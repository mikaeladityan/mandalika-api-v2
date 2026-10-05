import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../generated/prisma/client.js";
import { ForecastService, type SelectedProduct, type ForecastBatchRow } from "../../module/application/forecast/forecast.service.js";

const mocks = vi.hoisted(() => ({
    findMany: vi.fn(), findUnique: vi.fn(), percentages: vi.fn(),
    query: vi.fn(), execute: vi.fn(), transaction: vi.fn(),
    forecastUnique: vi.fn(), forecastFirst: vi.fn(), forecasts: vi.fn(),
    forecastUpdate: vi.fn(), safetyUpsert: vi.fn(),
}));
vi.mock("../../config/prisma.js", () => ({
    default: {
        product: { findMany: mocks.findMany, findUnique: mocks.findUnique },
        forecastPercentage: { findMany: mocks.percentages },
        forecast: { findUnique: mocks.forecastUnique, findFirst: mocks.forecastFirst,
            findMany: mocks.forecasts, update: mocks.forecastUpdate },
        safetyStock: { upsert: mocks.safetyUpsert },
        $queryRaw: mocks.query, $transaction: mocks.transaction,
    },
}));

const product = (id: number, code: string, slug: string, size: number, edar: number, acuan = edar): SelectedProduct & { code: string } => ({
    id, code, name: "GORGEOUS TUBEROSE", status: "ACTIVE",
    product_type: { slug }, size: { size },
    distribution_percentage: new Prisma.Decimal(edar),
    reference_distribution_percentage: new Prisma.Decimal(acuan),
    safety_percentage: new Prisma.Decimal(0.25),
});
const products = [
    product(1, "A10M-GOR", "atomizer", 10, 0),
    product(2, "PW110E-GOR", "edp", 110, 0.6, 0.5),
    product(3, "PW110P-GOR", "parfume-intense", 110, 0.4, 0.5),
    product(4, "V2E-GOR", "edp", 2, 0.7, 0.2),
    product(5, "V2P-GOR", "parfume-intense", 2, 0.3, 0.8),
];
const issuance = [
    { product_id: 1, total_quantity: 27_000 },
    { product_id: 2, total_quantity: 1_800 },
    { product_id: 3, total_quantity: 1_200 },
    { product_id: 4, total_quantity: 420 },
    { product_id: 5, total_quantity: 180 },
];
const period = { start_month: 1, start_year: 2026, horizon: 2 };

beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-15T03:00:00Z"));
    mocks.findMany.mockResolvedValue(products);
    mocks.findUnique.mockResolvedValue({ name: "GORGEOUS TUBEROSE" });
    mocks.percentages.mockResolvedValue([
        { id: 1, month: 1, year: 2026, value: new Prisma.Decimal(0.1) },
        { id: 2, month: 2, year: 2026, value: new Prisma.Decimal(0.1) },
    ]);
    mocks.execute.mockResolvedValue(1);
    mocks.transaction.mockImplementation(async (callback: (tx: { $executeRawUnsafe: typeof mocks.execute }) => Promise<void>) => {
        await callback({ $executeRawUnsafe: mocks.execute });
    });
});

afterEach(() => vi.useRealTimers());

