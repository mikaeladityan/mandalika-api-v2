import { Prisma } from "../../../../../generated/prisma/client.js";
import prisma from "../../../../../config/prisma.js";
import { QueryRmReceiptDTO, UpdateRmReceiptItemDTO, UpdateRmStatusDTO } from "./rm-receipt.schema.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { 
    TransferStatus, 
    TransferLocationType, 
    MovementType, 
    MovementRefType, 
    MovementEntityType,
    TransferPhotoStage 
} from "../../../../../generated/prisma/enums.js";
import { InventoryHelper, StockItem } from "../../../inventory-v2/inventory.helper.js";

const RM_RECEIPT_INCLUDE = {
    production_order: true,
    from_warehouse: true,
    to_warehouse: true,
    items: {
        include: {
            raw_material: {
                include: {
                    unit_raw_material: true
                }
            }
        }
    },
    photos: true
} as const;

type TxClient = Prisma.TransactionClient;

export class RmReceiptService {
    static async list(query: QueryRmReceiptDTO) {
        const {
            page = 1,
            take = 10,
            search,
            status,
            fromDate,
            toDate,
        } = query;

        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.StockTransferWhereInput = {
            production_order_id: { not: null },
            // Filter to only RM transfers (items MUST HAVE raw_material_id)
            items: {
                some: { raw_material_id: { not: null } }
            },
            ...(status && { status }),
            ...(fromDate || toDate ? {
                date: {
                    ...(fromDate && { gte: new Date(fromDate) }),
                    ...(toDate && { lte: new Date(new Date(toDate).setHours(23, 59, 59, 999)) }),
                }
            } : {}),
            ...(search && {
                OR: [
                    { transfer_number: { contains: search, mode: "insensitive" } },
                    { notes: { contains: search, mode: "insensitive" } },
                    { production_order: { mfg_number: { contains: search, mode: "insensitive" } } }
                ]
            })
        };

        const [data, total] = await Promise.all([
            prisma.stockTransfer.findMany({
                where,
                skip,
                take: limit,
                orderBy: { created_at: "desc" },
                include: RM_RECEIPT_INCLUDE
            }),
            prisma.stockTransfer.count({ where }),
        ]);

        return { data, total };
    }

    static async detail(id: number) {
        const result = await prisma.stockTransfer.findUnique({
            where: { id },
            include: RM_RECEIPT_INCLUDE
        });

        if (!result) throw new ApiError(404, "Data Penerimaan RM tidak ditemukan");
        return result;
    }

    static async updateItems(id: number, payload: UpdateRmReceiptItemDTO, userId: string) {
        return await prisma.$transaction(async (tx) => {
            const transfer = await tx.stockTransfer.findUnique({
                where: { id },
                include: { items: true }
            });

            if (!transfer) throw new ApiError(404, "Transfer tidak ditemukan");
            if (transfer.status !== TransferStatus.PENDING) {
                throw new ApiError(400, "Hanya draf transfer (PENDING) yang dapat diubah kuantitasnya");
            }

            for (const itemUpdate of payload.items) {
                const dbItem = transfer.items.find(i => i.id === itemUpdate.id);
                if (!dbItem) throw new ApiError(400, `Item ID ${itemUpdate.id} tidak ditemukan dalam transfer ini`);

                await tx.stockTransferItem.update({
                    where: { id: itemUpdate.id },
                    data: { quantity_requested: itemUpdate.quantity_requested }
                });
            }

            return await tx.stockTransfer.findUnique({
                where: { id },
                include: RM_RECEIPT_INCLUDE
            });
        });
    }

