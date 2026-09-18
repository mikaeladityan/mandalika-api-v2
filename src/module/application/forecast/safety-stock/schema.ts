import { z } from "zod";

export const SERVICE_LEVEL_Z = {
    80: 0.8416212335729143,
    85: 1.0364333894937898,
    90: 1.2815515655446004,
    95: 1.6448536269514722,
    97.5: 1.959963984540054,
    98: 2.0537489106318225,
    99: 2.3263478740408408,
    99.5: 2.5758293035489004,
    99.9: 3.090232306167813,
} as const;

export const SERVICE_LEVELS = Object.keys(SERVICE_LEVEL_Z).map(Number);
const serviceLevel = z.coerce.number().refine((value) => SERVICE_LEVELS.includes(value), "Target layanan tidak tersedia");
const month = z.coerce.number().int("Bulan harus berupa bilangan bulat").min(1, "Bulan harus antara 1 dan 12").max(12, "Bulan harus antara 1 dan 12");
const year = z.coerce.number().int("Tahun harus berupa bilangan bulat").min(1900, "Tahun tidak valid").max(9999, "Tahun tidak valid");
const positiveId = z.coerce.number().int("ID harus berupa bilangan bulat").positive("ID harus lebih besar dari 0");
const sortOrder = z.enum(["asc", "desc"]);

const commonQuery = {
    month,
    year,
    service_level: serviceLevel.default(80),
    product_id: positiveId.optional(),
    page: z.coerce.number().int().min(1).default(1),
    take: z.coerce.number().int().min(1).max(100).default(50),
    sortBy: z.string().optional(),
    order: sortOrder.default("asc"),
};

export const QuerySafetyStockSchema = z.object({
    ...commonQuery,
    outlet_id: positiveId.optional(),
});

export const QuerySafetyStockSummarySchema = z.object(commonQuery);

export type QuerySafetyStockDTO = z.infer<typeof QuerySafetyStockSchema>;
export type QuerySafetyStockSummaryDTO = z.infer<typeof QuerySafetyStockSummarySchema>;
export type SafetyStockServiceLevel = keyof typeof SERVICE_LEVEL_Z;

export const SafetyStockDetailRowSchema = z.object({
    outlet_id: z.number(), outlet_code: z.string(), outlet_name: z.string(),
    product_id: z.number(), product_code: z.string(), product_name: z.string(), product_status: z.enum(["ACTIVE", "PENDING"]), delivery_days: z.number().nullable(),
    weeks: z.tuple([z.number(), z.number(), z.number(), z.number()]), total_sales: z.number(), weekly_average: z.number(),
    standard_deviation: z.number(), safety_stock: z.number().int(), buffer_weeks: z.number().nullable(), has_data: z.boolean(),
});
export const SafetyStockSummaryRowSchema = z.object({
    product_id: z.number(), product_code: z.string(), product_name: z.string(), product_status: z.enum(["ACTIVE", "PENDING"]), delivery_days: z.number().nullable(),
    total_sales: z.number(), safety_stock: z.number().int(), sales_to_stock_ratio: z.number().nullable(), buffer_percentage: z.number().nullable(), has_data: z.boolean(),
});

export type SafetyStockDetailRow = z.infer<typeof SafetyStockDetailRowSchema>;
export type SafetyStockSummaryRow = z.infer<typeof SafetyStockSummaryRowSchema>;
