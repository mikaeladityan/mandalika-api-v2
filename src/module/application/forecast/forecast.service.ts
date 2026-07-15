import prisma from "../../../config/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { ApiError } from "../../../lib/errors/api.error.js";
import { GetPagination } from "../../../lib/utils/pagination.js";
import {
    DeleteForecastByPeriodDTO,
    FinalizeForecastDTO,
    QueryForecastDTO,
    ResponseForecastDTO,
    RunForecastDTO,
    UpdateManualForecastDTO,
    CompareForecastDTO,
} from "./forecast.schema.js";
import { ISSUANCE_THRESHOLD_PERIOD } from "../shared/constants.js";

const PRODUCT_SELECT = {
    id: true,
    name: true,
    product_type: { select: { slug: true } },
    size: { select: { size: true } },
    distribution_percentage: true,
    reference_distribution_percentage: true,
    safety_percentage: true,
} as const;

const OTHERS_TYPE_NOT = ["display", "kertas", "botol", "paper-bag", "kartu-garansi", "canvas-bag", "box-uk", "others"].map(
    (s) => ({ product_type: { slug: { contains: s, mode: "insensitive" as const } } }),
);

const COMPARE_PRODUCT_SELECT = { ...PRODUCT_SELECT, code: true } as const;

export type SelectedProduct = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

export type ForecastBatchRow = {
    product_id: number;
    month: number;
    year: number;
    base_forecast: number;
    final_forecast: number;
    trend: "UP" | "DOWN" | "STABLE";
    forecast_percentage_id: number;
    status: "ADJUSTED" | "DRAFT";
};
export type DistField = "distribution_percentage" | "reference_distribution_percentage";

export class ForecastService {
    static async loadBaseSalesInput(
        productIds: number[],
        start_month: number,
        start_year: number,
    ): Promise<Map<number, number>> {
        if (productIds.length === 0) {
            return new Map<number, number>();
        }
        const AVG_MONTHS = 3;
        const prevMonths = Array.from({ length: AVG_MONTHS }, (_, i) => {
            const d = new Date(start_year, start_month - 1 - (i + 1), 1);
            return { month: d.getMonth() + 1, year: d.getFullYear() };
        });

        const salesData = await prisma.$queryRaw<any[]>(Prisma.sql`
            SELECT product_id, SUM(month_qty) as total_quantity
            FROM (
                SELECT
                    product_id,
                    year,
                    month,
                    COALESCE(
                        NULLIF(SUM(CASE WHEN (year * 12 + month) > ${ISSUANCE_THRESHOLD_PERIOD} AND type != 'ALL'::"IssuanceType" THEN quantity ELSE 0 END), 0),
                        SUM(CASE WHEN (year * 12 + month) <= ${ISSUANCE_THRESHOLD_PERIOD} AND type = 'ALL'::"IssuanceType" THEN quantity ELSE 0 END)
                    ) as month_qty
                FROM product_issuances
                WHERE product_id IN (${Prisma.join(productIds)})
                  AND (${Prisma.join(
                      prevMonths.map(
                          (pm) => Prisma.sql`(year = ${pm.year} AND month = ${pm.month})`,
                      ),
                      " OR ",
                  )})
                GROUP BY product_id, year, month
            ) sub
            GROUP BY product_id
        `);

        return new Map<number, number>(
            salesData.map((s) => [s.product_id, Number(s.total_quantity ?? 0) / AVG_MONTHS]),
        );
    }

    static computeForecastBatch(params: {
        products: SelectedProduct[];
        monthsRange: { month: number; year: number }[];
        pctMap: Map<string, { id: number; value: unknown }>;
        inputMap: Map<number, number>;
        is_others: boolean | undefined;
        distField: DistField;
    }): ForecastBatchRow[] {
        const { products, monthsRange, pctMap, inputMap, is_others, distField } = params;
        const batch: ForecastBatchRow[] = [];

        // Group products by base name (for special rule Aroma groups, normalize HAMPERS prefix)
        const groups = new Map<string, SelectedProduct[]>();
        for (const p of products) {
            const baseName = ForecastService.getAromaBaseName(p.name);
            if (!groups.has(baseName)) groups.set(baseName, []);
            groups.get(baseName)!.push(p);
        }
        const groupValues = Array.from(groups.values());

        // track the input for the current month calculation (starts with actual sales)
        let currentInputMap = new Map<number, number>(inputMap);
        let previousTheoreticalAtomFinal = new Map<string, number>();

        // Track aromas where regular variants should mirror hampers variants
        const edpMirrorAromas = new Set<string>();
        const parfumMirrorAromas = new Set<string>();

        for (const group of groupValues) {
            if (!group.length) continue;
            const aromaName = ForecastService.getAromaBaseName(group[0]!.name);

            const hasHampersEdp = group.some(
                (p) =>
                    p.product_type?.slug?.toLowerCase() === "hampers-edp" &&
                    (p.size?.size === 100 || p.size?.size === 110 || p.size?.size === 120),
            );
            if (hasHampersEdp) edpMirrorAromas.add(aromaName);

            const hasHampersParf = group.some(
                (p) =>
                    (p.product_type?.slug?.toLowerCase() === "hampers-parfum" ||
                        p.product_type?.slug?.toLowerCase() === "hampers-perfume") &&
                    (p.size?.size === 100 || p.size?.size === 110 || p.size?.size === 120),
            );
            if (hasHampersParf) parfumMirrorAromas.add(aromaName);
        }

        for (let i = 0; i < monthsRange.length; i++) {
            const m = monthsRange[i]!;
            const pct = pctMap.get(`${m.year}-${m.month}`);

            // Special Rule for Display: Ignore existing percentage settings and force 0 growth
            const pctValue = is_others ? 0 : Number(pct?.value ?? 0);

            // If not is_others, stop calculation if percentage is not found or zero
            if (!is_others && (!pct || Number(pct.value) === 0)) {
                break;
            }
            const nextInputMap = new Map<number, number>();
            const status = i === 0 ? "ADJUSTED" : "DRAFT";

            for (const group of groupValues) {
                if (!group.length) continue;
                const aromaName = ForecastService.getAromaBaseName(group[0]!.name);

                // --- Skip "others" type products that shouldn't be in non-others forecast ---
                const isOthersSlug = (s: string | undefined | null) => {
                    if (!s) return false;
                    const sl = s.toLowerCase();
                    return (
                        sl.includes("display") ||
                        sl.includes("kertas") ||
                        sl.includes("botol") ||
                        sl.includes("paper-bag") ||
                        sl.includes("kartu-garansi") ||
                        sl.includes("canvas-bag") ||
                        sl.includes("box-uk") ||
                        sl.includes("others")
                    );
                };

                const edpAnchors = group.filter((p) => {
                    const slug = p.product_type?.slug?.toLowerCase();
                    const size = p.size?.size;
                    return (
                        (slug === "edp" || slug === "hampers-edp") &&
                        (size === 100 || size === 110 || size === 120)
                    );
                });

                const parfumAnchors = group.filter((p) => {
                    const slug = p.product_type?.slug?.toLowerCase();
                    const size = p.size?.size;
                    return (
                        (slug === "parfum" || slug === "perfume" || slug === "hampers-parfum") &&
                        (size === 100 || size === 110 || size === 120)
                    );
                });

                let atomBase = 0;
                if (i === 0) {
                    atomBase =
                        edpAnchors.reduce((acc, p) => acc + (currentInputMap.get(p.id) ?? 0), 0) +
                        parfumAnchors.reduce((acc, p) => acc + (currentInputMap.get(p.id) ?? 0), 0);
                } else {
                    atomBase = previousTheoreticalAtomFinal.get(aromaName) ?? 0;
                }

                const atomFinal = atomBase * (1 + pctValue);
                previousTheoreticalAtomFinal.set(aromaName, atomFinal);

                // ═══ TWO-PASS APPROACH for Hampers Mirroring ═══
                // Map to store computed final_forecast per product id within this group+month
                const computedFinalMap = new Map<number, number>();

                // --- PASS 1: Process hampers variants + atomizer + others first ---
                for (const product of group) {
                    const slug = product.product_type?.slug?.toLowerCase();
                    const size = product.size?.size;
                    const distPct = Number(product[distField] ?? 0);
                    const input = currentInputMap.get(product.id) ?? 0;

                    const isRegularEdpParfum =
                        (slug === "edp" || slug === "parfum" || slug === "perfume") &&
                        (size === 100 || size === 110 || size === 120 || size === 2);

                    // In Pass 1, skip regular EDP/Parfum that need mirroring (defer to Pass 2)
                    const needsMirrorInPass1 =
                        isRegularEdpParfum &&
                        ((slug === "edp" && edpMirrorAromas.has(aromaName)) ||
                            ((slug === "parfum" || slug === "perfume") &&
                                parfumMirrorAromas.has(aromaName)));

                    if (needsMirrorInPass1) {
                        continue;
                    }

                    let base_forecast = input * (1 + pctValue);
                    let final_forecast = base_forecast;

                    // If this is a non-others run, force others-type products to 0 or null (here 0)
                    if (!is_others && isOthersSlug(slug)) {
                        base_forecast = 0;
                        final_forecast = 0;
                    }
                    // If this is an others-run, it only processes others (already filtered by query)
                    // but we ensure non-regular items that skipped mirroring still happen here.

                    const isEdpParfumAnchor =
                        (slug === "edp" ||
                            slug === "hampers-edp" ||
                            slug === "parfum" ||
                            slug === "perfume" ||
                            slug === "hampers-parfum") &&
                        (size === 100 || size === 110 || size === 120);
                    const isVial2ml =
                        size === 2 &&
                        (slug === "edp" ||
                            slug === "hampers-edp" ||
                            slug === "parfum" ||
                            slug === "perfume" ||
                            slug === "hampers-parfum");

                    if (slug === "atomizer") {
                        base_forecast = atomBase;
                        final_forecast = atomFinal;
                    } else if (isEdpParfumAnchor) {
                        base_forecast = input * (1 + pctValue);
                        final_forecast = atomFinal * distPct;
                    } else if (isVial2ml) {
                        // Pass 1: Handle only Hampers 2ML or Regular 2ML that doesn't need mirroring
                        // (Mirroring check is already done at the start of loop)
                        base_forecast = input * (1 + pctValue);
                        // Copy from its corresponding 100-120ml variant in this group
                        const parent = group.find(
                            (p) =>
                                p.product_type?.slug?.toLowerCase() === slug &&
                                (p.size?.size === 100 ||
                                    p.size?.size === 110 ||
                                    p.size?.size === 120),
                        );
                        if (parent) {
                            final_forecast =
                                computedFinalMap.get(parent.id) ??
                                atomFinal * Number(parent[distField] ?? 0);
                        } else {
                            final_forecast = atomFinal * distPct;
                        }
                    }

                    computedFinalMap.set(product.id, final_forecast);
                    batch.push({
                        product_id: product.id,
                        month: m.month,
                        year: m.year,
                        base_forecast,
                        final_forecast,
                        trend: ForecastService.trend(final_forecast, input),
                        forecast_percentage_id: pct?.id ?? 1,
                        status: status,
                    });
                    nextInputMap.set(product.id, final_forecast);
                }

                // --- PASS 2: Process regular EDP/Parfum that need mirroring from Hampers ---
                for (const product of group) {
                    const slug = product.product_type?.slug?.toLowerCase();
                    const size = product.size?.size;
                    const input = currentInputMap.get(product.id) ?? 0;

                    if (!is_others && isOthersSlug(slug)) continue;

                    const isRegularEdp =
                        slug === "edp" && (size === 100 || size === 110 || size === 120);
                    const isRegularEdp2ml = slug === "edp" && size === 2;
                    const isRegularParfum =
                        (slug === "parfum" || slug === "perfume") &&
                        (size === 100 || size === 110 || size === 120);
                    const isRegularParfum2ml =
                        (slug === "parfum" || slug === "perfume") && size === 2;

                    const needsEdpMirror =
                        (isRegularEdp || isRegularEdp2ml) && edpMirrorAromas.has(aromaName);
                    const needsParfumMirror =
                        (isRegularParfum || isRegularParfum2ml) &&
                        parfumMirrorAromas.has(aromaName);

                    if (!needsEdpMirror && !needsParfumMirror) continue;

                    // Find the corresponding hampers product and COPY its final_forecast directly
                    let final_forecast = 0;
                    const base_forecast = input * (1 + pctValue);

                    if (needsEdpMirror) {
                        const hEdp = group.find(
                            (p) =>
                                p.product_type?.slug?.toLowerCase() === "hampers-edp" &&
                                (p.size?.size === 100 ||
                                    p.size?.size === 110 ||
                                    p.size?.size === 120),
                        );
                        if (hEdp) {
                            // Direct copy of hampers' final_forecast value for both 100ml and 2ml
                            final_forecast =
                                computedFinalMap.get(hEdp.id) ??
                                atomFinal * Number(hEdp[distField] ?? 0);
                        }
                    } else if (needsParfumMirror) {
                        const hParf = group.find((p) => {
                            const s = p.product_type?.slug?.toLowerCase();
                            return (
                                (s === "hampers-parfum" || s === "hampers-perfume") &&
                                (p.size?.size === 100 ||
                                    p.size?.size === 110 ||
                                    p.size?.size === 120)
                            );
                        });
                        if (hParf) {
                            // Direct copy of hampers' final_forecast value for both 100ml and 2ml
                            final_forecast =
                                computedFinalMap.get(hParf.id) ??
                                atomFinal * Number(hParf[distField] ?? 0);
                        }
                    }

                    batch.push({
                        product_id: product.id,
                        month: m.month,
                        year: m.year,
                        base_forecast,
                        final_forecast,
                        trend: ForecastService.trend(final_forecast, input),
                        forecast_percentage_id: pct?.id ?? 1,
                        status: status,
                    });
                    nextInputMap.set(product.id, final_forecast);
                }
            }
            currentInputMap = nextInputMap;
        }

        return batch;
    }