describe("Forecast issuance pipeline", () => {
    it.each([undefined, 4])("runs the new formula for all products or a selected Vial (%s) before allocating stock and saving", async (product_id) => {
        mocks.query.mockResolvedValueOnce(issuance).mockResolvedValueOnce([
            { product_id: 1, quantity: 2_000 },
            { product_id: 2, quantity: 800 },
            { product_id: 4, quantity: 200 },
        ]);
        const allocation = vi.spyOn(ForecastService, "applyOpeningStockToForecastBatch");
        const result = await ForecastService.run({ ...period, product_id, is_others: false });

        expect(result.processed_records).toBe(10);
        expect(result.safety_stock_records).toBe(5);
        expect(allocation).toHaveBeenCalledOnce();
        const gross = allocation.mock.calls[0]![0];
        const m1 = gross.filter((row) => row.month === 1).map((row) => row.final_forecast);
        const m2 = gross.filter((row) => row.month === 2).map((row) => row.final_forecast);
        [1_100, 660, 440, 154, 66].forEach((value, index) => expect(m1[index]).toBeCloseTo(value, 5));
        [1_210, 726, 484, 169.4, 72.6].forEach((value, index) => expect(m2[index]).toBeCloseTo(value, 5));
        const saved: ForecastBatchRow[] = allocation.mock.results[0]!.value;
        expect(saved.find((row) => row.product_id === 1 && row.month === 1)?.final_forecast).toBe(0);
        expect(saved.find((row) => row.product_id === 4 && row.month === 2)?.final_forecast).toBeCloseTo(123.4, 5);
        expect(mocks.execute).toHaveBeenCalledTimes(2); // forecast + safety stock
        const forecastSql: string = mocks.execute.mock.calls[0]![0];
        expect(forecastSql).toContain("INSERT INTO forecasts");
        for (const row of saved) {
            expect(forecastSql).toContain(`${row.base_forecast}, ${row.final_forecast}, ${row.net_forecast}`);
        }
        if (product_id) {
            expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: product_id }, select: { name: true } });
        }
    });

    it("compares EDAR and ACUAN using separate three-month bottle and Vial averages, without writing", async () => {
        mocks.query.mockResolvedValue(issuance);
        const result = await ForecastService.compare(period);
        const bottle = result.data.find((row) => row.product_id === 2)!;
        const vial = result.data.find((row) => row.product_id === 4)!;
        const atomizer = result.data.find((row) => row.product_id === 1)!;
        expect(bottle.monthly[0]!.final_edar).toBeCloseTo(660, 5);
        expect(bottle.monthly[0]!.final_acuan).toBeCloseTo(550, 5);
        expect(vial.monthly[0]!.final_edar).toBeCloseTo(154, 5);
        expect(vial.monthly[0]!.final_acuan).toBeCloseTo(44, 5);
        expect(vial.monthly[1]!.final_edar).toBeCloseTo(169.4, 5);
        expect(vial.monthly[1]!.final_acuan).toBeCloseTo(48.4, 5);
        expect(atomizer.monthly[0]!.final_edar).toBeCloseTo(1_100, 5);
        expect(atomizer.monthly[0]!.final_acuan).toBeCloseTo(1_100, 5);
        expect(mocks.transaction).not.toHaveBeenCalled();
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    it("loads the three previous months across a year boundary and divides by three even with missing months", async () => {
        mocks.query.mockResolvedValue([{ product_id: 2, total_quantity: "300" }]);
        expect(await ForecastService.loadBaseSalesInput([2], 1, 2026)).toEqual(new Map([[2, 100]]));
        const query: Prisma.Sql = mocks.query.mock.calls[0]![0];
        expect(query.sql).toContain("FROM product_issuances");
        expect(query.values.slice(-6)).toEqual([2025, 12, 2025, 11, 2025, 10]);
    });
});