    static async updateStatus(id: number, payload: UpdateRmStatusDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const transfer = await tx.stockTransfer.findUnique({
                where: { id },
                include: { 
                    items: { 
                        include: { 
                            raw_material: {
                                include: {
                                    unit_raw_material: true
                                }
                            }
                        } 
                    } 
                },
            });

            if (!transfer) throw new ApiError(404, "Data Penerimaan RM tidak ditemukan");
            
            if (!transfer.production_order_id) {
                throw new ApiError(400, "TRM ini tidak valid (tidak terhubung ke Pesanan Manufaktur).");
            }

            if (transfer.status === TransferStatus.COMPLETED || transfer.status === TransferStatus.CANCELLED) {
                throw new ApiError(400, `Tidak dapat memperbarui transfer dengan status ${transfer.status}`);
            }

            let updateData: Prisma.StockTransferUpdateInput = { status: payload.status };

            if (payload.status === TransferStatus.APPROVED) {
                if (transfer.status !== TransferStatus.PENDING) {
                    throw new ApiError(400, "Hanya TRM berstatus PENDING yang dapat disetujui (APPROVED).");
                }
                updateData = { ...updateData, approved_at: new Date(), approved_by: userId };
            }

            if (payload.status === TransferStatus.CANCELLED) {
                updateData = await this._handleCancellation(tx, transfer, updateData, userId);
            }

            if (payload.status === TransferStatus.SHIPMENT) {
                updateData = await this._handleShipment(tx, transfer, payload, updateData, userId);
            }

            if (payload.status === TransferStatus.RECEIVED) {
                updateData = await this._handleReceived(tx, transfer, payload, updateData, userId);
            }

            if (payload.status === TransferStatus.FULFILLMENT) {
                updateData = await this._handleFulfillment(tx, transfer, payload, updateData, userId);
            }

            return await tx.stockTransfer.update({
                where: { id },
                data: updateData,
                include: RM_RECEIPT_INCLUDE,
            });
        });
    }

    private static async _handleCancellation(
        tx: TxClient,
        transfer: any,
        updateData: Prisma.StockTransferUpdateInput,
        userId: string,
    ): Promise<Prisma.StockTransferUpdateInput> {
        if (transfer.status === TransferStatus.REJECTED || transfer.status === TransferStatus.MISSING) {
            throw new ApiError(400, `Tidak dapat membatalkan TRM yang sudah pada tahap ${transfer.status}.`);
        }

        if (
            (transfer.status === TransferStatus.SHIPMENT || transfer.status === TransferStatus.RECEIVED) &&
            transfer.from_warehouse_id
        ) {
            const items: StockItem[] = transfer.items.map((i: any) => ({
                raw_material_id: i.raw_material_id,
                quantity: Number(i.quantity_packed || i.quantity_requested),
                raw_material: i.raw_material,
            }));
            
            await InventoryHelper.addWarehouseStock(
                tx, 
                transfer.from_warehouse_id, 
                items,
                transfer.id, 
                MovementRefType.STOCK_TRANSFER, 
                MovementType.TRANSFER_IN, 
                userId,
                "Batal Penerimaan RM",
                MovementEntityType.RAW_MATERIAL
            );
        }

        return { ...updateData, cancelled_at: new Date(), cancelled_by: userId };
    }

    private static async _handleShipment(
        tx: TxClient,
        transfer: any,
        payload: UpdateRmStatusDTO,
        updateData: Prisma.StockTransferUpdateInput,
        userId: string,
    ): Promise<Prisma.StockTransferUpdateInput> {
        if (transfer.status !== TransferStatus.APPROVED) {
            throw new ApiError(400, "TRM harus disetujui (APPROVED) sebelum dikirim (SHIPMENT).");
        }

        if (payload.items) {
            await Promise.all(
                payload.items.map((i) =>
                    tx.stockTransferItem.update({
                        where: { id: i.id },
                        data: { quantity_packed: i.quantity_packed },
                    }),
                ),
            );
        }

        if (transfer.from_warehouse_id) {
            const items: StockItem[] = transfer.items.map((i: any) => {
                const updatedItem = payload.items?.find(pi => pi.id === i.id);
                return {
                    raw_material_id: i.raw_material_id,
                    quantity: Number(updatedItem?.quantity_packed ?? i.quantity_requested),
                    raw_material: i.raw_material,
                };
            });
            
            await InventoryHelper.deductWarehouseStock(
                tx, 
                transfer.from_warehouse_id, 
                items,
                transfer.id, 
                MovementRefType.STOCK_TRANSFER, 
                MovementType.TRANSFER_OUT, 
                userId,
                MovementEntityType.RAW_MATERIAL
            );
        }

        if (payload.photos && payload.photos.length > 0) {
            await tx.stockTransferPhoto.createMany({
                data: payload.photos.map((url: string) => ({
                    transfer_id: transfer.id,
                    url,
                    stage: TransferPhotoStage.SHIPMENT,
                    uploaded_by: userId,
                })),
            });
        }

        return { ...updateData, shipped_at: new Date(), shipment_notes: payload.notes };
    }

    private static async _handleReceived(
        tx: TxClient,
        transfer: any,
        payload: UpdateRmStatusDTO,
        updateData: Prisma.StockTransferUpdateInput,
        userId: string,
    ): Promise<Prisma.StockTransferUpdateInput> {
        if (transfer.status !== TransferStatus.SHIPMENT) {
            throw new ApiError(400, "Hanya TRM berstatus SHIPMENT yang dapat diterima (RECEIVED).");
        }

        if (payload.items) {
            await Promise.all(
                payload.items.map((i) =>
                    tx.stockTransferItem.update({
                        where: { id: i.id },
                        data: { quantity_received: i.quantity_received },
                    }),
                ),
            );
        }

        if (payload.photos && payload.photos.length > 0) {
            await tx.stockTransferPhoto.createMany({
                data: payload.photos.map((url: string) => ({
                    transfer_id: transfer.id,
                    url,
                    stage: TransferPhotoStage.RECEIVED,
                    uploaded_by: userId,
                })),
            });
        }

        return { ...updateData, received_at: new Date(), received_notes: payload.notes };
    }

    private static async _handleFulfillment(
        tx: TxClient,
        transfer: any,
        payload: UpdateRmStatusDTO,
        updateData: Prisma.StockTransferUpdateInput,
        userId: string,
    ): Promise<Prisma.StockTransferUpdateInput> {
        if (transfer.status !== TransferStatus.RECEIVED) {
            throw new ApiError(400, "Data harus berstatus RECEIVED sebelum tahap FULFILLMENT.");
        }
        
        if (!payload.items || payload.items.length !== transfer.items.length) {
            throw new ApiError(400, "Semua item dalam TRM harus diverifikasi pada tahap FULFILLMENT.");
        }

        const fulfilledItems: StockItem[] = [];
        let hasDiscrepancy = false;

        for (const reqItem of payload.items) {
            const dbItem = transfer.items.find((i: any) => i.id === reqItem.id);
            if (!dbItem) throw new ApiError(400, `Item ID ${reqItem.id} tidak valid untuk TRM ini.`);

            const fulfilled = Number(reqItem.quantity_fulfilled ?? 0);
            const missing = Number(reqItem.quantity_missing ?? 0);
            const rejected = Number(reqItem.quantity_rejected ?? 0);
            const expected = Number(dbItem.quantity_packed || dbItem.quantity_requested);

            if (fulfilled < 0 || missing < 0 || rejected < 0) {
                throw new ApiError(400, "Kuantitas tidak boleh bernilai negatif.");
            }

            if (Math.abs(fulfilled + missing + rejected - expected) > 0.0001) {
                throw new ApiError(
                    400,
                    `Total verifikasi untuk item ID ${dbItem.id} (${fulfilled + missing + rejected}) tidak sesuai dengan Qty Kirim (${expected}).`,
                );
            }

            if (missing > 0 || rejected > 0) hasDiscrepancy = true;

            await tx.stockTransferItem.update({
                where: { id: reqItem.id },
                data: { quantity_fulfilled: fulfilled, quantity_missing: missing, quantity_rejected: rejected },
            });

            if (fulfilled > 0) {
                fulfilledItems.push({
                    raw_material_id: dbItem.raw_material_id,
                    quantity: fulfilled,
                    raw_material: dbItem.raw_material,
                });
            }
        }

        if (fulfilledItems.length > 0 && transfer.to_warehouse_id) {
            await InventoryHelper.addWarehouseStock(
                tx, 
                transfer.to_warehouse_id, 
                fulfilledItems,
                transfer.id, 
                MovementRefType.STOCK_TRANSFER, 
                MovementType.TRANSFER_IN, 
                userId,
                "Terima Bahan Baku Manufaktur",
                MovementEntityType.RAW_MATERIAL
            );
        }

        const finalStatus = hasDiscrepancy ? TransferStatus.PARTIAL : TransferStatus.COMPLETED;

        return {
            ...updateData,
            status: finalStatus,
            fulfilled_at: new Date(),
            fulfillment_notes: payload.notes,
        };
    }
}
