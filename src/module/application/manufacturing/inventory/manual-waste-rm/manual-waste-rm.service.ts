import { Prisma } from "../../../../../generated/prisma/client.js";
import prisma from "../../../../../config/prisma.js";
import {
    CreateManualWasteRMDTO,
    QueryManualWasteRMDTO,
    ReturnManualWasteRMDTO,
} from "./manual-waste-rm.schema.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import {
    WasteType,
    MovementType,
    MovementRefType,
    MovementEntityType,
} from "../../../../../generated/prisma/enums.js";
import { InventoryHelper } from "../../../inventory-v2/inventory.helper.js";

const WASTE_INCLUDE = {
    raw_material: {
        include: { unit_raw_material: true },
    },
    warehouse: true,
} as const;

export class ManualWasteRMService {
    static async list(query: QueryManualWasteRMDTO) {
        const { page = 1, take = 10, search, status, fromDate, toDate, warehouse_id } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.ProductionOrderWasteWhereInput = {
            production_order_id: null,
            waste_type: WasteType.RAW_MATERIAL,
            ...(status === "RETURNED" && { returned_at: { not: null } }),
            ...(status === "ACTIVE" && { returned_at: null }),
            ...(warehouse_id && { warehouse_id }),
            ...(fromDate || toDate
                ? {
                      created_at: {
                          ...(fromDate && { gte: new Date(fromDate) }),
                          ...(toDate && {
                              lte: new Date(new Date(toDate).setHours(23, 59, 59, 999)),
                          }),
                      },
                  }
                : {}),
            ...(search && {
                OR: [
                    { raw_material: { name: { contains: search, mode: "insensitive" } } },
                    { notes: { contains: search, mode: "insensitive" } },
                ],
            }),
        };

        const [data, total] = await Promise.all([
            prisma.productionOrderWaste.findMany({
                where,
                skip,
                take: limit,
                orderBy: { created_at: "desc" },
                include: WASTE_INCLUDE,
            }),
            prisma.productionOrderWaste.count({ where }),
        ]);

        return { data, total };
    }

    static async detail(id: number) {
        const result = await prisma.productionOrderWaste.findFirst({
            where: { id, production_order_id: null, waste_type: WasteType.RAW_MATERIAL },
            include: WASTE_INCLUDE,
        });

        if (!result) throw new ApiError(404, "Data Manual Waste RM tidak ditemukan");
        return result;
    }

    static async stockCheck(rawMaterialId: number, warehouseId: number) {
        const quantity = await InventoryHelper.getAvailableRMStock(rawMaterialId, warehouseId);
        return { quantity };
    }

    static async create(payload: CreateManualWasteRMDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const rm = await tx.rawMaterial.findUnique({
                where: { id: payload.raw_material_id },
                include: { unit_raw_material: true },
            });
            if (!rm) throw new ApiError(404, "Bahan baku tidak ditemukan");

            const warehouse = await tx.warehouse.findUnique({ where: { id: payload.warehouse_id } });
            if (!warehouse) throw new ApiError(404, "Gudang tidak ditemukan");

            // Create record first to get ID for stock movement reference
            const waste = await tx.productionOrderWaste.create({
                data: {
                    production_order_id: null,
                    waste_type: WasteType.RAW_MATERIAL,
                    raw_material_id: payload.raw_material_id,
                    warehouse_id: payload.warehouse_id,
                    quantity: payload.quantity,
                    notes: payload.notes,
                },
                include: WASTE_INCLUDE,
            });

            // Deduct stock
            await InventoryHelper.deductWarehouseStock(
                tx,
                payload.warehouse_id,
                [{ raw_material_id: payload.raw_material_id, quantity: payload.quantity, raw_material: rm }],
                waste.id,
                MovementRefType.MANUAL,
                MovementType.OUT,
                userId,
                `Manual Waste RM: ${payload.notes}`,
                MovementEntityType.RAW_MATERIAL,
            );

            return waste;
        });
    }

    static async returnWaste(id: number, payload: ReturnManualWasteRMDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const waste = await tx.productionOrderWaste.findFirst({
                where: { id, production_order_id: null, waste_type: WasteType.RAW_MATERIAL },
                include: { raw_material: { include: { unit_raw_material: true } } },
            });

            if (!waste) throw new ApiError(404, "Data Manual Waste RM tidak ditemukan");
            if (waste.returned_at) throw new ApiError(400, "Bahan baku ini sudah dikembalikan sebelumnya");
            if (!waste.warehouse_id || !waste.raw_material_id) {
                throw new ApiError(400, "Data gudang atau bahan baku tidak valid");
            }

            await InventoryHelper.addWarehouseStock(
                tx,
                waste.warehouse_id,
                [
                    {
                        raw_material_id: waste.raw_material_id,
                        quantity: Number(waste.quantity),
                        raw_material: waste.raw_material!,
                    },
                ],
                waste.id,
                MovementRefType.MANUAL,
                MovementType.IN,
                userId,
                `Pengembalian Manual Waste RM${payload.return_notes ? `: ${payload.return_notes}` : ""}`,
                MovementEntityType.RAW_MATERIAL,
            );

            return await tx.productionOrderWaste.update({
                where: { id },
                data: {
                    returned_at: new Date(),
                    returned_by: payload.return_notes
                        ? `${userId} | ${payload.return_notes}`
                        : userId,
                },
                include: WASTE_INCLUDE,
            });
        });
    }

    static async destroy(id: number, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const waste = await tx.productionOrderWaste.findFirst({
                where: { id, production_order_id: null, waste_type: WasteType.RAW_MATERIAL },
                include: { raw_material: { include: { unit_raw_material: true } } },
            });

            if (!waste) throw new ApiError(404, "Data Manual Waste RM tidak ditemukan");

            // If still ACTIVE (not returned), restore stock before deleting
            if (!waste.returned_at && waste.warehouse_id && waste.raw_material_id) {
                await InventoryHelper.addWarehouseStock(
                    tx,
                    waste.warehouse_id,
                    [
                        {
                            raw_material_id: waste.raw_material_id,
                            quantity: Number(waste.quantity),
                            raw_material: waste.raw_material!,
                        },
                    ],
                    waste.id,
                    MovementRefType.MANUAL,
                    MovementType.IN,
                    userId,
                    "Pembatalan Manual Waste RM (hapus data)",
                    MovementEntityType.RAW_MATERIAL,
                );
            }

            await tx.productionOrderWaste.delete({ where: { id } });
            return { success: true };
        });
    }
}
