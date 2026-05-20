import { z } from "zod";
import {
    MovementEntityType,
    MovementLocationType,
    MovementType,
    MovementRefType,
} from "../../../../../generated/prisma/client.js";

const isoDateString = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, "Format tanggal harus ISO (YYYY-MM-DD)");

// ── Query ───────────────────────────────────────────────────────────────────
export const QueryStockMovementSchema = z.object({
    page:           z.coerce.number().int().positive().default(1).optional(),
    take:           z.coerce.number().int().positive().max(5000).default(50).optional(),
    /** Cari berdasarkan nama produk, kode produk, nama bahan baku, atau barcode */
    search:         z.string().trim().min(1).optional(),
    entity_type:    z.enum(MovementEntityType).optional(),
    entity_id:      z.coerce.number().int().positive().optional(),
    location_type:  z.enum(MovementLocationType).optional(),
    location_id:    z.coerce.number().int().positive().optional(),
    movement_type:  z.enum(MovementType).optional(),
    reference_type: z.enum(MovementRefType).optional(),
    reference_id:   z.coerce.number().int().positive().optional(),
    date_from:      isoDateString.optional(),
    date_to:        isoDateString.optional(),
    created_by:     z.string().trim().min(1).optional(),
    sortBy:         z.enum(["created_at", "quantity"]).default("created_at").optional(),
    sortOrder:      z.enum(["asc", "desc"]).default("desc").optional(),
});

export type QueryStockMovementDTO = z.infer<typeof QueryStockMovementSchema>;

// ── Response ─────────────────────────────────────────────────────────────────
export interface ResponseStockMovementDTO {
    id:                number;
    entity_type:       string;
    entity_id:         number;
    product_code:      string | null;
    product_name:      string | null;
    barcode:           string | null;
    category:          string | null;
    size:              string | null;
    location_type:     string;
    location_id:       number;
    location_name:     string | null;
    movement_type:     string;
    quantity:          number;
    /** Running balance sebelum mutasi */
    qty_before:        number;
    /** Running balance setelah mutasi */
    qty_after:         number;
    reference_id:      number | null;
    reference_type:    string | null;
    reference_code:    string | null;
    reference_subtype: string | null;
    destination_name:  string | null;
    created_by:        string | null;
    created_at:        Date;
}
