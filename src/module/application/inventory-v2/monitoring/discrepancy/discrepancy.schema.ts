import { z } from "zod";

export const QueryDiscrepancySchema = z.object({
    page:   z.coerce.number().int().positive().default(1).optional(),
    take:   z.coerce.number().int().positive().max(100).default(25).optional(),
    search: z.string().optional(),
});

export type QueryDiscrepancyDTO = z.infer<typeof QueryDiscrepancySchema>;
