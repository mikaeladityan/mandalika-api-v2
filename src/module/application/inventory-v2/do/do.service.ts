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
    MovementRefType,
} from "../../../../generated/prisma/enums.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import ExcelJS from "exceljs";
import { ReturnService } from "../return/return.service.js";
import { InventoryHelper, StockItem } from "../inventory.helper.js";
import {
    EXPORT_ROW_LIMIT,
    PRODUCT_INCLUDE,
    generateDocNumber,
    generateDocBarcode,
} from "../inventory.constants.js";

const DO_INCLUDE = {
    items: { include: { product: PRODUCT_INCLUDE } },
    from_warehouse: true,
    to_outlet: true,
} as const;

type TxClient = Prisma.TransactionClient;
type DiscrepancyQuery = { page?: number; take?: number; search?: string };

export class DOService {
    static async create(payload: RequestDeliveryOrderDTO, userId: string = "system") {
        const orderDate = new Date(payload.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (orderDate < today) throw new ApiError(400, "Tanggal DO tidak boleh di masa lalu.");

        return prisma.stockTransfer.create({
            data: {
                transfer_number: generateDocNumber("DO"),
                barcode: generateDocBarcode("DO"),
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
            include: DO_INCLUDE,
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
                orderBy: { [sortBy as string]: sortOrder },
                include: DO_INCLUDE,
            }),
            prisma.stockTransfer.count({ where }),
        ]);

        return { data, len };
    }

