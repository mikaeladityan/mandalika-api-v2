import { Prisma } from "../../../../generated/prisma/client.js";
import prisma from "../../../../config/prisma.js";
import {
    ReturnStatus,
    TransferLocationType,
    MovementEntityType,
    MovementLocationType,
    MovementType,
    MovementRefType,
} from "../../../../generated/prisma/enums.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { RequestReturnDTO, UpdateReturnStatusDTO } from "./return.schema.js";

function generateReturnNumber() {
    const date = new Date();
    const prefix = "RTN";
    const ym = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
    const random = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, "0");
    return `${prefix}-${ym}-${random}`;
}

export class ReturnService {
    /**
     * Creates a Draft Stock Return from rejected items in a Stock Transfer (DO or TG)
     * @param tx Prisma transaction client
     * @param transfer The source transfer object (including items)
     * @param userId The user ID creating this return
     * @param targetWarehouseId Optional override for return destination warehouse
     */
    static async createFromRejection(
        tx: any,
        transfer: any,
        userId: string = "system",
        targetWarehouseId?: number
    ) {
        // Items must have a rejection quantity
        // Note: quantity_rejected is expected to be present in the transfer items
        const rejectedItems = transfer.items.filter((i: any) => Number(i.quantity_rejected || 0) > 0);
        
        if (rejectedItems.length === 0) return null;

        const return_number = generateReturnNumber();

        // The return 'from' is the original 'to' (destination of the DO/TG)
        const from_type = transfer.to_type;
        const from_warehouse_id = transfer.to_warehouse_id;
        const from_outlet_id = transfer.to_outlet_id;

        // The return 'to' defaults to the original 'from' (source of the DO/TG)
        // or a specific warehouse if provided (e.g. Pusat SBY)
        const to_type = transfer.from_type;
        const to_warehouse_id = targetWarehouseId || transfer.from_warehouse_id;
        const to_outlet_id = targetWarehouseId ? null : transfer.from_outlet_id;

        const stockReturn = await tx.stockReturn.create({
            data: {
                return_number,
                from_type,
                from_warehouse_id,
                from_outlet_id,
                to_type,
                to_warehouse_id,
                to_outlet_id,
                status: ReturnStatus.DRAFT,
                source_transfer_id: transfer.id,
                created_by: userId,
                notes: `Auto-generated from rejection of ${transfer.transfer_number}`,
                items: {
                    create: rejectedItems.map((i: any) => ({
                        product_id: i.product_id,
                        quantity: i.quantity_rejected,
                        notes: i.notes,
                    })),
                },
            },
        });

        return stockReturn;
    }

    static async list(query: any) {
        const { page = 1, take = 25, search, status } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.StockReturnWhereInput = {
            ...(search && {
                OR: [
                    { return_number: { contains: search, mode: "insensitive" } },
                    {
                        source_transfer: {
                            transfer_number: { contains: search, mode: "insensitive" },
                        },
                    },
                ],
            }),
            ...(status && { status: status as ReturnStatus }),
        };

        const [data, len] = await Promise.all([
            prisma.stockReturn.findMany({
                where,
                skip,
                take: limit,
                orderBy: { created_at: "desc" },
                include: {
                    items: {
                        include: {
                            product: {
                                include: { product_type: true, size: true, unit: true },
                            },
                        },
                    },
                    from_warehouse: true,
                    from_outlet: true,
                    to_warehouse: true,
                    to_outlet: true,
                    source_transfer: true,
                },
            }),
            prisma.stockReturn.count({ where }),
        ]);

        return { data, len };
    }

