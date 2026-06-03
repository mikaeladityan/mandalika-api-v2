import { Prisma } from "../../../../../../generated/prisma/client.js";
import type { RMImportPreviewDTO } from "../import.schema.js";

export type MasterMaps = {
    unitIds: Map<string, number>;
    categoryIds: Map<string, number>;
    supplierIds: Map<string, number>;
};

export type RMRow = {
    id: number;
    barcode: string;
};

export async function bulkUpsertRawMaterials(
    tx: Prisma.TransactionClient,
    chunk: RMImportPreviewDTO[],
    maps: MasterMaps,
): Promise<RMRow[]> {
    if (!chunk.length) return [];

    const values = chunk.map((row) => {
        const unitId = maps.unitIds.get(row.unit);
        if (!unitId) {
            throw new Error(`Unit tidak ditemukan untuk material: ${row.name}`);
        }
        const categoryId = maps.categoryIds.get(row.category) ?? null;
        return Prisma.sql`(
            ${row.barcode},
            ${row.name},
            ${row.min_stock},
            ${unitId},
            ${categoryId},
            NOW(),
            NOW()
        )`;
    });

    return tx.$queryRaw<RMRow[]>`
        INSERT INTO "raw_materials" (
            barcode, name, min_stock, unit_id, raw_mat_categories_id,
            created_at, updated_at
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT (barcode) DO UPDATE SET
            name = EXCLUDED.name,
            min_stock = EXCLUDED.min_stock,
            unit_id = EXCLUDED.unit_id,
            raw_mat_categories_id = EXCLUDED.raw_mat_categories_id,
            updated_at = NOW()
        RETURNING id, barcode
    `;
}

export async function bulkUpsertSupplierMaterials(
    tx: Prisma.TransactionClient,
    rows: Array<{
        supplier_id: number;
        raw_material_id: number;
        unit_price: number;
        min_buy: number;
        lead_time: number;
    }>,
): Promise<number> {
    if (!rows.length) return 0;

    // Imported (RM, supplier) jadi canonical preferred — reset preferred lama untuk RM yang sama
    // agar tidak ada >1 baris is_preferred=true per raw_material_id setelah upsert.
    const rmIds = Array.from(new Set(rows.map((r) => r.raw_material_id)));
    await tx.$executeRaw`
        UPDATE "supplier_materials"
        SET is_preferred = false, updated_at = NOW()
        WHERE raw_material_id = ANY(${rmIds}::int[]) AND is_preferred = true
    `;

    const values = rows.map(
        (r) => Prisma.sql`(
            ${r.supplier_id},
            ${r.raw_material_id},
            ${r.unit_price},
            ${r.min_buy},
            ${r.lead_time},
            true,
            'ACTIVE'::"STATUS",
            NOW(),
            NOW()
        )`,
    );

    return tx.$executeRaw`
        INSERT INTO "supplier_materials" (
            supplier_id, raw_material_id, unit_price, min_buy, lead_time,
            is_preferred, status, created_at, updated_at
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT (supplier_id, raw_material_id) DO UPDATE SET
            unit_price = EXCLUDED.unit_price,
            min_buy = EXCLUDED.min_buy,
            lead_time = EXCLUDED.lead_time,
            is_preferred = true,
            updated_at = NOW()
    `;
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}
