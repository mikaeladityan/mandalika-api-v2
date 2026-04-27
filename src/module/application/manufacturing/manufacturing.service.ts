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

function generateMfgNumber(): string {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const seq = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, "0");
    return `MFG-${ym}-${seq}`;
}

function generateTrmNumber(): string {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const seq = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, "0");
    return `TRM-${ymd}-${seq}`;
}

export class ManufacturingService {
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

            const mfg_number = generateMfgNumber();
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
                    mfg_number,
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
                include: { 
                    items: {
                        include: { raw_material: true }
                    }, 
                    product: true 
                },
            });

            // Handle Automated RM Transfer (Penerimaan RM)
            await this.handleAutomaticRMTransfer(tx, order, userId);

            return order;
        });
    }

    private static async getLatestRMStock(tx: any, rmId: number, warehouseId: number, excludeOrderId?: number): Promise<number> {
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();

        // 1. Get the latest available period for this RM in THIS specific warehouse (avoiding future periods)
        const latestPeriod = await tx.rawMaterialInventory.findFirst({
            where: { 
                raw_material_id: rmId, 
                warehouse_id: warehouseId,
                OR: [
                    { year: { lt: currentYear } },
                    { year: currentYear, month: { lte: currentMonth } }
                ]
            },
            orderBy: [{ year: "desc" }, { month: "desc" }],
            select: { month: true, year: true },
        });

        if (!latestPeriod) return 0;

        // 2. Get on-hand stock (sum of inventory records for that month)
        const records = await tx.rawMaterialInventory.findMany({
            where: {
                raw_material_id: rmId,
                warehouse_id: warehouseId,
                month: latestPeriod.month,
                year: latestPeriod.year,
            },
        });

        const onHand = records.reduce((sum: number, r: any) => sum + Number(r.quantity), 0);

        // 3. Calculate booked quantity (from RELEASED production orders, excluding the current order if specified)
        const bookedResult = await tx.productionOrderItem.aggregate({
            where: {
                raw_material_id: rmId,
                warehouse_id: warehouseId,
                production_order: {
                    status: ProductionStatus.RELEASED,
                    ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
                },
            },
            _sum: { quantity_planned: true },
        });

        const booked = Number(bookedResult._sum.quantity_planned || 0);

        // 4. Available = On-Hand - Booked
        return Math.max(0, onHand - booked);
    }

    private static async handleAutomaticRMTransfer(tx: any, order: any, userId: string) {
        // Dynamically find PRD and KDG warehouses by code pattern
        const rmWarehouses = await tx.warehouse.findMany({
            where: { type: "RAW_MATERIAL" as any, deleted_at: null },
            select: { id: true, code: true, name: true },
        });

        const prdWh = rmWarehouses.find((w: any) => w.code?.toUpperCase().includes("PRD"));
        const kdgWh = rmWarehouses.find((w: any) => w.code?.toUpperCase().includes("KDG"));

        if (!prdWh || !kdgWh) return;

        const transferItems: any[] = [];

        for (const item of order.items) {
            const needed = Number(item.quantity_planned);

            // Independent stock check for each warehouse
            const [stockPRD, stockKDG] = await Promise.all([
                this.getLatestRMStock(tx, item.raw_material_id, prdWh.id),
                this.getLatestRMStock(tx, item.raw_material_id, kdgWh.id),
            ]);

            if (stockPRD < needed) {
                const shortfall = needed - stockPRD;
                // Move what is available in KDG to cover shortfall
                const transferQty = Math.min(shortfall, stockKDG);

                if (transferQty > 0) {
                    transferItems.push({
                        raw_material_id: item.raw_material_id,
                        quantity_requested: transferQty,
                        notes: `Auto-generated for Order ${order.mfg_number}`,
                    });
                }
            }
        }

        if (transferItems.length > 0) {
            await tx.stockTransfer.create({
                data: {
                    transfer_number: generateTrmNumber(),
                    from_type: TransferLocationType.WAREHOUSE,
                    from_warehouse_id: kdgWh.id,
                    to_type: TransferLocationType.WAREHOUSE,
                    to_warehouse_id: prdWh.id,
                    status: TransferStatus.PENDING,
                    notes: `Penerimaan RM Otomatis - Pesanan: ${order.mfg_number}`,
                    created_by: userId,
                    barcode: `BC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                    date: new Date(),
                    production_order_id: order.id,
                    items: {
                        create: transferItems.map(ti => ({
                            raw_material_id: ti.raw_material_id,
                            quantity_requested: ti.quantity_requested,
                            notes: ti.notes,
                        })),
                    },
                },
            });
        }
    }

    static async changeStatus(id: number, payload: RequestChangeStatusDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const order = await tx.productionOrder.findUnique({
                where: { id },
                include: {
                    items: {
                        include: {
                            raw_material: { select: { id: true, name: true } },
                            substitute_raw_material: { select: { id: true, name: true } },
                        }
                    }
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
                throw new ApiError(
                    400,
                    `Tidak dapat beralih status dari ${order.status} ke ${nextStatus}`,
                );
            }

            const updateData: Prisma.ProductionOrderUpdateInput = {
                status: nextStatus as ProductionStatus,
                notes: payload.notes ?? order.notes,
                updated_by: userId,
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

            await ManufacturingService.attachAuditUsers(updated);

            return updated;
        });
    }

    static async submitResult(id: number, payload: RequestSubmitResultDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const order = await tx.productionOrder.findUnique({
                where: { id },
                include: {
                    items: {
                        include: {
                            raw_material: { select: { id: true, name: true } },
                            substitute_raw_material: { select: { id: true, name: true } },
                        }
                    }
                },
            });
            if (!order) throw new ApiError(404, "Pesanan produksi tidak ditemukan");
            if (order.status !== ProductionStatus.PROCESSING) {
                throw new ApiError(400, `submitResult memerlukan status PROCESSING, status saat ini: ${order.status}`);
            }

            // Pre-validate: cek stok untuk semua item yang overconsumption sebelum ada mutasi
            const now = new Date();
            const currentMonth = now.getMonth() + 1;
            const currentYear = now.getFullYear();
            const shortfalls: string[] = [];

            for (const itemPayload of payload.items) {
                const dbItem = order.items.find((i) => i.id === itemPayload.id);
                if (!dbItem || !dbItem.warehouse_id) continue;

                const planned = Number(dbItem.quantity_planned);
                const actual = itemPayload.quantity_actual;
                const wasteQty = planned - actual;

                if (wasteQty < 0) {
                    const overUsage = Math.abs(wasteQty);
                    const effectiveRmId = (dbItem as any).substitute_raw_material_id ?? dbItem.raw_material_id;
                    const effectiveRmName =
                        (dbItem as any).substitute_raw_material?.name ??
                        (dbItem as any).raw_material?.name ??
                        `Material ID:${effectiveRmId}`;

                    const periodRecords = await tx.rawMaterialInventory.findMany({
                        where: {
                            raw_material_id: effectiveRmId,
                            warehouse_id: dbItem.warehouse_id,
                            month: currentMonth,
                            year: currentYear,
                        },
                    });
                    const available = periodRecords.reduce((sum: number, r: any) => sum + Number(r.quantity), 0);

                    if (available < overUsage) {
                        shortfalls.push(
                            `${effectiveRmName}: butuh tambah ${overUsage}, tersedia ${available} (kurang ${overUsage - available})`,
                        );
                    }
                }
            }

            if (shortfalls.length > 0) {
                throw new ApiError(
                    400,
                    `Stok bahan baku tidak mencukupi untuk pemakaian berlebih:\n${shortfalls.join("\n")}`,
                );
            }

            for (const itemPayload of payload.items) {
                const dbItem = order.items.find((i) => i.id === itemPayload.id);
                if (!dbItem) throw new ApiError(400, `Item ID ${itemPayload.id} tidak ditemukan dalam pesanan ini`);

                await tx.productionOrderItem.update({
                    where: { id: itemPayload.id },
                    data: { quantity_actual: itemPayload.quantity_actual },
                });

                const planned = Number(dbItem.quantity_planned);
                const actual = itemPayload.quantity_actual;
                const wasteQty = planned - actual;

                // Use substitute RM if override was applied, otherwise original
                const effectiveRmId = (dbItem as any).substitute_raw_material_id ?? dbItem.raw_material_id;
                const effectiveRmName = (dbItem as any).substitute_raw_material?.name ?? (dbItem as any).raw_material?.name ?? "";

                if (wasteQty > 0 && dbItem.warehouse_id) {
                    await tx.productionOrderWaste.create({
                        data: {
                            production_order_id: id,
                            waste_type: WasteType.RAW_MATERIAL,
                            raw_material_id: effectiveRmId,
                            quantity: wasteQty,
                            notes: `RM saving: planned ${planned}, actual ${actual}`,
                        },
                    });

                    await this.addBackRMStock(tx, dbItem.warehouse_id, effectiveRmId, wasteQty, id, userId);
                }

                if (wasteQty < 0 && dbItem.warehouse_id) {
                    const overUsage = Math.abs(wasteQty);
                    await InventoryHelper.deductWarehouseStock(
                        tx,
                        dbItem.warehouse_id,
                        [{ raw_material_id: effectiveRmId, quantity: overUsage, raw_material: { name: effectiveRmName } }],
                        id,
                        MovementRefType.PRODUCTION,
                        MovementType.OUT,
                        userId,
                        undefined, // notes
                        MovementEntityType.RAW_MATERIAL
                    );

                    // Log as Waste RM
                    await tx.productionOrderWaste.create({
                        data: {
                            production_order_id: id,
                            waste_type: WasteType.RAW_MATERIAL,
                            raw_material_id: effectiveRmId,
                            quantity: overUsage,
                            notes: "Pemakaian Berlebih (Overconsumption)",
                        },
                    });
                }
            }

            // Calculate Yield Loss (Planned vs Actual)
            const plannedQty = Number(order.quantity_planned);
            const actualQty = Number(payload.quantity_actual);
            const yieldLoss = plannedQty - actualQty;

            if (yieldLoss > 0) {
                await tx.productionOrderWaste.create({
                    data: {
                        production_order_id: id,
                        product_id: order.product_id,
                        waste_type: WasteType.RAW_MATERIAL,
                        quantity: yieldLoss,
                        notes: "Selisih Hasil Produksi (Yield Loss)",
                    },
                });
            }

            const updated = await tx.productionOrder.update({
                where: { id },
                data: {
                    quantity_actual: payload.quantity_actual,
                    status: ProductionStatus.QC_REVIEW,
                    completed_at: new Date(),
                    notes: payload.notes ?? order.notes,
                    updated_by: userId,
                },
                include: { items: true, product: true, wastes: true },
            });

            await ManufacturingService.attachAuditUsers(updated);

            return updated;
        });
    }

    static async qcAction(id: number, payload: RequestQcActionDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const order = await tx.productionOrder.findUnique({
                where: { id },
                include: { items: true, goods_receipt: true },
            });
            if (!order) throw new ApiError(404, "Pesanan produksi tidak ditemukan");
            if (order.status !== ProductionStatus.QC_REVIEW && order.status !== ProductionStatus.COMPLETED) {
                throw new ApiError(400, `qcAction memerlukan status QC_REVIEW atau COMPLETED, status saat ini: ${order.status}`);
            }
            if (order.goods_receipt) throw new ApiError(400, "GR sudah dibuat untuk pesanan produksi ini");

            const fgWarehouse = await tx.warehouse.findUnique({ where: { id: payload.fg_warehouse_id } });
            if (!fgWarehouse) throw new ApiError(404, "Gudang FG tidak ditemukan");

            const totalQc = payload.quantity_accepted + payload.quantity_rejected;
            const actualQty = Number(order.quantity_actual ?? order.quantity_planned);
            if (totalQc > actualQty) {
                throw new ApiError(400, `Total QC (${totalQc}) melebihi jumlah produksi aktual (${actualQty})`);
            }

            if (payload.quantity_accepted > 0) {
                const gr = await tx.goodsReceipt.create({
                    data: {
                        gr_number: generateDocNumber("GR"),
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

                // Use InventoryHelper to update Finish Goods stock
                await InventoryHelper.addWarehouseStock(
                    tx,
                    payload.fg_warehouse_id,
                    [{ product_id: order.product_id, quantity: payload.quantity_accepted }],
                    gr.id,
                    MovementRefType.GOODS_RECEIPT,
                    MovementType.IN,
                    userId,
                    `Produksi: ${order.mfg_number}`
                );
            }

            if (payload.quantity_rejected > 0) {
                await tx.productionOrderWaste.create({
                    data: {
                        production_order_id: id,
                        waste_type: WasteType.FINISH_GOODS,
                        product_id: order.product_id,
                        warehouse_id: payload.fg_warehouse_id,
                        quantity: payload.quantity_rejected,
                        notes: payload.qc_notes 
                            ? `Ditolak saat QC: ${payload.qc_notes}` 
                            : "Ditolak saat QC (Finish Goods)",
                    },
                });
            }

            const updated = await tx.productionOrder.update({
                where: { id },
                data: {
                    status: ProductionStatus.FINISHED,
                    quantity_actual: payload.quantity_accepted,
                    quantity_accepted: payload.quantity_accepted,
                    quantity_rejected: payload.quantity_rejected,
                    fg_warehouse_id: payload.fg_warehouse_id,
                    qc_notes: payload.qc_notes,
                    finished_at: new Date(),
                    updated_by: userId,
                },
                include: { items: true, product: true, wastes: true, goods_receipt: true },
            });

            await ManufacturingService.attachAuditUsers(updated);

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
                product: { 
                    include: { 
                        unit: { select: { id: true, name: true } }
                    }
                },
                items: {
                    include: {
                        raw_material: {
                            include: {
                                unit_raw_material: { select: { id: true, name: true } }
                            }
                        },
                        substitute_raw_material: {
                            include: {
                                unit_raw_material: { select: { id: true, name: true } }
                            }
                        },
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

        if (!result) throw new ApiError(404, "Pesanan produksi tidak ditemukan");

        // Fetch stock information for each item across ALL raw material warehouses
        const rmWarehouses = await prisma.warehouse.findMany({
            where: { type: "RAW_MATERIAL" as any, deleted_at: null },
            select: { id: true, name: true, code: true },
        });

        if (rmWarehouses.length > 0) {
            const rmWhIds = rmWarehouses.map((w) => w.id);

            // Identify PRD and KDG warehouses by code pattern for backward compatibility
            const prdWh = rmWarehouses.find((w) => w.code?.toUpperCase().includes("PRD"));
            const kdgWh = rmWarehouses.find((w) => w.code?.toUpperCase().includes("KDG"));

            const now = new Date();
            const currentMonth = now.getMonth() + 1;
            const currentYear = now.getFullYear();

            for (const item of result.items) {
                const rmId = (item as any).substitute_raw_material_id ?? item.raw_material_id;

                // Find the latest period stock for this specific item PER WAREHOUSE (avoiding future)
                const invRecords = await prisma.$queryRaw<Array<{ warehouse_id: number; quantity: number }>>`
                    SELECT DISTINCT ON (warehouse_id)
                        warehouse_id,
                        quantity
                    FROM raw_material_inventories
                    WHERE raw_material_id = ${rmId}
                      AND (
                        year < ${currentYear} 
                        OR (year = ${currentYear} AND month <= ${currentMonth})
                      )
                    ORDER BY warehouse_id, year DESC, month DESC
                `;

                // Calculate booked quantities from other RELEASED orders (exclude this order)
                const bookedRecords = await prisma.productionOrderItem.groupBy({
                    by: ["warehouse_id"],
                    where: {
                        OR: [
                            { raw_material_id: rmId },
                            { substitute_raw_material_id: rmId }
                        ],
                        warehouse_id: { in: rmWhIds },
                        production_order: {
                            status: ProductionStatus.RELEASED,
                            id: { not: result.id },
                        },
                    },
                    _sum: { quantity_planned: true },
                });

                // Build per-warehouse stock map
                const warehouseStock: Record<string, { on_hand: number; booked: number; avail: number }> = {};
                let totalOnHand = 0;
                let totalBooked = 0;

                for (const wh of rmWarehouses) {
                    const onHand = invRecords
                        .filter((r) => r.warehouse_id === wh.id)
                        .reduce((sum, r) => sum + Number(r.quantity), 0);
                    const booked = Number(
                        bookedRecords.find((b) => b.warehouse_id === wh.id)?._sum.quantity_planned || 0
                    );
                    const avail = Math.max(0, onHand - booked);

                    warehouseStock[wh.code || wh.name] = { on_hand: onHand, booked, avail };
                    totalOnHand += onHand;
                    totalBooked += booked;
                }

                // Backward-compatible PRD/KDG fields
                const prdKey = prdWh ? (prdWh.code || prdWh.name) : null;
                const kdgKey = kdgWh ? (kdgWh.code || kdgWh.name) : null;
                const prdStock = prdKey ? warehouseStock[prdKey] : null;
                const kdgStock = kdgKey ? warehouseStock[kdgKey] : null;

                (item as any).inventory_stock = {
                    prd: prdStock?.on_hand ?? 0,
                    kdg: kdgStock?.on_hand ?? 0,
                    total: totalOnHand,
                    prd_avail: prdStock?.avail ?? 0,
                    kdg_avail: kdgStock?.avail ?? 0,
                    total_avail: Math.max(0, totalOnHand - totalBooked),
                    booked_prd: prdStock?.booked ?? 0,
                    booked_kdg: kdgStock?.booked ?? 0,
                    warehouses: warehouseStock,
                };
            }
        } else {
            // No warehouses or no inventory data — set all to 0
            for (const item of result.items) {
                (item as any).inventory_stock = {
                    prd: 0, kdg: 0, total: 0,
                    prd_avail: 0, kdg_avail: 0, total_avail: 0,
                    booked_prd: 0, booked_kdg: 0,
                    warehouses: {},
                };
            }
        }

        await ManufacturingService.attachAuditUsers(result);
        return result;
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

    private static async validateAndAllocateRM(tx: any, items: any[], orderId: number) {
        // 1. Fetch relevant warehouses dynamically
        const rmWarehouses = await tx.warehouse.findMany({
            where: { type: "RAW_MATERIAL" as any, deleted_at: null },
            select: { id: true, code: true, name: true },
        });

        const prdWh = rmWarehouses.find((w: any) => w.code?.toUpperCase().includes("PRD"));
        const kdgWh = rmWarehouses.find((w: any) => w.code?.toUpperCase().includes("KDG"));

        if (!prdWh) {
            throw new ApiError(400, "Gudang Produksi (PRD) tidak ditemukan dalam sistem.");
        }

        for (const item of items) {
            const needed = Number(item.quantity_planned);

            // Use substitute RM if override was applied, otherwise original
            const effectiveRmId = item.substitute_raw_material_id ?? item.raw_material_id;
            const effectiveRmName = item.substitute_raw_material?.name ?? item.raw_material?.name ?? String(effectiveRmId);

            // 2. Get available stock (on-hand minus booked by other RELEASED orders)
            // Pass orderId to exclude the current order's own items from the "booked" calculation
            const availPRD = await this.getLatestRMStock(tx, effectiveRmId, prdWh.id, orderId);
            const availKDG = kdgWh
                ? await this.getLatestRMStock(tx, effectiveRmId, kdgWh.id, orderId)
                : 0;

            const totalAvailable = availPRD + availKDG;

            // 3. Implement Decision Logic
            if (totalAvailable < needed) {
                throw new ApiError(
                    400,
                    `Stok tidak mencukupi untuk Raw Material: ${effectiveRmName}. ` +
                    `Total tersedia: ${totalAvailable}. Harap lakukan Open PO.`,
                );
            }

            if (availPRD < needed) {
                throw new ApiError(
                    400,
                    `Stok di Gudang Produksi tidak mencukupi untuk ${effectiveRmName}. ` +
                    `Tersedia di ${prdWh.name || prdWh.code}: ${availPRD}` +
                    (kdgWh ? `, Tersedia di ${kdgWh.name || kdgWh.code}: ${availKDG}` : '') +
                    `. Harap lakukan mutasi terlebih dahulu.`,
                );
            }

            // 4. Allocate to PRD warehouse
            await tx.productionOrderItem.updateMany({
                where: { id: item.id, production_order_id: orderId },
                data: { warehouse_id: prdWh.id },
            });
        }
    }

    private static async deductRMStock(tx: any, items: any[], orderId: number, userId: string) {
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
            undefined, // notes
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
            "RM saving/return",
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

            // Prevent overriding with the same RM
            if (payload.substitute_raw_material_id === item.raw_material_id) {
                throw new ApiError(400, "Bahan baku pengganti tidak boleh sama dengan bahan baku asli");
            }

            const substituteRM = await tx.rawMaterial.findUnique({
                where: { id: payload.substitute_raw_material_id },
                select: { id: true, name: true },
            });
            if (!substituteRM) throw new ApiError(404, "Bahan baku pengganti tidak ditemukan");

            const updated = await tx.productionOrderItem.update({
                where: { id: itemId },
                data: {
                    substitute_raw_material_id: payload.substitute_raw_material_id,
                    override_reason: payload.override_reason,
                },
                include: {
                    raw_material: { select: { id: true, name: true } },
                    substitute_raw_material: { select: { id: true, name: true } },
                },
            });

            // --- Auto-transfer check for substitute RM (same logic as handleAutomaticRMTransfer) ---
            const rmWarehouses = await tx.warehouse.findMany({
                where: { type: "RAW_MATERIAL" as any, deleted_at: null },
                select: { id: true, code: true, name: true },
            });

            const prdWh = rmWarehouses.find((w: any) => w.code?.toUpperCase().includes("PRD"));
            const kdgWh = rmWarehouses.find((w: any) => w.code?.toUpperCase().includes("KDG"));

            if (prdWh && kdgWh) {
                const needed = Number(item.quantity_planned);
                const [stockPRD, stockKDG] = await Promise.all([
                    this.getLatestRMStock(tx, payload.substitute_raw_material_id, prdWh.id),
                    this.getLatestRMStock(tx, payload.substitute_raw_material_id, kdgWh.id),
                ]);

                if (stockPRD < needed) {
                    const shortfall = needed - stockPRD;
                    const transferQty = Math.min(shortfall, stockKDG);

                    if (transferQty > 0) {
                        // Try to append to existing PENDING transfer for this order first
                        const existingTransfer = await tx.stockTransfer.findFirst({
                            where: {
                                production_order_id: orderId,
                                status: TransferStatus.PENDING,
                                from_warehouse_id: kdgWh.id,
                                to_warehouse_id: prdWh.id,
                            },
                            select: { id: true },
                        });

                        if (existingTransfer) {
                            // Upsert: update existing item for this RM if present, else create
                            const existingItem = await tx.stockTransferItem.findFirst({
                                where: {
                                    transfer_id: existingTransfer.id,
                                    raw_material_id: payload.substitute_raw_material_id,
                                },
                            });

                            if (existingItem) {
                                await tx.stockTransferItem.update({
                                    where: { id: existingItem.id },
                                    data: { quantity_requested: transferQty },
                                });
                            } else {
                                await tx.stockTransferItem.create({
                                    data: {
                                        transfer_id: existingTransfer.id,
                                        raw_material_id: payload.substitute_raw_material_id,
                                        quantity_requested: transferQty,
                                        notes: `Override RM untuk Order ${order.mfg_number}`,
                                    },
                                });
                            }
                        } else {
                            // Create new transfer for substitute RM
                            await tx.stockTransfer.create({
                                data: {
                                    transfer_number: generateTrmNumber(),
                                    from_type: TransferLocationType.WAREHOUSE,
                                    from_warehouse_id: kdgWh.id,
                                    to_type: TransferLocationType.WAREHOUSE,
                                    to_warehouse_id: prdWh.id,
                                    status: TransferStatus.PENDING,
                                    notes: `Penerimaan RM Otomatis (Override) - Pesanan: ${order.mfg_number}`,
                                    created_by: userId,
                                    barcode: `BC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                                    date: new Date(),
                                    production_order_id: orderId,
                                    items: {
                                        create: [{
                                            raw_material_id: payload.substitute_raw_material_id,
                                            quantity_requested: transferQty,
                                            notes: `Override RM untuk Order ${order.mfg_number}`,
                                        }],
                                    },
                                },
                            });
                        }
                    }
                }
            }

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
            if (!item) throw new ApiError(404, "Item tidak ditemukan dalam pesanan ini");
            if (!item.substitute_raw_material_id) throw new ApiError(400, "Item ini tidak memiliki override aktif");

            const substituteRmId = item.substitute_raw_material_id;

            // Clear override on item
            const updated = await tx.productionOrderItem.update({
                where: { id: itemId },
                data: {
                    substitute_raw_material_id: null,
                    override_reason: null,
                },
                include: {
                    raw_material: { select: { id: true, name: true } },
                    substitute_raw_material: { select: { id: true, name: true } },
                },
            });

            // Clean up PENDING transfer items for substitute RM linked to this order
            const pendingTransfers = await tx.stockTransfer.findMany({
                where: {
                    production_order_id: orderId,
                    status: TransferStatus.PENDING,
                },
                include: {
                    items: { where: { raw_material_id: substituteRmId } },
                },
            });

            for (const transfer of pendingTransfers) {
                if (transfer.items.length === 0) continue;

                // Delete the substitute RM items from transfer
                await tx.stockTransferItem.deleteMany({
                    where: {
                        transfer_id: transfer.id,
                        raw_material_id: substituteRmId,
                    },
                });

                // If transfer is now empty, delete it too
                const remaining = await tx.stockTransferItem.count({
                    where: { transfer_id: transfer.id },
                });
                if (remaining === 0) {
                    await tx.stockTransfer.delete({ where: { id: transfer.id } });
                }
            }

            // Re-check original RM: if PRD stock is insufficient and no PENDING transfer covers it, create one
            const rmWarehouses = await tx.warehouse.findMany({
                where: { type: "RAW_MATERIAL" as any, deleted_at: null },
                select: { id: true, code: true, name: true },
            });

            const prdWh = rmWarehouses.find((w: any) => w.code?.toUpperCase().includes("PRD"));
            const kdgWh = rmWarehouses.find((w: any) => w.code?.toUpperCase().includes("KDG"));

            if (prdWh && kdgWh) {
                const needed = Number(item.quantity_planned);
                const [stockPRD, stockKDG] = await Promise.all([
                    this.getLatestRMStock(tx, item.raw_material_id, prdWh.id),
                    this.getLatestRMStock(tx, item.raw_material_id, kdgWh.id),
                ]);

                if (stockPRD < needed && stockKDG > 0) {
                    const shortfall = needed - stockPRD;
                    const transferQty = Math.min(shortfall, stockKDG);

                    // Check if there's already a PENDING transfer covering original RM for this order
                    const existingTransfer = await tx.stockTransfer.findFirst({
                        where: {
                            production_order_id: orderId,
                            status: TransferStatus.PENDING,
                            from_warehouse_id: kdgWh.id,
                            to_warehouse_id: prdWh.id,
                        },
                        select: { id: true },
                    });

                    if (existingTransfer) {
                        const existingItem = await tx.stockTransferItem.findFirst({
                            where: {
                                transfer_id: existingTransfer.id,
                                raw_material_id: item.raw_material_id,
                            },
                        });

                        if (!existingItem) {
                            await tx.stockTransferItem.create({
                                data: {
                                    transfer_id: existingTransfer.id,
                                    raw_material_id: item.raw_material_id,
                                    quantity_requested: transferQty,
                                    notes: `Restore override — Order ${order.mfg_number}`,
                                },
                            });
                        }
                    } else {
                        await tx.stockTransfer.create({
                            data: {
                                transfer_number: generateTrmNumber(),
                                from_type: TransferLocationType.WAREHOUSE,
                                from_warehouse_id: kdgWh.id,
                                to_type: TransferLocationType.WAREHOUSE,
                                to_warehouse_id: prdWh.id,
                                status: TransferStatus.PENDING,
                                notes: `Penerimaan RM Otomatis (Restore Override) - Pesanan: ${order.mfg_number}`,
                                created_by: userId,
                                barcode: `BC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                                date: new Date(),
                                production_order_id: orderId,
                                items: {
                                    create: [{
                                        raw_material_id: item.raw_material_id,
                                        quantity_requested: transferQty,
                                        notes: `Restore override — Order ${order.mfg_number}`,
                                    }],
                                },
                            },
                        });
                    }
                }
            }

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
                    include: {
                        raw_materials: {
                            include: { unit_raw_material: true },
                        },
                    },
                },
            },
        });

        if (!product) throw new ApiError(404, "Produk tidak ditemukan");
        if (!product.recipes.length) throw new ApiError(404, "Produk tidak memiliki resep aktif");

        const rmWarehouses = await prisma.warehouse.findMany({
            where: { type: "RAW_MATERIAL" as any, deleted_at: null },
            select: { id: true, code: true, name: true },
        });

        const uniqueRmIds = [...new Set(product.recipes.map((r) => r.raw_mat_id))];

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        let stockData: Array<{ raw_material_id: number; warehouse_id: number; on_hand: number }> = [];
        if (uniqueRmIds.length > 0) {
            stockData = await prisma.$queryRaw<Array<{ raw_material_id: number; warehouse_id: number; on_hand: number }>>`
                WITH latest_periods AS (
                    SELECT DISTINCT ON (raw_material_id, warehouse_id)
                        raw_material_id, warehouse_id, year, month
                    FROM raw_material_inventories
                    WHERE raw_material_id IN (${Prisma.join(uniqueRmIds)})
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
        }

        const bookedData = await prisma.productionOrderItem.groupBy({
            by: ["raw_material_id", "warehouse_id"],
            where: {
                raw_material_id: { in: uniqueRmIds.length > 0 ? uniqueRmIds : [-1] },
                production_order: { status: ProductionStatus.RELEASED },
            },
            _sum: { quantity_planned: true },
        });

        const firstRecipe = product.recipes[0]!;

        const recipes = product.recipes.map((r) => {
            const warehouses: Record<string, { on_hand: number; booked: number; avail: number }> = {};

            for (const wh of rmWarehouses) {
                const stock = stockData.find(
                    (s) => s.raw_material_id === r.raw_mat_id && s.warehouse_id === wh.id
                );
                const booked = bookedData.find(
                    (b) => b.raw_material_id === r.raw_mat_id && b.warehouse_id === wh.id
                );

                const on_hand = Number(stock?.on_hand ?? 0);
                const booked_qty = Number(booked?._sum.quantity_planned ?? 0);
                const avail = Math.max(0, on_hand - booked_qty);

                warehouses[wh.code || wh.name] = { on_hand, booked: booked_qty, avail };
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
