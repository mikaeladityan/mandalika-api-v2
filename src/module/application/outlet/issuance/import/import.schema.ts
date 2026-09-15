import { z } from "zod";

export const RequestIssuanceExecuteSchema = z.object({
    import_id: z.string().uuid("Import ID tidak valid"),
});

export type RequestIssuanceExecuteDTO = z.infer<typeof RequestIssuanceExecuteSchema>;

export type IssuanceCell = string | number | Date | null;
export type IssuanceMatrix = IssuanceCell[][];

export type IssuancePreviewRow = {
    product_code: string;
    outlet_code: string;
    date: string;
    quantity: number;
    product_id: number | null;
    outlet_id: number | null;
    errors: string[];
};

export type IssuanceOutletSummary = {
    outlet_code: string;
    outlet_name: string | null;
    matched_sku: number;
    unmatched_sku: number;
    valid_rows: number;
    invalid_rows: number;
    first_date: string | null;
    last_date: string | null;
};

export type IssuancePeriod = { month: number; year: number };

export type ResponseIssuancePreviewDTO = {
    import_id: string;
    total: number;
    valid: number;
    invalid: number;
    periods: IssuancePeriod[];
    summaries: IssuanceOutletSummary[];
};

export type ResponseIssuancePreviewDetailDTO = ResponseIssuancePreviewDTO & {
    rows: IssuancePreviewRow[];
    createdAt: number;
};
