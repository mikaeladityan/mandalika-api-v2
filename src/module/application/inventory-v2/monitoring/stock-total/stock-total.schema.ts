import { z } from "zod";

// ── Query ───────────────────────────────────────────────────────────────────
export const QueryStockTotalSchema = z.object({
    page:      z.coerce.number().int().positive().default(1).optional(),
    take:      z.coerce.number().int().positive().max(5000).default(50).optional(),
    search:    z.string().optional(),
    type_id:   z.coerce.number().int().positive().optional(),
    gender:    z.string().optional(),
    sortBy:    z.enum(["name", "code", "type", "size", "total_stock", "updated_at"])
                .default("updated_at").optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc").optional(),
});

export type QueryStockTotalDTO = z.infer<typeof QueryStockTotalSchema>;

// ── Response ─────────────────────────────────────────────────────────────────
export interface ResponseStockTotalDTO {
    code:            string;
    name:            string;
    type:            string;
    size:            number;
    gender:          string;
    uom:             string;
    total_stock:     number;
    /** Total quantity missing across all non-cancelled transfers (DO / TG) */
    total_missing:   number;
    /** Dynamic map: location name → quantity, e.g. { "Gudang SBY": 40, "Toko A": 10 } */
    location_stocks: Record<string, number>;
}

export interface ResponseStockTotalLocationDTO {
    id:   number;
    name: string;
    type: "WAREHOUSE" | "OUTLET";
}
