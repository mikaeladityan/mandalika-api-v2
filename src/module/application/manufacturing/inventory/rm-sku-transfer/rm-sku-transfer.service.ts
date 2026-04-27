import { Prisma } from "../../../../../generated/prisma/client.js";
import prisma from "../../../../../config/prisma.js";
import { RequestRmSkuTransferDTO } from "./rm-sku-transfer.schema.js";
import { InventoryHelper } from "../../../shared/inventory.helper.js";
import { MovementEntityType, MovementRefType, MovementType } from "../../../../../generated/prisma/enums.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";

export class RmSkuTransferService {
    static async transfer(payload: RequestRmSkuTransferDTO, userId: string = "system") {
        const { source_rm_id, target_rm_id, warehouse_id, quantity, notes } = payload;

        if (source_rm_id === target_rm_id) {
            throw new ApiError(400, "RM Asal dan RM Tujuan tidak boleh sama");
        }

        return await prisma.$transaction(async (tx) => {
            // 1. Validate Source RM exists and get name
            const sourceRm = await tx.rawMaterial.findUnique({
                where: { id: source_rm_id },
                include: { unit_raw_material: true }
            });
            if (!sourceRm) throw new ApiError(404, "RM Asal tidak ditemukan");

            // 2. Validate Target RM exists and get name
            const targetRm = await tx.rawMaterial.findUnique({
                where: { id: target_rm_id },
                include: { unit_raw_material: true }
            });
            if (!targetRm) throw new ApiError(404, "RM Tujuan tidak ditemukan");

            // 3. Validate Warehouse exists
            const warehouse = await tx.warehouse.findUnique({
                where: { id: warehouse_id }
            });
            if (!warehouse) throw new ApiError(404, "Gudang tidak ditemukan");

            // 4. Deduct from Source RM
            await InventoryHelper.deductWarehouseStock(
                tx,
                warehouse_id,
                [{ 
                    raw_material_id: source_rm_id, 
                    quantity,
                    raw_material: { name: sourceRm.name }
                }],
                0, // No specific doc ID for this manual adjustment
                MovementRefType.STOCK_ADJUSTMENT,
                MovementType.OUT,
                userId,
                `Pindah SKU ke ${targetRm.name}: ${notes || ""}`.trim(),
                MovementEntityType.RAW_MATERIAL
            );

            // 4. Add to Target RM
            await InventoryHelper.addWarehouseStock(
                tx,
                warehouse_id,
                [{ 
                    raw_material_id: target_rm_id, 
                    quantity,
                    raw_material: { name: targetRm.name }
                }],
                0,
                MovementRefType.STOCK_ADJUSTMENT,
                MovementType.IN,
                userId,
                `Pindah SKU dari ${sourceRm.name}: ${notes || ""}`.trim(),
                MovementEntityType.RAW_MATERIAL
            );

            // Update source RM movement with more detail if needed, but InventoryHelper creates a generic one.
            // We can manually update the notes of the movement created by deductWarehouseStock if we want.
            // But the current helper doesn't return the movement ID easily without more work.
            // However, addWarehouseStock takes notes, deductWarehouseStock doesn't.
            // Let's modify InventoryHelper.deductWarehouseStock to accept notes too if possible, 
            // or just leave it as is for now.
            
            return { success: true };
        });
    }

    static async getStock(rm_id: number, warehouse_id: number) {
        // Use the same DISTINCT ON raw SQL pattern proven in recipe.service.ts
        const inventoryRows = await prisma.$queryRaw<Array<{
            quantity: number;
        }>>`
            SELECT DISTINCT ON (rmi.raw_material_id, rmi.warehouse_id)
                rmi.quantity
            FROM raw_material_inventories rmi
            WHERE rmi.raw_material_id = ${rm_id}
              AND rmi.warehouse_id = ${warehouse_id}
            ORDER BY rmi.raw_material_id, rmi.warehouse_id, rmi.year DESC, rmi.month DESC
        `;

        const onHand = Number(inventoryRows[0]?.quantity || 0);

        // 2. Get Booked Stock (from RELEASED production orders)
        const bookedRows = await prisma.$queryRaw<Array<{
            total: number;
        }>>`
            SELECT COALESCE(SUM(poi.quantity_planned), 0) AS total
            FROM production_order_items poi
            JOIN production_orders po ON po.id = poi.production_order_id
            WHERE poi.raw_material_id = ${rm_id}
              AND (poi.warehouse_id = ${warehouse_id} OR poi.warehouse_id IS NULL)
              AND po.status = 'RELEASED'::"ProductionStatus"
        `;

        const bookedQty = Number(bookedRows[0]?.total || 0);
        const avail = Math.max(0, onHand - bookedQty);

        return {
            on_hand: onHand,
            booked: bookedQty,
            avail: avail
        };
    }

    static async getStockAll(rm_id: number) {
        // Fetch stock for ALL RM warehouses in one query, same pattern as recipe.service.ts
        const inventoryRows = await prisma.$queryRaw<Array<{
            raw_material_id: number;
            warehouse_id: number;
            warehouse_name: string;
            warehouse_code: string;
            quantity: number;
        }>>`
            SELECT DISTINCT ON (rmi.raw_material_id, rmi.warehouse_id)
                rmi.raw_material_id,
                rmi.warehouse_id,
                w.name AS warehouse_name,
                w.code AS warehouse_code,
                rmi.quantity
            FROM raw_material_inventories rmi
            JOIN warehouses w ON w.id = rmi.warehouse_id
            WHERE rmi.raw_material_id = ${rm_id}
              AND w.type = 'RAW_MATERIAL'::"WarehouseType"
              AND w.deleted_at IS NULL
            ORDER BY rmi.raw_material_id, rmi.warehouse_id, rmi.year DESC, rmi.month DESC
        `;

        return inventoryRows.map(row => ({
            warehouse_id: row.warehouse_id,
            warehouse_name: row.warehouse_name,
            warehouse_code: row.warehouse_code,
            on_hand: Number(row.quantity),
            booked: 0,
            avail: Number(row.quantity),
        }));
    }
}