    static async detail(id: number) {
        const result = await prisma.stockReturn.findUnique({
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
                from_outlet: true,
                to_warehouse: true,
                to_outlet: true,
                source_transfer: true,
            },
        });
        if (!result) throw new ApiError(404, "Data Retur tidak ditemukan");
        return result;
    }

    static async create(payload: RequestReturnDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const return_number = generateReturnNumber();

            const stockReturn = await tx.stockReturn.create({
                data: {
                    return_number,
                    from_type: payload.from_type,
                    from_warehouse_id: payload.from_warehouse_id,
                    from_outlet_id: payload.from_outlet_id,
                    to_type: payload.to_type,
                    to_warehouse_id: payload.to_warehouse_id,
                    status: ReturnStatus.DRAFT,
                    notes: payload.notes,
                    created_by: userId,
                    items: {
                        create: payload.items.map((i) => ({
                            product_id: i.product_id,
                            quantity: i.quantity,
                            notes: i.notes,
                        })),
                    },
                },
                include: {
                    items: {
                        include: {
                            product: {
                                include: { product_type: true, size: true, unit: true },
                            },
                        },
                    },
                    from_warehouse: true,
                    from_outlet: true,
                    to_warehouse: true,
                },
            });

            return stockReturn;
        });
    }

    static async updateStatus(
        id: number,
        payload: UpdateReturnStatusDTO,
        userId: string = "system",
    ) {
        return await prisma.$transaction(async (tx) => {
            const stockReturn = await tx.stockReturn.findUnique({
                where: { id },
                include: {
                    items: {
                        include: {
                            product: {
                                include: { product_type: true, size: true, unit: true },
                            },
                        },
                    },
                },
            });

            if (!stockReturn) throw new ApiError(404, "Data Retur tidak ditemukan");

            if (
                stockReturn.status === ReturnStatus.COMPLETED ||
                stockReturn.status === ReturnStatus.CANCELLED
            ) {
                throw new ApiError(
                    400,
                    `Tidak dapat memperbarui retur dengan status ${stockReturn.status}`,
                );
            }

            let finalStatus = payload.status;
            const updateData: any = { status: finalStatus };

            if (finalStatus === ReturnStatus.SHIPPING) {
                if (stockReturn.status !== ReturnStatus.DRAFT) {
                    throw new ApiError(
                        400,
                        "Hanya Retur berstatus DRAFT yang dapat dikirim (SHIPPING).",
                    );
                }
                updateData.shipped_at = new Date();

                // Deduct inventory at source
                if (
                    stockReturn.from_type === TransferLocationType.WAREHOUSE &&
                    stockReturn.from_warehouse_id
                ) {
                    await this.deductWarehouseInventory(
                        tx,
                        stockReturn.from_warehouse_id,
                        stockReturn.items,
                        stockReturn.id,
                        userId,
                    );
                } else if (
                    stockReturn.from_type === TransferLocationType.OUTLET &&
                    stockReturn.from_outlet_id
                ) {
                    await this.deductOutletInventory(
                        tx,
                        stockReturn.from_outlet_id,
                        stockReturn.items,
                        stockReturn.id,
                        userId,
                    );
                }
            }

            if (finalStatus === ReturnStatus.RECEIVED) {
                if (stockReturn.status !== ReturnStatus.SHIPPING) {
                    throw new ApiError(
                        400,
                        "Hanya Retur berstatus SHIPPING yang dapat diterima (RECEIVED).",
                    );
                }
                updateData.received_at = new Date();

                // Add inventory at destination warehouse
                if (stockReturn.to_warehouse_id) {
                    await this.addWarehouseInventory(
                        tx,
                        stockReturn.to_warehouse_id,
                        stockReturn.items,
                        stockReturn.id,
                        userId,
                    );
                }

                // Auto-complete upon receipt
                finalStatus = ReturnStatus.COMPLETED;
                updateData.status = finalStatus;
            }

            if (finalStatus === ReturnStatus.CANCELLED) {
                if (stockReturn.status === ReturnStatus.SHIPPING) {
                    // Revert inventory
                    if (
                        stockReturn.from_type === TransferLocationType.WAREHOUSE &&
                        stockReturn.from_warehouse_id
                    ) {
                        await this.revertWarehouseInventory(
                            tx,
                            stockReturn.from_warehouse_id,
                            stockReturn.items,
                            stockReturn.id,
                            userId,
                        );
                    } else if (
                        stockReturn.from_type === TransferLocationType.OUTLET &&
                        stockReturn.from_outlet_id
                    ) {
                        await this.revertOutletInventory(
                            tx,
                            stockReturn.from_outlet_id,
                            stockReturn.items,
                            stockReturn.id,
                            userId,
                        );
                    }
                }
            }

            const updated = await tx.stockReturn.update({
                where: { id },
                data: updateData,
                include: {
                    items: {
                        include: {
                            product: {
                                include: { product_type: true, size: true, unit: true },
                            },
                        },
                    },
                    from_warehouse: true,
                    from_outlet: true,
                    to_warehouse: true,
                },
            });

            return updated;
        });
    }

    private static async deductWarehouseInventory(
        tx: any,
        warehouse_id: number,
        items: any[],
        return_id: number,
        userId: string,
    ) {
        for (const item of items) {
            const deductAmount = Number(item.quantity);

            let pi = await tx.productInventory.findFirst({
                where: { product_id: item.product_id, warehouse_id },
                orderBy: { created_at: "desc" },
            });

            if (!pi || Number(pi.quantity) < deductAmount) {
                const pName = item.product?.name || `ID:${item.product_id}`;
                throw new ApiError(400, `Stok tidak mencukupi di Gudang untuk produk ${pName}`);
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
                    movement_type: MovementType.RETURN_OUT,
                    quantity: deductAmount,
                    qty_before,
                    qty_after,
                    reference_id: return_id,
                    reference_type: MovementRefType.STOCK_RETURN,
                    created_by: userId,
                },
            });
        }
    }

    private static async deductOutletInventory(
        tx: any,
        outlet_id: number,
        items: any[],
        return_id: number,
        userId: string,
    ) {
        for (const item of items) {
            const deductAmount = Number(item.quantity);

            let oi = await tx.outletInventory.findFirst({
                where: { product_id: item.product_id, outlet_id },
                orderBy: { created_at: "desc" },
            });

            if (!oi || Number(oi.quantity) < deductAmount) {
                const pName = item.product?.name || `ID:${item.product_id}`;
                throw new ApiError(400, `Stok tidak mencukupi di Outlet untuk produk ${pName}`);
            }

            const qty_before = Number(oi.quantity);
            const qty_after = qty_before - deductAmount;

            await tx.outletInventory.update({
                where: { id: oi.id },
                data: { quantity: qty_after },
            });

            await tx.stockMovement.create({
                data: {
                    entity_type: MovementEntityType.PRODUCT,
                    entity_id: item.product_id,
                    location_type: MovementLocationType.OUTLET,
                    location_id: outlet_id,
                    movement_type: MovementType.RETURN_OUT,
                    quantity: deductAmount,
                    qty_before,
                    qty_after,
                    reference_id: return_id,
                    reference_type: MovementRefType.STOCK_RETURN,
                    created_by: userId,
                },
            });
        }
    }

    private static async addWarehouseInventory(
        tx: any,
        warehouse_id: number,
        items: any[],
        return_id: number,
        userId: string,
    ) {
        for (const item of items) {
            const addAmount = Number(item.quantity);

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
                    data: { product_id: item.product_id, warehouse_id, quantity: addAmount },
                });
            }

            const qty_after = qty_before + addAmount;

            await tx.stockMovement.create({
                data: {
                    entity_type: MovementEntityType.PRODUCT,
                    entity_id: item.product_id,
                    location_type: MovementLocationType.WAREHOUSE,
                    location_id: warehouse_id,
                    movement_type: MovementType.RETURN_IN,
                    quantity: addAmount,
                    qty_before,
                    qty_after,
                    reference_id: return_id,
                    reference_type: MovementRefType.STOCK_RETURN,
                    created_by: userId,
                },
            });
        }
    }

    private static async revertWarehouseInventory(
        tx: any,
        warehouse_id: number,
        items: any[],
        return_id: number,
        userId: string,
    ) {
        for (const item of items) {
            const revertAmount = Number(item.quantity);

            let pi = await tx.productInventory.findFirst({
                where: { product_id: item.product_id, warehouse_id },
                orderBy: { created_at: "desc" },
            });

            if (!pi) continue; // Should not happen if it was deducted

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
                    movement_type: MovementType.RETURN_IN,
                    quantity: revertAmount,
                    qty_before,
                    qty_after,
                    reference_id: return_id,
                    reference_type: MovementRefType.STOCK_RETURN,
                    created_by: userId,
                    notes: "Batal (Cancel) Retur",
                },
            });
        }
    }

    private static async revertOutletInventory(
        tx: any,
        outlet_id: number,
        items: any[],
        return_id: number,
        userId: string,
    ) {
        for (const item of items) {
            const revertAmount = Number(item.quantity);

            let oi = await tx.outletInventory.findFirst({
                where: { product_id: item.product_id, outlet_id },
                orderBy: { created_at: "desc" },
            });

            if (!oi) continue;

            const qty_before = Number(oi.quantity);
            const qty_after = qty_before + revertAmount;

            await tx.outletInventory.update({
                where: { id: oi.id },
                data: { quantity: qty_after },
            });

            await tx.stockMovement.create({
                data: {
                    entity_type: MovementEntityType.PRODUCT,
                    entity_id: item.product_id,
                    location_type: MovementLocationType.OUTLET,
                    location_id: outlet_id,
                    movement_type: MovementType.RETURN_IN,
                    quantity: revertAmount,
                    qty_before,
                    qty_after,
                    reference_id: return_id,
                    reference_type: MovementRefType.STOCK_RETURN,
                    created_by: userId,
                    notes: "Batal (Cancel) Retur",
                },
            });
        }
    }
}
