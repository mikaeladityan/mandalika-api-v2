import { z } from "zod";
import { GENDER } from "../../../../../../generated/prisma/client.js";

export const QueryStockDistributionFGSchema = z.object({
    page:      z.coerce.number().int().positive().default(1).optional(),
    take:      z.coerce.number().int().positive().max(5000).default(50).optional(),
    search:    z.string().optional(),
    type_id:   z.coerce.number().int().positive().optional(),
    gender:    z.enum(GENDER).optional(),
    month:     z.coerce.number().int().min(1).max(12).optional(),
    year:      z.coerce.number().int().min(2000).max(2100).optional(),
    sortBy:    z.enum(["name", "code", "type", "size", "total_stock", "updated_at"])
                .default("updated_at").optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc").optional(),
});

export type QueryStockDistributionFGDTO = z.infer<typeof QueryStockDistributionFGSchema>;

export interface ResponseStockDistributionFGDTO {
    code:            string;
    name:            string;
    type:            string;
    size:            number;
    gender:          string;
    uom:             string;
    total_stock:     number;
    total_missing:   number;
    location_stocks: Record<string, number>;
}

export interface ResponseStockDistributionLocationDTO {
    id:   number;
    name: string;
    type: "WAREHOUSE" | "OUTLET";
}
