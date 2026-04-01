import { Prisma } from "../../../../generated/prisma/client.js";
import prisma from "../../../../config/prisma.js";
import {
    RequestTransferGudangDTO,
    QueryTransferGudangDTO,
    UpdateTransferGudangStatusDTO,
} from "./tg.schema.js";
import {
    TransferStatus,
    TransferLocationType,
    MovementType,
    MovementEntityType,
    MovementRefType,
    MovementLocationType,
    TransferPhotoStage,
} from "../../../../generated/prisma/enums.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import ExcelJS from "exceljs";
import { ReturnService } from "../return/return.service.js";

function generateTGNumber() {
    const date = new Date();
    const prefix = "TG";
    const ym = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
    const random = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, "0");
    return `${prefix}-${ym}-${random}`;
}

function generateTGBarcode() {
    const random = Math.floor(Math.random() * 1000000000000)
        .toString()
        .padStart(12, "0");
    return `TG${random}`;
}

export class TGService {
    static async create(payload: RequestTransferGudangDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const transfer_number = generateTGNumber();
            const barcode = generateTGBarcode();

            const orderDate = payload.date ? new Date(payload.date) : new Date();
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (orderDate < today) {
                throw new ApiError(400, "Tanggal TG tidak boleh di masa lalu.");
            }

            if (payload.from_warehouse_id === payload.to_warehouse_id) {
                throw new ApiError(400, "Gudang asal dan tujuan tidak boleh sama.");
            }

            const transfer = await tx.stockTransfer.create({
                data: {
                    transfer_number,
                    barcode,
                    from_type: TransferLocationType.WAREHOUSE,
                    from_warehouse_id: payload.from_warehouse_id,
                    to_type: TransferLocationType.WAREHOUSE,
                    to_warehouse_id: payload.to_warehouse_id,
                    status: TransferStatus.PENDING,
                    notes: payload.notes,
                    date: orderDate,
                    created_by: userId,
                    items: {
                        create: payload.items.map((i) => ({
                            product_id: i.product_id,
                            quantity_requested: i.quantity_requested,
                            notes: i.notes,
                        })),
                    },
                },
                include: {
                    items: {
                        include: {
                            product: {
                                include: { product_type: true, size: true, unit: true }
                            }
                        }
                    },
                    from_warehouse: true,
                    to_warehouse: true,
                },
            });
            return transfer;
        });
    }

    static async list(query: QueryTransferGudangDTO) {
        const {
            page = 1,
            take = 10,
            sortBy = "created_at",
            sortOrder = "desc",
            search,
            status,
            from_warehouse_id,
            to_warehouse_id,
        } = query;

        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.StockTransferWhereInput = {
            from_type: TransferLocationType.WAREHOUSE,
            to_type: TransferLocationType.WAREHOUSE,
            ...(search && {
                OR: [
                    { transfer_number: { contains: search, mode: "insensitive" } },
                    { barcode: { contains: search, mode: "insensitive" } },
                ],
            }),
            ...(status && { status }),
            ...(from_warehouse_id && { from_warehouse_id }),
            ...(to_warehouse_id && { to_warehouse_id }),
        };

        const [data, len] = await Promise.all([
            prisma.stockTransfer.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy as any]: sortOrder },
                include: {
                    items: {
                        include: {
                            product: {
                                include: { product_type: true, size: true, unit: true }
                            }
                        }
                    },
                    from_warehouse: true,
                    to_warehouse: true,
                },
            }),
            prisma.stockTransfer.count({ where }),
        ]);

        return { data, len };
    }

    static async detail(id: number) {
        const result = await prisma.stockTransfer.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        product: {
                            include: { product_type: true, size: true, unit: true }
                        }
                    }
                },
                from_warehouse: true,
                to_warehouse: true,
                photos: true,
            },
        });

        if (!result) throw new ApiError(404, "Data Transfer Gudang tidak ditemukan");
        
        if (
            result.from_type !== TransferLocationType.WAREHOUSE ||
            result.to_type !== TransferLocationType.WAREHOUSE
        ) {
            throw new ApiError(403, "Akses ditolak: Data ini bukan merupakan Transfer Gudang.");
        }

        return result;
    }

    static async updateStatus(
        id: number,
        payload: UpdateTransferGudangStatusDTO,
        userId: string = "system",
    ) {
        return await prisma.$transaction(async (tx) => {
            const transfer = await tx.stockTransfer.findUnique({
                where: { id },
                include: { 
                    items: { 
                        include: { 
                            product: {
                                include: { product_type: true, size: true, unit: true }
                            } 
                        } 
                    } 
                },
            });

            if (!transfer) throw new ApiError(404, "Data Transfer Gudang tidak ditemukan");
            if (
                transfer.from_type !== TransferLocationType.WAREHOUSE ||
                transfer.to_type !== TransferLocationType.WAREHOUSE
            ) {
                throw new ApiError(400, "Tipe data tidak valid untuk pembaruan status TG.");
            }

            if (
                transfer.status === TransferStatus.COMPLETED ||
                transfer.status === TransferStatus.CANCELLED
            ) {
                throw new ApiError(
                    400,
                    `Tidak dapat memperbarui transfer dengan status ${transfer.status}`,
                );
            }

            let finalStatus = payload.status;
            const updateData: any = { status: finalStatus };

            if (finalStatus === TransferStatus.APPROVED) {
                if (transfer.status !== TransferStatus.PENDING) {
                    throw new ApiError(400, "Hanya TG berstatus PENDING yang dapat disetujui (APPROVED).");
                }
                updateData.approved_at = new Date();
                updateData.approved_by = userId;
            }

            if (finalStatus === TransferStatus.CANCELLED) {
                if (
                    transfer.status === TransferStatus.REJECTED ||
                    transfer.status === TransferStatus.MISSING
                ) {
                    throw new ApiError(
                        400,
                        `Tidak dapat membatalkan TG yang sudah pada tahap ${transfer.status}.`,
                    );
                }


                if ((transfer.status === TransferStatus.SHIPMENT || transfer.status === TransferStatus.RECEIVED) && transfer.from_warehouse_id) {
                    await this.revertWarehouseInventory(
                        tx,
                        transfer.from_warehouse_id,
                        transfer.items,
                        transfer.id,
                        userId,
                    );
                }
                updateData.cancelled_at = new Date();
                updateData.cancelled_by = userId;
            }

            if (finalStatus === TransferStatus.SHIPMENT) {
                if (transfer.status !== TransferStatus.APPROVED) {
                    throw new ApiError(400, "TG harus disetujui (APPROVED) sebelum dikirim (SHIPMENT).");
                }
                updateData.shipped_at = new Date();
                updateData.shipment_notes = payload.notes;

                if (payload.items) {
                    for (const reqItem of payload.items) {
                        if (reqItem.quantity_packed !== undefined) {
                            await tx.stockTransferItem.update({
                                where: { id: reqItem.id },
                                data: { quantity_packed: reqItem.quantity_packed },
                            });
                        }
                    }
                }

                if (transfer.from_warehouse_id) {
                    await this.deductWarehouseInventory(
                        tx,
                        transfer.from_warehouse_id,
                        transfer.items,
                        transfer.id,
                        userId,
                    );
                }

                if (payload.photos && payload.photos.length > 0) {
                    await tx.stockTransferPhoto.createMany({
                        data: payload.photos.map((url: string) => ({
                            transfer_id: id,
                            url,
                            stage: TransferPhotoStage.SHIPMENT,
                            uploaded_by: userId,
                        })),
                    });
                }
            }

            if (finalStatus === TransferStatus.RECEIVED) {
                if (transfer.status !== TransferStatus.SHIPMENT) {
                    throw new ApiError(400, "Hanya TG berstatus SHIPMENT yang dapat diterima (RECEIVED).");
                }
                updateData.received_at = new Date();
                updateData.received_notes = payload.notes;

                if (payload.items) {
                    for (const reqItem of payload.items) {
                        if (reqItem.quantity_received !== undefined) {
                            await tx.stockTransferItem.update({
                                where: { id: reqItem.id },
                                data: { quantity_received: reqItem.quantity_received },
                            });
                        }
                    }
                }

                if (payload.photos && payload.photos.length > 0) {
                    await tx.stockTransferPhoto.createMany({
                        data: payload.photos.map((url: string) => ({
                            transfer_id: id,
                            url,
                            stage: TransferPhotoStage.RECEIVED,
                            uploaded_by: userId,
                        })),
                    });
                }
            }

            if (finalStatus === TransferStatus.FULFILLMENT) {
                if (transfer.status !== TransferStatus.RECEIVED) {
                    throw new ApiError(400, "Data harus berstatus RECEIVED sebelum tahap FULFILLMENT.");
                }
                updateData.fulfilled_at = new Date();
                updateData.fulfillment_notes = payload.notes;

                if (!payload.items || payload.items.length !== transfer.items.length) {
                    throw new ApiError(400, "Semua item dalam TG harus diverifikasi pada tahap FULFILLMENT.");
                }

                const receivedMap = new Map();
                for (const reqItem of payload.items) {
                    const dbItem = transfer.items.find((i: any) => i.id === reqItem.id);
                    if (!dbItem) throw new ApiError(400, `Item ID ${reqItem.id} tidak valid untuk TG ini.`);

                    const fulfilled = Number(reqItem.quantity_fulfilled || 0);
                    const missing = Number(reqItem.quantity_missing || 0);
                    const rejected = Number(reqItem.quantity_rejected || 0);

                    if (fulfilled < 0 || missing < 0 || rejected < 0) {
                        throw new ApiError(400, "Kuantitas tidak boleh bernilai negatif.");
                    }

                    const expectedAmount = Number(
                        dbItem.quantity_packed || dbItem.quantity_requested,
                    );

                    if (Math.abs((fulfilled + missing + rejected) - expectedAmount) > 0.0001) {
                        const pName = dbItem.product?.name || "Produk";
                        throw new ApiError(
                            400,
                            `Total fulfilled, missing, dan rejected untuk ${pName} (${fulfilled + missing + rejected}) tidak sesuai dengan Pack (${expectedAmount}).`,
                        );
                    }

                    await tx.stockTransferItem.update({
                        where: { id: reqItem.id },
                        data: {
                            quantity_fulfilled: fulfilled,
                            quantity_missing: missing,
                            quantity_rejected: rejected,
                        },
                    });

                    receivedMap.set(dbItem.product_id, fulfilled);
                }

                const fulfilledItemsList = transfer.items
                    .map((i: any) => ({
                        product_id: i.product_id,
                        quantity_fulfilled: receivedMap.get(i.product_id) || 0,
                    }))
                    .filter((i) => i.quantity_fulfilled > 0);

                if (fulfilledItemsList.length > 0 && transfer.to_warehouse_id) {
                    await this.addWarehouseInventory(
                        tx,
                        transfer.to_warehouse_id,
                        fulfilledItemsList,
                        transfer.id,
                        userId,
                    );
                }

                updateData.status = TransferStatus.COMPLETED;

                // Handle Rejections -> Create Draft Return
                const anyRejected = payload.items.some((i: any) => Number(i.quantity_rejected || 0) > 0);
                if (anyRejected) {
                    const latestTransfer = await tx.stockTransfer.findUnique({
                        where: { id },
                        include: { items: true }
                    });
                    
                    if (latestTransfer) {
                        const pusatSBY = await tx.warehouse.findFirst({
                            where: { code: "GFG-SBY" }
                        });
                        
                        const targetWarehouseId = pusatSBY?.id || transfer.from_warehouse_id || undefined;
                        
                        await ReturnService.createFromRejection(
                            tx, 
                            latestTransfer, 
                            userId, 
                            targetWarehouseId
                        );
                    }
                }
            }

            const updatedTG = await tx.stockTransfer.update({
                where: { id },
                data: updateData,
                include: {
                    items: {
                        include: {
                            product: {
                                include: { product_type: true, size: true, unit: true }
                            }
                        }
                    },
                    from_warehouse: true,
                    to_warehouse: true,
                },
            });

            return updatedTG;
        });
    }

    private static async deductWarehouseInventory(
        tx: any,
        warehouse_id: number,
        items: any[],
        transfer_id: number,
        userId: string,
    ) {
        for (const item of items) {
            const deductAmount = Number(item.quantity_packed || item.quantity_requested);

            let pi = await tx.productInventory.findFirst({
                where: { product_id: item.product_id, warehouse_id },
                orderBy: { created_at: "desc" },
            });

            if (!pi || Number(pi.quantity) < deductAmount) {
                const productName = item.product?.name || item.product_id;
                const productCode = item.product?.code ? `[${item.product.code}] ` : "";
                throw new ApiError(
                    400,
                    `Stok tidak mencukupi di Gudang untuk produk ${productCode}${productName}`,
                );
            }

            const qty_before = Number(pi.quantity);
            const qty_after = qty_before - deductAmount;

            await tx.productInventory.update({
                where: { id: pi.id },
                data: { quantity: qty_after },
            });

            await tx.stockMovement.create({
                data: {
                    entity_type: MovementEntityType.PRODUCT,
                    entity_id: item.product_id,
                    location_type: MovementLocationType.WAREHOUSE,
                    location_id: warehouse_id,
                    movement_type: MovementType.TRANSFER_OUT,
                    quantity: deductAmount,
                    qty_before,
                    qty_after,
                    reference_id: transfer_id,
                    reference_type: MovementRefType.STOCK_TRANSFER,
                    created_by: userId,
                },
            });
        }
    }

    private static async revertWarehouseInventory(
        tx: any,
        warehouse_id: number,
        items: any[],
        transfer_id: number,
        userId: string,
    ) {
        for (const item of items) {
            const revertAmount = Number(item.quantity_packed || item.quantity_requested);

            let pi = await tx.productInventory.findFirst({
                where: { product_id: item.product_id, warehouse_id },
                orderBy: { created_at: "desc" },
            });

            if (!pi) {
                pi = await tx.productInventory.create({
                    data: {
                        product_id: item.product_id,
                        warehouse_id,
                        quantity: 0,
                    },
                });
            }

            const qty_before = Number(pi.quantity);
            const qty_after = qty_before + revertAmount;

            await tx.productInventory.update({
                where: { id: pi.id },
                data: { quantity: qty_after },
            });

            await tx.stockMovement.create({
                data: {
                    entity_type: MovementEntityType.PRODUCT,
                    entity_id: item.product_id,
                    location_type: MovementLocationType.WAREHOUSE,
                    location_id: warehouse_id,
                    movement_type: MovementType.TRANSFER_IN,
                    quantity: revertAmount,
                    qty_before,
                    qty_after,
                    reference_id: transfer_id,
                    reference_type: MovementRefType.STOCK_TRANSFER,
                    created_by: userId,
                    notes: "Batal Transfer Gudang",
                },
            });
        }
    }

    private static async addWarehouseInventory(
        tx: any,
        warehouse_id: number,
        items: any[],
        transfer_id: number,
        userId: string,
    ) {
        for (const item of items) {
            const addAmount = Number(item.quantity_fulfilled);
            
            let pi = await tx.productInventory.findFirst({
                where: { product_id: item.product_id, warehouse_id },
                orderBy: { created_at: "desc" },
            });

            let qty_before = 0;
            if (pi) {
                qty_before = Number(pi.quantity);
                await tx.productInventory.update({
                    where: { id: pi.id },
                    data: { quantity: qty_before + addAmount },
                });
            } else {
                await tx.productInventory.create({
                    data: {
                        product_id: item.product_id,
                        warehouse_id,
                        quantity: addAmount,
                    },
                });
            }

            const qty_after = qty_before + addAmount;

            await tx.stockMovement.create({
                data: {
                    entity_type: MovementEntityType.PRODUCT,
                    entity_id: item.product_id,
                    location_type: MovementLocationType.WAREHOUSE,
                    location_id: warehouse_id,
                    movement_type: MovementType.TRANSFER_IN,
                    quantity: addAmount,
                    qty_before,
                    qty_after,
                    reference_id: transfer_id,
                    reference_type: MovementRefType.STOCK_TRANSFER,
                    created_by: userId,
                },
            });
        }
    }

    static async getStock(warehouse_id: number, product_id: number) {
        const inventory = await prisma.productInventory.findFirst({
            where: {
                warehouse_id,
                product_id,
            },
            orderBy: { created_at: "desc" },
        });

        return Number(inventory?.quantity || 0);
    }

    static async export(query: QueryTransferGudangDTO) {
        const { data } = await this.list({ ...query, take: 1000000, page: 1 });

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Data Transfer Gudang");

        sheet.columns = [
            { header: "No", key: "no", width: 5 },
            { header: "No. TG", key: "transfer_number", width: 20 },
            { header: "Barcode", key: "barcode", width: 20 },
            { header: "Tanggal", key: "date", width: 15 },
            { header: "Gudang (Asal)", key: "from_warehouse", width: 25 },
            { header: "Gudang (Tujuan)", key: "to_warehouse", width: 25 },
            { header: "Status", key: "status", width: 15 },
            { header: "Dibuat Oleh", key: "created_by", width: 20 },
            { header: "Catatan", key: "notes", width: 30 },
        ];

        data.forEach((item, index) => {
            sheet.addRow({
                no: index + 1,
                transfer_number: item.transfer_number,
                barcode: item.barcode,
                date: item.created_at ? new Date(item.created_at).toLocaleDateString("id-ID") : "-",
                from_warehouse: item.from_warehouse?.name || "-",
                to_warehouse: item.to_warehouse?.name || "-",
                status: item.status,
                created_by: item.created_by,
                notes: item.notes || "-",
            });
        });

        sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0070C0" } };
        sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

        return await workbook.xlsx.writeBuffer();
    }
}
