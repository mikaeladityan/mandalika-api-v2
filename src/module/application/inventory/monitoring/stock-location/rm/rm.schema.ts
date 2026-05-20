import { z } from "zod";
import { MaterialType } from "../../../../../../generated/prisma/client.js";

export const QueryStockLocationRMSchema = z.object({
    location_id:   z.coerce.number().int().positive().optional(),
    month:         z.coerce.number().int().min(1).max(12).optional(),
    year:          z.coerce.number().int().min(2000).max(2100).optional(),
    search:        z.string().trim().min(1).optional(),
    category_id:   z.coerce.number().int().positive().optional(),
    material_type: z.enum(MaterialType).optional(),
    page:          z.coerce.number().int().positive().default(1).optional(),
    take:          z.coerce.number().int().positive().max(5000).default(50).optional(),
    sortBy:        z.enum(["name", "quantity", "updated_at"]).default("name").optional(),
    sortOrder:     z.enum(["asc", "desc"]).default("asc").optional(),
});

export type QueryStockLocationRMDTO = z.infer<typeof QueryStockLocationRMSchema>;

export interface ResponseStockLocationRMItemDTO {
    name:          string;
    category:      string;
    unit:          string;
    material_type: "FO" | "PCKG" | null;
    quantity:      number;
    min_stock:     number | null;
    location_name: string;
}

export interface ResponseStockLocationRMAvailableDTO {
    id:   number;
    name: string;
    type: "WAREHOUSE";
}
