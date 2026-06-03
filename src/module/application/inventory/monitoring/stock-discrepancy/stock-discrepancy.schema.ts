import { z } from "zod";

export const QueryStockDiscrepancySchema = z.object({
    page:   z.coerce.number().int().positive().default(1).optional(),
    take:   z.coerce.number().int().positive().max(500).default(25).optional(),
    /** Cari berdasarkan transfer_number, product.name, atau product.code */
    search: z.string().trim().min(1).optional(),
});

export type QueryStockDiscrepancyDTO = z.infer<typeof QueryStockDiscrepancySchema>;

export interface ResponseStockDiscrepancyDTO {
    id:                 number;
    transfer_id:        number;
    transfer_number:    string;
    transfer_date:      Date;
    from_location:      string | null;
    to_location:        string | null;
    product_id:         number | null;
    product_code:       string | null;
    product_name:       string | null;
    quantity_requested: number;
    quantity_missing:   number;
    quantity_rejected:  number;
    notes:              string | null;
}
