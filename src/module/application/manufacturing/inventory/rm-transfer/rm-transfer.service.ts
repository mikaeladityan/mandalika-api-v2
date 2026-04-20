import { Prisma } from "../../../../../generated/prisma/client.js";
import prisma from "../../../../../config/prisma.js";
import { 
    CreateRmTransferDTO, 
    QueryRmTransferDTO, 
    UpdateRmTransferStatusDTO 
} from "./rm-transfer.schema.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { 
    TransferStatus, 
    TransferLocationType, 
    MovementType, 
    MovementRefType, 
    MovementEntityType,
    TransferPhotoStage,
    WasteType
} from "../../../../../generated/prisma/enums.js";
import { InventoryHelper, StockItem } from "../../../inventory-v2/inventory.helper.js";
import { generateDocNumber, generateDocBarcode } from "../../../inventory-v2/inventory.constants.js";

const RM_TRANSFER_INCLUDE = {
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

export class RmTransferService {
    static async detail(id: number) {
        const result = await prisma.stockTransfer.findUnique({
            where: { id },
            include: RM_TRANSFER_INCLUDE
        });

        if (!result) throw new ApiError(404, "Data Transfer RM tidak ditemukan");
        return result;
    }

    static async getStock(rmId: number, warehouseId: number): Promise<number> {
        // Get the latest period for this RM and Warehouse
        const latestPeriod = await prisma.rawMaterialInventory.findFirst({
            where: { raw_material_id: rmId, warehouse_id: warehouseId },
            orderBy: [{ year: "desc" }, { month: "desc" }],
            select: { month: true, year: true },
        });

        if (!latestPeriod) return 0;

        // Sum up quantities for that month (consistent with InventoryHelper)
        const records = await prisma.rawMaterialInventory.findMany({
            where: {
                raw_material_id: rmId,
                warehouse_id: warehouseId,
                month: latestPeriod.month,
                year: latestPeriod.year,
            },
        });

        return records.reduce((sum: number, r: any) => sum + Number(r.quantity), 0);
    }

    static async stockCheck(query: any) {
        const rmId = Number(query.raw_material_id);
        const whId = Number(query.warehouse_id);
        
        if (!rmId || !whId) throw new ApiError(400, "Raw Material ID and Warehouse ID are required.");

        const stock = await this.getStock(rmId, whId);
        return { quantity: stock };
    }

    static async create(payload: CreateRmTransferDTO, userId: string = "system") {
        const orderDate = new Date(payload.date);
        
        if (payload.from_warehouse_id === payload.to_warehouse_id) {
            throw new ApiError(400, "Gudang asal dan tujuan tidak boleh sama.");
        }

        // VALIDATE STOCK BEFORE CREATE
        for (const item of payload.items) {
            const available = await this.getStock(item.raw_material_id, payload.from_warehouse_id);
            if (available < item.quantity_requested) {
                const rm = await prisma.rawMaterial.findUnique({ where: { id: item.raw_material_id }, select: { name: true } });
                throw new ApiError(
                    400, 
                    `Stok tidak mencukupi untuk ${rm?.name || `ID:${item.raw_material_id}`}. ` +
                    `Tersedia: ${available.toLocaleString()}, Dibutuhkan: ${item.quantity_requested.toLocaleString()}.`
                );
            }
        }

        return await prisma.stockTransfer.create({
            data: {
                transfer_number: generateDocNumber("TRM-M"),
                barcode: generateDocBarcode("TRM"),
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
                        raw_material_id: i.raw_material_id,
                        quantity_requested: i.quantity_requested,
                        notes: i.notes,
                    })),
                },
            },
            include: RM_TRANSFER_INCLUDE,
        });
    }

    static async list(query: QueryRmTransferDTO) {
        const {
            page = 1,
            take = 10,
            search,
            status,
            fromDate,
            toDate,
            from_warehouse_id,
            to_warehouse_id
        } = query;

        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.StockTransferWhereInput = {
            // Manual transfers have NO production_order_id
            production_order_id: null,
            // Filter to only RM transfers
            items: {
                some: { raw_material_id: { not: null } }
            },
            ...(status && { status }),
            ...(from_warehouse_id && { from_warehouse_id }),
            ...(to_warehouse_id && { to_warehouse_id }),
            ...(fromDate || toDate ? {
                date: {
                    ...(fromDate && { gte: new Date(fromDate) }),
                    ...(toDate && { lte: new Date(new Date(toDate).setHours(23, 59, 59, 999)) }),
                }
            } : {}),
            ...(search && {
                OR: [
                    { transfer_number: { contains: search, mode: "insensitive" } },
                    { notes: { contains: search, mode: "insensitive" } }
                ]
            })
        };

        const [data, total] = await Promise.all([
            prisma.stockTransfer.findMany({
                where,
                skip,
                take: limit,
                orderBy: { created_at: "desc" },
                include: RM_TRANSFER_INCLUDE
            }),
            prisma.stockTransfer.count({ where }),
        ]);

        return { data, total };
    }



    static async updateStatus(id: number, payload: UpdateRmTransferStatusDTO, userId: string = "system") {
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

            if (!transfer) throw new ApiError(404, "Data Transfer RM tidak ditemukan");
            
            if (transfer.status === TransferStatus.COMPLETED || transfer.status === TransferStatus.CANCELLED) {
                throw new ApiError(400, `Tidak dapat memperbarui transfer dengan status ${transfer.status}`);
            }

            let updateData: Prisma.StockTransferUpdateInput = { status: payload.status };

            if (payload.status === TransferStatus.APPROVED) {
                if (transfer.status !== TransferStatus.PENDING) {
                    throw new ApiError(400, "Hanya Transfer berstatus PENDING yang dapat disetujui (APPROVED).");
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
                include: RM_TRANSFER_INCLUDE,
            });
        });
    }

    private static async _handleCancellation(
        tx: TxClient,
        transfer: any,
        updateData: Prisma.StockTransferUpdateInput,
        userId: string,
    ): Promise<Prisma.StockTransferUpdateInput> {
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
                transfer.from_warehouse_id as number, 
                items,
                transfer.id, 
                MovementRefType.STOCK_TRANSFER, 
                MovementType.TRANSFER_IN, 
                userId,
                "Batal Transfer RM Manual",
                MovementEntityType.RAW_MATERIAL
            );
        }

        return { ...updateData, cancelled_at: new Date(), cancelled_by: userId };
    }

    private static async _handleShipment(
        tx: TxClient,
        transfer: any,
        payload: UpdateRmTransferStatusDTO,
        updateData: Prisma.StockTransferUpdateInput,
        userId: string,
    ): Promise<Prisma.StockTransferUpdateInput> {
        if (transfer.status !== TransferStatus.APPROVED && transfer.status !== TransferStatus.PARTIAL) {
            throw new ApiError(400, "Transfer harus disetujui (APPROVED) atau berstatus PARTIAL sebelum dikirim (SHIPMENT).");
        }

        const payloadItemMap = new Map(payload.items?.map((i) => [i.id, i]) ?? []);
        const itemsToShip: StockItem[] = [];
        const packUpdates: Promise<any>[] = [];

        for (const dbItem of transfer.items) {
            const alreadyFulfilled = Number(dbItem.quantity_fulfilled ?? 0);
            const remaining = Number(dbItem.quantity_requested) - alreadyFulfilled;

            if (remaining <= 0) continue;

            const packed = Number(payloadItemMap.get(dbItem.id)?.quantity_packed ?? remaining);

            if (packed < 0) {
                throw new ApiError(400, `Qty kirim tidak boleh negatif untuk item ID ${dbItem.id}.`);
            }
            if (packed > remaining + 0.0001) {
                throw new ApiError(
                    400,
                    `Qty kirim untuk ${dbItem.raw_material?.name ?? `item ID ${dbItem.id}`} (${packed}) melebihi sisa kebutuhan (${remaining}).`,
                );
            }

            if (packed > 0) {
                packUpdates.push(
                    tx.stockTransferItem.update({ where: { id: dbItem.id }, data: { quantity_packed: packed } }),
                );
                itemsToShip.push({ raw_material_id: dbItem.raw_material_id, quantity: packed, raw_material: dbItem.raw_material });
            }
        }

        if (itemsToShip.length === 0) {
            throw new ApiError(400, "Tidak ada item yang perlu dikirim. Semua item sudah terpenuhi.");
        }

        await Promise.all(packUpdates);

        if (transfer.from_warehouse_id) {
            await InventoryHelper.deductWarehouseStock(
                tx,
                transfer.from_warehouse_id as number,
                itemsToShip,
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
        payload: UpdateRmTransferStatusDTO,
        updateData: Prisma.StockTransferUpdateInput,
        userId: string,
    ): Promise<Prisma.StockTransferUpdateInput> {
        if (transfer.status !== TransferStatus.SHIPMENT) {
            throw new ApiError(400, "Hanya Transfer berstatus SHIPMENT yang dapat diterima (RECEIVED).");
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
        payload: UpdateRmTransferStatusDTO,
        updateData: Prisma.StockTransferUpdateInput,
        userId: string,
    ): Promise<Prisma.StockTransferUpdateInput> {
        if (transfer.status !== TransferStatus.RECEIVED && transfer.status !== TransferStatus.PARTIAL) {
            throw new ApiError(400, "Data harus berstatus RECEIVED atau PARTIAL sebelum tahap FULFILLMENT.");
        }

        const itemsPackedThisCycle = transfer.items.filter((i: any) => Number(i.quantity_packed ?? 0) > 0);
        const verifiedIds = new Set(payload.items?.map((i) => i.id) ?? []);
        const missingVerification = itemsPackedThisCycle.filter((i: any) => !verifiedIds.has(i.id));

        if (missingVerification.length > 0) {
            throw new ApiError(
                400,
                `Item berikut belum diverifikasi: ${missingVerification.map((i: any) => i.id).join(", ")}`,
            );
        }

        const payloadItemMap = new Map(payload.items?.map((i) => [i.id, i]) ?? []);
        const fulfilledItems: StockItem[] = [];
        const fulfillUpdates: Promise<any>[] = [];
        let allItemsFullyFulfilled = true;

        for (const dbItem of transfer.items) {
            const packedThisCycle = Number(dbItem.quantity_packed ?? 0);

            if (packedThisCycle === 0) {
                if (Number(dbItem.quantity_fulfilled ?? 0) < Number(dbItem.quantity_requested) - 0.0001) {
                    allItemsFullyFulfilled = false;
                }
                continue;
            }

            const reqItem = payloadItemMap.get(dbItem.id);
            if (!reqItem) throw new ApiError(400, `Item ID ${dbItem.id} (packed this cycle) harus diverifikasi.`);

            const fulfilledThisCycle = Number(reqItem.quantity_fulfilled ?? 0);
            const missingThisCycle = Number(reqItem.quantity_missing ?? 0);
            const rejectedThisCycle = Number(reqItem.quantity_rejected ?? 0);

            if (fulfilledThisCycle < 0 || missingThisCycle < 0 || rejectedThisCycle < 0) {
                throw new ApiError(400, "Kuantitas tidak boleh bernilai negatif.");
            }

            if (Math.abs(fulfilledThisCycle + missingThisCycle + rejectedThisCycle - packedThisCycle) > 0.0001) {
                // We allow receiving LESS than packed, the difference is considered "still floating/to be verified later" or "was never actually received"
                // But generally users verify against what WAS packed. 
                // If they verify 30 out of 50, we assume 20 are still "at warehouse/floating" or they want to partial verify.
            }

            const totalFulfilled = Number(dbItem.quantity_fulfilled ?? 0) + fulfilledThisCycle;
            const totalMissing = Number(dbItem.quantity_missing ?? 0) + missingThisCycle;
            const totalRejected = Number(dbItem.quantity_rejected ?? 0) + rejectedThisCycle;
            const remainingPacked = Math.max(0, packedThisCycle - (fulfilledThisCycle + missingThisCycle + rejectedThisCycle));

            if (totalFulfilled + totalMissing + totalRejected < Number(dbItem.quantity_requested) - 0.0001) {
                allItemsFullyFulfilled = false;
            }

            fulfillUpdates.push(
                tx.stockTransferItem.update({
                    where: { id: dbItem.id },
                    data: {
                        quantity_fulfilled: totalFulfilled,
                        quantity_missing: (Number(dbItem.quantity_missing ?? 0) + missingThisCycle),
                        quantity_rejected: (Number(dbItem.quantity_rejected ?? 0) + rejectedThisCycle),
                        quantity_packed: remainingPacked, // Partial verify: keep the rest packed/floating or return to stock
                    },
                }),
            );

            if (fulfilledThisCycle > 0) {
                fulfilledItems.push({ raw_material_id: dbItem.raw_material_id, quantity: fulfilledThisCycle, raw_material: dbItem.raw_material });
            }
        }

        await Promise.all(fulfillUpdates);

        // Record Waste RM for rejected items
        for (const dbItem of transfer.items) {
            const reqItem = payloadItemMap.get(dbItem.id);
            const rejectedThisCycle = Number(reqItem?.quantity_rejected ?? 0);

            if (rejectedThisCycle > 0) {
                await tx.productionOrderWaste.create({
                    data: {
                        production_order_id: transfer.production_order_id || null, // Optional for manual transfers
                        waste_type: WasteType.RAW_MATERIAL,
                        raw_material_id: dbItem.raw_material_id,
                        warehouse_id: transfer.to_warehouse_id,
                        quantity: rejectedThisCycle,
                        notes: `Reject dari Transfer ${transfer.transfer_number}`,
                    }
                });
            }
        }

        if (fulfilledItems.length > 0 && transfer.to_warehouse_id) {
            await InventoryHelper.addWarehouseStock(
                tx,
                transfer.to_warehouse_id as number,
                fulfilledItems,
                transfer.id,
                MovementRefType.STOCK_TRANSFER,
                MovementType.TRANSFER_IN,
                userId,
                "Terima Transfer RM Manual",
                MovementEntityType.RAW_MATERIAL
            );
        }

        const finalStatus = allItemsFullyFulfilled ? TransferStatus.COMPLETED : TransferStatus.PARTIAL;

        return {
            ...updateData,
            status: finalStatus,
            fulfilled_at: new Date(),
            fulfillment_notes: payload.notes,
        };
    }
    
    static async cleanCancelled() {
        return await prisma.$transaction(async (tx) => {
            // Delete related items first
            await tx.stockTransferItem.deleteMany({
                where: {
                    transfer: {
                        status: TransferStatus.CANCELLED,
                        production_order_id: null // Only for manual transfers if needed, or all. 
                        // User asked for "status cancel", so let's clean ALL cancelled transfers in this module.
                    }
                }
            });
            
            // Delete photos
            await tx.stockTransferPhoto.deleteMany({
                where: {
                    transfer: { status: TransferStatus.CANCELLED }
                }
            });

            const deleted = await tx.stockTransfer.deleteMany({
                where: { status: TransferStatus.CANCELLED }
            });
            
            return deleted;
        });
    }
}
