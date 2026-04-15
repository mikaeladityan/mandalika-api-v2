import { z } from "zod";

// ── Query ───────────────────────────────────────────────────────────────────
export const QueryStockLocationSchema = z.object({
    /** Tipe lokasi: WAREHOUSE (Gudang FG) atau OUTLET (Toko) */
    location_type: z.enum(["WAREHOUSE", "OUTLET"]).optional(),
    /** ID lokasi (warehouse_id atau outlet_id) */
    location_id:   z.coerce.number().int().positive().optional(),
    month:         z.coerce.number().int().min(1).max(12).optional(),
    year:          z.coerce.number().int().positive().optional(),
    search:        z.string().optional(),
    type_id:       z.coerce.number().int().positive().optional(),
    gender:        z.string().optional(),
    page:          z.coerce.number().int().positive().default(1).optional(),
    take:          z.coerce.number().int().positive().max(5000).default(50).optional(),
    sortBy:        z.enum(["name", "code", "quantity", "updated_at"]).default("name").optional(),
    sortOrder:     z.enum(["asc", "desc"]).default("asc").optional(),
});

export type QueryStockLocationDTO = z.infer<typeof QueryStockLocationSchema>;

// ── Response ─────────────────────────────────────────────────────────────────
export interface ResponseStockLocationItemDTO {
    product_code:  string;
    product_name:  string;
    type:          string;
    size:          number;
    gender:        string;
    uom:           string;
    quantity:      number;
    /** Hanya tersedia untuk OUTLET */
    min_stock:     number | null;
    location_name: string;
}

export interface ResponseAvailableLocationDTO {
    id:   number;
    name: string;
    type: "WAREHOUSE" | "OUTLET";
}
