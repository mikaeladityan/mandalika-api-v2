import { z } from "zod";
import { ProductionStatus, WasteType } from "../../../generated/prisma/enums.js";

export const RequestCreateProductionSchema = z.object({
    product_id: z.number().int().positive(),
    quantity_planned: z.number().positive(),
    target_date: z.coerce.date().optional(),
    notes: z.string().optional(),
    items: z
        .array(
            z.object({
                raw_material_id: z.number().int().positive(),
                quantity_planned: z.number().positive(),
            }),
        )
        .min(1)
        .optional(),
});

export type RequestCreateProductionDTO = z.infer<typeof RequestCreateProductionSchema>;

export const RequestChangeStatusSchema = z.object({
    status: z.enum([
        ProductionStatus.RELEASED,
        ProductionStatus.PROCESSING,
        ProductionStatus.QC_REVIEW,
    ] as [string, ...string[]]),
    notes: z.string().optional(),
});

export type RequestChangeStatusDTO = z.infer<typeof RequestChangeStatusSchema>;

export const RequestSubmitResultSchema = z.object({
    quantity_actual: z.number().min(0),
    notes: z.string().optional(),
    items: z.array(
        z.object({
            id: z.number().int().positive(),
            quantity_actual: z.number().min(0),
        }),
    ),
});

export type RequestSubmitResultDTO = z.infer<typeof RequestSubmitResultSchema>;

export const RequestQcActionSchema = z
    .object({
        quantity_accepted: z.number().min(0),
        quantity_rejected: z.number().min(0),
        fg_warehouse_id: z.number().int().positive(),
        qc_notes: z.string().optional(),
    })
    .refine(
        (d) => d.quantity_accepted + d.quantity_rejected > 0,
        "Total accepted + rejected must be greater than 0",
    );

export type RequestQcActionDTO = z.infer<typeof RequestQcActionSchema>;

export const QueryProductionSchema = z.object({
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(100).default(10).optional(),
    sortBy: z.enum(["created_at", "mfg_number", "target_date"]).default("created_at").optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc").optional(),
    search: z.string().optional(),
    status: z.enum(ProductionStatus).optional(),
    product_id: z.coerce.number().int().positive().optional(),
});

export type QueryProductionDTO = z.infer<typeof QueryProductionSchema>;
