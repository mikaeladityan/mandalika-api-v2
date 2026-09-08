import { describe, it, expect, vi, beforeEach } from "vitest";
import { IssuanceService } from "../../module/application/issuance/issuance.service.js";
import prisma from "../../config/prisma.js";
import { ApiError } from "../../lib/errors/api.error.js";
import { IssuanceType } from "../../generated/prisma/client.js";

vi.mock("../../config/prisma.js", () => {
    const mockPrisma = {
        $transaction: vi.fn(),
        $queryRaw: vi.fn(),
        product: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), count: vi.fn() },
        productIssuance: { upsert: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), findFirst: vi.fn() },
        productType: { findUnique: vi.fn(), findFirst: vi.fn() },
        unitProduct: { findUnique: vi.fn(), findFirst: vi.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        if (Array.isArray(cb)) return Promise.all(cb);
        return cb(mockPrisma);
    });
    return { default: mockPrisma };
});

describe("IssuanceService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─── SAVE (UPSERT) ───────────────────────────────────────────────────────
 
     describe("save", () => {
         const mockBody = { product_id: 1, quantity: 150, month: 3, year: 2025, type: IssuanceType.ALL };
 
         it("should upsert issuance data successfully", async () => {
             // @ts-ignore
             prisma.product.findUnique.mockResolvedValue({ id: 1, name: "T-Shirt" });
             // @ts-ignore
             prisma.productIssuance.upsert.mockResolvedValue({ id: 1, ...mockBody });
 
             await expect(IssuanceService.saveBulk({
                 product_id: 1,
                 month: 3,
                 year: 2025,
                 data: [mockBody]
             })).resolves.toBeUndefined();
             // @ts-ignore
             expect(prisma.productIssuance.upsert).toHaveBeenCalledWith(
                 expect.objectContaining({
                     where: expect.objectContaining({
                         product_id_year_month_type: { product_id: 1, month: 3, year: 2025, type: IssuanceType.ALL }
                     }),
                     update: { quantity: 150 },
                     create: expect.objectContaining({ product_id: 1, quantity: 150, month: 3, year: 2025 }),
                 }),
             );
         });
 
         it("should use resolved period when month/year not provided", async () => {
             const now = new Date();
             const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
             const expectedMonth = d.getUTCMonth() + 1;
             const expectedYear = d.getUTCFullYear();
 
             // @ts-ignore
             prisma.product.findUnique.mockResolvedValue({ id: 1, name: "T-Shirt" });
             // @ts-ignore
             prisma.productIssuance.upsert.mockResolvedValue({ id: 1 });
              await IssuanceService.saveBulk({
                  product_id: 1,
                  month: expectedMonth,
                  year: expectedYear,
                  data: [{ product_id: 1, quantity: 100, type: IssuanceType.ALL }]
              });
 
             // @ts-ignore
             expect(prisma.productIssuance.upsert).toHaveBeenCalledWith(
                 expect.objectContaining({
                     create: expect.objectContaining({ month: expectedMonth, year: expectedYear }),
                 }),
             );
         });
 
         it("should throw 404 if product not found", async () => {
             // @ts-ignore
             prisma.product.findUnique.mockResolvedValue(null);
              await expect(IssuanceService.saveBulk({
                  product_id: 999,
                  month: 3,
                  year: 2025,
                  data: [{ product_id: 999, quantity: 100, type: IssuanceType.ALL }]
              })).rejects.toThrow("Produk tersebut tidak ditemukan");
         });
 
         it("should throw 400 if type is not ALL for historical data (<= Feb 2026)", async () => {
             // @ts-ignore
             prisma.product.findUnique.mockResolvedValue({ id: 1, name: "T-Shirt" });
              await expect(
                  IssuanceService.saveBulk({
                      product_id: 1,
                      month: 2,
                      year: 2026,
                      data: [{ product_id: 1, quantity: 100, month: 2, year: 2026, type: IssuanceType.OFFLINE }]
                  }),
              ).rejects.toThrow("sistem hanya menerima tipe pengeluaran 'ALL'");
         });
 
         it("should not call upsert if product not found", async () => {
             // @ts-ignore
             prisma.product.findUnique.mockResolvedValue(null);
 
             await expect(IssuanceService.saveBulk({
                 product_id: 999,
                 month: 3,
                 year: 2025,
                 data: [{ product_id: 999, quantity: 100, type: IssuanceType.ALL }]
             })).rejects.toThrow(ApiError);
             // @ts-ignore
             expect(prisma.productIssuance.upsert).not.toHaveBeenCalled();
         });
     });

    // ─── DETAIL ───────────────────────────────────────────────────────────────

    describe("detail", () => {
        it("should return issuance detail", async () => {
            // @ts-ignore
            prisma.product.findUniqueOrThrow.mockResolvedValue({
                id: 1,
                code: "TSHIRT",
                name: "T-Shirt",
                product_type: { id: 1, name: "Apparel", slug: "apparel" },
            });
            // @ts-ignore
            prisma.productIssuance.findMany.mockResolvedValue([{
                id: 1,
                product_id: 1,
                month: 3,
                year: 2025,
                quantity: "100",
                type: IssuanceType.ALL,
                created_at: new Date(),
                updated_at: new Date(),
            }]);

            const result = await IssuanceService.detail(1, 2025, 3);

            expect(result).toBeDefined();
            expect(result.issuances).toHaveLength(1);
            expect(result.totalQuantity).toBe(100);
            expect(result.product.name).toBe("T-Shirt");
        });

        it("should convert Decimal quantity to number", async () => {
            // @ts-ignore
            prisma.product.findUniqueOrThrow.mockResolvedValue({
                id: 1, code: "TSHIRT", name: "T-Shirt",
                product_type: { id: 1, name: "Apparel", slug: "apparel" },
            });
            // @ts-ignore
            prisma.productIssuance.findMany.mockResolvedValue([{
                id: 1,
                product_id: 1,
                month: 1,
                year: 2025,
                quantity: "250.5",
                type: IssuanceType.ALL,
                created_at: new Date(),
                updated_at: new Date(),
            }]);

            const result = await IssuanceService.detail(1, 2025, 1);
            expect(typeof result.totalQuantity).toBe("number");
            expect(result.totalQuantity).toBe(250.5);
        });

        it("should return null for product_type if not set", async () => {
            // @ts-ignore
            prisma.product.findUniqueOrThrow.mockResolvedValue({
                id: 1, code: "TSHIRT", name: "T-Shirt", product_type: null
            });
            // @ts-ignore
            prisma.productIssuance.findMany.mockResolvedValue([]);

            const result = await IssuanceService.detail(1, 2025, 1);
            expect(result.product.product_type).toBeNull();
        });

        it("should throw 400 if year is 0", async () => {
            await expect(IssuanceService.detail(1, 0, 3)).rejects.toThrow(ApiError);
            await expect(IssuanceService.detail(1, 0, 3)).rejects.toThrow("Tahun dan bulan wajib diisi");
        });

        it("should throw 400 if month is 0", async () => {
            await expect(IssuanceService.detail(1, 2025, 0)).rejects.toThrow(ApiError);
        });

        it("should throw if product is not found", async () => {
            // @ts-ignore
            prisma.product.findUniqueOrThrow.mockRejectedValue(new Error("P404"));

            await expect(IssuanceService.detail(999, 2025, 3)).rejects.toThrow();
        });
    });

    // ─── LIST ─────────────────────────────────────────────────────────────────

    describe("list", () => {
        const mockCountResult = [{ total: 1 }];
        const mockRow = {
            id: 1,
            code: "TSHIRT",
            name: "T-Shirt",
            size_val: 40,
            unit_name: "pcs",
            pt_id: 1,
            pt_name: "Apparel",
            pt_slug: "apparel",
            totalQuantity: "150",
            issuances_data: JSON.stringify([{ year: 2025, month: 1, quantity: "150" }]),
        };

        it("should return list of issuances with trend data", async () => {
            // @ts-ignore
            prisma.$queryRaw
                // @ts-ignore
                .mockResolvedValueOnce(mockCountResult) // count
                // @ts-ignore
                .mockResolvedValueOnce([mockRow]);      // main query

            const result = await IssuanceService.list({ sortBy: "quantity", sortOrder: "desc" });

            expect(result.len).toBe(1);
            expect(result.issuances).toHaveLength(1);
            expect(result.issuances[0]?.product.code).toBe("TSHIRT");
            expect(result.issuances[0]?.quantity).toBeInstanceOf(Array);
            expect(result.issuances[0]?.totalQuantity).toBeGreaterThanOrEqual(0);
        });

        it("should return empty list when total is 0", async () => {
            // @ts-ignore
            prisma.$queryRaw.mockResolvedValueOnce([{ total: 0 }]);

            const result = await IssuanceService.list({ sortBy: "quantity", sortOrder: "desc" });

            expect(result.issuances).toHaveLength(0);
            expect(result.len).toBe(0);
            // @ts-ignore — hanya count query yang dipanggil, main query tidak
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        });

        it("should handle period range parameters", async () => {
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1 }])
                .mockResolvedValueOnce([mockRow]);

            const result = await IssuanceService.list({ 
                sortBy: "quantity", 
                sortOrder: "desc", 
                start_month: 1, start_year: 2025,
                end_month: 6, end_year: 2025
            });

            expect(result.issuances[0]?.quantity).toHaveLength(6);
        });

        it("should handle issuances_data as parsed object (not string)", async () => {
            const rowWithObject = {
                ...mockRow,
                issuances_data: [{ year: 2025, month: 1, quantity: "100" }],
            };
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1 }])
                .mockResolvedValueOnce([rowWithObject]);

            const result = await IssuanceService.list({ sortBy: "quantity", sortOrder: "desc" });
            expect(result.issuances[0]).toBeDefined();
        });

        it("should handle product_type as null in list", async () => {
            const rowNoType = { ...mockRow, pt_id: null, pt_name: null, pt_slug: null };
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1 }])
                .mockResolvedValueOnce([rowNoType]);

            const result = await IssuanceService.list({ sortBy: "name", sortOrder: "asc" });
            expect(result.issuances[0]?.product.product_type).toBeNull();
        });

        it("should handle null size_val gracefully", async () => {
            const rowNoSize = { ...mockRow, size_val: null, unit_name: null };
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1 }])
                .mockResolvedValueOnce([rowNoSize]);

            const result = await IssuanceService.list({ sortBy: "quantity", sortOrder: "desc" });
            expect(result.issuances[0]?.product.size).toBe("");
        });

        it("should filter by product_id", async () => {
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1 }])
                .mockResolvedValueOnce([mockRow]);

            const result = await IssuanceService.list({ sortBy: "quantity", sortOrder: "desc", product_id: 1 });
            expect(result.len).toBe(1);
        });

        it("should limit result to 2 when both product_id and product_id_2 are set", async () => {
            const mockRow2 = { ...mockRow, id: 2, code: "POLO", name: "Polo Shirt" };
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 2 }])
                .mockResolvedValueOnce([mockRow, mockRow2]);

            const result = await IssuanceService.list({
                sortBy: "quantity", sortOrder: "desc",
                product_id: 1, product_id_2: 2,
            });
            expect(result.len).toBe(2);
            expect(result.issuances).toHaveLength(2);
        });
    });

    // ─── TREND CALCULATION ────────────────────────────────────────────────────

    describe("calculateTrendSeries (via list)", () => {
        it("should mark first element as STABLE", async () => {
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1 }])
                .mockResolvedValueOnce([{
                    ...{
                        id: 1, code: "X", name: "X", size_val: null, unit_name: null,
                        pt_id: null, pt_name: null, pt_slug: null, totalQuantity: "0",
                        issuances_data: "[]",
                    },
                }]);

            const result = await IssuanceService.list({ 
                sortBy: "quantity", 
                sortOrder: "desc", 
                start_month: 1, start_year: 2025,
                end_month: 3, end_year: 2025
            });
            expect(result.issuances[0]?.quantity[0]?.trend).toBe("STABLE");
            expect(result.issuances[0]?.quantity[0]?.percentage).toBeNull();
        });

        it("should return UP trend for significant increase", async () => {
            // getLastNMonths(2) uses M-1 as the most recent period (not current month)
            const now = new Date();
            const p1 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
            const p2 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

            const actuals = [
                { year: p1.getUTCFullYear(), month: p1.getUTCMonth() + 1, quantity: "50" },
                { year: p2.getUTCFullYear(), month: p2.getUTCMonth() + 1, quantity: "100" },
            ];
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1 }])
                .mockResolvedValueOnce([{
                    id: 1, code: "X", name: "X", size_val: null, unit_name: null,
                    pt_id: null, pt_name: null, pt_slug: null, totalQuantity: "150",
                    issuances_data: JSON.stringify(actuals),
                }]);

            const result = await IssuanceService.list({ 
                sortBy: "quantity", 
                sortOrder: "desc", 
                start_month: p1.getUTCMonth() + 1, start_year: p1.getUTCFullYear(),
                end_month: p2.getUTCMonth() + 1, end_year: p2.getUTCFullYear()
            });
            const series = result.issuances[0]?.quantity!;
            expect(series[1]?.trend).toBe("UP");
            // quantity goes 50 → 100, so ((100-50)/50)*100 = 100
            expect(series[1]?.percentage).toBe(100);
        });

        it("should return DOWN trend for significant decrease", async () => {
            const now = new Date();
            const p1 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
            const p2 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

            const actuals = [
                { year: p1.getUTCFullYear(), month: p1.getUTCMonth() + 1, quantity: "100" },
                { year: p2.getUTCFullYear(), month: p2.getUTCMonth() + 1, quantity: "10" },
            ];
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1 }])
                .mockResolvedValueOnce([{
                    id: 1, code: "X", name: "X", size_val: null, unit_name: null,
                    pt_id: null, pt_name: null, pt_slug: null, totalQuantity: "110",
                    issuances_data: JSON.stringify(actuals),
                }]);

            const result = await IssuanceService.list({ 
                sortBy: "quantity", 
                sortOrder: "desc", 
                start_month: p1.getUTCMonth() + 1, start_year: p1.getUTCFullYear(),
                end_month: p2.getUTCMonth() + 1, end_year: p2.getUTCFullYear()
            });
            const series = result.issuances[0]?.quantity!;
            expect(series[1]?.trend).toBe("DOWN");
            // quantity goes 100 → 10, so ((10-100)/100)*100 = -90
            expect(series[1]?.percentage).toBe(-90);
        });

        it("should return STABLE when prev quantity is 0", async () => {
            const actuals = [
                { year: 2024, month: 11, quantity: "0" },
                { year: 2024, month: 12, quantity: "50" },
            ];
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1 }])
                .mockResolvedValueOnce([{
                    id: 1, code: "X", name: "X", size_val: null, unit_name: null,
                    pt_id: null, pt_name: null, pt_slug: null, totalQuantity: "50",
                    issuances_data: JSON.stringify(actuals),
                }]);

            const result = await IssuanceService.list({ 
                sortBy: "quantity", 
                sortOrder: "desc", 
                start_month: 11, start_year: 2024,
                end_month: 12, end_year: 2024
            });
            const series = result.issuances[0]?.quantity!;
            // prev is 0, delta is Infinity → STABLE (guarded)
            expect(series[1]?.trend).toBe("STABLE");
            expect(series[1]?.percentage).toBeNull();
        });
    });
});