    static async export(query: QueryForecastDTO) {
        const { data } = await ForecastService.get({ ...query, take: 10000, page: 1 });

        const monthsShort = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

        const esc = (v: string | number | null | undefined): string => {
            const s = String(v ?? "");
            return s.includes(",") || s.includes('"') || s.includes("\n")
                ? `"${s.replace(/"/g, '""')}"`
                : s;
        };

        const periods =
            data.length > 0
                ? (data[0]?.monthly_data.map((m) => ({ month: m.month, year: m.year })) ?? [])
                : [];

        const visibleCols = query.visibleColumns ? query.visibleColumns.split(",") : null;
        const isVisible = (uiId: string) => !visibleCols || visibleCols.includes(uiId);

        type ColDef = { uiId: string; header: string; value: (item: ResponseForecastDTO) => string | number };

        const allColDefs: ColDef[] = [
            { uiId: "code", header: "CODE", value: (item) => item.product_code ?? "" },
            { uiId: "product", header: "PRODUCT NAME", value: (item) => item.product_name.toUpperCase() },
            { uiId: "product_type", header: "TYPE", value: (item) => item.product_type.toUpperCase() },
            { uiId: "edar", header: "EDAR (%)", value: (item) => item.distribution_percentage ?? "" },
            { uiId: "size", header: "SIZE", value: (item) => item.product_size.toUpperCase() },
            ...periods.map((p) => ({
                uiId: "forecast-values",
                header: `FC ${monthsShort[p.month - 1]}'${String(p.year).slice(-2)}`,
                value: (item: ResponseForecastDTO) => {
                    const m = item.monthly_data.find((md) => md.month === p.month && md.year === p.year);
                    return m ? Math.round(Number(m.final_forecast ?? m.base_forecast)) : 0;
                },
            })),
            { uiId: "total-forecast", header: "TOTAL FORECAST", value: (item) => Math.round(Number(item.safety_stock_summary?.total_forecast ?? 0)) },
            { uiId: "total-demand", header: "JUMLAH FORECAST", value: (item) => Math.round(Number(item.safety_stock_summary?.total_demand ?? 0)) },
            { uiId: "safety_percentage", header: "% SAFETY", value: (item) => item.safety_percentage ?? 0 },
            { uiId: "safety-stock", header: "SAFETY STOCK", value: (item) => Math.round(Number(item.safety_stock_summary?.safety_stock_quantity ?? 0)) },
            { uiId: "current_stock", header: "STOCK", value: (item) => Math.round(item.current_stock) },
            { uiId: "need_produce", header: "NEED PRODUCE", value: (item) => Math.round(item.need_produce) },
        ];

        let orderedColDefs = [...allColDefs];
        if (query.columnOrder) {
            const orderArr = query.columnOrder.split(",");
            orderedColDefs.sort((a, b) => {
                const ia = orderArr.indexOf(a.uiId);
                const ib = orderArr.indexOf(b.uiId);
                if (ia !== -1 && ib !== -1) return ia - ib;
                if (ia !== -1) return -1;
                if (ib !== -1) return 1;
                return 0;
            });
        }

        const visibleColDefs = orderedColDefs.filter((col) => isVisible(col.uiId));

        const headers = visibleColDefs.map((col) => col.header);
        const rows = data.map((item) => visibleColDefs.map((col) => esc(col.value(item))).join(","));

        const csv = [headers.map(esc).join(","), ...rows].join("\n");
        return Buffer.from("\uFEFF" + csv, "utf-8"); // BOM for Excel UTF-8 compatibility
    }

