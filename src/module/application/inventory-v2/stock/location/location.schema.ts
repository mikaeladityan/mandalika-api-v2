import { z } from "zod";

export const QueryLocationSchema = z.object({
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(500).default(25).optional(),
    search: z.string().optional(),
    sortBy: z
        .enum(["name", "code", "type", "size", "gender", "updated_at", "total_stock"])
        .optional()
        .default("total_stock"),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
    type_id: z.coerce.number().int().positive().optional(),
    gender: z.string().optional(),
});

export type QueryLocationDTO = z.infer<typeof QueryLocationSchema>;

export interface ResponseLocationDTO {
    code: string;
    name: string;
    type: string;
    size: number;
    gender: string;
    uom: string;
    total_stock: number;
    location_stocks: Record<string, number>;
}
