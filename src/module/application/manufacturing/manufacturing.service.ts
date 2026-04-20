import { Prisma } from "../../../generated/prisma/client.js";
import prisma from "../../../config/prisma.js";
import {
    RequestCreateProductionDTO,
    RequestChangeStatusDTO,
    RequestSubmitResultDTO,
    RequestQcActionDTO,
    QueryProductionDTO,
    RequestUpdateProductionDTO,
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
import { InventoryHelper } from "../inventory-v2/inventory.helper.js";
import { generateDocNumber } from "../inventory-v2/inventory.constants.js";

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

            // STRICT VALIDATION: Ensure all materials are "Ready" (Total Stock PRD+KDG >= Planned)
            // This is a safety check if the frontend validation is bypassed
            const [prdWh, kdgWh] = await Promise.all([
                tx.warehouse.findUnique({ where: { code: "GRM-PRD" } }),
                tx.warehouse.findUnique({ where: { code: "GRM-KDG" } }),
            ]);

            if (prdWh) {
                for (const item of order.items) {
                    const needed = Number(item.quantity_planned);
                    const stockPRD = await this.getLatestRMStock(tx, item.raw_material_id, prdWh.id);
                    const stockKDG = kdgWh ? await this.getLatestRMStock(tx, item.raw_material_id, kdgWh.id) : 0;
                    const totalAvailable = stockPRD + stockKDG;

                    if (totalAvailable < needed) {
                        throw new ApiError(
                            400,
                            `Stok tidak cukup untuk ${item.raw_material.name}. ` +
                            `Dibutuhkan: ${needed.toLocaleString()}, Tersedia: ${totalAvailable.toLocaleString()}. ` +
                            `Mohon pastikan stok Mencukupi sebelum membuat jadwal.`
                        );
                    }
                }
            }

            return order;
        });
    }

    private static async getLatestRMStock(tx: any, rmId: number, warehouseId: number): Promise<number> {
        // 1. Get the latest available period for this RM and Warehouse
        const latestPeriod = await tx.rawMaterialInventory.findFirst({
            where: { raw_material_id: rmId, warehouse_id: warehouseId },
            orderBy: [{ year: "desc" }, { month: "desc" }],
            select: { month: true, year: true },
        });

        if (!latestPeriod) return 0;

        // 2. Map all records in that month (consistent with InventoryHelper SUM logic)
        const records = await tx.rawMaterialInventory.findMany({
            where: {
                raw_material_id: rmId,
                warehouse_id: warehouseId,
                month: latestPeriod.month,
                year: latestPeriod.year,
            },
        });

        return records.reduce((sum: number, r: any) => sum + Number(r.quantity), 0);
    }

    private static async handleAutomaticRMTransfer(tx: any, order: any, userId: string) {
        const [prdWh, kdgWh] = await Promise.all([
            tx.warehouse.findUnique({ where: { code: "GRM-PRD" } }),
            tx.warehouse.findUnique({ where: { code: "GRM-KDG" } }),
        ]);

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
                        include: { raw_material: { select: { id: true, name: true } } }
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
                        include: { raw_material: { select: { id: true, name: true } } }
                    }
                },
            });
            if (!order) throw new ApiError(404, "Pesanan produksi tidak ditemukan");
            if (order.status !== ProductionStatus.PROCESSING) {
                throw new ApiError(400, `submitResult memerlukan status PROCESSING, status saat ini: ${order.status}`);
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
                    await InventoryHelper.deductWarehouseStock(
                        tx, 
                        dbItem.warehouse_id, 
                        [{ raw_material_id: dbItem.raw_material_id, quantity: overUsage, raw_material: { name: dbItem.raw_material.name } }], 
                        id, 
                        MovementRefType.PRODUCTION, 
                        MovementType.OUT, 
                        userId,
                        MovementEntityType.RAW_MATERIAL
                    );

                    // Log as Waste RM
                    await tx.productionOrderWaste.create({
                        data: {
                            production_order_id: id,
                            waste_type: WasteType.RAW_MATERIAL,
                            raw_material_id: dbItem.raw_material_id,
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

        // Fetch GRM-PRD and GRM-KDG stock information for each item
        const [prdWh, kdgWh] = await Promise.all([
            prisma.warehouse.findUnique({ where: { code: "GRM-PRD" }, select: { id: true } }),
            prisma.warehouse.findUnique({ where: { code: "GRM-KDG" }, select: { id: true } }),
        ]);

        if (prdWh) {
            for (const item of result.items) {
                const latestPeriod = await prisma.rawMaterialInventory.findFirst({
                    where: { raw_material_id: item.raw_material_id },
                    orderBy: [{ year: "desc" }, { month: "desc" }],
                    select: { month: true, year: true },
                });

                if (latestPeriod) {
                    const invRecords = await prisma.rawMaterialInventory.findMany({
                        where: {
                            raw_material_id: item.raw_material_id,
                            warehouse_id: { in: [prdWh.id, kdgWh?.id].filter(Boolean) as number[] },
                            month: latestPeriod.month,
                            year: latestPeriod.year,
                        },
                    });

                    const stockPRD = invRecords
                        .filter((r) => r.warehouse_id === prdWh.id)
                        .reduce((sum, r) => sum + Number(r.quantity), 0);

                    const stockKDG = kdgWh
                        ? invRecords
                            .filter((r) => r.warehouse_id === kdgWh.id)
                            .reduce((sum, r) => sum + Number(r.quantity), 0)
                        : 0;

                    (item as any).inventory_stock = {
                        prd: stockPRD,
                        kdg: stockKDG,
                        total: stockPRD + stockKDG
                    };
                } else {
                    (item as any).inventory_stock = { prd: 0, kdg: 0, total: 0 };
                }
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
        // 1. Fetch relevant warehouses
        const [prdWh, kdgWh] = await Promise.all([
            tx.warehouse.findUnique({ where: { code: "GRM-PRD" } }),
            tx.warehouse.findUnique({ where: { code: "GRM-KDG" } }),
        ]);

        if (!prdWh) {
            throw new ApiError(400, "Gudang Pusat Produksi (GRM-PRD) tidak ditemukan dalam sistem.");
        }

        for (const item of items) {
            const needed = Number(item.quantity_planned);

            // 2. Get latest period for this material
            const latestPeriod = await tx.rawMaterialInventory.findFirst({
                where: { raw_material_id: item.raw_material_id },
                orderBy: [{ year: "desc" }, { month: "desc" }],
                select: { month: true, year: true },
            });

            if (!latestPeriod) {
                throw new ApiError(400, `Data inventory tidak ditemukan untuk Raw Material: ${item.raw_material.name}`);
            }

            // 3. Get stock from both warehouses
            const invRecords = await tx.rawMaterialInventory.findMany({
                where: {
                    raw_material_id: item.raw_material_id,
                    warehouse_id: { in: [prdWh.id, kdgWh?.id].filter(Boolean) },
                    month: latestPeriod.month,
                    year: latestPeriod.year,
                },
            });

            const stockPRD = invRecords
                .filter((r: any) => r.warehouse_id === prdWh.id)
                .reduce((sum: number, r: any) => sum + Number(r.quantity), 0);
            
            const stockKDG = kdgWh 
                ? invRecords
                    .filter((r: any) => r.warehouse_id === kdgWh.id)
                    .reduce((sum: number, r: any) => sum + Number(r.quantity), 0)
                : 0;

            const totalAvailable = stockPRD + stockKDG;

            // 4. Implement Decision Logic
            if (totalAvailable < needed) {
                throw new ApiError(
                    400,
                    `Stok tidak mencukupi untuk Raw Material: ${item.raw_material.name}. ` +
                    `Total tersedia (PRD + KDG): ${totalAvailable}. Harap lakukan Open PO.`,
                );
            }

            if (stockPRD < needed) {
                throw new ApiError(
                    400,
                    `Stok di Gudang Produksi (GRM-PRD) tidak mencukupi untuk ${item.raw_material.name}. ` +
                    `Tersedia di PRD: ${stockPRD}, Tersedia di KDG: ${stockKDG}. ` +
                    `Harap lakukan mutasi dari Gudang Kandangan (GRM-KDG) terlebih dahulu.`,
                );
            }

            // 5. Allocate to GRM-PRD
            await tx.productionOrderItem.updateMany({
                where: { id: item.id, production_order_id: orderId },
                data: { warehouse_id: prdWh.id },
            });
        }
    }

    private static async deductRMStock(tx: any, items: any[], orderId: number, userId: string) {
        const stockItems = items.map(item => ({
            raw_material_id: item.raw_material_id,
            quantity: Number(item.quantity_planned),
            raw_material: { name: item.raw_material?.name }
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
