import { Prisma } from "../../../../generated/prisma/client.js";
import prisma from "../../../../config/prisma.js";
import {
    RequestTransferGudangDTO,
    QueryTransferGudangDTO,
    UpdateTransferGudangStatusDTO,
    RequestUpdateTransferGudangDTO,
} from "./tg.schema.js";
import {
    TransferStatus,
    TransferLocationType,
    MovementType,
    MovementRefType,
    TransferPhotoStage,
} from "../../../../generated/prisma/enums.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import ExcelJS from "exceljs";
import { ReturnService } from "../return/return.service.js";
import { InventoryHelper, StockItem } from "../../shared/inventory.helper.js";
import {
    EXPORT_ROW_LIMIT,
    PRODUCT_INCLUDE,
    generateDocNumber,
    generateDocBarcode,
} from "../../shared/inventory.constants.js";

const TG_INCLUDE = {
    items: { include: { product: PRODUCT_INCLUDE } },
    from_warehouse: true,
    to_warehouse: true,
} as const;

type TxClient = Prisma.TransactionClient;

export class TGService {
    static async create(payload: RequestTransferGudangDTO, userId: string = "system") {
        const orderDate = new Date(payload.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (orderDate < today) {
            throw new ApiError(400, "Tanggal TG tidak boleh di masa lalu.");
        }
        if (payload.from_warehouse_id === payload.to_warehouse_id) {
            throw new ApiError(400, "Gudang asal dan tujuan tidak boleh sama.");
        }

        return prisma.stockTransfer.create({
            data: {
                transfer_number: generateDocNumber("TG"),
                barcode: generateDocBarcode("TG"),
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
            include: TG_INCLUDE,
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
                orderBy: { [sortBy as string]: sortOrder },
                include: TG_INCLUDE,
            }),
            prisma.stockTransfer.count({ where }),
        ]);

        return { data, len };
    }

    static async detail(id: number) {
        const result = await prisma.stockTransfer.findUnique({
            where: { id },
            include: { ...TG_INCLUDE, photos: true },
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
                include: { items: { include: { product: PRODUCT_INCLUDE } } },
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
                throw new ApiError(400, `Tidak dapat memperbarui transfer dengan status ${transfer.status}`);
            }

            let updateData: Prisma.StockTransferUpdateInput = { status: payload.status };

            if (payload.status === TransferStatus.APPROVED) {
                if (transfer.status !== TransferStatus.PENDING) {
                    throw new ApiError(400, "Hanya TG berstatus PENDING yang dapat disetujui (APPROVED).");
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

            let created_return = null;
            if (payload.status === TransferStatus.FULFILLMENT) {
                const result = await this._handleFulfillment(tx, transfer, payload, updateData, userId);
                updateData = result.updateData;
                created_return = result.created_return;
            }

            const updated = await tx.stockTransfer.update({
                where: { id },
                data: updateData,
                include: TG_INCLUDE,
            });

            return {
                ...updated,
                created_return,
            };
        });
    }

    private static async _handleCancellation(
        tx: TxClient,
        transfer: any,
        updateData: Prisma.StockTransferUpdateInput,
        userId: string,
    ): Promise<Prisma.StockTransferUpdateInput> {
        if (
            transfer.status === TransferStatus.REJECTED ||
            transfer.status === TransferStatus.MISSING
        ) {
            throw new ApiError(400, `Tidak dapat membatalkan TG yang sudah pada tahap ${transfer.status}.`);
        }

        if (
            (transfer.status === TransferStatus.SHIPMENT || transfer.status === TransferStatus.RECEIVED) &&
            transfer.from_warehouse_id
        ) {
            const items: StockItem[] = transfer.items.map((i: any) => ({
                product_id: i.product_id,
                quantity: Number(i.quantity_packed || i.quantity_requested),
                product: i.product,
            }));
            await InventoryHelper.addWarehouseStock(
                tx, transfer.from_warehouse_id, items,
                transfer.id, MovementRefType.STOCK_TRANSFER, MovementType.TRANSFER_IN, userId,
                "Batal Transfer Gudang",
            );
        }

        return { ...updateData, cancelled_at: new Date(), cancelled_by: userId };
    }

    private static async _handleShipment(
        tx: TxClient,
        transfer: any,
        payload: UpdateTransferGudangStatusDTO,
        updateData: Prisma.StockTransferUpdateInput,
        userId: string,
    ): Promise<Prisma.StockTransferUpdateInput> {
        if (transfer.status !== TransferStatus.APPROVED && transfer.status !== TransferStatus.PARTIAL) {
            throw new ApiError(400, "TG harus disetujui (APPROVED) atau berstatus PARTIAL sebelum dikirim (SHIPMENT).");
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
                    `Qty kirim untuk ${dbItem.product?.name ?? `item ID ${dbItem.id}`} (${packed}) melebihi sisa kebutuhan (${remaining}).`,
                );
            }

            if (packed > 0) {
                packUpdates.push(
                    tx.stockTransferItem.update({ where: { id: dbItem.id }, data: { quantity_packed: packed } }),
                );
                itemsToShip.push({ product_id: dbItem.product_id, quantity: packed, product: dbItem.product });
            }
        }

