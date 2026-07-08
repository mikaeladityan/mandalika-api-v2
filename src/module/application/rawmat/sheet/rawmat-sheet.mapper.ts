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
 * RM sheet layout B-M. Kolom G (SUPPLIER_FLAG) dan H (USD) dikelola manual di
 * sheet — sync TIDAK menulisnya. Karena itu row dipecah dua segmen:
 *   left  (B-F): BARCODE | CATEGORY | MATERIAL NAME | UOM | SUPPLIER
 *   right (I-M): PRICE   | MOQ      | LEAD TIME     | MIN STOCK | LOCAL/IMPORT
 *
 * Column A (UID) is reserved (not read or written on update). Sync MUST leave it alone.
 */
export function rawMatToRowSegments(rm: RawMatWithSheetRelations): {
    left: string[];
    right: string[];
} {
    const pref = pickPreferredSupplier(rm.supplier_materials);
    return {
        left: [
            rm.barcode ?? "",
            rm.raw_mat_category?.name ?? "",
            rm.name,
            rm.unit_raw_material.name,
            pref?.supplier.name ?? "",
        ],
        right: [
            pref != null ? String(pref.unit_price) : "",
            pref?.min_buy != null ? String(pref.min_buy) : "",
            pref?.lead_time != null ? String(pref.lead_time) : "",
            rm.min_stock != null ? String(rm.min_stock) : "0",
            pref?.supplier.source ?? rm.source ?? "",
        ],
    };
}