    static async run(body: RunForecastDTO) {
        if (body.is_others) {
            throw new ApiError(
                400,
                "Forecasting untuk produk 'Others' tidak didukung. Silakan kelola secara manual.",
            );
        }
        const { product_id, start_year, start_month, horizon = 12 } = body;

        // 1. Resolve all months in the requested horizon
        const monthsRange = Array.from({ length: horizon }, (_, i) => {
            const date = new Date(start_year, start_month - 1 + i, 1);
            return { month: date.getMonth() + 1, year: date.getFullYear() };
        });

        // Load all available percentages for these months
        const percentages = await prisma.forecastPercentage.findMany({
            where: {
                OR: monthsRange.map((m) => ({ month: m.month, year: m.year })),
            },
        });
        const pctMap = new Map(percentages.map((p) => [`${p.year}-${p.month}`, p]));

        if (percentages.length === 0) {
            throw new ApiError(
                404,
                `Data persentase forecast untuk periode ${start_month}/${start_year} belum diatur.`,
            );
        }

        // 2. Load relevant products
        const products: SelectedProduct[] = product_id
            ? await ForecastService.loadVariantsByProductId(product_id, body.is_others)
            : await prisma.product.findMany({
                  where: {
                      status: "ACTIVE",
                      ...(body.is_others
                          ? {
                                OR: [
                                    {
                                        product_type: {
                                            slug: { contains: "display", mode: "insensitive" },
                                        },
                                    },
                                    {
                                        product_type: {
                                            slug: { contains: "kertas", mode: "insensitive" },
                                        },
                                    },
                                    {
                                        product_type: {
                                            slug: { contains: "botol", mode: "insensitive" },
                                        },
                                    },
                                    {
                                        product_type: {
                                            slug: { contains: "paper-bag", mode: "insensitive" },
                                        },
                                    },
                                    {
                                        product_type: {
                                            slug: {
                                                contains: "kartu-garansi",
                                                mode: "insensitive",
                                            },
                                        },
                                    },
                                    {
                                        product_type: {
                                            slug: { contains: "canvas-bag", mode: "insensitive" },
                                        },
                                    },
                                      {
                                          product_type: {
                                              slug: { contains: "box-uk", mode: "insensitive" },
                                          },
                                      },
                                      {
                                          product_type: {
                                              slug: { contains: "others", mode: "insensitive" },
                                          },
                                      },
                                  ],
                              }
                            : {
                                  NOT: [
                                      {
                                          product_type: {
                                              slug: { contains: "display", mode: "insensitive" },
                                          },
                                      },
                                      {
                                          product_type: {
                                              slug: { contains: "kertas", mode: "insensitive" },
                                          },
                                      },
                                      {
                                          product_type: {
                                              slug: { contains: "botol", mode: "insensitive" },
                                          },
                                      },
                                      {
                                          product_type: {
                                              slug: { contains: "paper-bag", mode: "insensitive" },
                                          },
                                      },
                                      {
                                          product_type: {
                                              slug: {
                                                  contains: "kartu-garansi",
                                                  mode: "insensitive",
                                              },
                                          },
                                      },
                                      {
                                          product_type: {
                                              slug: { contains: "canvas-bag", mode: "insensitive" },
                                          },
                                      },
                                      {
                                          product_type: {
                                              slug: { contains: "box-uk", mode: "insensitive" },
                                          },
                                      },
                                      {
                                          product_type: {
                                              slug: { contains: "others", mode: "insensitive" },
                                          },
                                      },
                                  ],
                              }),
                  },
                  select: PRODUCT_SELECT,
              });

        if (products.length === 0) {
            throw new ApiError(404, "Tidak ada produk aktif ditemukan.");
        }

        // 3. Load actual sales for the base period (average of M-1, M-2, M-3)
        const inputMap = await ForecastService.loadBaseSalesInput(
            products.map((p) => p.id),
            start_month,
            start_year,
        );

        // 4. Calculate sequentially through the horizon
        const batch = ForecastService.computeForecastBatch({
            products,
            monthsRange,
            pctMap,
            inputMap,
            is_others: body.is_others,
            distField: "distribution_percentage",
        });

        // 5. Batch Save using Raw SQL Bulk Upsert (Optimization for large datasets)
        if (batch.length > 0) {
            const start = Date.now();
            const nowIso = new Date().toISOString();

            try {
                // Use larger chunk size to reduce roundtrips
                const chunkSize = 4000;

                await prisma.$transaction(
                    async (tx) => {
                        for (let i = 0; i < batch.length; i += chunkSize) {
                            const chunk = batch.slice(i, i + chunkSize);
                            const valuesSql = chunk
                                .map(
                                    (f) =>
                                        `(${f.product_id}, ${f.month}, ${f.year}, '${f.trend}', '${f.status}', ${f.base_forecast}, ${f.final_forecast}, ${f.forecast_percentage_id}, '${nowIso}', '${nowIso}')`,
                                )
                                .join(", ");

                            await tx.$executeRawUnsafe(`
                            INSERT INTO forecasts (
                                product_id, month, year, trend, status, 
                                base_forecast, final_forecast, forecast_percentage_id, 
                                created_at, updated_at
                            )
                            VALUES ${valuesSql}
                            ON CONFLICT (product_id, month, year)
                            DO UPDATE SET
                                trend = EXCLUDED.trend,
                                status = EXCLUDED.status,
                                base_forecast = EXCLUDED.base_forecast,
                                final_forecast = EXCLUDED.final_forecast,
                                forecast_percentage_id = EXCLUDED.forecast_percentage_id,
                                updated_at = EXCLUDED.updated_at;
                        `);
                        }
                    },
                    { timeout: 60000 },
                ); // 60s transaction timeout

                const duration = ((Date.now() - start) / 1000).toFixed(2);
                console.log(`[Forecast Engine] Bulk Upsert ${batch.length} rows took ${duration}s`);
            } catch (err) {
                console.error("[Forecast Engine] Bulk Upsert Error:", err);
                throw new ApiError(500, "Gagal melakukan bulk update forecast.");
            }
        }

        // 6. Safety Stock Calculation (Rolling 4-Month Forecast Average)
        const safetyStockBatch: any[] = [];

        // Group forecasts by product for faster sliding window calculation
        const productForecasts = new Map<number, typeof batch>();
        for (const b of batch) {
            if (!productForecasts.has(b.product_id)) productForecasts.set(b.product_id, []);
            productForecasts.get(b.product_id)!.push(b);
        }

        const windowSize = 4;
        const nowIso = new Date().toISOString();

        for (const p of products) {
            const pBatch = productForecasts.get(p.id) || [];
            if (pBatch.length < windowSize) continue;

            const safetyPct = Number(p.safety_percentage ?? 0);

            // Initial window sum
            let currentSum = 0;
            for (let j = 0; j < windowSize; j++) {
                currentSum += pBatch[j]!.final_forecast;
            }

            // Slide the window
            for (let i = 0; i <= pBatch.length - windowSize; i++) {
                if (i > 0) {
                    currentSum =
                        currentSum -
                        pBatch[i - 1]!.final_forecast +
                        pBatch[i + windowSize - 1]!.final_forecast;
                }

                const avg = currentSum / windowSize;
                safetyStockBatch.push({
                    product_id: p.id,
                    month: pBatch[i]!.month,
                    year: pBatch[i]!.year,
                    horizon: windowSize,
                    avg_forecast: avg,
                    total_forecast: currentSum,
                    safety_stock_quantity: avg * safetyPct,
                    safety_stock_ratio: safetyPct,
                });
            }
        }

        if (safetyStockBatch.length > 0) {
            try {
                const chunkSize = 4000;
                await prisma.$transaction(
                    async (tx) => {
                        for (let i = 0; i < safetyStockBatch.length; i += chunkSize) {
                            const chunk = safetyStockBatch.slice(i, i + chunkSize);
                            const valuesSql = chunk
                                .map(
                                    (s) =>
                                        `(${s.product_id}, ${s.month}, ${s.year}, ${s.horizon}, ${s.avg_forecast}, ${s.total_forecast}, ${s.safety_stock_quantity}, ${s.safety_stock_ratio}, '${nowIso}', '${nowIso}')`,
                                )
                                .join(", ");

                            await tx.$executeRawUnsafe(`
                            INSERT INTO safety_stock (
                                product_id, month, year, horizon, 
                                avg_forecast, total_forecast, 
                                safety_stock_quantity, safety_stock_ratio, 
                                created_at, updated_at
                            )
                            VALUES ${valuesSql}
                            ON CONFLICT (product_id, month, year)
                            DO UPDATE SET
                                horizon = EXCLUDED.horizon,
                                avg_forecast = EXCLUDED.avg_forecast,
                                total_forecast = EXCLUDED.total_forecast,
                                safety_stock_quantity = EXCLUDED.safety_stock_quantity,
                                safety_stock_ratio = EXCLUDED.safety_stock_ratio,
                                updated_at = EXCLUDED.updated_at;
                        `);
                        }
                    },
                    { timeout: 60000 },
                );
                console.log(
                    `[Forecast Engine] Safety Stock Upsert Sukses: ${safetyStockBatch.length} rows`,
                );
            } catch (err) {
                console.error("[Forecast Engine] Safety Stock Batch Error:", err);
            }
        }

        return {
            message: `Forecast berhasil disimpan: ${batch.length} record diproses. Safety Stock: ${safetyStockBatch.length} record.`,
            processed_records: batch.length,
            safety_stock_records: safetyStockBatch.length,
        };
    }
    static async updateManual(body: UpdateManualForecastDTO) {
        const { product_id, month, year, final_forecast, ratio } = body;

        // 1. Load product to check if it's a Display product
        const product = await prisma.product.findUnique({
            where: { id: product_id },
            include: { product_type: true },
        });

        if (!product) throw new ApiError(404, "Produk tidak ditemukan.");

        const tSlug = product?.product_type?.slug?.toLowerCase() || "";
        const isOthersProduct =
            tSlug.includes("display") ||
            tSlug.includes("kertas") ||
            tSlug.includes("botol") ||
            tSlug.includes("paper-bag") ||
            tSlug.includes("kartu-garansi") ||
            tSlug.includes("canvas-bag") ||
            tSlug.includes("box-uk") ||
            tSlug.includes("others");

        if (!isOthersProduct) {
            throw new ApiError(403, "Update manual hanya diizinkan untuk produk Others.");
        }

        // Helper to resolve base_forecast if it doesn't exist
        const getBase = async (m: number, y: number) => {
            const existing = await prisma.forecast.findUnique({
                where: { product_id_month_year: { product_id, month: m, year: y } },
            });
            if (existing) return Number(existing.base_forecast);

            // Fallback to average of 3 previous months' sales
            const AVG_MONTHS = 3;
            const prevPeriods = Array.from({ length: AVG_MONTHS }, (_, i) => {
                const d = new Date(y, m - 1 - (i + 1), 1);
                return { month: d.getMonth() + 1, year: d.getFullYear() };
            });
            const sales = await prisma.$queryRaw<any[]>(Prisma.sql`
                SELECT SUM(month_qty) as quantity
                FROM (
                    SELECT
                        year,
                        month,
                        COALESCE(
                            NULLIF(SUM(CASE WHEN (year * 12 + month) > ${ISSUANCE_THRESHOLD_PERIOD} AND type != 'ALL'::"IssuanceType" THEN quantity ELSE 0 END), 0),
                            SUM(CASE WHEN (year * 12 + month) <= ${ISSUANCE_THRESHOLD_PERIOD} AND type = 'ALL'::"IssuanceType" THEN quantity ELSE 0 END)
                        ) as month_qty
                    FROM product_issuances
                    WHERE product_id = ${product_id}
                      AND (${Prisma.join(
                          prevPeriods.map(
                              (pm) => Prisma.sql`(year = ${pm.year} AND month = ${pm.month})`,
                          ),
                          " OR ",
                      )})
                    GROUP BY year, month
                ) sub
            `);
            return Number(sales[0]?.quantity ?? 0) / AVG_MONTHS;
        };

        const currentBase = await getBase(month, year);

        // New Logic: final_forecast in input is treated as Base Forecast
        let resolvedBase = final_forecast !== undefined ? final_forecast : currentBase;
        let resolvedRatio = ratio !== undefined ? ratio : 0;

        // If it's an existing record and only ratio changed, we might want to keep the existing ratio if ratio was undefined
        // But the DTO usually sends what's in the form.

        let resolvedFinal = resolvedBase * (1 + resolvedRatio / 100);

        const shouldPropagate = isOthersProduct && final_forecast !== undefined;

        if (!shouldPropagate) {
            // SINGLE UPDATE (Non-Display or Display Ratio-only)
            const existing = await prisma.forecast.findUnique({
                where: { product_id_month_year: { product_id, month, year } },
            });

            if (!existing) {
                const pct = await prisma.forecastPercentage.findUnique({
                    where: { month_year: { month, year } },
                });
                await prisma.forecast.create({
                    data: {
                        product_id,
                        month,
                        year,
                        base_forecast: resolvedBase,
                        final_forecast: resolvedFinal,
                        ratio: resolvedRatio,
                        trend: ForecastService.trend(resolvedFinal, resolvedBase),
                        status: "ADJUSTED",
                        forecast_percentage_id: pct?.id ?? 1,
                    },
                });
            } else {
                await prisma.forecast.update({
                    where: { product_id_month_year: { product_id, month, year } },
                    data: {
                        base_forecast: resolvedBase,
                        final_forecast: resolvedFinal,
                        ratio: resolvedRatio,
                        trend: ForecastService.trend(resolvedFinal, resolvedBase),
                        status: "ADJUSTED",
                    },
                });
            }

            // Recalculate Safety Stock for this month
            const windowSize = 4;
            const safetyPct =
                product.safety_percentage && Number(product.safety_percentage) > 0
                    ? Number(product.safety_percentage)
                    : isOthersProduct
                      ? 0.25
                      : 0;

            const avg = resolvedFinal; // Simplified for single update; usually requires window lookup but Display is manual-first

            await prisma.safetyStock.upsert({
                where: { product_id_month_year: { product_id, month, year } },
                create: {
                    product_id,
                    month,
                    year,
                    horizon: windowSize,
                    avg_forecast: avg,
                    total_forecast: avg * windowSize,
                    safety_stock_quantity: avg * safetyPct,
                    safety_stock_ratio: safetyPct,
                },
                update: {
                    avg_forecast: avg,
                    total_forecast: avg * windowSize,
                    safety_stock_quantity: avg * safetyPct,
                    safety_stock_ratio: safetyPct,
                },
            });
        } else {
            // PROPAGATION (Display Base Forecast update)
            const horizon = 12;
            const monthsRange = Array.from({ length: horizon }, (_, i) => {
                const d = new Date(year, month - 1 + i, 1);
                return { month: d.getMonth() + 1, year: d.getFullYear() };
            });

            const percentages = await prisma.forecastPercentage.findMany({
                where: {
                    OR: monthsRange.map((m) => ({ month: m.month, year: m.year })),
                },
            });
            const pctMap = new Map(percentages.map((p) => [`${p.year}-${p.month}`, p]));

            const nowIso = new Date().toISOString();

            // Load existing forecasts to decide which rows to propagate/overwrite
            const existingForecasts = await prisma.forecast.findMany({
                where: {
                    product_id,
                    OR: monthsRange.map((m) => ({ month: m.month, year: m.year })),
                },
            });
            const existingMap = new Map(existingForecasts.map((f) => [`${f.year}-${f.month}`, f]));

            const forecastBatch = monthsRange
                .map((m) => {
                    const pct = pctMap.get(`${m.year}-${m.month}`);
                    const isTargetMonth = m.month === month && m.year === year;
                    const existing = existingMap.get(`${m.year}-${m.month}`);

                    // Rule based on user prompt:
                    // Update only if it's the target month OR future months are "empty/draft" (Initial like behavior)
                    const shouldProcess = isTargetMonth || !existing || existing.status === "DRAFT";

                    if (!shouldProcess) return null;

                    // Ratio is month-specific per user request
                    const mRatio = isTargetMonth ? resolvedRatio : 0;
                    const mFinal = resolvedBase * (1 + mRatio / 100);

                    return {
                        product_id,
                        month: m.month,
                        year: m.year,
                        final_forecast: mFinal,
                        base_forecast: resolvedBase,
                        ratio: mRatio,
                        trend: "STABLE",
                        status: "ADJUSTED",
                        forecast_percentage_id: pct?.id ?? 1,
                    };
                })
                .filter((f): f is Exclude<typeof f, null> => f !== null);

            await prisma.$transaction(
                async (tx) => {
                    const valuesSql = forecastBatch
                        .map(
                            (f) =>
                                `(${f.product_id}, ${f.month}, ${f.year}, '${f.trend}', '${f.status}', ${f.base_forecast}, ${f.final_forecast}, ${f.ratio}, ${f.forecast_percentage_id}, '${nowIso}', '${nowIso}')`,
                        )
                        .join(", ");

                    await tx.$executeRawUnsafe(`
                    INSERT INTO forecasts (
                        product_id, month, year, trend, status, 
                        base_forecast, final_forecast, ratio, forecast_percentage_id, 
                        created_at, updated_at
                    )
                    VALUES ${valuesSql}
                    ON CONFLICT (product_id, month, year)
                    DO UPDATE SET
                        trend = EXCLUDED.trend,
                        status = EXCLUDED.status,
                        base_forecast = EXCLUDED.base_forecast,
                        final_forecast = EXCLUDED.final_forecast,
                        ratio = EXCLUDED.ratio,
                        forecast_percentage_id = EXCLUDED.forecast_percentage_id,
                        updated_at = EXCLUDED.updated_at;
                `);

                    const windowSize = 4;
                    const safetyStockBatch: any[] = [];
                    const safetyPct =
                        product.safety_percentage && Number(product.safety_percentage) > 0
                            ? Number(product.safety_percentage)
                            : isOthersProduct
                              ? 0.25
                              : 0;

                    for (const f of forecastBatch) {
                        const mFinal = f.final_forecast;
                        const avg = mFinal;
                        const totalDemand = mFinal * windowSize;
                        safetyStockBatch.push({
                            product_id,
                            month: f.month,
                            year: f.year,
                            horizon: windowSize,
                            avg_forecast: avg,
                            total_forecast: totalDemand,
                            safety_stock_quantity: avg * safetyPct,
                            safety_stock_ratio: safetyPct,
                        });
                    }

                    if (safetyStockBatch.length > 0) {
                        const ssSql = safetyStockBatch
                            .map(
                                (s) =>
                                    `(${s.product_id}, ${s.month}, ${s.year}, ${s.horizon}, ${s.avg_forecast}, ${s.total_forecast}, ${s.safety_stock_quantity}, ${s.safety_stock_ratio}, '${nowIso}', '${nowIso}')`,
                            )
                            .join(", ");

                        await tx.$executeRawUnsafe(`
                        INSERT INTO safety_stock (
                            product_id, month, year, horizon, 
                            avg_forecast, total_forecast, 
                            safety_stock_quantity, safety_stock_ratio, 
                            created_at, updated_at
                        )
                        VALUES ${ssSql}
                        ON CONFLICT (product_id, month, year)
                        DO UPDATE SET
                            horizon = EXCLUDED.horizon,
                            avg_forecast = EXCLUDED.avg_forecast,
                            total_forecast = EXCLUDED.total_forecast,
                            safety_stock_quantity = EXCLUDED.safety_stock_quantity,
                            safety_stock_ratio = EXCLUDED.safety_stock_ratio,
                            updated_at = EXCLUDED.updated_at;
                    `);
                    }
                },
                { timeout: 30000 },
            );
        }

        return { message: "Forecast berhasil diperbarui secara manual." };
    }

