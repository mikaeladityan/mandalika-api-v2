import { Prisma } from "../../../generated/prisma/client.js";
import prisma from "../../../config/prisma.js";
import {
    RequestCreateProductionDTO,
    RequestChangeStatusDTO,
    RequestSubmitResultDTO,
    RequestQcActionDTO,
    QueryProductionDTO,
    RequestUpdateProductionDTO,
    RequestOverrideItemDTO,
} from "./manufacturing.schema.js";
import {
    ProductionStatus,
    MovementType,
    MovementEntityType,
    MovementRefType,
    GoodsReceiptType,
    GoodsReceiptStatus,
    WasteType,
    TransferLocationType,
    TransferStatus,
} from "../../../generated/prisma/enums.js";
import { ApiError } from "../../../lib/errors/api.error.js";
import { GetPagination } from "../../../lib/utils/pagination.js";
import { InventoryHelper } from "../shared/inventory.helper.js";
import { generateDocNumber } from "../shared/inventory.constants.js";

interface WarehouseStock {
    on_hand: number;
    booked: number;
    avail: number;
}

interface MaterialStockInfo {
    total_on_hand: number;
    total_booked: number;
    total_avail: number;
    warehouses: Record<string, WarehouseStock>;
}

export class ManufacturingService {
    private static generateMfgNumber(): string {
        const now = new Date();
        const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
        const seq = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
        return `MFG-${ym}-${seq}`;
    }

    private static generateTrmNumber(): string {
        const now = new Date();
        const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
        const seq = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
        return `TRM-${ymd}-${seq}`;
    }