        if (itemsToShip.length === 0) {
            throw new ApiError(400, "Tidak ada item yang perlu dikirim. Semua item sudah terpenuhi.");
        }

        await Promise.all(packUpdates);

        if (transfer.from_warehouse_id) {
            await InventoryHelper.deductWarehouseStock(
                tx, transfer.from_warehouse_id, itemsToShip,
                transfer.id, MovementRefType.STOCK_TRANSFER, MovementType.TRANSFER_OUT, userId,
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
        payload: UpdateTransferGudangStatusDTO,
        updateData: Prisma.StockTransferUpdateInput,
        userId: string,
    ): Promise<Prisma.StockTransferUpdateInput> {
        if (transfer.status !== TransferStatus.SHIPMENT) {
            throw new ApiError(400, "Hanya TG berstatus SHIPMENT yang dapat diterima (RECEIVED).");
        }

        if (payload.items) {
            const itemsToUpdate = payload.items.filter((i) => i.quantity_received !== undefined);
            await Promise.all(
                itemsToUpdate.map((i) =>
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
        payload: UpdateTransferGudangStatusDTO,
        updateData: Prisma.StockTransferUpdateInput,
        userId: string,
    ): Promise<{ updateData: Prisma.StockTransferUpdateInput; created_return: any }> {
        if (transfer.status !== TransferStatus.RECEIVED) {
            throw new ApiError(400, "Data harus berstatus RECEIVED sebelum tahap FULFILLMENT.");
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
        const itemsToReceiveIntoDestStock: StockItem[] = []; // Combines fulfilled and rejected (to be returned)
        const rejectedItemsList: Array<{ product_id: number; quantity_rejected: number; notes?: string | null; product: any }> = [];
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
                throw new ApiError(
                    400,
                    `Total verifikasi untuk item ID ${dbItem.id} (${fulfilledThisCycle + missingThisCycle + rejectedThisCycle}) tidak sesuai dengan Qty Kirim siklus ini (${packedThisCycle}).`,
                );
            }

            const totalFulfilled = Number(dbItem.quantity_fulfilled ?? 0) + fulfilledThisCycle;

            if (totalFulfilled < Number(dbItem.quantity_requested) - 0.0001) {
                allItemsFullyFulfilled = false;
            }

            fulfillUpdates.push(
                tx.stockTransferItem.update({
                    where: { id: dbItem.id },
                    data: {
                        quantity_fulfilled: totalFulfilled,
                        quantity_missing: missingThisCycle,
                        quantity_rejected: rejectedThisCycle,
                        quantity_packed: 0, // Reset so next cycle starts fresh
                    },
                }),
            );

            // Both fulfilled and rejected items physically arrived at the destination warehouse
            const totalArrivedAtDest = fulfilledThisCycle + rejectedThisCycle;
            if (totalArrivedAtDest > 0) {
                itemsToReceiveIntoDestStock.push({ 
                    product_id: dbItem.product_id, 
                    quantity: totalArrivedAtDest, 
                    product: dbItem.product 
                });
            }
            if (rejectedThisCycle > 0) {
                rejectedItemsList.push({ 
                    product_id: dbItem.product_id, 
                    quantity_rejected: rejectedThisCycle, 
                    notes: dbItem.notes,
                    product: dbItem.product
                });
            }
        }

        await Promise.all(fulfillUpdates);

        // Add BOTH fulfilled and rejected stock to the destination warehouse
        // (The rejected stock will immediately be deducted by the Return shipment)
        if (itemsToReceiveIntoDestStock.length > 0 && transfer.to_warehouse_id) {
            await InventoryHelper.addWarehouseStock(
                tx, transfer.to_warehouse_id, itemsToReceiveIntoDestStock,
                transfer.id, MovementRefType.STOCK_TRANSFER, MovementType.TRANSFER_IN, userId,
            );
        }

        let createdReturn = null;
        if (rejectedItemsList.length > 0) {
            createdReturn = await ReturnService.createFromRejection(
                tx,
                { ...transfer, items: rejectedItemsList },
                userId,
                transfer.from_warehouse_id ?? undefined,
            );
        }

        const finalStatus = allItemsFullyFulfilled ? TransferStatus.COMPLETED : TransferStatus.PARTIAL;

        return {
            updateData: {
                ...updateData,
                status: finalStatus,
                fulfilled_at: new Date(),
                fulfillment_notes: payload.notes,
            },
            created_return: createdReturn,
        };
    }

    static async getStock(warehouse_id: number, product_id: number) {
        const pi = await prisma.productInventory.findFirst({
            where: { warehouse_id, product_id },
            orderBy: { id: "desc" },
        });
        return Number(pi?.quantity ?? 0);
    }

    static async export(query: QueryTransferGudangDTO) {
        const { data } = await this.list({ ...query, take: EXPORT_ROW_LIMIT, page: 1 });

        const headers = {
            transfer_number: "No. TG",
            barcode: "Barcode",
            date: "Tanggal",
            "from_warehouse.name": "Gudang (Asal)",
            "to_warehouse.name": "Gudang (Tujuan)",
            status: "Status",
            created_by: "Dibuat Oleh",
            notes: "Catatan",
        };

        const mappedData = data.map((item) => ({
            ...item,
            date: item.date ? new Date(item.date).toLocaleDateString("id-ID") : "-",
        }));

        return InventoryHelper.toCSV(mappedData, headers);
    }

    static async update(id: number, payload: RequestUpdateTransferGudangDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const transfer = await tx.stockTransfer.findUnique({
                where: { id },
                include: { items: true }
            });

            if (!transfer) throw new ApiError(404, "Data Transfer Gudang tidak ditemukan");
            
            // Only allow update if status is PENDING or APPROVED
            if (transfer.status !== TransferStatus.PENDING && transfer.status !== TransferStatus.APPROVED) {
                throw new ApiError(400, "Tidak dapat mengubah data yang sudah dalam proses pengiriman atau selesai.");
            }

            // Update items if provided
            if (payload.items) {
                // Delete existing items
                await tx.stockTransferItem.deleteMany({
                    where: { transfer_id: id }
                });

                // Create new items
                await tx.stockTransferItem.createMany({
                    data: payload.items.map(i => ({
                        transfer_id: id,
                        product_id: i.product_id,
                        quantity_requested: i.quantity_requested,
                        notes: i.notes
                    }))
                });
            }

            const updated = await tx.stockTransfer.update({
                where: { id },
                data: {
                    ...(payload.date && { date: new Date(payload.date) }),
                    ...(payload.notes && { notes: payload.notes }),
                    ...(payload.from_warehouse_id && { from_warehouse_id: payload.from_warehouse_id }),
                    ...(payload.to_warehouse_id && { to_warehouse_id: payload.to_warehouse_id }),
                    updated_at: new Date(),
                },
                include: TG_INCLUDE,
            });

            return updated;
        });
    }
}
