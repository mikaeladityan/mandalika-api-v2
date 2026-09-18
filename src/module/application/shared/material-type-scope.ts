import { Prisma } from "../../../generated/prisma/client.js";
import prisma from "../../../config/prisma.js";

/**
 * Scope kategori raw material yang dipakai halaman rekomendasi dan consolidation.
 * Sumber tunggal supaya kedua halaman memakai aturan supplier yang sama.
 */
export type MaterialTypeScope = "ffo" | "lokal" | "impor" | "tester";

/**
 * Satu RM bisa punya lebih dari satu supplier_materials dengan is_preferred = true.
 * Supplier terpilih adalah preferred dengan supplier_id terkecil; aturan ini yang
 * menentukan sebuah RM masuk scope lokal atau impor.
 */
export const preferredSupplierJoin = Prisma.sql`
    LEFT JOIN LATERAL (
        SELECT sm.supplier_id, sm.min_buy, sm.lead_time
        FROM "supplier_materials" sm
        WHERE sm.raw_material_id = rm.id
          AND sm.is_preferred = true
        ORDER BY sm.supplier_id ASC
        LIMIT 1
    ) sm ON TRUE
    LEFT JOIN "suppliers" s ON s.id = sm.supplier_id
`;

const excludeTester = Prisma.sql`AND (rm.barcode IS NULL OR (rm.barcode NOT LIKE 'KTL-%' AND rm.barcode NOT LIKE 'KTP-%' AND rm.barcode NOT LIKE 'KA-%' AND rm.barcode NOT LIKE 'KTB-%'))`;

/** Filter SQL scope; mengharapkan alias rm, rmc, dan s dari preferredSupplierJoin. */
export const materialTypeScopeSql = (type?: string): Prisma.Sql => {
    switch (type) {
        case "ffo":
            return Prisma.sql`(rmc.slug ILIKE '%fragrance-oil%' OR rmc.slug ILIKE '%ffo%')`;
        case "lokal":
            return Prisma.sql`(rmc.slug IS NULL OR rmc.slug NOT ILIKE '%fragrance-oil%') AND s.source = 'LOCAL' ${excludeTester}`;
        case "impor":
            return Prisma.sql`(rmc.slug IS NULL OR rmc.slug NOT ILIKE '%fragrance-oil%') AND s.source = 'IMPORT' ${excludeTester}`;
        case "tester":
            return Prisma.sql`(rmc.slug IS NULL OR rmc.slug NOT ILIKE '%fragrance-oil%') AND (rm.barcode LIKE 'KTL-%' OR rm.barcode LIKE 'KTP-%' OR rm.barcode LIKE 'KA-%' OR rm.barcode LIKE 'KTB-%')`;
        default:
            return Prisma.sql`1=1`;
    }
};

/**
 * ID raw material yang masuk scope. `null` berarti tanpa filter type.
 * Prisma tidak bisa menyatakan "preferred dengan supplier_id terkecil" secara
 * deklaratif, jadi scope diselesaikan lebih dulu lewat query ini.
 */
export const materialIdsByTypeScope = async (type?: string): Promise<number[] | null> => {
    if (!type) return null;

    const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        SELECT rm.id
        FROM "raw_materials" rm
        LEFT JOIN "raw_mat_categories" rmc ON rmc.id = rm.raw_mat_categories_id
        ${preferredSupplierJoin}
        WHERE ${materialTypeScopeSql(type)}
          AND rm.deleted_at IS NULL
    `);

    return rows.map((row) => Number(row.id));
};
