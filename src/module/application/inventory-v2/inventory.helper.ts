import { Prisma } from "../../../generated/prisma/client.js";
import {
    MovementEntityType,
    MovementLocationType,
    MovementRefType,
    MovementType,
} from "../../../generated/prisma/enums.js";
import { ApiError } from "../../../lib/errors/api.error.js";

export interface StockItem {
    product_id?: number;
    raw_material_id?: number;
    quantity: number;
    product?: { name?: string; code?: string };
    raw_material?: { name?: string };
}

export class InventoryHelper {
    /**
     * Deducts stock from a warehouse. Throws ApiError(400) if insufficient.
     * Consolidates monthly records and creates a StockMovement audit record.
     */
    static async deductWarehouseStock(
        tx: Prisma.TransactionClient,
        warehouse_id: number,
        items: StockItem[],
        ref_id: number,
        ref_type: MovementRefType,
        movement_type: MovementType,
        userId: string,
        entity_type: MovementEntityType = MovementEntityType.PRODUCT,
    ): Promise<void> {
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();

        for (const item of items) {
            const entityId = entity_type === MovementEntityType.PRODUCT ? item.product_id : item.raw_material_id;
            if (!entityId) throw new ApiError(400, "Entity ID (Product/Raw Material) is required");

            const inventoryTable = entity_type === MovementEntityType.PRODUCT 
                ? (tx as any).productInventory 
                : (tx as any).rawMaterialInventory;

            const idField = entity_type === MovementEntityType.PRODUCT ? 'product_id' : 'raw_material_id';

            // 1. Get all records for this month to calculate total balance and consolidate
            const periodRecords = await inventoryTable.findMany({
                where: {
                    [idField]: entityId,
                    warehouse_id,
                    month,
                    year
                },
                orderBy: { date: 'asc' }
            });

            const qtyBefore = periodRecords.reduce((sum: number, r: any) => sum + Number(r.quantity), 0);
            
            if (qtyBefore < item.quantity) {
                const label = entity_type === MovementEntityType.PRODUCT
                    ? (item.product?.code ? `[${item.product.code}] ${item.product.name}` : `Product ID:${entityId}`)
                    : (item.raw_material?.name || `Material ID:${entityId}`);
                throw new ApiError(400, `Stok tidak mencukupi di Gudang untuk ${label}. Tersedia: ${qtyBefore}, Dibutuhkan: ${item.quantity}`);
            }

            const qtyAfter = qtyBefore - item.quantity;

            // 2. Consolidate: Update/Create record on date 1 and delete others
            if (periodRecords.length > 0) {
                const [primary, ...others] = periodRecords;
                await inventoryTable.update({
                    where: { id: primary.id },
                    data: { quantity: qtyAfter, date: 1 }
                });
                if (others.length > 0) {
                    await inventoryTable.deleteMany({
                        where: { id: { in: others.map((o: any) => o.id) } }
                    });
                }
            } else {
                // This case should theoretically not happen if qtyBefore < item.quantity check passes,
                // but for safety:
                await inventoryTable.create({
                    data: {
                        [idField]: entityId,
                        warehouse_id,
                        quantity: qtyAfter,
                        date: 1,
                        month,
                        year
                    }
                });
            }

            // 3. Create StockMovement
            await tx.stockMovement.create({
                data: {
                    entity_type,
                    entity_id: entityId,
                    location_type: MovementLocationType.WAREHOUSE,
                    location_id: warehouse_id,
                    movement_type,
                    quantity: item.quantity,
                    qty_before: qtyBefore,
                    qty_after: qtyAfter,
                    reference_id: ref_id,
                    reference_type: ref_type,
                    created_by: userId,
                },
            });
        }
    }

