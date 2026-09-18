import { SERVICE_LEVEL_Z } from "./schema.js";

export function calculateSafetyStock(weeks: [number, number, number, number], serviceLevel: number) {
    const zValue = SERVICE_LEVEL_Z[serviceLevel as keyof typeof SERVICE_LEVEL_Z];
    if (zValue === undefined) throw new Error("Target layanan tidak tersedia");
    const totalSales = weeks.reduce((sum, value) => sum + value, 0);
    const weeklyAverage = totalSales / weeks.length;
    const variance = weeks.reduce((sum, value) => sum + (value - weeklyAverage) ** 2, 0) / (weeks.length - 1);
    const standardDeviation = Math.sqrt(variance);
    const safetyStock = Math.ceil(standardDeviation * zValue);
    return {
        total_sales: totalSales,
        weekly_average: weeklyAverage,
        standard_deviation: standardDeviation,
        z_value: zValue,
        safety_stock: safetyStock,
        buffer_weeks: weeklyAverage > 0 ? safetyStock / weeklyAverage : null,
    };
}