describe("Hampers analytics", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns totals across all pages and compares the first month with the preceding year", async () => {
        const query = vi.mocked(prisma.$queryRaw);
        query.mockResolvedValueOnce([{ total: 26 }]);
        query.mockResolvedValueOnce([
            { year: 2025, month: 12, quantity: "200" },
            { year: 2026, month: 1, quantity: "300" },
            { year: 2026, month: 2, quantity: "0" },
            { year: 2026, month: 3, quantity: "10" },
        ]);
        query.mockResolvedValueOnce([{
            id: 1, code: "GB-HAMPERS", name: "Gift", size_val: null, unit_name: "PCS",
            pt_id: 1, pt_name: "Hampers", pt_slug: "hampers-ext", totalQuantity: 15,
            issuances_data: [{ year: 2025, month: 12, quantity: 10 }, { year: 2026, month: 1, quantity: 15 }],
        }]);
        const result = await IssuanceService.list({
            sortBy: "name", sortOrder: "asc", hampers_only: true, sales_analytics: true, search: "Gift", page: 2, take: 25,
            start_month: 1, start_year: 2026, end_month: 3, end_year: 2026,
        });
        expect(result.len).toBe(26);
        expect(result.hampersSummary).toEqual([
            { year: 2026, month: 1, quantity: 300, previousQuantity: 200, difference: 100, percentage: 50, trend: "UP" },
            { year: 2026, month: 2, quantity: 0, previousQuantity: 300, difference: -300, percentage: -100, trend: "DOWN" },
            { year: 2026, month: 3, quantity: 10, previousQuantity: 0, difference: 10, percentage: null, trend: "UP" },
        ]);
        expect(result.issuances[0]?.quantity[0]?.percentage).toBe(50);
        expect(result.issuances[0]?.quantity[1]?.percentage).toBe(-100);
        expect(result.issuances[0]?.totalQuantity).toBe(15);
        const countSql = query.mock.calls[0]?.[0];
        const summarySql = query.mock.calls[1]?.[0];
        expect(countSql).toHaveProperty("sql", expect.stringContaining("pt.slug ILIKE 'hampers-%'"));
        expect(countSql).toHaveProperty("sql", expect.not.stringContaining("p.code !~*"));
        expect(summarySql).toHaveProperty("sql", expect.not.stringContaining("LIMIT"));
        expect(summarySql).toHaveProperty("sql", expect.not.stringContaining("p.name ILIKE"));
    });

    it("keeps all-Hampers totals when the table search has no matches", async () => {
        vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
        const result = await IssuanceService.list({ sortBy: "name", sortOrder: "asc", hampers_only: true, start_month: 1, start_year: 2026, end_month: 1, end_year: 2026 });
        expect(result.issuances).toEqual([]);
        expect(result.hampersSummary?.[0]).toMatchObject({ quantity: 0, previousQuantity: 0, percentage: null, trend: "STABLE" });
    });
});


