import { z } from "zod";
import { GENDER } from "../../../../../../generated/prisma/client.js";

export const QueryStockLocationFGSchema = z.object({
    location_type: z.enum(["WAREHOUSE", "OUTLET"]).optional(),
    location_id:   z.coerce.number().int().positive().optional(),
    month:         z.coerce.number().int().min(1).max(12).optional(),
    year:          z.coerce.number().int().min(2000).max(2100).optional(),
    search:        z.string().trim().min(1).optional(),
    type_id:       z.coerce.number().int().positive().optional(),
    gender:        z.enum(GENDER).optional(),
    page:          z.coerce.number().int().positive().default(1).optional(),
    take:          z.coerce.number().int().positive().max(5000).default(50).optional(),
    sortBy:        z.enum(["name", "code", "quantity", "updated_at"]).default("name").optional(),
    sortOrder:     z.enum(["asc", "desc"]).default("asc").optional(),
});

export type QueryStockLocationFGDTO = z.infer<typeof QueryStockLocationFGSchema>;

export interface ResponseStockLocationFGItemDTO {
    product_code:  string;
    product_name:  string;
    type:          string;
    size:          number;
    gender:        string;
    uom:           string;
    quantity:      number;
    /** Hanya tersedia untuk OUTLET. */
    min_stock:     number | null;
    location_name: string;
}

export interface ResponseStockLocationFGAvailableDTO {
    id:   number;
    name: string;
    type: "WAREHOUSE" | "OUTLET";
}
