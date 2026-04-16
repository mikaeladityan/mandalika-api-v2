import { Prisma } from "../../../generated/prisma/client.js";
import prisma from "../../../config/prisma.js";
import {
    RequestCreateProductionDTO,
    RequestChangeStatusDTO,
    RequestSubmitResultDTO,
    RequestQcActionDTO,
    QueryProductionDTO,
} from "./manufacturing.schema.js";
import {
    ProductionStatus,
    MovementType,
    MovementEntityType,
    MovementRefType,
    GoodsReceiptType,
    GoodsReceiptStatus,
    WasteType,
    WarehouseType,
} from "../../../generated/prisma/enums.js";
import { ApiError } from "../../../lib/errors/api.error.js";
import { GetPagination } from "../../../lib/utils/pagination.js";

function generateMfgNumber(): string {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const seq = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, "0");
    return `MFG-${ym}-${seq}`;
}

function generateGrNumber(): string {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const seq = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, "0");
    return `GR-${ym}-${seq}`;
}

export class ManufacturingService {
    static async create(payload: RequestCreateProductionDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const product = await tx.product.findUnique({
                where: { id: payload.product_id },
                include: { recipes: { where: { is_active: true } } },
            });
            if (!product) throw new ApiError(404, "Product not found");

            const mfg_number = generateMfgNumber();

            let itemsToCreate: { raw_material_id: number; quantity_planned: number }[] = [];

            if (payload.items && payload.items.length > 0) {
                itemsToCreate = payload.items;
            } else {
                if (product.recipes.length === 0) {
                    throw new ApiError(400, "Product has no active BOM (recipes). Provide items manually.");
                }
                itemsToCreate = product.recipes.map((r) => ({
                    raw_material_id: r.raw_mat_id,
                    quantity_planned: Number(r.quantity) * payload.quantity_planned,
                }));
            }

            const order = await tx.productionOrder.create({
                data: {
                    mfg_number,
                    product_id: payload.product_id,
                    quantity_planned: payload.quantity_planned,
                    target_date: payload.target_date,
                    notes: payload.notes,
                    status: ProductionStatus.PLANNING,
                    created_by: userId,
                    items: {
                        create: itemsToCreate.map((i) => ({
                            raw_material_id: i.raw_material_id,
                            quantity_planned: i.quantity_planned,
                        })),
                    },
                },
                include: { items: true, product: true },
            });

            return order;
        });
    }

    static async changeStatus(id: number, payload: RequestChangeStatusDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const order = await tx.productionOrder.findUnique({
                where: { id },
                include: { items: true },
            });
            if (!order) throw new ApiError(404, "Production order not found");

            const { status: nextStatus } = payload;

            const validTransitions: Record<string, string> = {
                [ProductionStatus.PLANNING]: ProductionStatus.RELEASED,
                [ProductionStatus.RELEASED]: ProductionStatus.PROCESSING,
                [ProductionStatus.COMPLETED]: ProductionStatus.QC_REVIEW,
            };

            if (validTransitions[order.status] !== nextStatus) {
                throw new ApiError(
                    400,
                    `Cannot transition from ${order.status} to ${nextStatus}`,
                );
            }

            const updateData: Prisma.ProductionOrderUpdateInput = {
                status: nextStatus as ProductionStatus,
                notes: payload.notes ?? order.notes,
            };

            if (nextStatus === ProductionStatus.RELEASED) {
                await this.validateAndAllocateRM(tx, order.items, id);
                updateData.released_at = new Date();
            }

            if (nextStatus === ProductionStatus.PROCESSING) {
                await this.deductRMStock(tx, order.items, id, userId);
                updateData.processing_at = new Date();
            }

            if (nextStatus === ProductionStatus.QC_REVIEW) {
                updateData.completed_at = order.completed_at;
            }

            const updated = await tx.productionOrder.update({
                where: { id },
                data: updateData,
                include: { items: true, product: true },
            });

            return updated;
        });
    }

    static async submitResult(id: number, payload: RequestSubmitResultDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const order = await tx.productionOrder.findUnique({
                where: { id },
                include: { items: true },
            });
            if (!order) throw new ApiError(404, "Production order not found");
            if (order.status !== ProductionStatus.PROCESSING) {
                throw new ApiError(400, `submitResult requires status PROCESSING, current: ${order.status}`);
            }

            for (const itemPayload of payload.items) {
                const dbItem = order.items.find((i) => i.id === itemPayload.id);
                if (!dbItem) throw new ApiError(400, `Item id ${itemPayload.id} not found in this order`);

                await tx.productionOrderItem.update({
                    where: { id: itemPayload.id },
                    data: { quantity_actual: itemPayload.quantity_actual },
                });

                const planned = Number(dbItem.quantity_planned);
                const actual = itemPayload.quantity_actual;
                const wasteQty = planned - actual;

                if (wasteQty > 0 && dbItem.warehouse_id) {
                    await tx.productionOrderWaste.create({
                        data: {
                            production_order_id: id,
                            waste_type: WasteType.RAW_MATERIAL,
                            raw_material_id: dbItem.raw_material_id,
                            quantity: wasteQty,
                            notes: `RM saving: planned ${planned}, actual ${actual}`,
                        },
                    });

                    await this.addBackRMStock(tx, dbItem.warehouse_id, dbItem.raw_material_id, wasteQty, id, userId);
                }

                if (wasteQty < 0 && dbItem.warehouse_id) {
                    const overUsage = Math.abs(wasteQty);
                    const inv = await tx.rawMaterialInventory.findFirst({
                        where: { raw_material_id: dbItem.raw_material_id, warehouse_id: dbItem.warehouse_id },
                        orderBy: { created_at: "desc" },
                    });
                    if (!inv || Number(inv.quantity) < overUsage) {
                        throw new ApiError(
                            400,
                            `Insufficient RM stock for over-usage of raw_material_id ${dbItem.raw_material_id}`,
                        );
                    }
                    const qtyBefore = Number(inv.quantity);
                    const qtyAfter = qtyBefore - overUsage;
                    await tx.rawMaterialInventory.update({
                        where: { id: inv.id },
                        data: { quantity: qtyAfter },
                    });
                    await tx.stockMovement.create({
                        data: {
                            entity_type: MovementEntityType.RAW_MATERIAL,
                            entity_id: dbItem.raw_material_id,
                            location_type: "WAREHOUSE",
                            location_id: dbItem.warehouse_id,
                            movement_type: MovementType.OUT,
                            quantity: overUsage,
                            qty_before: qtyBefore,
                            qty_after: qtyAfter,
                            reference_id: id,
                            reference_type: MovementRefType.PRODUCTION,
                            created_by: userId,
                        },
                    });
                }
            }

            const updated = await tx.productionOrder.update({
                where: { id },
                data: {
                    quantity_actual: payload.quantity_actual,
                    status: ProductionStatus.COMPLETED,
                    completed_at: new Date(),
                    notes: payload.notes ?? order.notes,
                },
                include: { items: true, product: true, wastes: true },
            });

            return updated;
        });
    }

    static async qcAction(id: number, payload: RequestQcActionDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const order = await tx.productionOrder.findUnique({
                where: { id },
                include: { items: true, goods_receipt: true },
            });
            if (!order) throw new ApiError(404, "Production order not found");
            if (order.status !== ProductionStatus.QC_REVIEW) {
                throw new ApiError(400, `qcAction requires status QC_REVIEW, current: ${order.status}`);
            }
            if (order.goods_receipt) throw new ApiError(400, "GR already created for this production order");

            const fgWarehouse = await tx.warehouse.findUnique({ where: { id: payload.fg_warehouse_id } });
            if (!fgWarehouse) throw new ApiError(404, "FG warehouse not found");

            const totalQc = payload.quantity_accepted + payload.quantity_rejected;
            const actualQty = Number(order.quantity_actual ?? order.quantity_planned);
            if (totalQc > actualQty) {
                throw new ApiError(400, `Total QC (${totalQc}) exceeds actual production quantity (${actualQty})`);
            }

            if (payload.quantity_accepted > 0) {
                const gr = await tx.goodsReceipt.create({
                    data: {
                        gr_number: generateGrNumber(),
                        type: GoodsReceiptType.QC_FG,
                        status: GoodsReceiptStatus.COMPLETED,
                        warehouse_id: payload.fg_warehouse_id,
                        created_by: userId,
                        posted_at: new Date(),
                        production_order_id: id,
                        items: {
                            create: {
                                product_id: order.product_id,
                                quantity_planned: actualQty,
                                quantity_actual: payload.quantity_accepted,
                            },
                        },
                    },
                });

                const now = new Date();
                let pi = await tx.productInventory.findFirst({
                    where: { product_id: order.product_id, warehouse_id: payload.fg_warehouse_id },
                    orderBy: { created_at: "desc" },
                });

                const qtyBefore = pi ? Number(pi.quantity) : 0;
                const qtyAfter = qtyBefore + payload.quantity_accepted;

                if (pi) {
                    await tx.productInventory.update({
                        where: { id: pi.id },
                        data: { quantity: qtyAfter },
                    });
                } else {
                    await tx.productInventory.create({
                        data: {
                            product_id: order.product_id,
                            warehouse_id: payload.fg_warehouse_id,
                            quantity: payload.quantity_accepted,
                            date: now.getDate(),
                            month: now.getMonth() + 1,
                            year: now.getFullYear(),
                        },
                    });
                }

                await tx.stockMovement.create({
                    data: {
                        entity_type: MovementEntityType.PRODUCT,
                        entity_id: order.product_id,
                        location_type: "WAREHOUSE",
                        location_id: payload.fg_warehouse_id,
                        movement_type: MovementType.IN,
                        quantity: payload.quantity_accepted,
                        qty_before: qtyBefore,
                        qty_after: qtyAfter,
                        reference_id: gr.id,
                        reference_type: MovementRefType.GOODS_RECEIPT,
                        created_by: userId,
                    },
                });
            }

            if (payload.quantity_rejected > 0) {
                await tx.productionOrderWaste.create({
                    data: {
                        production_order_id: id,
                        waste_type: WasteType.FINISH_GOODS,
                        product_id: order.product_id,
                        quantity: payload.quantity_rejected,
                        notes: payload.qc_notes ?? "QC Rejected",
                    },
                });
            }

            const updated = await tx.productionOrder.update({
                where: { id },
                data: {
                    status: ProductionStatus.FINISHED,
                    quantity_accepted: payload.quantity_accepted,
                    quantity_rejected: payload.quantity_rejected,
                    fg_warehouse_id: payload.fg_warehouse_id,
                    qc_notes: payload.qc_notes,
                    finished_at: new Date(),
                },
                include: { items: true, product: true, wastes: true, goods_receipt: true },
            });

            return updated;
        });
    }

    static async list(query: QueryProductionDTO) {
        const {
            page = 1,
            take = 10,
            sortBy = "created_at",
            sortOrder = "desc",
            search,
            status,
            product_id,
        } = query;

        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.ProductionOrderWhereInput = {
            ...(search && {
                OR: [
                    { mfg_number: { contains: search, mode: "insensitive" } },
                    { product: { name: { contains: search, mode: "insensitive" } } },
                ],
            }),
            ...(status && { status }),
            ...(product_id && { product_id }),
        };

        const [data, len] = await Promise.all([
            prisma.productionOrder.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy]: sortOrder },
                include: {
                    product: { select: { id: true, name: true, code: true } },
                    items: true,
                },
            }),
            prisma.productionOrder.count({ where }),
        ]);

        return { data, len };
    }

    static async detail(id: number) {
        const result = await prisma.productionOrder.findUnique({
            where: { id },
            include: {
                product: { select: { id: true, name: true, code: true } },
                items: {
                    include: {
                        raw_material: { select: { id: true, name: true, barcode: true } },
                        warehouse: { select: { id: true, name: true, type: true } },
                    },
                },
                wastes: {
                    include: {
                        raw_material: { select: { id: true, name: true } },
                        product: { select: { id: true, name: true } },
                    },
                },
                goods_receipt: true,
                fg_warehouse: { select: { id: true, name: true } },
            },
        });

        if (!result) throw new ApiError(404, "Production order not found");
        return result;
    }

    private static async validateAndAllocateRM(tx: any, items: any[], orderId: number) {
        for (const item of items) {
            const needed = Number(item.quantity_planned);

            const inventories = await tx.rawMaterialInventory.findMany({
                where: {
                    raw_material_id: item.raw_material_id,
                    warehouse: { type: WarehouseType.RAW_MATERIAL },
                    quantity: { gt: 0 },
                },
                orderBy: { quantity: "desc" },
            });

            const totalAvailable = inventories.reduce(
                (sum: number, inv: any) => sum + Number(inv.quantity),
                0,
            );

            if (totalAvailable < needed) {
                throw new ApiError(
                    400,
                    `Insufficient stock for raw_material_id ${item.raw_material_id}. Needed: ${needed}, Available: ${totalAvailable}`,
                );
            }

            let remaining = needed;
            for (const inv of inventories) {
                if (remaining <= 0) break;
                const allocate = Math.min(remaining, Number(inv.quantity));

                await tx.productionOrderItem.updateMany({
                    where: { id: item.id, production_order_id: orderId },
                    data: { warehouse_id: inv.warehouse_id },
                });

                remaining -= allocate;
                if (remaining <= 0) break;
            }
        }
    }

    private static async deductRMStock(tx: any, items: any[], orderId: number, userId: string) {
        for (const item of items) {
            if (!item.warehouse_id) {
                throw new ApiError(
                    400,
                    `Item ${item.id} has no allocated warehouse. Release the order first.`,
                );
            }

            const inv = await tx.rawMaterialInventory.findFirst({
                where: {
                    raw_material_id: item.raw_material_id,
                    warehouse_id: item.warehouse_id,
                },
                orderBy: { created_at: "desc" },
            });

            if (!inv) {
                throw new ApiError(
                    400,
                    `Stock record not found for raw_material_id ${item.raw_material_id} in warehouse ${item.warehouse_id}`,
                );
            }

            const needed = Number(item.quantity_planned);
            const qtyBefore = Number(inv.quantity);

            if (qtyBefore < needed) {
                throw new ApiError(
                    400,
                    `Insufficient stock for raw_material_id ${item.raw_material_id}. Has: ${qtyBefore}, Needed: ${needed}`,
                );
            }

            const qtyAfter = qtyBefore - needed;

            await tx.rawMaterialInventory.update({
                where: { id: inv.id },
                data: { quantity: qtyAfter },
            });

            await tx.stockMovement.create({
                data: {
                    entity_type: MovementEntityType.RAW_MATERIAL,
                    entity_id: item.raw_material_id,
                    location_type: "WAREHOUSE",
                    location_id: item.warehouse_id,
                    movement_type: MovementType.OUT,
                    quantity: needed,
                    qty_before: qtyBefore,
                    qty_after: qtyAfter,
                    reference_id: orderId,
                    reference_type: MovementRefType.PRODUCTION,
                    created_by: userId,
                },
            });
        }
    }

    private static async addBackRMStock(
        tx: any,
        warehouseId: number,
        rawMatId: number,
        quantity: number,
        orderId: number,
        userId: string,
    ) {
        const inv = await tx.rawMaterialInventory.findFirst({
            where: { raw_material_id: rawMatId, warehouse_id: warehouseId },
            orderBy: { created_at: "desc" },
        });

        const qtyBefore = inv ? Number(inv.quantity) : 0;
        const qtyAfter = qtyBefore + quantity;

        if (inv) {
            await tx.rawMaterialInventory.update({
                where: { id: inv.id },
                data: { quantity: qtyAfter },
            });
        } else {
            const now = new Date();
            await tx.rawMaterialInventory.create({
                data: {
                    raw_material_id: rawMatId,
                    warehouse_id: warehouseId,
                    quantity: qtyAfter,
                    date: now.getDate(),
                    month: now.getMonth() + 1,
                    year: now.getFullYear(),
                },
            });
        }

        await tx.stockMovement.create({
            data: {
                entity_type: MovementEntityType.RAW_MATERIAL,
                entity_id: rawMatId,
                location_type: "WAREHOUSE",
                location_id: warehouseId,
                movement_type: MovementType.IN,
                quantity,
                qty_before: qtyBefore,
                qty_after: qtyAfter,
                reference_id: orderId,
                reference_type: MovementRefType.PRODUCTION,
                created_by: userId,
            },
        });
    }
}