    private static async getMaterialsStock(
        tx: Prisma.TransactionClient,
        materialIds: number[],
        warehouseIds: number[],
        excludeOrderId?: number
    ): Promise<Record<number, Record<number, WarehouseStock>>> {
        if (!materialIds.length || !warehouseIds.length) return {};

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        // 1. Fetch Latest Periods & On-Hand Quantities in one query
        const stockRecords = await tx.$queryRaw<Array<{ raw_material_id: number; warehouse_id: number; on_hand: number }>>`
            WITH latest_periods AS (
                SELECT DISTINCT ON (raw_material_id, warehouse_id)
                    raw_material_id, warehouse_id, year, month
                FROM raw_material_inventories
                WHERE raw_material_id IN (${Prisma.join(materialIds)})
                  AND warehouse_id IN (${Prisma.join(warehouseIds)})
                  AND (year < ${currentYear} OR (year = ${currentYear} AND month <= ${currentMonth}))
                ORDER BY raw_material_id, warehouse_id, year DESC, month DESC
            )
            SELECT lp.raw_material_id, lp.warehouse_id,
                   COALESCE(SUM(rmi.quantity), 0)::float AS on_hand
            FROM latest_periods lp
            JOIN raw_material_inventories rmi
                ON rmi.raw_material_id = lp.raw_material_id
                AND rmi.warehouse_id = lp.warehouse_id
                AND rmi.year = lp.year
                AND rmi.month = lp.month
            GROUP BY lp.raw_material_id, lp.warehouse_id
        `;

        // 2. Fetch Booked Items and aggregate in JS to handle substitute IDs correctly
        const bookedItems = await tx.productionOrderItem.findMany({
            where: {
                OR: [
                    { raw_material_id: { in: materialIds } },
                    { substitute_raw_material_id: { in: materialIds } }
                ],
                warehouse_id: { in: warehouseIds },
                production_order: {
                    status: ProductionStatus.RELEASED,
                    ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
                },
            },
            select: {
                raw_material_id: true,
                substitute_raw_material_id: true,
                warehouse_id: true,
                quantity_planned: true
            }
        });

        // 3. Map results
        const result: Record<number, Record<number, WarehouseStock>> = {};
        for (const rmId of materialIds) {
            result[rmId] = {};
            for (const whId of warehouseIds) {
                const stock = stockRecords.find(s => s.raw_material_id === rmId && s.warehouse_id === whId);
                
                const bookedQty = bookedItems
                    .filter(b => (b.substitute_raw_material_id === rmId || (!b.substitute_raw_material_id && b.raw_material_id === rmId)) && b.warehouse_id === whId)
                    .reduce((sum, b) => sum + Number(b.quantity_planned), 0);

                const onHand = Number(stock?.on_hand ?? 0);
                
                result[rmId][whId] = {
                    on_hand: onHand,
                    booked: bookedQty,
                    avail: Math.max(0, onHand - bookedQty)
                };
            }
        }
        return result;
    }
    static async create(payload: RequestCreateProductionDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const product = await tx.product.findUnique({
                where: { id: payload.product_id },
                include: { 
                    recipes: { where: { is_active: true } },
                    size: true
                },
            });
            if (!product) throw new ApiError(404, "Produk tidak ditemukan");

            const pSize = Number(product.size?.size ?? 1);
            let itemsToCreate: { raw_material_id: number; quantity_planned: number }[] = [];

            if (payload.items && payload.items.length > 0) {
                itemsToCreate = payload.items;
            } else {
                if (product.recipes.length === 0) {
                    throw new ApiError(400, "Produk tidak memiliki BOM (resep) yang aktif. Masukkan item secara manual.");
                }
                itemsToCreate = product.recipes.map((r) => ({
                    raw_material_id: r.raw_mat_id,
                    quantity_planned: r.use_size_calc
                        ? Number(r.quantity) * pSize * payload.quantity_planned
                        : Number(r.quantity) * payload.quantity_planned,
                }));
            }

            const order = await tx.productionOrder.create({
                data: {
                    mfg_number: this.generateMfgNumber(),
                    product_id: payload.product_id,
                    quantity_planned: payload.quantity_planned,
                    target_date: payload.target_date,
                    notes: payload.notes,
                    fg_warehouse_id: payload.fg_warehouse_id,
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

            // Handle Automated RM Transfer using centralized logic
            for (const item of order.items) {
                await this.syncStockTransfer(tx, order.id, order.mfg_number, item, userId);
            }

            return order;
        });
    }


    private static async syncStockTransfer(
        tx: Prisma.TransactionClient,
        orderId: number,
        mfgNumber: string,
        item: { id: number; raw_material_id: number; quantity_planned: any; substitute_raw_material_id?: number | null },
        userId: string,
        preFetchedStock?: any
    ) {
        const rmWarehouses = await tx.warehouse.findMany({
            where: { type: "RAW_MATERIAL" as any, deleted_at: null },
            select: { id: true, code: true },
        });

        const prdWh = rmWarehouses.find((w: any) => w.code?.toUpperCase().includes("PRD"));
        const kdgWh = rmWarehouses.find((w: any) => w.code?.toUpperCase().includes("KDG"));

        if (!prdWh || !kdgWh) return;

        const effectiveRmId = item.substitute_raw_material_id ?? item.raw_material_id;
        const needed = Number(item.quantity_planned);

        let stockPRD = 0;
        let stockKDG = 0;

        if (preFetchedStock) {
            stockPRD = preFetchedStock[effectiveRmId]?.[prdWh.id]?.avail ?? 0;
            stockKDG = preFetchedStock[effectiveRmId]?.[kdgWh.id]?.avail ?? 0;
        } else {
            const stock = await this.getMaterialsStock(tx, [effectiveRmId], [prdWh.id, kdgWh.id], orderId);
            stockPRD = stock[effectiveRmId]?.[prdWh.id]?.avail ?? 0;
            stockKDG = stock[effectiveRmId]?.[kdgWh.id]?.avail ?? 0;
        }

        if (stockPRD < needed) {
            const shortfall = needed - stockPRD;
            const transferQty = Math.min(shortfall, stockKDG);

            if (transferQty > 0) {
                let transfer = await tx.stockTransfer.findFirst({
                    where: {
                        production_order_id: orderId,
                        status: TransferStatus.PENDING,
                        from_warehouse_id: kdgWh.id,
                        to_warehouse_id: prdWh.id,
                    },
                    select: { id: true },
                });

                if (!transfer) {
                    transfer = await tx.stockTransfer.create({
                        data: {
                            transfer_number: this.generateTrmNumber(),
                            from_type: TransferLocationType.WAREHOUSE,
                            from_warehouse_id: kdgWh.id,
                            to_type: TransferLocationType.WAREHOUSE,
                            to_warehouse_id: prdWh.id,
                            status: TransferStatus.PENDING,
                            notes: `Penerimaan RM Otomatis - Pesanan: ${mfgNumber}`,
                            created_by: userId,
                            barcode: `BC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                            date: new Date(),
                            production_order_id: orderId,
                        },
                        select: { id: true },
                    });
                }

                const existingItem = await tx.stockTransferItem.findFirst({
                    where: { transfer_id: transfer.id, raw_material_id: effectiveRmId },
                });

                if (existingItem) {
                    await tx.stockTransferItem.update({
                        where: { id: existingItem.id },
                        data: { quantity_requested: transferQty },
                    });
                } else {
                    await tx.stockTransferItem.create({
                        data: {
                            transfer_id: transfer.id,
                            raw_material_id: effectiveRmId,
                            quantity_requested: transferQty,
                            notes: `Kebutuhan Order ${mfgNumber}`,
                        },
                    });
                }
            }
        } else {
            const pendingTransfer = await tx.stockTransfer.findFirst({
                where: { production_order_id: orderId, status: TransferStatus.PENDING },
                include: { items: { where: { raw_material_id: effectiveRmId } } }
            });

            if (pendingTransfer && pendingTransfer.items.length > 0) {
                await tx.stockTransferItem.deleteMany({
                    where: { transfer_id: pendingTransfer.id, raw_material_id: effectiveRmId }
                });
                const remaining = await tx.stockTransferItem.count({ where: { transfer_id: pendingTransfer.id } });
                if (remaining === 0) await tx.stockTransfer.delete({ where: { id: pendingTransfer.id } });
            }
        }
    }

    static async changeStatus(id: number, payload: RequestChangeStatusDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const order = await tx.productionOrder.findUnique({
                where: { id },
                include: {
                    items: { include: { raw_material: true, substitute_raw_material: true } },
                    product: { include: { size: true } },
                },
            });
            if (!order) throw new ApiError(404, "Pesanan produksi tidak ditemukan");

            const { status: nextStatus } = payload;
            const validTransitions: Record<string, string> = {
                [ProductionStatus.PLANNING]: ProductionStatus.RELEASED,
                [ProductionStatus.RELEASED]: ProductionStatus.PROCESSING,
                [ProductionStatus.COMPLETED]: ProductionStatus.QC_REVIEW,
            };

            if (validTransitions[order.status] !== nextStatus) {
                throw new ApiError(400, `Tidak dapat beralih status dari ${order.status} ke ${nextStatus}`);
            }

            const updateData: Prisma.ProductionOrderUpdateInput = {
                status: nextStatus as ProductionStatus,
                notes: payload.notes ?? order.notes,
                updated_by: userId,
            };

            if (nextStatus === ProductionStatus.RELEASED) {
                await this.validateAndAllocateRM(tx, order.items, id, order.mfg_number, userId);
                updateData.released_at = new Date();
            } else if (nextStatus === ProductionStatus.PROCESSING) {
                await this.deductRMStock(tx, order.items, id, order.mfg_number, userId);
                updateData.processing_at = new Date();
            }

            const updated = await tx.productionOrder.update({
                where: { id },
                data: updateData,
                include: { items: true, product: true },
            });

            return this.attachAuditUsers(updated);
        });
    }

    static async submitResult(id: number, payload: RequestSubmitResultDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const order = await tx.productionOrder.findUnique({
                where: { id },
                include: {
                    items: { include: { raw_material: true, substitute_raw_material: true } },
                    product: true,
                },
            });
            if (!order) throw new ApiError(404, "Pesanan produksi tidak ditemukan");
            if (order.status !== ProductionStatus.PROCESSING) {
                throw new ApiError(400, `Hanya pesanan berstatus PROCESSING yang dapat dikirim hasilnya.`);
            }

            const actualFG = Number(payload.quantity_actual);
            const plannedFG = Number(order.quantity_planned);

            // 1. Process items (summed usage from all outputs)
            for (const itemPayload of payload.items) {
                let dbItem = order.items.find(i => i.id === itemPayload.id);
                
                // Handle existing items
                if (dbItem) {
                    const planned = Number(dbItem.quantity_planned);
                    const actual = itemPayload.quantity_actual;
                    const diff = planned - actual;
                    const rmId = dbItem.substitute_raw_material_id ?? dbItem.raw_material_id;
                    const warehouseId = dbItem.warehouse_id;

                    await tx.productionOrderItem.update({
                        where: { id: dbItem.id },
                        data: { quantity_actual: actual },
                    });

                    if (diff > 0 && warehouseId) {
                        await this.addBackRMStock(tx, warehouseId, rmId, diff, id, userId);
                        await tx.productionOrderWaste.create({
                            data: {
                                production_order_id: id,
                                waste_type: WasteType.RAW_MATERIAL,
                                raw_material_id: rmId,
                                quantity: diff,
                                notes: `RM saving: planned ${planned}, actual ${actual}`,
                            },
                        });
                    } else if (diff < 0 && warehouseId) {
                        const overUsage = Math.abs(diff);
                        const rmName = dbItem.substitute_raw_material?.name ?? dbItem.raw_material?.name ?? "";
                        await InventoryHelper.deductWarehouseStock(
                            tx, warehouseId,
                            [{ raw_material_id: rmId, quantity: overUsage, raw_material: { name: rmName } }],
                            id, MovementRefType.PRODUCTION, MovementType.OUT, userId, 
                            `Pemakaian Tambahan (Base Overusage + Split FG) - MFG: ${order.mfg_number}`, 
                            MovementEntityType.RAW_MATERIAL
                        );
                        await tx.productionOrderWaste.create({
                            data: {
                                production_order_id: id,
                                waste_type: WasteType.RAW_MATERIAL,
                                raw_material_id: rmId,
                                quantity: overUsage,
                                notes: "Pemakaian Berlebih (Overconsumption)",
                            },
                        });
                    }
                } else if (itemPayload.raw_material_id && itemPayload.warehouse_id) {
                    // Handle new items (Extra materials for splits)
                    const actual = itemPayload.quantity_actual;
                    if (actual <= 0) continue;

                    await tx.productionOrderItem.create({
                        data: {
                            production_order_id: id,
                            raw_material_id: itemPayload.raw_material_id,
                            warehouse_id: itemPayload.warehouse_id,
                            quantity_planned: 0,
                            quantity_actual: actual,
                        },
                    });

                    await InventoryHelper.deductWarehouseStock(
                        tx, itemPayload.warehouse_id,
                        [{ raw_material_id: itemPayload.raw_material_id, quantity: actual }],
                        id, MovementRefType.PRODUCTION, MovementType.OUT, userId, 
                        `Pemakaian Bahan Split FG (New Material) - MFG: ${order.mfg_number}`, 
                        MovementEntityType.RAW_MATERIAL
                    );
                    
                    await tx.productionOrderWaste.create({
                        data: {
                            production_order_id: id,
                            waste_type: WasteType.RAW_MATERIAL,
                            raw_material_id: itemPayload.raw_material_id,
                            quantity: actual,
                            notes: `Pemakaian Bahan Split FG (New Material) - MFG: ${order.mfg_number}`,
                        },
                    });
                }
            }

            // 2. Save Multiple Outputs
            if (payload.outputs && payload.outputs.length > 0) {
                await tx.productionOrderOutput.deleteMany({ where: { production_order_id: id } });
                await tx.productionOrderOutput.createMany({
                    data: payload.outputs.map(o => ({
                        production_order_id: id,
                        product_id: o.product_id,
                        quantity_actual: o.quantity_actual,
                        notes: o.notes,
                    })),
                });
            }

            const yieldLoss = plannedFG - actualFG;
            if (yieldLoss > 0) {
                await tx.productionOrderWaste.create({
                    data: {
                        production_order_id: id,
                        product_id: order.product_id,
                        waste_type: WasteType.FINISH_GOODS,
                        quantity: yieldLoss,
                        notes: "Selisih Hasil Produksi (Yield Loss)",
                    },
                });
            }

            const updated = await tx.productionOrder.update({
                where: { id },
                data: {
                    quantity_actual: actualFG,
                    status: ProductionStatus.QC_REVIEW,
                    completed_at: new Date(),
                    notes: payload.notes ?? order.notes,
                    updated_by: userId,
                },
                include: { items: true, product: true, wastes: true, outputs: { include: { product: true } } },
            });

            return this.attachAuditUsers(updated);
        });
    }

    static async qcAction(id: number, payload: RequestQcActionDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const order = await tx.productionOrder.findUnique({
                where: { id },
                include: {
                    product: { include: { unit: true } },
                    outputs: { include: { product: { include: { unit: true } } } },
                },
            });
            if (!order) throw new ApiError(404, "Pesanan produksi tidak ditemukan");
            if (order.status !== ProductionStatus.QC_REVIEW) {
                throw new ApiError(400, "Hanya pesanan berstatus QC_REVIEW yang dapat diproses QC.");
            }

            // 1. Collect all accepted items for Goods Receipt
            const acceptedItems: { product_id: number; quantity: number }[] = [];
            
            if (payload.quantity_accepted > 0) {
                acceptedItems.push({
                    product_id: order.product_id,
                    quantity: Number(payload.quantity_accepted),
                });
            }

            // 2. Process Primary Product Update
            await tx.productionOrder.update({
                where: { id },
                data: {
                    quantity_accepted: payload.quantity_accepted,
                    quantity_rejected: payload.quantity_rejected,
                    status: ProductionStatus.FINISHED,
                    finished_at: new Date(),
                    fg_warehouse_id: payload.fg_warehouse_id,
                    qc_notes: payload.qc_notes,
                    updated_by: userId,
                },
            });

            if (payload.quantity_rejected > 0) {
                await tx.productionOrderWaste.create({
                    data: {
                        production_order_id: id,
                        waste_type: WasteType.FINISH_GOODS,
                        product_id: order.product_id,
                        warehouse_id: payload.fg_warehouse_id,
                        quantity: payload.quantity_rejected,
                        notes: payload.qc_notes || "Reject QC (Primary Product)",
                    },
                });
            }

            // 3. Process Split Outputs QC & Collect Items
            if (payload.outputs && payload.outputs.length > 0) {
                for (const outPayload of payload.outputs) {
                    const dbOutput = order.outputs.find(o => o.id === outPayload.id);
                    if (!dbOutput) continue;

                    await tx.productionOrderOutput.update({
                        where: { id: outPayload.id },
                        data: {
                            quantity_accepted: outPayload.quantity_accepted,
                            quantity_rejected: outPayload.quantity_rejected,
                        },
                    });

                    if (outPayload.quantity_accepted > 0) {
                        acceptedItems.push({
                            product_id: dbOutput.product_id,
                            quantity: Number(outPayload.quantity_accepted),
                        });
                    }

                    if (outPayload.quantity_rejected > 0) {
                        await tx.productionOrderWaste.create({
                            data: {
                                production_order_id: id,
                                waste_type: WasteType.FINISH_GOODS,
                                product_id: dbOutput.product_id,
                                warehouse_id: payload.fg_warehouse_id,
                                quantity: outPayload.quantity_rejected,
                                notes: "Reject QC (Split Product)",
                            },
                        });
                    }
                }
            }

            // 4. Create Single Goods Receipt for All Accepted Items
            if (acceptedItems.length > 0) {
                const gr = await tx.goodsReceipt.create({
                    data: {
                        gr_number: generateDocNumber("GR"),
                        type: GoodsReceiptType.QC_FG,
                        status: GoodsReceiptStatus.COMPLETED,
                        warehouse_id: payload.fg_warehouse_id,
                        created_by: userId,
                        posted_at: new Date(),
                        production_order_id: id,
                        notes: `Hasil Produksi MFG: ${order.mfg_number} (Termasuk Produk Tambahan/Split)`,
                    },
                });

                // Add all items to GR
                for (const item of acceptedItems) {
                    await tx.goodsReceiptItem.create({
                        data: {
                            gr_id: gr.id,
                            product_id: item.product_id,
                            quantity_planned: item.quantity,
                            quantity_actual: item.quantity,
                        },
                    });
                }

                // Update stock for all items
                await InventoryHelper.addWarehouseStock(
                    tx, payload.fg_warehouse_id,
                    acceptedItems,
                    gr.id, MovementRefType.GOODS_RECEIPT, MovementType.IN, userId, undefined, MovementEntityType.PRODUCT
                );
            }

            return { success: true };
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
            ...(status && { 
                status: Array.isArray(status) ? { in: status } : status 
            }),
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

        await ManufacturingService.attachAuditUsers(data);
        return { data, len };
    }

    static async detail(id: number) {
        const result = await prisma.productionOrder.findUnique({
            where: { id },
            include: {
                product: { include: { unit: { select: { id: true, name: true } } } },
                items: {
                    include: {
                        raw_material: { include: { unit_raw_material: { select: { id: true, name: true } } } },
                        substitute_raw_material: { include: { unit_raw_material: { select: { id: true, name: true } } } },
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
                outputs: {
                    include: {
                        product: {
                            include: {
                                size: true,
                                unit: { select: { id: true, name: true } }
                            }
                        }
                    }
                }
            },
        });

        if (!result) throw new ApiError(404, "Pesanan produksi tidak ditemukan");

        const rmWarehouses = await prisma.warehouse.findMany({
            where: { type: "RAW_MATERIAL" as any, deleted_at: null },
            select: { id: true, name: true, code: true },
        });

        if (rmWarehouses.length > 0) {
            const whIds = rmWarehouses.map(w => w.id);
            const materialIds = result.items.map(i => i.substitute_raw_material_id ?? i.raw_material_id);
            const stockMap = await this.getMaterialsStock(prisma, materialIds, whIds, result.id);

            const prdWh = rmWarehouses.find(w => w.code?.toUpperCase().includes("PRD"));
            const kdgWh = rmWarehouses.find(w => w.code?.toUpperCase().includes("KDG"));

            for (const item of result.items) {
                const rmId = item.substitute_raw_material_id ?? item.raw_material_id;
                const mStock = stockMap[rmId] || {};
                
                const warehouseStock: Record<string, WarehouseStock> = {};
                let totalOnHand = 0;
                let totalBooked = 0;

                for (const wh of rmWarehouses) {
                    const ws = mStock[wh.id] || { on_hand: 0, booked: 0, avail: 0 };
                    warehouseStock[wh.code || wh.name] = ws;
                    totalOnHand += ws.on_hand;
                    totalBooked += ws.booked;
                }

                (item as any).inventory_stock = {
                    prd: prdWh ? (mStock[prdWh.id]?.on_hand ?? 0) : 0,
                    kdg: kdgWh ? (mStock[kdgWh.id]?.on_hand ?? 0) : 0,
                    total: totalOnHand,
                    prd_avail: prdWh ? (mStock[prdWh.id]?.avail ?? 0) : 0,
                    kdg_avail: kdgWh ? (mStock[kdgWh.id]?.avail ?? 0) : 0,
                    total_avail: Math.max(0, totalOnHand - totalBooked),
                    booked_prd: prdWh ? (mStock[prdWh.id]?.booked ?? 0) : 0,
                    booked_kdg: kdgWh ? (mStock[kdgWh.id]?.booked ?? 0) : 0,
                    warehouses: warehouseStock,
                };
            }
        }

        return this.attachAuditUsers(result);
    }

    static async listWastes(query: any) {
        const { page = 1, take = 10, waste_type, search } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.ProductionOrderWasteWhereInput = {
            ...(waste_type && { waste_type: waste_type as WasteType }),
            ...(search && {
                OR: [
                    { production_order: { mfg_number: { contains: search, mode: "insensitive" } } },
                    { product: { name: { contains: search, mode: "insensitive" } } },
                    { raw_material: { name: { contains: search, mode: "insensitive" } } },
                ],
            }),
        };

        const [data, len] = await Promise.all([
            prisma.productionOrderWaste.findMany({
                where,
                skip,
                take: limit,
                orderBy: { created_at: "desc" },
                include: {
                    production_order: {
                        select: { id: true, mfg_number: true }
                    },
                    product: { select: { id: true, name: true } },
                    raw_material: { select: { id: true, name: true } },
                },
            }),
            prisma.productionOrderWaste.count({ where }),
        ]);

        return { data, len };
    }

    static async delete(id: number) {
        return await prisma.$transaction(async (tx) => {
            const order = await tx.productionOrder.findUnique({
                where: { id },
                include: { items: true },
            });
            if (!order) throw new ApiError(404, "Pesanan produksi tidak ditemukan");
            
            // Safety check: Only ALLOW deletion for PLANNING status (before release/processing)
            if (order.status !== ProductionStatus.PLANNING) {
                throw new ApiError(400, "Tidak dapat menghapus pesanan produksi yang sudah dirilis atau diproses");
            }

            // Delete order items first (manual cascade if not set in DB)
            await tx.productionOrderItem.deleteMany({
                where: { production_order_id: id }
            });

            // Delete associated stock transfers (Penerimaan RM / Auto-generated RM Transfers)
            // Note: We only delete if they are still in PENDING or APPROVED status (not yet processed/shipped)
            await tx.stockTransfer.deleteMany({
                where: { 
                    production_order_id: id,
                    status: { in: [TransferStatus.PENDING, TransferStatus.APPROVED] }
                }
            });

            // Delete the order
            const deleted = await tx.productionOrder.delete({
                where: { id }
            });

            return deleted;
        });
    }

    static async cleanCancelled() {
        return await prisma.$transaction(async (tx) => {
            // Target: Find ProductionOrders that have an associated StockTransfer with status CANCELLED
            // Since ProductionStatus doesn't have CANCELLED, we identify them via the linked transfer
            const cancelledProductions = await tx.productionOrder.findMany({
                where: {
                    stock_transfer: {
                        status: TransferStatus.CANCELLED
                    }
                },
                select: { id: true }
            });

            const ids = cancelledProductions.map(p => p.id);
            if (ids.length === 0) return { count: 0 };

            // 1. Delete associated Stock Transfer dependencies
            await tx.stockTransferItem.deleteMany({
                where: { transfer: { production_order_id: { in: ids } } }
            });
            await tx.stockTransferPhoto.deleteMany({
                where: { transfer: { production_order_id: { in: ids } } }
            });
            await tx.stockTransfer.deleteMany({
                where: { production_order_id: { in: ids } }
            });

            // 2. Delete associated Goods Receipt dependencies (if any)
            await tx.goodsReceiptItem.deleteMany({
                where: { goods_receipt: { production_order_id: { in: ids } } }
            });
            await tx.goodsReceipt.deleteMany({
                where: { production_order_id: { in: ids } }
            });

            // 3. Delete Production detail dependencies
            await tx.productionOrderItem.deleteMany({
                where: { production_order_id: { in: ids } }
            });
            await tx.productionOrderWaste.deleteMany({
                where: { production_order_id: { in: ids } }
            });

            // 4. Finally delete the Production Orders
            const deleted = await tx.productionOrder.deleteMany({
                where: { id: { in: ids } }
            });

            return deleted;
        });
    }
    
    static async update(id: number, payload: RequestUpdateProductionDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const order = await tx.productionOrder.findUnique({
                where: { id },
            });
            if (!order) throw new ApiError(404, "Pesanan produksi tidak ditemukan");

            // Safety check: Only ALLOW update for PLANNING or RELEASED status
            if (order.status !== ProductionStatus.PLANNING && order.status !== ProductionStatus.RELEASED) {
                throw new ApiError(400, "Tidak dapat mengubah pesanan produksi yang sudah diproses atau selesai");
            }

            const updated = await tx.productionOrder.update({
                where: { id },
                data: {
                    target_date: payload.target_date ?? order.target_date,
                    notes: payload.notes ?? order.notes,
                    fg_warehouse_id: payload.fg_warehouse_id ?? order.fg_warehouse_id,
                    updated_by: userId,
                },
                include: { product: true, items: true },
            });

            await ManufacturingService.attachAuditUsers(updated);

            return updated;
        });
    }

    private static async validateAndAllocateRM(
        tx: Prisma.TransactionClient, 
        items: any[], 
        orderId: number, 
        mfgNumber: string,
        userId: string
    ) {
        const rmWarehouses = await tx.warehouse.findMany({
            where: { type: "RAW_MATERIAL" as any, deleted_at: null },
            select: { id: true, code: true, name: true },
        });

        const prdWh = rmWarehouses.find((w: any) => w.code?.toUpperCase().includes("PRD"));
        const kdgWh = rmWarehouses.find((w: any) => w.code?.toUpperCase().includes("KDG"));

        if (!prdWh) throw new ApiError(400, "Gudang Produksi (PRD) tidak ditemukan dalam sistem.");

        const materialIds = items.map(i => i.substitute_raw_material_id ?? i.raw_material_id);
        const whIds = rmWarehouses.map(w => w.id);
        const stockMap = await this.getMaterialsStock(tx, materialIds, whIds, orderId);

        for (const item of items) {
            const needed = Number(item.quantity_planned);
            const rmId = item.substitute_raw_material_id ?? item.raw_material_id;
            const rmName = item.substitute_raw_material?.name ?? item.raw_material?.name ?? String(rmId);

            const mStock = stockMap[rmId] || {};
            const availPRD = mStock[prdWh.id]?.avail ?? 0;
            const availKDG = kdgWh ? (mStock[kdgWh.id]?.avail ?? 0) : 0;
            const totalAvailable = availPRD + availKDG;

            if (totalAvailable < needed) {
                throw new ApiError(400, `Stok tidak mencukupi untuk ${rmName}. Total tersedia: ${totalAvailable}.`);
            }

            // Sync transfer if PRD stock is low
            await this.syncStockTransfer(tx, orderId, mfgNumber, item, userId, stockMap);

            await tx.productionOrderItem.updateMany({
                where: { id: item.id, production_order_id: orderId },
                data: { warehouse_id: prdWh.id },
            });
        }
    }

    private static async deductRMStock(tx: any, items: any[], orderId: number, mfgNumber: string, userId: string) {
        const stockItems = items.map(item => ({
            raw_material_id: item.substitute_raw_material_id ?? item.raw_material_id,
            quantity: Number(item.quantity_planned),
            raw_material: { name: item.substitute_raw_material?.name ?? item.raw_material?.name },
        }));

        // Use the same warehouse for all items in a production order typically (GRM-PRD)
        const warehouseId = items[0]?.warehouse_id;
        if (!warehouseId) {
            throw new ApiError(400, "Alokasi gudang tidak ditemukan untuk item produksi.");
        }

        await InventoryHelper.deductWarehouseStock(
            tx,
            warehouseId,
            stockItems,
            orderId,
            MovementRefType.PRODUCTION,
            MovementType.OUT,
            userId,
            `Pemakaian Bahan Baku (Planned) - MFG: ${mfgNumber}`,
            MovementEntityType.RAW_MATERIAL
        );
    }

    private static async addBackRMStock(
        tx: any,
        warehouseId: number,
        rawMatId: number,
        quantity: number,
        orderId: number,
        userId: string,
    ) {
        await InventoryHelper.addWarehouseStock(
            tx,
            warehouseId,
            [{ raw_material_id: rawMatId, quantity }],
            orderId,
            MovementRefType.PRODUCTION,
            MovementType.IN,
            userId,
            "Pengembalian Sisa Bahan (RM Saving)",
            MovementEntityType.RAW_MATERIAL
        );
    }

    static async overrideItem(orderId: number, itemId: number, payload: RequestOverrideItemDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const order = await tx.productionOrder.findUnique({
                where: { id: orderId },
                select: { id: true, status: true, mfg_number: true },
            });
            if (!order) throw new ApiError(404, "Pesanan produksi tidak ditemukan");

            if (order.status !== ProductionStatus.PLANNING && order.status !== ProductionStatus.RELEASED) {
                throw new ApiError(400, `Override hanya diizinkan pada status PLANNING atau RELEASED. Status saat ini: ${order.status}`);
            }

            const item = await tx.productionOrderItem.findFirst({
                where: { id: itemId, production_order_id: orderId },
            });
            if (!item) throw new ApiError(404, "Item tidak ditemukan dalam pesanan ini");
            if (payload.substitute_raw_material_id === item.raw_material_id) {
                throw new ApiError(400, "Bahan baku pengganti tidak boleh sama dengan bahan baku asli");
            }

            const updated = await tx.productionOrderItem.update({
                where: { id: itemId },
                data: {
                    substitute_raw_material_id: payload.substitute_raw_material_id,
                    override_reason: payload.override_reason,
                },
                include: { raw_material: true, substitute_raw_material: true },
            });

            await this.syncStockTransfer(tx, orderId, order.mfg_number, updated, userId);
            return updated;
        });
    }

    static async clearItemOverride(orderId: number, itemId: number, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const order = await tx.productionOrder.findUnique({
                where: { id: orderId },
                select: { id: true, status: true, mfg_number: true },
            });
            if (!order) throw new ApiError(404, "Pesanan produksi tidak ditemukan");

            if (order.status !== ProductionStatus.PLANNING && order.status !== ProductionStatus.RELEASED) {
                throw new ApiError(400, `Hapus override hanya diizinkan pada status PLANNING atau RELEASED. Status saat ini: ${order.status}`);
            }

            const item = await tx.productionOrderItem.findFirst({
                where: { id: itemId, production_order_id: orderId },
            });
            if (!item || !item.substitute_raw_material_id) throw new ApiError(400, "Override tidak ditemukan");

            const updated = await tx.productionOrderItem.update({
                where: { id: itemId },
                data: { substitute_raw_material_id: null, override_reason: null },
                include: { raw_material: true, substitute_raw_material: true },
            });

            await this.syncStockTransfer(tx, orderId, order.mfg_number, updated, userId);
            return updated;
        });
    }

    static async bomPreview(productId: number) {
        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: {
                size: true,
                recipes: {
                    where: { is_active: true },
                    include: { raw_materials: { include: { unit_raw_material: true } } },
                },
            },
        });

        if (!product) throw new ApiError(404, "Produk tidak ditemukan");
        if (!product.recipes.length) throw new ApiError(404, "Produk tidak memiliki resep aktif");

        const rmWarehouses = await prisma.warehouse.findMany({
            where: { type: "RAW_MATERIAL" as any, deleted_at: null },
            select: { id: true, code: true, name: true },
        });

        const whIds = rmWarehouses.map(w => w.id);
        const uniqueRmIds = [...new Set(product.recipes.map(r => r.raw_mat_id))];
        const stockMap = await this.getMaterialsStock(prisma, uniqueRmIds, whIds);

        const firstRecipe = product.recipes[0]!;
        const recipes = product.recipes.map((r) => {
            const mStock = stockMap[r.raw_mat_id] || {};
            const warehouses: Record<string, WarehouseStock> = {};

            for (const wh of rmWarehouses) {
                warehouses[wh.code || wh.name] = mStock[wh.id] || { on_hand: 0, booked: 0, avail: 0 };
            }

            return {
                raw_mat_id: r.raw_mat_id,
                barcode: r.raw_materials?.barcode ?? null,
                name: r.raw_materials?.name ?? "",
                quantity: Number(r.quantity),
                unit: r.raw_materials?.unit_raw_material?.name ?? "",
                use_size_calc: !!r.use_size_calc,
                warehouses,
            };
        });

        return {
            product_id: product.id,
            code: product.code,
            name: product.name,
            product_size: Number(product.size?.size ?? 1),
            version: firstRecipe.version,
            is_active: firstRecipe.is_active,
            description: firstRecipe.description ?? null,
            recipes,
        };
    }

    private static async attachAuditUsers(orders: any | any[]) {
        const isArray = Array.isArray(orders);
        const orderList = isArray ? orders : [orders];
        
        const userIds = new Set<string>();
        orderList.forEach(order => {
            if (order.created_by) userIds.add(order.created_by);
            if (order.updated_by) userIds.add(order.updated_by);
        });

        if (userIds.size === 0) return orders;

        const users = await prisma.user.findMany({
            where: { id: { in: Array.from(userIds) } },
            select: { id: true, first_name: true, last_name: true, photo: true }
        });

        const userMap = new Map(users.map(u => [u.id, u]));

        orderList.forEach(order => {
            order.creator = userMap.get(order.created_by) || { first_name: order.created_by, last_name: "" };
            order.updater = userMap.get(order.updated_by) || (order.updated_by ? { first_name: order.updated_by, last_name: "" } : null);
        });

        return orders;
    }
}