    static async detail(id: number) {
        const result = await prisma.stockTransfer.findUnique({
            where: { id },
            include: { ...DO_INCLUDE, photos: true },
        });

        if (!result) throw new ApiError(404, "Data Delivery Order tidak ditemukan");
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
                include: { items: { include: { product: PRODUCT_INCLUDE } } },
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

            let updateData: Prisma.StockTransferUpdateInput = { status: payload.status };

            if (payload.status === TransferStatus.APPROVED) {
                if (transfer.status !== TransferStatus.PENDING) {
                    throw new ApiError(400, "Hanya DO berstatus PENDING yang dapat disetujui (APPROVED).");
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
                updateData = await this._handleReceived(tx, transfer, payload, updateData);
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
                include: DO_INCLUDE,
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
            transfer.status === TransferStatus.PARTIAL ||
            transfer.status === TransferStatus.REJECTED ||
            transfer.status === TransferStatus.MISSING
        ) {
            throw new ApiError(
                400,
                `Tidak dapat membatalkan DO yang sudah pada tahap ${transfer.status}.`,
            );
        }

        if (
            (transfer.status === TransferStatus.SHIPMENT ||
                transfer.status === TransferStatus.RECEIVED) &&
            transfer.from_warehouse_id
        ) {
            const items: StockItem[] = transfer.items.map((i: any) => ({
                product_id: i.product_id,
                quantity: Number(i.quantity_packed || i.quantity_requested),
                product: i.product,
            }));
            await InventoryHelper.addWarehouseStock(
                tx,
                transfer.from_warehouse_id,
                items,
                transfer.id,
                MovementRefType.STOCK_TRANSFER,
                MovementType.TRANSFER_IN,
                userId,
                "Batal (Cancellation)",
            );
        }

        return updateData;
    }

    private static async _handleShipment(
        tx: TxClient,
        transfer: any,
        payload: UpdateDeliveryOrderStatusDTO,
        updateData: Prisma.StockTransferUpdateInput,
        userId: string,
    ): Promise<Prisma.StockTransferUpdateInput> {
        if (transfer.status !== TransferStatus.APPROVED) {
            throw new ApiError(400, "DO harus disetujui (APPROVED) sebelum dikirim (SHIPMENT).");
        }

        if (payload.items) {
            const itemsToUpdate = payload.items.filter((i) => i.quantity_packed !== undefined);
            await Promise.all(
                itemsToUpdate.map((i) =>
                    tx.stockTransferItem.update({
                        where: { id: i.id },
                        data: { quantity_packed: i.quantity_packed },
                    }),
                ),
            );
        }

        if (transfer.from_warehouse_id) {
            const items: StockItem[] = transfer.items.map((i: any) => ({
                product_id: i.product_id,
                quantity: Number(i.quantity_packed || i.quantity_requested),
                product: i.product,
            }));
            await InventoryHelper.deductWarehouseStock(
                tx,
                transfer.from_warehouse_id,
                items,
                transfer.id,
                MovementRefType.STOCK_TRANSFER,
                MovementType.TRANSFER_OUT,
                userId,
            );
        }

        return { ...updateData, shipped_at: new Date(), shipment_notes: payload.notes };
    }

    private static async _handleReceived(
        tx: TxClient,
        transfer: any,
        payload: UpdateDeliveryOrderStatusDTO,
        updateData: Prisma.StockTransferUpdateInput,
    ): Promise<Prisma.StockTransferUpdateInput> {
        if (transfer.status !== TransferStatus.SHIPMENT) {
            throw new ApiError(400, "Hanya DO berstatus SHIPMENT yang dapat diterima (RECEIVED).");
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

        return { ...updateData, received_at: new Date(), received_notes: payload.notes };
    }

    private static async _handleFulfillment(
        tx: TxClient,
        transfer: any,
        payload: UpdateDeliveryOrderStatusDTO,
        updateData: Prisma.StockTransferUpdateInput,
        userId: string,
    ): Promise<{ updateData: Prisma.StockTransferUpdateInput; created_return: any }> {
        if (transfer.status !== TransferStatus.RECEIVED) {
            throw new ApiError(400, "Data harus berstatus RECEIVED sebelum tahap FULFILLMENT.");
        }
        if (!payload.items || payload.items.length !== transfer.items.length) {
            throw new ApiError(400, "Semua item dalam DO harus diverifikasi pada tahap FULFILLMENT.");
        }

        const fulfilledMap = new Map<number, number>();
        const rejectedItemsList: Array<{
            product_id: number;
            quantity_rejected: number;
            notes?: string | null;
        }> = [];

        const itemsToReceiveIntoDestStock: StockItem[] = [];

        for (const reqItem of payload.items) {
            const dbItem = transfer.items.find((i: any) => i.id === reqItem.id);
            if (!dbItem) throw new ApiError(400, `Item ID ${reqItem.id} tidak valid untuk DO ini.`);

            const fulfilled = Number(reqItem.quantity_fulfilled ?? 0);
            const missing = Number(reqItem.quantity_missing ?? 0);
            const rejected = Number(reqItem.quantity_rejected ?? 0);

            if (fulfilled < 0 || missing < 0 || rejected < 0) {
                throw new ApiError(400, "Kuantitas tidak boleh bernilai negatif.");
            }

            const expected = Number(dbItem.quantity_packed || dbItem.quantity_requested);
            if (Math.abs(fulfilled + missing + rejected - expected) > 0.0001) {
                throw new ApiError(
                    400,
                    `Total verifikasi untuk item ID ${dbItem.id} (${fulfilled + missing + rejected}) tidak sesuai dengan Qty Pack (${expected}).`,
                );
            }

            await tx.stockTransferItem.update({
                where: { id: reqItem.id },
                data: { quantity_fulfilled: fulfilled, quantity_missing: missing, quantity_rejected: rejected },
            });

            fulfilledMap.set(dbItem.product_id, fulfilled);
            
            const totalArrivedAtDest = fulfilled + rejected;
            if (totalArrivedAtDest > 0) {
                itemsToReceiveIntoDestStock.push({
                    product_id: dbItem.product_id,
                    quantity: totalArrivedAtDest,
                    product: dbItem.product
                });
            }

            if (rejected > 0) {
                rejectedItemsList.push({
                    product_id: dbItem.product_id,
                    quantity_rejected: rejected,
                    notes: dbItem.notes ?? null,
                });
            }
        }

        if (itemsToReceiveIntoDestStock.length > 0 && transfer.to_outlet_id) {
            await InventoryHelper.addOutletStock(
                tx,
                transfer.to_outlet_id,
                itemsToReceiveIntoDestStock,
                transfer.id,
                MovementRefType.STOCK_TRANSFER,
                MovementType.TRANSFER_IN,
                userId,
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

        return {
            updateData: {
                ...updateData,
                status: TransferStatus.COMPLETED,
                fulfilled_at: new Date(),
                fulfillment_notes: payload.notes,
            },
            created_return: createdReturn,
        };
    }

    static async getStock(warehouse_id?: number, outlet_id?: number, product_id?: number) {
        if (warehouse_id) {
            const pi = await prisma.productInventory.findFirst({
                where: { product_id, warehouse_id },
                orderBy: [{ year: "desc" }, { month: "desc" }, { date: "desc" }, { id: "desc" }],
            });
            return Number(pi?.quantity ?? 0);
        }

        if (outlet_id) {
            const oi = await prisma.outletInventory.findUnique({
                where: { outlet_id_product_id: { outlet_id, product_id: Number(product_id) } },
            });
            return Number(oi?.quantity ?? 0);
        }

        return 0;
    }

    static async export(query: QueryDeliveryOrderDTO) {
        const { data } = await this.list({ ...query, take: EXPORT_ROW_LIMIT, page: 1 });

        const headers = {
            transfer_number: "No. DO",
            barcode: "Barcode",
            date: "Tanggal",
            "from_warehouse.name": "Gudang (Asal)",
            "to_outlet.name": "Outlet (Tujuan)",
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

}