    // ─── GET ──────────────────────────────────────────────────────────────────────
    static async get(
        query: QueryForecastDTO,
    ): Promise<{ data: ResponseForecastDTO[]; len: number }> {
        const now = new Date();
        const monthsWindow = ForecastService.resolveHorizonMonths(now, query.horizon ?? 12, {
            month: query.start_month,
            year: query.start_year,
        });

        const page = query.page ?? 1;
        const take = query.take ?? 25;
        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.ProductWhereInput = {
            status: "ACTIVE",
            deleted_at: null,
            ...(query.is_others
                ? {
                      OR: [
                          { product_type: { slug: { contains: "display", mode: "insensitive" } } },
                          { product_type: { slug: { contains: "kertas", mode: "insensitive" } } },
                          { product_type: { slug: { contains: "botol", mode: "insensitive" } } },
                          {
                              product_type: {
                                  slug: { contains: "paper-bag", mode: "insensitive" },
                              },
                          },
                          {
                              product_type: {
                                  slug: { contains: "kartu-garansi", mode: "insensitive" },
                              },
                          },
                          {
                              product_type: {
                                  slug: { contains: "canvas-bag", mode: "insensitive" },
                              },
                          },
                           {
                               product_type: {
                                   slug: { contains: "box-uk", mode: "insensitive" },
                               },
                           },
                           {
                               product_type: {
                                   slug: { contains: "others", mode: "insensitive" },
                               },
                           },
                       ],
                   }
                 : {
                       NOT: [
                           { product_type: { slug: { contains: "display", mode: "insensitive" } } },
                           { product_type: { slug: { contains: "kertas", mode: "insensitive" } } },
                           { product_type: { slug: { contains: "botol", mode: "insensitive" } } },
                           {
                               product_type: {
                                   slug: { contains: "paper-bag", mode: "insensitive" },
                               },
                           },
                           {
                               product_type: {
                                   slug: { contains: "kartu-garansi", mode: "insensitive" },
                               },
                           },
                           {
                               product_type: {
                                   slug: { contains: "canvas-bag", mode: "insensitive" },
                               },
                           },
                           {
                               product_type: {
                                   slug: { contains: "box-uk", mode: "insensitive" },
                               },
                           },
                           {
                               product_type: {
                                   slug: { contains: "others", mode: "insensitive" },
                               },
                           },
                       ],
                   }),
            ...(query.type_id && { type_id: query.type_id }),
            ...(query.size_id && { size_id: query.size_id }),
            ...(query.search && {
                OR: [
                    { name: { contains: query.search, mode: "insensitive" } },
                    { code: { contains: query.search, mode: "insensitive" } },
                    { product_type: { name: { contains: query.search, mode: "insensitive" } } },
                ],
            }),
        };

        const len = await prisma.product.count({ where });
        if (len === 0) return { data: [], len };

        const startYear = monthsWindow[0]!.year;
        const startMonth = monthsWindow[0]!.month;
        const endYear = monthsWindow[monthsWindow.length - 1]!.year;
        const endMonth = monthsWindow[monthsWindow.length - 1]!.month;
        const searchRaw = query.search ? `%${query.search}%` : null;

        const AVG_MONTHS = 3;
        const prevMonths = Array.from({ length: AVG_MONTHS }, (_, i) => {
            const d = new Date(startYear, startMonth - 1 - (AVG_MONTHS - i), 1);
            return { month: d.getMonth() + 1, year: d.getFullYear() };
        });

        const rangePercentages = await prisma.forecastPercentage.findMany({
            where: {
                OR: monthsWindow.map((m) => ({ month: m.month, year: m.year })),
            },
        });
        const pctMap = new Map(rangePercentages.map((p) => [`${p.year}-${p.month}`, p]));

        const productsRaw = await prisma.$queryRaw<
            {
                id: number;
                code: string | null;
                name: string;
                z_value: number;
                size: number | null;
                size_id: number | null;
                product_type_name: string | null;
                unit_name: string | null;
                distribution_percentage: number | null;
                reference_distribution_percentage: number | null;
                safety_percentage: number | null;
                forecasts_data: string | null;
                safety_stock_data: string | null;
                historical_sales_data: string | null;
                stock_by_warehouse_data: string | null;
                current_stock: number | null;
            }[]
        >`
            SELECT
                p.id,
                p.code,
                p.name,
                p.z_value,
                ps.size            AS "size",
                p.size_id          AS "size_id",
                pt.name            AS "product_type_name",
                u.name             AS "unit_name",
                p.distribution_percentage,
                p.reference_distribution_percentage,
                p.safety_percentage,
                COALESCE(pi.quantity, 0)::float8 AS "current_stock",

                -- Group Sorting Priority: Base on the max final_forecast of the group in M1
                MAX(COALESCE(f_m1.final_forecast, 0)) OVER(PARTITION BY p.name) as group_sort_priority,
                COALESCE(f_m1.final_forecast, 0) as m1_final_forecast,

                (
                    SELECT COALESCE(json_agg(
                        json_build_object(
                            'month',          f.month,
                            'year',           f.year,
                            'base_forecast',  f.base_forecast,
                            'final_forecast', f.final_forecast,
                            'trend',          f.trend,
                            'status',         f.status,
                            'ratio',          f.ratio
                        ) ORDER BY f.year ASC, f.month ASC
                    ), '[]'::json)
                    FROM "forecasts" f
                    WHERE f.product_id = p.id
                      AND (f.year * 12 + f.month) >= ${startYear * 12 + startMonth}
                      AND (f.year * 12 + f.month) <= ${endYear * 12 + endMonth}
                ) AS "forecasts_data",

                (
                    SELECT COALESCE(json_agg(
                        json_build_object(
                            'month',          sub.month,
                            'year',           sub.year,
                            'quantity',       sub.qty
                        ) ORDER BY sub.year ASC, sub.month ASC
                    ), '[]'::json)
                    FROM (
                        SELECT year, month, 
                            COALESCE(
                                NULLIF(SUM(CASE WHEN (year * 12 + month) > ${ISSUANCE_THRESHOLD_PERIOD} AND type != 'ALL'::"IssuanceType" THEN quantity ELSE 0 END), 0),
                                SUM(CASE WHEN (year * 12 + month) <= ${ISSUANCE_THRESHOLD_PERIOD} AND type = 'ALL'::"IssuanceType" THEN quantity ELSE 0 END)
                            ) as qty
                        FROM product_issuances
                        WHERE product_id = p.id
                          AND (${Prisma.join(
                              prevMonths.map(
                                  (pm) => Prisma.sql`(year = ${pm.year} AND month = ${pm.month})`,
                              ),
                              " OR ",
                          )})
                        GROUP BY year, month
                    ) sub
                ) AS "historical_sales_data",

                (
                    SELECT row_to_json(ss)
                    FROM (
                        SELECT
                            safety_stock_quantity,
                            safety_stock_ratio,
                            avg_forecast,
                            total_forecast,
                            created_at
                        FROM "safety_stock"
                        WHERE product_id = p.id
                        ORDER BY created_at DESC
                        LIMIT 1
                    ) ss
                ) AS "safety_stock_data",

                (
                    SELECT COALESCE(json_agg(
                        json_build_object(
                            'warehouse_id',   w.id,
                            'warehouse_name', w.name,
                            'stock',          COALESCE(stk.qty, 0)::float8
                        ) ORDER BY w.name ASC
                    ), '[]'::json)
                    FROM "warehouses" w
                    LEFT JOIN (
                        SELECT warehouse_id, SUM(quantity)::float8 AS qty
                        FROM product_inventories
                        WHERE product_id = p.id
                          AND month = ${startMonth} AND year = ${startYear}
                        GROUP BY warehouse_id
                    ) stk ON stk.warehouse_id = w.id
                    WHERE w.type = 'FINISH_GOODS' AND w.deleted_at IS NULL
                ) AS "stock_by_warehouse_data"

            FROM "products" p
            LEFT JOIN "product_types"     pt ON pt.id = p.type_id
            LEFT JOIN "unit_of_materials" u  ON u.id  = p.unit_id
            LEFT JOIN "product_size"      ps ON ps.id = p.size_id
            -- Join specific M1 forecast for sorting
            LEFT JOIN "forecasts" f_m1 ON f_m1.product_id = p.id AND f_m1.month = ${startMonth} AND f_m1.year = ${startYear}
            -- Join Current Stock for M1 from all FINISH_GOODS Warehouses
            LEFT JOIN (
                SELECT pi.product_id, SUM(pi.quantity) as quantity
                FROM product_inventories pi
                JOIN warehouses w ON w.id = pi.warehouse_id
                WHERE pi.month = ${startMonth} 
                  AND pi.year = ${startYear}
                  AND w.type = 'FINISH_GOODS'
                  AND w.deleted_at IS NULL
                GROUP BY pi.product_id
            ) pi ON p.id = pi.product_id
            WHERE p.status = 'ACTIVE'
              AND p.deleted_at IS NULL
              AND (
                ${
                    query.is_others
                        ? Prisma.sql`pt.slug ILIKE '%display%' OR pt.slug ILIKE '%kertas%' OR pt.slug ILIKE '%botol%' OR pt.slug ILIKE '%paper-bag%' OR pt.slug ILIKE '%kartu-garansi%' OR pt.slug ILIKE '%canvas-bag%' OR pt.slug ILIKE '%box-uk%' OR pt.slug ILIKE '%others%'`
                        : Prisma.sql`pt.slug IS NULL OR (pt.slug NOT ILIKE '%display%' AND pt.slug NOT ILIKE '%kertas%' AND pt.slug NOT ILIKE '%botol%' AND pt.slug NOT ILIKE '%paper-bag%' AND pt.slug NOT ILIKE '%kartu-garansi%' AND pt.slug NOT ILIKE '%canvas-bag%' AND pt.slug NOT ILIKE '%box-uk%' AND pt.slug NOT ILIKE '%others%')`
                }
              )
            ${searchRaw ? Prisma.sql`AND (p.name ILIKE ${searchRaw} OR p.code ILIKE ${searchRaw} OR pt.name ILIKE ${searchRaw})` : Prisma.empty}
            ${query.type_id ? Prisma.sql`AND p.type_id = ${query.type_id}` : Prisma.empty}
            ${query.size_id ? Prisma.sql`AND p.size_id = ${query.size_id}` : Prisma.empty}
            ORDER BY 
                ${
                    query.is_others
                        ? Prisma.sql`
                        CASE 
                            WHEN pt.slug ILIKE '%display%' AND pt.slug NOT ILIKE '%tester%' THEN 1
                            WHEN pt.slug ILIKE '%tester%' THEN 2
                            ELSE 3
                        END ASC,
                        p.name ASC, 
                        p.id ASC
                    `
                        : Prisma.sql`
                        group_sort_priority DESC,
                        p.name ASC, 
                        CASE 
                            WHEN pt.name ILIKE '%EDP%' OR pt.name ILIKE '%Parfum%' OR pt.name ILIKE '%Perfume%' THEN 1
                            WHEN pt.name ILIKE '%Atomizer%' THEN 2
                            ELSE 3
                        END ASC,
                        ps.size DESC NULLS LAST,
                        CASE 
                            WHEN pt.name ILIKE '%EDP%' THEN 1
                            WHEN pt.name ILIKE '%Parfum%' OR pt.name ILIKE '%Perfume%' THEN 2
                            ELSE 3
                        END ASC,
                        p.id ASC
                    `
                }
            LIMIT ${limit} OFFSET ${skip}
        `;

        // EDAR vs AVG ACT: pair sales share dirata-rata atas window `horizon` bulan
        // ACT terakhir sebelum bulan mulai (per bulan dihitung ACT%, lalu di-AVG —
        // konsisten dengan kolom AVG halaman EDAR vs ACT). Members are fetched
        // in a second query (ignoring type/size/search filters and pagination) so the
        // pair total stays correct when a member falls outside the current page/filter.
        const lastActMonth = prevMonths[prevMonths.length - 1]!;
        const actWindow = Array.from({ length: monthsWindow.length }, (_, i) => {
            const d = new Date(startYear, startMonth - 1 - (monthsWindow.length - i), 1);
            return { month: d.getMonth() + 1, year: d.getFullYear() };
        });
        const actWindowKeys = actWindow.map((m) => m.year * 12 + m.month);
        const edarGroups = Array.from(
            new Map(
                productsRaw
                    .filter((p) => Number(p.distribution_percentage ?? 0) > 0)
                    .map((p) => [
                        `${p.name}|${p.size_id ?? "null"}`,
                        { name: p.name, size_id: p.size_id },
                    ]),
            ).values(),
        );

        const pairMap = new Map<
            string,
            {
                id: number;
                code: string | null;
                name: string;
                size_id: number | null;
                product_type_name: string | null;
                distribution_percentage: number;
                salesByMonth: Map<number, number>;
            }[]
        >();
        if (edarGroups.length > 0) {
            const pairRows = await prisma.$queryRaw<
                {
                    id: number;
                    code: string | null;
                    name: string;
                    size_id: number | null;
                    product_type_name: string | null;
                    distribution_percentage: number;
                    year: number | null;
                    month: number | null;
                    sales: number | null;
                }[]
            >`
                SELECT
                    p.id,
                    p.code,
                    p.name,
                    p.size_id,
                    pt.name AS "product_type_name",
                    p.distribution_percentage::float8 AS "distribution_percentage",
                    iss.year,
                    iss.month,
                    COALESCE(
                        NULLIF(SUM(CASE WHEN (iss.year * 12 + iss.month) > ${ISSUANCE_THRESHOLD_PERIOD} AND iss.type != 'ALL'::"IssuanceType" THEN iss.quantity ELSE 0 END), 0),
                        SUM(CASE WHEN (iss.year * 12 + iss.month) <= ${ISSUANCE_THRESHOLD_PERIOD} AND iss.type = 'ALL'::"IssuanceType" THEN iss.quantity ELSE 0 END)
                    )::float8 AS "sales"
                FROM "products" p
                LEFT JOIN "product_types" pt ON pt.id = p.type_id
                LEFT JOIN "product_issuances" iss
                    ON iss.product_id = p.id
                   AND (iss.year * 12 + iss.month) IN (${Prisma.join(actWindowKeys)})
                WHERE p.status = 'ACTIVE'
                  AND p.deleted_at IS NULL
                  AND p.distribution_percentage > 0
                  AND (${Prisma.join(
                      edarGroups.map((g) =>
                          g.size_id == null
                              ? Prisma.sql`(p.name = ${g.name} AND p.size_id IS NULL)`
                              : Prisma.sql`(p.name = ${g.name} AND p.size_id = ${g.size_id})`,
                      ),
                      " OR ",
                  )})
                GROUP BY p.id, p.code, p.name, p.size_id, pt.name, p.distribution_percentage, iss.year, iss.month
            `;
            for (const r of pairRows) {
                const key = `${r.name}|${r.size_id ?? "null"}`;
                let list = pairMap.get(key);
                if (!list) {
                    list = [];
                    pairMap.set(key, list);
                }
                let member = list.find((m) => m.id === r.id);
                if (!member) {
                    member = {
                        id: r.id,
                        code: r.code,
                        name: r.name,
                        size_id: r.size_id,
                        product_type_name: r.product_type_name,
                        distribution_percentage: r.distribution_percentage,
                        salesByMonth: new Map(),
                    };
                    list.push(member);
                }
                if (r.year != null && r.month != null) {
                    member.salesByMonth.set(r.year * 12 + r.month, Number(r.sales ?? 0));
                }
            }
        }

        const data: ResponseForecastDTO[] = productsRaw.map((p) => {
            const rawForecasts: {
                month: number;
                year: number;
                base_forecast: string;
                final_forecast: string | null;
                trend: string;
                status: string;
                ratio: string | null;
            }[] =
                typeof p.forecasts_data === "string"
                    ? JSON.parse(p.forecasts_data)
                    : (p.forecasts_data ?? []);

            const rawHistorical: { month: number; year: number; quantity: number }[] =
                typeof p.historical_sales_data === "string"
                    ? JSON.parse(p.historical_sales_data)
                    : (p.historical_sales_data ?? []);

            const stock_by_warehouse: ResponseForecastDTO["stock_by_warehouse"] = (() => {
                const raw =
                    typeof p.stock_by_warehouse_data === "string"
                        ? JSON.parse(p.stock_by_warehouse_data)
                        : (p.stock_by_warehouse_data ?? []);
                if (!Array.isArray(raw)) return [];
                return raw.map((w: any) => ({
                    warehouse_id: Number(w.warehouse_id),
                    warehouse_name: String(w.warehouse_name ?? ""),
                    stock: Number(w.stock ?? 0),
                }));
            })();

            const historicalByKey = new Map<
                string,
                { month: number; year: number; quantity: number }
            >(rawHistorical.map((h) => [`${h.year}-${h.month}`, h]));
            const historical_sales = prevMonths.map((pm) => {
                const found = historicalByKey.get(`${pm.year}-${pm.month}`);
                return {
                    month: pm.month,
                    year: pm.year,
                    period: `${pm.month}/${pm.year}`,
                    quantity: Number(found?.quantity ?? 0),
                };
            });

            const forecastByKey = new Map(rawForecasts.map((f) => [`${f.year}-${f.month}`, f]));

            const monthly_data: ResponseForecastDTO["monthly_data"] = monthsWindow.map((m) => {
                const forecast = forecastByKey.get(`${m.year}-${m.month}`);
                return {
                    month: m.month,
                    year: m.year,
                    period: `${m.month}/${m.year}`,
                    base_forecast: Number(forecast?.base_forecast ?? 0),
                    final_forecast:
                        forecast?.final_forecast != null ? Number(forecast.final_forecast) : null,
                    trend: forecast?.trend ?? "STABLE",
                    status: forecast?.status ?? null,
                    is_current_month: m.is_current_month,
                    is_actionable: !forecast || forecast.status !== "FINALIZED",
                    ratio: forecast?.ratio != null ? Number(forecast.ratio) : 0,
                    percentage_value: query.is_others
                        ? forecast?.ratio != null
                            ? Number(forecast.ratio)
                            : 0
                        : pctMap.has(`${m.year}-${m.month}`)
                          ? Number(
                                (Number(pctMap.get(`${m.year}-${m.month}`)!.value) * 100).toFixed(
                                    2,
                                ),
                            )
                          : null,
                };
            });

            const ss =
                typeof p.safety_stock_data === "string"
                    ? JSON.parse(p.safety_stock_data)
                    : p.safety_stock_data;

            const FIXED_SS_MONTHS = 4;
            let safety_stock_summary = null;

            // Safety Stock always uses fixed 4-month average (M+0..M+3), independent of horizon
            const ssMonths = monthly_data.slice(0, FIXED_SS_MONTHS);
            const total = ssMonths.reduce((acc, m) => acc + (m.final_forecast ?? 0), 0);
            const avg = total / FIXED_SS_MONTHS;

            // If safety_percentage is missing and it's an "others" product, use 25% (0.25)
            const ratio =
                p.safety_percentage && Number(p.safety_percentage) > 0
                    ? Number(p.safety_percentage)
                    : query.is_others
                      ? 0.25
                      : 0;

            const safetyQ = avg * ratio;

            safety_stock_summary = {
                safety_stock_quantity: safetyQ,
                safety_stock_ratio: Number((ratio * 100).toFixed(2)),
                avg_forecast: avg,
                total_forecast: total,
                total_demand: total + safetyQ,
                last_updated: ss?.created_at ? new Date(ss.created_at) : null,
            };

            // Calculate Need Produce for M1: Forecast M1 - Current Stock
            const m1MonthData = monthly_data.find(
                (m) => m.month === startMonth && m.year === startYear,
            );
            const m1Forecast = m1MonthData?.final_forecast ?? 0;
            const currentStock = Number(p.current_stock ?? 0);
            const needProduce = Math.max(0, m1Forecast - currentStock);

            const edar_sales_share: ResponseForecastDTO["edar_sales_share"] = (() => {
                if (Number(p.distribution_percentage ?? 0) <= 0) return null;
                const members = pairMap.get(`${p.name}|${p.size_id ?? "null"}`) ?? [];

                // Per bulan window: ACT% = sales member / total pasangan bulan itu.
                // AVG hanya atas bulan yang punya sales pasangan (> 0), lalu
                // dibulatkan 1 desimal — konsisten kolom AVG halaman EDAR vs ACT.
                const pctSums = new Map<number, { sum: number; count: number }>();
                let monthsCounted = 0;
                for (const key of actWindowKeys) {
                    const pairTotal = members.reduce(
                        (s, m) => s + (m.salesByMonth.get(key) ?? 0),
                        0,
                    );
                    if (pairTotal <= 0) continue;
                    monthsCounted++;
                    for (const m of members) {
                        const share = ((m.salesByMonth.get(key) ?? 0) / pairTotal) * 100;
                        const acc = pctSums.get(m.id) ?? { sum: 0, count: 0 };
                        acc.sum += share;
                        acc.count++;
                        pctSums.set(m.id, acc);
                    }
                }
                const avgPct = (id: number) => {
                    const acc = pctSums.get(id);
                    if (!acc || acc.count === 0) return null;
                    return Math.round((acc.sum / acc.count) * 10) / 10;
                };
                const totalSales = (m: (typeof members)[number]) =>
                    Array.from(m.salesByMonth.values()).reduce((s, v) => s + v, 0);

                const own = members.find((m) => m.id === p.id);
                return {
                    month: lastActMonth.month,
                    year: lastActMonth.year,
                    months_counted: monthsCounted,
                    own_sales: own ? totalSales(own) : 0,
                    pair_total_sales: members.reduce((s, m) => s + totalSales(m), 0),
                    actual_pct: own ? avgPct(own.id) : null,
                    members: members.map((m) => ({
                        product_id: m.id,
                        product_code: m.code,
                        product_type: m.product_type_name ?? "",
                        edar_pct: Number((Number(m.distribution_percentage) * 100).toFixed(2)),
                        sales: totalSales(m),
                        actual_pct: avgPct(m.id),
                    })),
                };
            })();

            return {
                product_id: p.id,
                product_code: p.code,
                product_name: p.name,
                product_type: p.product_type_name ?? "",
                product_size: `${p.size ?? ""} ML`.trim(),
                z_value: Number(p.z_value ?? 0),
                distribution_percentage: p.distribution_percentage
                    ? Number((Number(p.distribution_percentage) * 100).toFixed(2))
                    : 0,
                reference_distribution_percentage:
                    p.reference_distribution_percentage != null
                        ? Number((Number(p.reference_distribution_percentage) * 100).toFixed(2))
                        : null,
                safety_percentage:
                    p.safety_percentage && Number(p.safety_percentage) > 0
                        ? Number((Number(p.safety_percentage) * 100).toFixed(2))
                        : query.is_others
                          ? 25
                          : 0,
                current_stock: currentStock,
                stock_by_warehouse,
                need_produce: needProduce,
                edar_sales_share,
                historical_sales,
                monthly_data,
                safety_stock_summary,
            };
        });

        return { data, len };
    }
    private static resolveHorizonMonths(
        now: Date,
        horizon: number,
        startOverride?: { month?: number; year?: number },
    ) {
        const startYear = startOverride?.year ?? now.getUTCFullYear();
        const startMonth = startOverride?.month ?? now.getUTCMonth() + 1;
        const todayYear = now.getUTCFullYear();
        const todayMonth = now.getUTCMonth() + 1;
        return Array.from({ length: horizon }, (_, i) => {
            const d = new Date(Date.UTC(startYear, startMonth - 1 + i, 1));
            const y = d.getUTCFullYear();
            const m = d.getUTCMonth() + 1;
            return {
                year: y,
                month: m,
                is_current_month: y === todayYear && m === todayMonth,
            };
        });
    }
    private static getAromaBaseName(name?: string): string {
        return (name || "")
            .replace(/^hampers\s+/i, "")
            .trim()
            .toUpperCase();
    }

