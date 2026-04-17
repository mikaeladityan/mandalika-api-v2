import { z } from "zod";
import { ProductionStatus } from "../../../generated/prisma/enums.js";

export const RequestCreateProductionSchema = z.object({
    product_id: z.number({ error: "Produk wajib dipilih" }).int().positive("Produk wajib dipilih"),
    quantity_planned: z.number({ error: "Jumlah rencana produksi wajib diisi" }).positive("Jumlah rencana produksi minimal 1"),
    target_date: z.coerce.date().optional(),
    notes: z.string().optional(),
    fg_warehouse_id: z.number().int().positive("Gudang FG wajib dipilih").optional(),
    items: z
        .array(
            z.object({
                raw_material_id: z.number().int().positive("Bahan baku wajib dipilih"),
                quantity_planned: z.number().positive("Jumlah rencana bahan baku minimal 1"),
            }),
        )
        .min(1, "Minimal harus ada 1 item")
        .optional(),
});

export type RequestCreateProductionDTO = z.infer<typeof RequestCreateProductionSchema>;

export const RequestChangeStatusSchema = z.object({
    status: z.enum([
        ProductionStatus.RELEASED,
        ProductionStatus.PROCESSING,
        ProductionStatus.QC_REVIEW,
    ] as [string, ...string[]], { error: "Status wajib diisi" }),
    notes: z.string().optional(),
});

export type RequestChangeStatusDTO = z.infer<typeof RequestChangeStatusSchema>;

export const RequestSubmitResultSchema = z.object({
    quantity_actual: z.number({ error: "Jumlah aktual produksi wajib diisi" }).min(0, "Jumlah aktual minimal 0"),
    notes: z.string().optional(),
    items: z.array(
        z.object({
            id: z.number().int().positive(),
            quantity_actual: z.number({ error: "Jumlah aktual bahan baku wajib diisi" }).min(0, "Jumlah aktual minimal 0"),
        }),
    ),
});

export type RequestSubmitResultDTO = z.infer<typeof RequestSubmitResultSchema>;

export const RequestQcActionSchema = z
    .object({
        quantity_accepted: z.coerce.number({ error: "Jumlah diterima wajib diisi" }).min(0, "Jumlah diterima minimal 0"),
        quantity_rejected: z.coerce.number({ error: "Jumlah ditolak wajib diisi" }).min(0, "Jumlah ditolak minimal 0"),
        fg_warehouse_id: z.coerce.number({ error: "Gudang FG wajib dipilih" }).int().positive("Gudang FG wajib dipilih"),
        qc_notes: z.string().optional(),
    })
    .refine(
        (d) => d.quantity_accepted + d.quantity_rejected > 0,
        "Total yang diterima + ditolak harus lebih besar dari 0",
    );

export type RequestQcActionDTO = z.infer<typeof RequestQcActionSchema>;

export const QueryProductionSchema = z.object({
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(100).default(10).optional(),
    sortBy: z.enum(["created_at", "mfg_number", "target_date"]).default("created_at").optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc").optional(),
    search: z.string().optional(),
    status: z.preprocess((val) => {
        if (!val) return undefined;
        if (typeof val === "string") return val.includes(",") ? val.split(",") : [val];
        if (Array.isArray(val)) return val;
        return [val];
    }, z.array(z.nativeEnum(ProductionStatus))).optional(),
    product_id: z.coerce.number().int().positive().optional(),
});

export type QueryProductionDTO = z.infer<typeof QueryProductionSchema>;

export const QueryWasteSchema = z.object({
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(100).default(10).optional(),
    waste_type: z.string().optional(),
    search: z.string().optional(),
});

export type QueryWasteDTO = z.infer<typeof QueryWasteSchema>;