describe("Sales analytics CSV totals", () => {
    it.each([true, false])("exports totals with empty product results (hampers_only=%s)", async (hampersOnly) => {
        const list = vi.spyOn(IssuanceService, "list").mockResolvedValue({
            issuances: [], len: 0,
            salesSummary: [
                { year: 2026, month: 1, quantity: 300, previousQuantity: 200, difference: 100, percentage: 50, trend: "UP" },
                { year: 2026, month: 2, quantity: 0, previousQuantity: 300, difference: -300, percentage: -100, trend: "DOWN" },
                { year: 2026, month: 3, quantity: 10, previousQuantity: 0, difference: 10, percentage: null, trend: "UP" },
            ],
        });
        try {
            const csv = Buffer.from(await IssuanceService.export({
                sortBy: "name", sortOrder: "asc", sales_analytics: true, hampers_only: hampersOnly,
                visibleColumns: "code,name,type,size,periods,total",
            })).toString("utf8");
            expect(csv).toContain("MOM JAN '26 (%)");
            expect(csv).toContain(hampersOnly ? "TOTAL ALL HAMPERS" : "TOTAL ALL FG");
            expect(csv).toContain(",300,0,10,310,50,-100,- (basis 0)");
            expect(list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, take: 1000000, hampers_only: hampersOnly }));
        } finally {
            list.mockRestore();
        }
    });
});