    private static async loadVariantsByProductId(
        product_id: number,
        is_others?: boolean,
    ): Promise<SelectedProduct[]> {
        const target = await prisma.product.findUnique({
            where: { id: product_id },
            select: { name: true },
        });
        if (!target) throw new ApiError(404, "Produk tidak ditemukan.");

        const baseName = ForecastService.getAromaBaseName(target.name);

        const variations = await prisma.product.findMany({
            where: {
                status: "ACTIVE",
                deleted_at: null,
                AND: [
                    {
                        OR: [
                            { name: { equals: baseName, mode: "insensitive" } },
                            { name: { startsWith: `HAMPERS ${baseName}`, mode: "insensitive" } },
                        ],
                    },
                    is_others
                        ? {
                              OR: [
                                  {
                                      product_type: {
                                          slug: { contains: "display", mode: "insensitive" },
                                      },
                                  },
                                  {
                                      product_type: {
                                          slug: { contains: "kertas", mode: "insensitive" },
                                      },
                                  },
                                  {
                                      product_type: {
                                          slug: { contains: "botol", mode: "insensitive" },
                                      },
                                  },
                                  {
                                      product_type: {
                                          slug: { contains: "paper-bag", mode: "insensitive" },
                                      },
                                  },
                                  {
                                      product_type: {
                                          slug: { contains: "kartu-garansi", mode: "insensitive" },
                                      },
                                  },
                                  {
                                      product_type: {
                                          slug: { contains: "canvas-bag", mode: "insensitive" },
                                      },
                                  },
                                  {
                                      product_type: {
                                          slug: { contains: "box-uk", mode: "insensitive" },
                                      },
                                  },
                                  {
                                      product_type: {
                                          slug: { contains: "others", mode: "insensitive" },
                                      },
                                  },
                              ],
                          }
                        : {
                              NOT: [
                                  {
                                      product_type: {
                                          slug: { contains: "display", mode: "insensitive" },
                                      },
                                  },
                                  {
                                      product_type: {
                                          slug: { contains: "kertas", mode: "insensitive" },
                                      },
                                  },
                                  {
                                      product_type: {
                                          slug: { contains: "botol", mode: "insensitive" },
                                      },
                                  },
                                  {
                                      product_type: {
                                          slug: { contains: "paper-bag", mode: "insensitive" },
                                      },
                                  },
                                  {
                                      product_type: {
                                          slug: { contains: "kartu-garansi", mode: "insensitive" },
                                      },
                                  },
                                  {
                                      product_type: {
                                          slug: { contains: "canvas-bag", mode: "insensitive" },
                                      },
                                  },
                                  {
                                      product_type: {
                                          slug: { contains: "box-uk", mode: "insensitive" },
                                      },
                                  },
                                  {
                                      product_type: {
                                          slug: { contains: "others", mode: "insensitive" },
                                      },
                                  },
                              ],
                          },
                ],
            },
            select: PRODUCT_SELECT,
        });

        if (variations.length === 0) {
            throw new ApiError(
                404,
                `Tidak ada variasi produk aktif ditemukan untuk "${target.name}".`,
            );
        }

        return variations;
    }
    static async detail(product_id: number, month: number, year: number) {
        if (!month || !year) throw new ApiError(400, "Bulan dan tahun wajib diisi");

        const row = await prisma.forecast.findUnique({
            where: { product_id_month_year: { product_id, month, year } },
        });

        if (!row) throw new ApiError(404, "Data forecast tidak ditemukan");

        return {
            product_id: row.product_id,
            month: row.month,
            year: row.year,
            base_forecast: Number(row.base_forecast),
            final_forecast: row.final_forecast != null ? Number(row.final_forecast) : null,
            trend: row.trend,
            status: row.status,
        };
    }

