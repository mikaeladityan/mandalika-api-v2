import { Prisma } from "../../../../generated/prisma/client.js";

export type RawMatWithSheetRelations = Prisma.RawMaterialGetPayload<{
    include: {
        raw_mat_category: { select: { name: true } };
        unit_raw_material: { select: { name: true } };
        supplier_materials: {
            select: {
                id: true;
                is_preferred: true;
                status: true;
                unit_price: true;
                min_buy: true;
                lead_time: true;
                supplier: { select: { name: true; source: true } };
            };
        };
    };
}> & {
    /** Denormalised LOCAL/IMPORT field – present when fetched via raw SQL or legacy service layer. */
    source?: string | null;
};

type SupplierRow = RawMatWithSheetRelations["supplier_materials"][number];

export function pickPreferredSupplier(rows: SupplierRow[]): SupplierRow | undefined {
    const preferred = rows.find((r) => r.is_preferred && r.status === "ACTIVE");
    if (preferred) return preferred;

    const activeRows = rows.filter((r) => r.status === "ACTIVE");
    if (activeRows.length === 0) return undefined;

    return activeRows.reduce((min, r) => (r.id < min.id ? r : min));
}

/**
 * Returns 10 cells matching the RM sheet column layout B-K:
 *   BARCODE | CATEGORY | MATERIAL NAME | UOM | SUPPLIER |
 *   PRICE   | MOQ      | LEAD TIME     | MIN STOCK | LOCAL/IMPORT
 *
 * Column A is reserved (not read or written). Sync MUST leave it alone.
 */
export function rawMatToRow(rm: RawMatWithSheetRelations): string[] {
    const pref = pickPreferredSupplier(rm.supplier_materials);
    return [
        rm.barcode ?? "",
        rm.raw_mat_category?.name ?? "",
        rm.name,
        rm.unit_raw_material.name,
        pref?.supplier.name ?? "",
        pref != null ? String(pref.unit_price) : "",
        pref?.min_buy != null ? String(pref.min_buy) : "",
        pref?.lead_time != null ? String(pref.lead_time) : "",
        rm.min_stock != null ? String(rm.min_stock) : "0",
        pref?.supplier.source ?? rm.source ?? "",
    ];
}