    /**
     * Adds stock to a warehouse. Creates the inventory record if it doesn't exist.
     * Consolidates monthly records and creates a StockMovement audit record.
     */
    static async addWarehouseStock(
        tx: Prisma.TransactionClient,
        warehouse_id: number,
        items: StockItem[],
        ref_id: number,
        ref_type: MovementRefType,
        movement_type: MovementType,
        userId: string,
        notes?: string,
        entity_type: MovementEntityType = MovementEntityType.PRODUCT,
    ): Promise<void> {
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();

        for (const item of items) {
            const entityId = entity_type === MovementEntityType.PRODUCT ? item.product_id : item.raw_material_id;
            if (!entityId) throw new ApiError(400, "Entity ID (Product/Raw Material) is required");

            const inventoryTable = entity_type === MovementEntityType.PRODUCT 
                ? (tx as any).productInventory 
                : (tx as any).rawMaterialInventory;

            const idField = entity_type === MovementEntityType.PRODUCT ? 'product_id' : 'raw_material_id';

            // 1. Get all records for this month
            const periodRecords = await inventoryTable.findMany({
                where: {
                    [idField]: entityId,
                    warehouse_id,
                    month,
                    year
                },
                orderBy: { date: 'asc' }
            });

            const qtyBefore = periodRecords.reduce((sum: number, r: any) => sum + Number(r.quantity), 0);
            const qtyAfter = qtyBefore + item.quantity;

            // 2. Consolidate: Update/Create primary and delete others
            if (periodRecords.length > 0) {
                const [primary, ...others] = periodRecords;
                await inventoryTable.update({
                    where: { id: primary.id },
                    data: { quantity: qtyAfter, date: 1 }
                });
                if (others.length > 0) {
                    await inventoryTable.deleteMany({
                        where: { id: { in: others.map((o: any) => o.id) } }
                    });
                }
            } else {
                await inventoryTable.create({
                    data: {
                        [idField]: entityId,
                        warehouse_id,
                        quantity: qtyAfter,
                        date: 1,
                        month,
                        year
                    }
                });
            }

            // 3. Create StockMovement
            await tx.stockMovement.create({
                data: {
                    entity_type,
                    entity_id: entityId,
                    location_type: MovementLocationType.WAREHOUSE,
                    location_id: warehouse_id,
                    movement_type,
                    quantity: item.quantity,
                    qty_before: qtyBefore,
                    qty_after: qtyAfter,
                    reference_id: ref_id,
                    reference_type: ref_type,
                    created_by: userId,
                    ...(notes ? { notes } : {}),
                },
            });
        }
    }

    /**
     * Deducts stock from an outlet. (Products only)
     */
    static async deductOutletStock(
        tx: Prisma.TransactionClient,
        outlet_id: number,
        items: StockItem[],
        ref_id: number,
        ref_type: MovementRefType,
        movement_type: MovementType,
        userId: string,
    ): Promise<void> {
        for (const item of items) {
            if (!item.product_id) throw new ApiError(400, "Product ID is required for outlet deduction");
            
            const oi = await tx.outletInventory.findUnique({
                where: { outlet_id_product_id: { outlet_id, product_id: item.product_id } },
            });

            if (!oi || Number(oi.quantity) < item.quantity) {
                const pName = item.product?.name ?? `ID:${item.product_id}`;
                throw new ApiError(400, `Stok tidak mencukupi di Outlet untuk produk ${pName}`);
            }

            const qty_before = Number(oi.quantity);
            const qty_after = qty_before - item.quantity;

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
                    movement_type,
                    quantity: item.quantity,
                    qty_before,
                    qty_after,
                    reference_id: ref_id,
                    reference_type: ref_type,
                    created_by: userId,
                },
            });
        }
    }

    /**
     * Adds stock to an outlet. (Products only)
     */
    static async addOutletStock(
        tx: Prisma.TransactionClient,
        outlet_id: number,
        items: StockItem[],
        ref_id: number,
        ref_type: MovementRefType,
        movement_type: MovementType,
        userId: string,
        notes?: string,
    ): Promise<void> {
        for (const item of items) {
            if (!item.product_id) throw new ApiError(400, "Product ID is required for outlet addition");

            const oi = await tx.outletInventory.findUnique({
                where: { outlet_id_product_id: { outlet_id, product_id: item.product_id } },
            });

            const qty_before = oi ? Number(oi.quantity) : 0;
            const qty_after = qty_before + item.quantity;

            if (oi) {
                await tx.outletInventory.update({
                    where: { id: oi.id },
                    data: { quantity: qty_after },
                });
            } else {
                await tx.outletInventory.create({
                    data: { outlet_id, product_id: item.product_id, quantity: qty_after },
                });
            }

            await tx.stockMovement.create({
                data: {
                    entity_type: MovementEntityType.PRODUCT,
                    entity_id: item.product_id,
                    location_type: MovementLocationType.OUTLET,
                    location_id: outlet_id,
                    movement_type,
                    quantity: item.quantity,
                    qty_before,
                    qty_after,
                    reference_id: ref_id,
                    reference_type: ref_type,
                    created_by: userId,
                    ...(notes ? { notes } : {}),
                },
            });
        }
    }

    static toCSV(data: any[], headers: Record<string, string>): string {
        const headerRow = Object.values(headers).join(",");
        const keys = Object.keys(headers);

        const rows = data.map((item) => {
            return keys
                .map((key) => {
                    const value = key.split(".").reduce((obj, k) => obj?.[k], item) ?? "";
                    const sanitized = String(value).replace(/"/g, '""');
                    return `"${sanitized}"`;
                })
                .join(",");
        });

        return [headerRow, ...rows].join("\n");
    }
}
