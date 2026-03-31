import { Prisma } from "../../../../generated/prisma/client.js";
import prisma from "../../../../config/prisma.js";
import {
    RequestDeliveryOrderDTO,
    QueryDeliveryOrderDTO,
    UpdateDeliveryOrderStatusDTO,
} from "./do.schema.js";
import {
    TransferStatus,
    TransferLocationType,
    MovementType,
    MovementEntityType,
    MovementRefType,
    MovementLocationType,
} from "../../../../generated/prisma/enums.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import ExcelJS from "exceljs";

function generateDONumber() {
    const date = new Date();
    const prefix = "DO";
    const ym = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
    const random = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, "0");
    return `${prefix}-${ym}-${random}`;
}

function generateDOBarcode() {
    const random = Math.floor(Math.random() * 1000000000000)
        .toString()
        .padStart(12, "0");
    return `DO${random}`;
}

export class DOService {
    static async create(payload: RequestDeliveryOrderDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const transfer_number = generateDONumber();
            const barcode = generateDOBarcode();

            const orderDate = payload.date ? new Date(payload.date) : new Date();
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (orderDate < today) {
                throw new ApiError(400, "Tanggal DO tidak boleh di masa lalu.");
            }

            const transfer = await tx.stockTransfer.create({
                data: {
                    transfer_number,
                    barcode,
                    from_type: TransferLocationType.WAREHOUSE,
                    from_warehouse_id: payload.from_warehouse_id,
                    to_type: TransferLocationType.OUTLET,
                    to_outlet_id: payload.to_outlet_id,
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
                    items: { include: { product: true } },
                    from_warehouse: true,
                    to_outlet: true,
                },
            });
            return transfer;
        });
    }

    static async list(query: QueryDeliveryOrderDTO) {
        const {
            page = 1,
            take = 10,
            sortBy = "created_at",
            sortOrder = "desc",
            search,
            status,
            from_warehouse_id,
            to_outlet_id,
        } = query;

        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.StockTransferWhereInput = {
            from_type: TransferLocationType.WAREHOUSE,
            to_type: TransferLocationType.OUTLET,
            ...(search && {
                OR: [
                    { transfer_number: { contains: search, mode: "insensitive" } },
                    { barcode: { contains: search, mode: "insensitive" } },
                ],
            }),
            ...(status && { status }),
            ...(from_warehouse_id && { from_warehouse_id }),
            ...(to_outlet_id && { to_outlet_id }),
        };

        const [data, len] = await Promise.all([
            prisma.stockTransfer.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy as any]: sortOrder },
                include: {
                    items: { include: { product: true } },
                    from_warehouse: true,
                    to_outlet: true,
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
                items: { include: { product: true } },
                from_warehouse: true,
                to_outlet: true,
                photos: true,
            },
        });

        if (!result) throw new ApiError(404, "Data Delivery Order tidak ditemukan");
        // Ensure it's actually a DO
        if (
            result.from_type !== TransferLocationType.WAREHOUSE ||
            result.to_type !== TransferLocationType.OUTLET
        ) {
            throw new ApiError(403, "Akses ditolak: Data ini bukan merupakan Delivery Order.");
        }

        return result;
    }

    static async updateStatus(
        id: number,
        payload: UpdateDeliveryOrderStatusDTO,
        userId: string = "system",
    ) {
        return await prisma.$transaction(async (tx) => {
            const transfer = await tx.stockTransfer.findUnique({
                where: { id },
                include: { items: { include: { product: true } } },
            });

            if (!transfer) throw new ApiError(404, "Data Delivery Order tidak ditemukan");
            if (
                transfer.from_type !== TransferLocationType.WAREHOUSE ||
                transfer.to_type !== TransferLocationType.OUTLET
            ) {
                throw new ApiError(400, "Tipe data tidak valid untuk pembaruan status DO.");
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
                updateData.approved_at = new Date();
                updateData.approved_by = userId;
            }

            if (finalStatus === TransferStatus.CANCELLED) {
                if (transfer.status === TransferStatus.RECEIVED) {
                    throw new ApiError(
                        400,
                        "Tidak dapat membatalkan DO yang sudah diterima (RECEIVED).",
                    );
                }

                if (transfer.status === TransferStatus.SHIPMENT && transfer.from_warehouse_id) {
                    // Revert stock to warehouse
                    await this.revertWarehouseInventory(
                        tx,
                        transfer.from_warehouse_id,
                        transfer.items,
                        transfer.id,
                        userId,
                    );
                }
                // updateData.cancelled_at = new Date();
                // updateData.cancelled_by = userId;
            }

            if (finalStatus === TransferStatus.SHIPMENT) {
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
            }

            if (finalStatus === TransferStatus.RECEIVED) {
                updateData.received_at = new Date();
                updateData.received_notes = payload.notes;

                // When marked as RECEIVED from the simple button UI, 
                // we assume all items are received perfectly to SHOP.
                const itemsToProcess = [];
                for (const item of transfer.items) {
                    const receivedQty = Number(item.quantity_packed || item.quantity_requested);
                    
                    await tx.stockTransferItem.update({
                        where: { id: item.id },
                        data: { 
                            quantity_received: receivedQty,
                            quantity_fulfilled: receivedQty,
                        },
                    });

                    itemsToProcess.push({
                        product_id: item.product_id,
                        quantity_fulfilled: receivedQty,
                    });
                }

                if (itemsToProcess.length > 0 && transfer.to_outlet_id) {
                    await this.addOutletInventory(
                        tx,
                        transfer.to_outlet_id,
                        itemsToProcess,
                        transfer.id,
                        userId,
                    );
                }

                // Smooth transition to COMPLETED if it's the standard flow
                updateData.status = TransferStatus.COMPLETED;
            }

            if (finalStatus === TransferStatus.FULFILLMENT) {
                updateData.fulfilled_at = new Date();
                updateData.fulfillment_notes = payload.notes;

                if (!payload.items || payload.items.length === 0) {
                    throw new ApiError(400, "Daftar item diperlukan untuk tahap FULFILLMENT.");
                }

                let allPerfect = true;
                let anyFulfilled = false;
                let anyRejected = false;
                let anyMissing = false;

                const receivedMap = new Map();
                for (const reqItem of payload.items) {
                    const dbItem = transfer.items.find((i: any) => i.id === reqItem.id);
                    if (!dbItem) throw new ApiError(400, `Item ${reqItem.id} tidak ditemukan`);

                    const fulfilled = reqItem.quantity_fulfilled || 0;
                    const missing = reqItem.quantity_missing || 0;
                    const rejected = reqItem.quantity_rejected || 0;

                    const expectedAmount = Number(
                        dbItem.quantity_packed || dbItem.quantity_requested,
                    );
                    if (fulfilled + missing + rejected !== expectedAmount) {
                        throw new ApiError(
                            400,
                            `Total fulfilled, missing, dan rejected untuk produk ${dbItem.product_id} harus sesuai dengan kuantitas pack (${expectedAmount})`,
                        );
                    }

                    if (fulfilled > 0) anyFulfilled = true;
                    if (missing > 0) anyMissing = true;
                    if (rejected > 0) anyRejected = true;
                    if (fulfilled !== expectedAmount) allPerfect = false;

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

                if (fulfilledItemsList.length > 0 && transfer.to_outlet_id) {
                    await this.addOutletInventory(
                        tx,
                        transfer.to_outlet_id,
                        fulfilledItemsList,
                        transfer.id,
                        userId,
                    );
                }

                if (allPerfect) {
                    updateData.status = TransferStatus.COMPLETED;
                } else if (anyRejected && !anyFulfilled) {
                    updateData.status = TransferStatus.REJECTED;
                } else if (anyMissing && !anyFulfilled) {
                    updateData.status = TransferStatus.MISSING;
                } else {
                    updateData.status = TransferStatus.PARTIAL;
                }
            }

            const updatedDO = await tx.stockTransfer.update({
                where: { id },
                data: updateData,
                include: {
                    items: { include: { product: true } },
                    from_warehouse: true,
                    to_outlet: true,
                },
            });

            return updatedDO;
        });
    }

    static async export(query: QueryDeliveryOrderDTO) {
        const { data } = await this.list({ ...query, take: 1000000, page: 1 });

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Data Delivery Order");

        sheet.columns = [
            { header: "No", key: "no", width: 5 },
            { header: "No. DO", key: "transfer_number", width: 20 },
            { header: "Barcode", key: "barcode", width: 20 },
            { header: "Tanggal", key: "date", width: 15 },
            { header: "Gudang (Asal)", key: "from_warehouse", width: 25 },
            { header: "Outlet (Tujuan)", key: "to_outlet", width: 25 },
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
                to_outlet: item.to_outlet?.name || "-",
                status: item.status,
                created_by: item.created_by,
                notes: item.notes || "-",
            });
        });

        // Styling
        sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0070C0" } };
        sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

        return await workbook.xlsx.writeBuffer();
    }

    static async exportDetail(id: number) {
        const doRecord = await prisma.stockTransfer.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        product: {
                            include: { product_type: true, size: true, unit: true },
                        },
                    },
                },
                from_warehouse: true,
                to_outlet: true,
            },
        });

        if (!doRecord) throw new ApiError(404, "Data Delivery Order tidak ditemukan");

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet(`DO ${doRecord.transfer_number}`);

        sheet.mergeCells("A1:D1");
        sheet.getCell("A1").value = "PERFORMENCE ERP - DELIVERY ORDER";
        sheet.getCell("A1").font = { bold: true, size: 16 };
        sheet.getCell("A1").alignment = { horizontal: "center" };

        sheet.addRow([]);
        sheet.addRow(["No. Dokumen", doRecord.transfer_number]);
        sheet.addRow(["Barcode", doRecord.barcode]);
        sheet.addRow([
            "Tanggal",
            doRecord.created_at ? new Date(doRecord.created_at).toLocaleDateString("id-ID") : "-",
        ]);
        sheet.addRow(["Gudang Asal", doRecord.from_warehouse?.name || "-"]);
        sheet.addRow(["Outlet Tujuan", doRecord.to_outlet?.name || "-"]);
        sheet.addRow(["Status", doRecord.status]);
        sheet.addRow(["Dibuat Oleh", doRecord.created_by]);

        sheet.addRow([]);

        const tableHeaderRow = [
            "No",
            "SKU / Code",
            "Nama Produk",
            "Qty (Requested)",
            "Qty (Packed)",
            "Qty (Fulfilled)",
        ];
        sheet.addRow(tableHeaderRow);
        const headerRowNumber = sheet.rowCount;

        doRecord.items.forEach((item, index) => {
            const p = item.product;
            const fullProductName =
                `${p.name} ${p.product_type?.name.toLocaleUpperCase() || ""} ${p.size?.size || ""}${p.unit?.name.toLocaleUpperCase() || ""} (${p.gender})`
                    .replace(/\s+/g, " ")
                    .trim();

            sheet.addRow([
                index + 1,
                p.code,
                fullProductName,
                Number(item.quantity_requested),
                Number(item.quantity_packed || 0),
                Number(item.quantity_fulfilled || 0),
            ]);
        });

        const headerRow = sheet.getRow(headerRowNumber);
        headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
        headerRow.eachCell((cell) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0070C0" } };
            cell.alignment = { horizontal: "center", vertical: "middle" };
            cell.border = {
                top: { style: "thin" },
                left: { style: "thin" },
                bottom: { style: "thin" },
                right: { style: "thin" },
            };
        });

        return await workbook.xlsx.writeBuffer();
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
                // If inventory record doesn't even exist, something is wrong, but let's be safe
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
                    movement_type: MovementType.TRANSFER_IN, // Returning stock
                    quantity: revertAmount,
                    qty_before,
                    qty_after,
                    reference_id: transfer_id,
                    reference_type: MovementRefType.STOCK_TRANSFER,
                    created_by: userId,
                    notes: "Batal (Cancellation)",
                },
            });
        }
    }

    private static async addOutletInventory(
        tx: any,
        outlet_id: number,
        items: any[],
        transfer_id: number,
        userId: string,
    ) {
        for (const item of items) {
            const addAmount = Number(item.quantity_fulfilled);
            let oi = await tx.outletInventory.findUnique({
                where: { outlet_id_product_id: { outlet_id, product_id: item.product_id } },
            });

            let qty_before = oi ? Number(oi.quantity) : 0;

            if (oi) {
                await tx.outletInventory.update({
                    where: { id: oi.id },
                    data: { quantity: qty_before + addAmount },
                });
            } else {
                await tx.outletInventory.create({
                    data: {
                        outlet_id,
                        product_id: item.product_id,
                        quantity: addAmount,
                    },
                });
            }

            const qty_after = qty_before + addAmount;

            await tx.stockMovement.create({
                data: {
                    entity_type: MovementEntityType.PRODUCT,
                    entity_id: item.product_id,
                    location_type: MovementLocationType.OUTLET,
                    location_id: outlet_id,
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

    static async getStock(warehouse_id?: number, outlet_id?: number, product_id?: number) {
        if (warehouse_id) {
            const pi = await prisma.productInventory.findFirst({
                where: { product_id, warehouse_id },
                orderBy: [{ year: "desc" }, { month: "desc" }, { date: "desc" }, { id: "desc" }],
            });
            return Number(pi?.quantity || 0);
        }

        if (outlet_id) {
            const oi = await prisma.outletInventory.findUnique({
                where: { outlet_id_product_id: { outlet_id, product_id: Number(product_id) } },
            });
            return Number(oi?.quantity || 0);
        }

        return 0;
    }
}