describe("All FG sales totals", () => {
    it("uses the Sales Analytics product scope and ignores table pagination and product search", async () => {
        const query = vi.mocked(prisma.$queryRaw);
        query.mockReset();
        query.mockResolvedValueOnce([{ total: 100 }]);
        query.mockResolvedValueOnce([
            { year: 2026, month: 1, quantity: 1000 },
            { year: 2026, month: 2, quantity: 1200 },
        ]);
        query.mockResolvedValueOnce([{
            id: 1, code: "FG-1", name: "Perfume", size_val: 50, unit_name: "ML",
            pt_id: null, pt_name: null, pt_slug: null, totalQuantity: 10,
            issuances_data: [{ year: 2026, month: 1, quantity: 20 }, { year: 2026, month: 2, quantity: 10 }],
        }]);
        const result = await IssuanceService.list({
            sortBy: "name", sortOrder: "asc", sales_analytics: true, search: "Perfume", page: 2, take: 25,
            start_month: 2, start_year: 2026, end_month: 2, end_year: 2026,
        });
        expect(result.salesSummary).toEqual([
            { year: 2026, month: 2, quantity: 1200, previousQuantity: 1000, difference: 200, percentage: 20, trend: "UP" },
        ]);
        expect(result.issuances[0]?.quantity[0]?.percentage).toBe(-50);
        expect(result.hampersSummary).toBeUndefined();
        expect(query.mock.calls[1]?.[0]).toHaveProperty("sql", expect.stringContaining("p.code !~*"));
        expect(query.mock.calls[1]?.[0]).toHaveProperty("sql", expect.stringContaining("LEFT JOIN product_types"));
        expect(query.mock.calls[1]?.[0]).toHaveProperty("sql", expect.not.stringContaining("hampers-%"));
        expect(query.mock.calls[1]?.[0]).toHaveProperty("sql", expect.not.stringContaining("p.name ILIKE"));
        expect(query.mock.calls[1]?.[0]).toHaveProperty("sql", expect.not.stringContaining("LIMIT"));
    });
});