describe("Forecast historical protection", () => {
    it.each([undefined, 4])("moves a historical request to M Now for all products or selected Vial (%s), including Safety Stock", async (product_id) => {
        vi.setSystemTime(new Date("2026-10-05T03:00:00Z"));
        mocks.percentages.mockResolvedValue([
            { id: 10, month: 10, year: 2026, value: new Prisma.Decimal(0.1) },
            { id: 11, month: 11, year: 2026, value: new Prisma.Decimal(0.1) },
        ]);
        mocks.query.mockResolvedValueOnce(issuance).mockResolvedValueOnce([]);
        const sales = vi.spyOn(ForecastService, "loadBaseSalesInput");
        const stock = vi.spyOn(ForecastService, "loadOpeningFinishedGoodsStock");
        const result = await ForecastService.run({ ...period, product_id });
        expect(result.period).toEqual({ start_month: 10, start_year: 2026, horizon: 2 });
        expect(sales).toHaveBeenCalledWith([1, 2, 3, 4, 5], 10, 2026);
        expect(stock).toHaveBeenCalledWith([1, 2, 3, 4, 5], 10, 2026);
        expect(mocks.percentages).toHaveBeenCalledWith({ where: { OR: [
            { month: 10, year: 2026 }, { month: 11, year: 2026 },
        ] } });
        // Inspect every persisted forecast and Safety Stock tuple, not just the response.
        for (const [sql] of mocks.execute.mock.calls) {
            const periods = Array.from((sql as string).matchAll(/\((\d+), (\d+), (\d+),/g));
            expect(periods.length).toBeGreaterThan(0);
            for (const match of periods) {
                expect(Number(match[3]) * 12 + Number(match[2])).toBeGreaterThanOrEqual(2026 * 12 + 10);
            }
        }
    });

    it("uses Jakarta's new month and carries the horizon across a year boundary", async () => {
        // Still December in UTC; already January in Jakarta.
        vi.setSystemTime(new Date("2026-12-31T18:00:00Z"));
        mocks.percentages.mockResolvedValue([
            { id: 1, month: 1, year: 2027, value: new Prisma.Decimal(0.1) },
            { id: 2, month: 2, year: 2027, value: new Prisma.Decimal(0.1) },
        ]);
        mocks.query.mockResolvedValueOnce(issuance).mockResolvedValueOnce([]);
        const result = await ForecastService.run({ start_month: 12, start_year: 2026, horizon: 2 });
        expect(result.period).toEqual({ start_month: 1, start_year: 2027, horizon: 2 });
        const sql: string = mocks.execute.mock.calls[0]![0];
        expect(sql).toContain("(1, 1, 2027,");
        expect(sql).toContain("(1, 2, 2027,");
        expect(sql).not.toContain(", 12, 2026,");
    });

    it("retains a requested future start month", async () => {
        mocks.percentages.mockResolvedValue([
            { id: 12, month: 12, year: 2026, value: new Prisma.Decimal(0.1) },
            { id: 1, month: 1, year: 2027, value: new Prisma.Decimal(0.1) },
        ]);
        mocks.query.mockResolvedValueOnce(issuance).mockResolvedValueOnce([]);
        const result = await ForecastService.run({ start_month: 12, start_year: 2026, horizon: 2 });
        expect(result.period).toEqual({ start_month: 12, start_year: 2026, horizon: 2 });
        expect(mocks.execute.mock.calls[0]![0]).toContain("(1, 1, 2027,");
    });

    it.each([
        { month: 12, year: 2025, final_forecast: 100 },
        { month: 9, year: 2026, ratio: 10 },
    ])("rejects historical manual edits before reading or writing ($month/$year)", async (edit) => {
        vi.setSystemTime(new Date("2026-10-05T03:00:00Z"));
        await expect(ForecastService.updateManual({ product_id: 1, ...edit }))
            .rejects.toMatchObject({ statusCode: 400 });
        expect(mocks.findUnique).not.toHaveBeenCalled();
        expect(mocks.forecastUpdate).not.toHaveBeenCalled();
        expect(mocks.safetyUpsert).not.toHaveBeenCalled();
        expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("reallocates a current manual edit using current/future records and stock while preserving old records", async () => {
        vi.setSystemTime(new Date("2026-10-05T03:00:00Z"));
        const row = (month: number, gross: number, final: number) => ({
            product_id: 1, month, year: 2026, base_forecast: gross,
            net_forecast: gross, final_forecast: final, trend: "STABLE", status: "ADJUSTED",
            forecast_percentage_id: 1,
        });
        const historical = [row(8, 777, 77), row(9, 888, 88)];
        const future = [row(10, 100, 100), row(11, 150, 150)];
        const snapshot = structuredClone(historical);
        const records = [...historical, ...future];
        mocks.findUnique.mockResolvedValue({ product_type: { slug: "display" }, safety_percentage: 0.25 });
        mocks.forecastUnique.mockResolvedValue(row(10, 100, 100));
        mocks.forecastFirst.mockResolvedValue({ month: 10, year: 2026 });
        mocks.forecasts.mockResolvedValueOnce(future).mockResolvedValueOnce(future);
        mocks.query.mockResolvedValue([{ product_id: 1, quantity: 120 }]);
        mocks.safetyUpsert.mockResolvedValue({});
        mocks.forecastUpdate.mockImplementation(async ({ where, data }: {
            where: { product_id_month_year: { month: number; year: number } };
            data: Partial<ReturnType<typeof row>>;
        }) => {
            const target = records.find((r) => r.month === where.product_id_month_year.month)!;
            Object.assign(target, data);
            return target;
        });
        mocks.transaction.mockImplementation(async (operations: Promise<object>[]) => Promise.all(operations));
        const stock = vi.spyOn(ForecastService, "loadOpeningFinishedGoodsStock");
        await ForecastService.updateManual({ product_id: 1, month: 10, year: 2026, ratio: 0 });
        const cutoff = { product_id: 1, OR: [
            { year: { gt: 2026 } }, { year: 2026, month: { gte: 10 } },
        ] };
        expect(mocks.forecastFirst).toHaveBeenCalledWith(expect.objectContaining({ where: cutoff }));
        expect(mocks.forecasts).toHaveBeenLastCalledWith(expect.objectContaining({ where: cutoff }));
        expect(stock).toHaveBeenCalledWith([1], 10, 2026);
        expect(future.map((r) => r.final_forecast)).toEqual([0, 130]);
        expect(historical).toEqual(snapshot);
        for (const [args] of mocks.forecastUpdate.mock.calls) {
            expect(args.where.product_id_month_year.month).toBeGreaterThanOrEqual(10);
        }
        expect(mocks.safetyUpsert.mock.calls[0]![0].where.product_id_month_year).toEqual({ product_id: 1, month: 10, year: 2026 });
    });
});