    static async finalize(data: FinalizeForecastDTO) {
        const result = await prisma.forecast.updateMany({
            where: { month: data.month, year: data.year, status: "DRAFT" },
            data: { status: "FINALIZED" },
        });
        if (result.count === 0) throw new ApiError(400, "Tidak ada data DRAFT untuk periode ini");
        return { count: result.count };
    }

    static async deleteByPeriod(data: DeleteForecastByPeriodDTO) {
        const result = await prisma.forecast.deleteMany({
            where: { month: data.month, year: data.year },
        });
        if (result.count === 0)
            throw new ApiError(400, "Tidak ada data forecast untuk dihapus pada periode ini");
        return { count: result.count };
    }

    static async resetByProduct(product_id: number) {
        return await prisma.$transaction(async (tx) => {
            const f = await tx.forecast.deleteMany({ where: { product_id } });
            const s = await tx.safetyStock.deleteMany({ where: { product_id } });
            return { forecast: f.count, safety_stock: s.count };
        });
    }

    static async destroyById(id: number) {
        try {
            await prisma.forecast.delete({ where: { id } });
        } catch (err: any) {
            if (err?.code === "P2025") throw new ApiError(404, "Data forecast tidak ditemukan");
            throw err;
        }
    }

    static async compare(query: CompareForecastDTO) {
        const { start_month, start_year, horizon = 12 } = query;

        const monthsRange = Array.from({ length: horizon }, (_, i) => {
            const date = new Date(start_year, start_month - 1 + i, 1);
            return { month: date.getMonth() + 1, year: date.getFullYear() };
        });

        const percentages = await prisma.forecastPercentage.findMany({
            where: { OR: monthsRange.map((m) => ({ month: m.month, year: m.year })) },
        });
        if (percentages.length === 0) {
            throw new ApiError(
                404,
                `Data persentase forecast untuk periode ${start_month}/${start_year} belum diatur.`,
            );
        }
        const pctMap = new Map(percentages.map((p) => [`${p.year}-${p.month}`, p]));

        const products = await prisma.product.findMany({
            where: { status: "ACTIVE", deleted_at: null, NOT: OTHERS_TYPE_NOT },
            select: COMPARE_PRODUCT_SELECT,
        });
        if (products.length === 0) throw new ApiError(404, "Tidak ada produk aktif ditemukan.");

        const inputMap = await ForecastService.loadBaseSalesInput(
            products.map((p) => p.id),
            start_month,
            start_year,
        );

        const common = { products, monthsRange, pctMap, inputMap, is_others: false } as const;
        const edarBatch = ForecastService.computeForecastBatch({
            ...common,
            distField: "distribution_percentage",
        });
        const acuanBatch = ForecastService.computeForecastBatch({
            ...common,
            distField: "reference_distribution_percentage",
        });

        const acuanMap = new Map(acuanBatch.map((r) => [`${r.product_id}-${r.year}-${r.month}`, r]));
        const byProduct = new Map<number, ForecastBatchRow[]>();
        for (const r of edarBatch) {
            if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
            byProduct.get(r.product_id)!.push(r);
        }

        const data = products
            .map((p) => {
                const rows = byProduct.get(p.id) ?? [];
                const monthly = rows.map((r) => {
                    const a = acuanMap.get(`${r.product_id}-${r.year}-${r.month}`);
                    const final_acuan = a?.final_forecast ?? 0;
                    const delta = final_acuan - r.final_forecast;
                    return {
                        month: r.month,
                        year: r.year,
                        final_edar: r.final_forecast,
                        final_acuan,
                        delta,
                        delta_pct:
                            r.final_forecast !== 0
                                ? Number(((delta / r.final_forecast) * 100).toFixed(2))
                                : null,
                    };
                });
                const total_edar = monthly.reduce((s, m) => s + m.final_edar, 0);
                const total_acuan = monthly.reduce((s, m) => s + m.final_acuan, 0);
                const total_delta = total_acuan - total_edar;
                return {
                    product_id: p.id,
                    product_code: p.code,
                    product_name: p.name,
                    product_type: p.product_type?.slug ?? null,
                    product_size: p.size?.size ?? null,
                    edar_pct:
                        p.distribution_percentage != null
                            ? Number((Number(p.distribution_percentage) * 100).toFixed(2))
                            : null,
                    acuan_pct:
                        p.reference_distribution_percentage != null
                            ? Number((Number(p.reference_distribution_percentage) * 100).toFixed(2))
                            : null,
                    monthly,
                    total_edar,
                    total_acuan,
                    total_delta,
                    total_delta_pct:
                        total_edar !== 0 ? Number(((total_delta / total_edar) * 100).toFixed(2)) : null,
                };
            })
            .filter((d) => d.monthly.length > 0)
            .sort((a, b) => b.total_edar - a.total_edar);

        return { period: { start_month, start_year, horizon }, data };
    }

    private static trend(forecast: number, input: number): "UP" | "DOWN" | "STABLE" {
        if (forecast > input) return "UP";
        if (forecast < input) return "DOWN";
        return "STABLE";
    }
}
