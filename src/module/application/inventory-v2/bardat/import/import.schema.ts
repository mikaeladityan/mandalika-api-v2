import { z } from "zod";

export const RequestBardatExecuteSchema = z.object({
    import_id: z.string().uuid("Import ID tidak valid"),
});

export type RequestBardatExecuteDTO = z.infer<typeof RequestBardatExecuteSchema>;

export type BardatCell = string | number | Date | null;
export type BardatMatrix = BardatCell[][];

export type BardatPreviewRow = {
    product_code: string;
    outlet_code: string;
    date: string;
    quantity: number;
    product_id: number | null;
    outlet_id: number | null;
    errors: string[];
};

export type BardatOutletSummary = {
    outlet_code: string;
    outlet_name: string | null;
    matched_sku: number;
    unmatched_sku: number;
    valid_rows: number;
    invalid_rows: number;
    first_date: string | null;
    last_date: string | null;
};

export type BardatPeriod = { month: number; year: number };

export type ResponseBardatPreviewDTO = {
    import_id: string;
    total: number;
    valid: number;
    invalid: number;
    periods: BardatPeriod[];
    summaries: BardatOutletSummary[];
};

export type ResponseBardatPreviewDetailDTO = ResponseBardatPreviewDTO & {
    rows: BardatPreviewRow[];
    createdAt: number;
};
