import { describe, it, expect, vi, beforeEach } from "vitest";
import { FGImportService } from "../../../../module/application/inventory/fg/import/import.service.js";
import { redisClient } from "../../../../config/redis.js";

describe("FGImportService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("preview", () => {
        it("parses valid row dan mengembalikan import_id + counters", async () => {
            const rows = [
                {
                    "PRODUCT CODE": "FG_001",
                    "PRODUCT NAME": "Parfum 100ml",
                    TYPE: "Parfum",
                    GENDER: "Men",
                    SIZE: 100,
                    UOM: "ml",
                    EDAR: 50,
                    SAFETY: 10,
                },
            ];

            const result = await FGImportService.preview(rows);

            expect(result.total).toBe(1);
            expect(result.valid).toBe(1);
            expect(result.invalid).toBe(0);
            expect(result.import_id).toMatch(/^[0-9a-f-]{36}$/i);
            expect(redisClient.set).toHaveBeenCalled();
        });

        it("menandai row invalid dengan errors[] terisi", async () => {
            const rows = [
                {
                    "PRODUCT CODE": "",
                    "PRODUCT NAME": "Invalid",
                    TYPE: "Parfum",
                    SIZE: 0,
                    UOM: "ml",
                },
            ];

            const result = await FGImportService.preview(rows);

            expect(result.total).toBe(1);
            expect(result.valid).toBe(0);
            expect(result.invalid).toBe(1);
        });

        it("normalize GENDER ke WOMEN/MEN/UNISEX", async () => {
            const rows = [
                { "PRODUCT CODE": "A", "PRODUCT NAME": "A", TYPE: "T", GENDER: "Woman", SIZE: 10, UOM: "ml" },
                { "PRODUCT CODE": "B", "PRODUCT NAME": "B", TYPE: "T", GENDER: "men", SIZE: 10, UOM: "ml" },
                { "PRODUCT CODE": "C", "PRODUCT NAME": "C", TYPE: "T", GENDER: "", SIZE: 10, UOM: "ml" },
            ];

            const result = await FGImportService.preview(rows);

            expect(result.valid).toBe(3);
        });
    });

    describe("execute", () => {
        it("throws ApiError saat cache tidak ditemukan", async () => {
            vi.mocked(redisClient.get).mockResolvedValueOnce(null);

            await expect(FGImportService.execute("missing-id")).rejects.toThrow(
                "Import session expired, not found, or already executed",
            );
        });

        it("throws ApiError saat status sudah executing", async () => {
            vi.mocked(redisClient.get).mockResolvedValueOnce(
                JSON.stringify({
                    status: "executing",
                    createdAt: Date.now(),
                    total: 1,
                    valid: 1,
                    invalid: 0,
                    rows: [],
                }),
            );

            await expect(FGImportService.execute("locked-id")).rejects.toThrow(
                "Import session expired, not found, or already executed",
            );
        });

        it("throws ApiError saat tidak ada baris valid", async () => {
            vi.mocked(redisClient.get).mockResolvedValueOnce(
                JSON.stringify({
                    status: "preview",
                    createdAt: Date.now(),
                    total: 1,
                    valid: 0,
                    invalid: 1,
                    rows: [
                        {
                            code: "",
                            name: "",
                            gender: "UNISEX",
                            size: 0,
                            type: null,
                            unit: null,
                            distribution_percentage: 0,
                            safety_percentage: 0,
                            errors: ["bad"],
                        },
                    ],
                }),
            );

            await expect(FGImportService.execute("invalid-rows-id")).rejects.toThrow(
                "Tidak ada baris valid untuk diimport",
            );
        });

        it("sukses execute dan menghapus cache", async () => {
            vi.mocked(redisClient.get).mockResolvedValueOnce(
                JSON.stringify({
                    status: "preview",
                    createdAt: Date.now(),
                    total: 1,
                    valid: 1,
                    invalid: 0,
                    rows: [
                        {
                            code: "FG_001",
                            name: "Parfum",
                            gender: "MEN",
                            size: 100,
                            type: "parfum",
                            unit: "ml",
                            distribution_percentage: 50,
                            safety_percentage: 10,
                            errors: [],
                        },
                    ],
                }),
            );

            const result = await FGImportService.execute("valid-id");

            expect(result.import_id).toBe("valid-id");
            expect(result.total).toBe(1);
            expect(redisClient.del).toHaveBeenCalled();
        });
    });

    describe("getPreview", () => {
        it("throws ApiError 404 jika cache tidak ada", async () => {
            vi.mocked(redisClient.get).mockResolvedValueOnce(null);

            await expect(FGImportService.getPreview("missing-id")).rejects.toThrow(
                "Import preview not found or expired",
            );
        });

        it("throws ApiError 400 jika sudah executed", async () => {
            vi.mocked(redisClient.get).mockResolvedValueOnce(
                JSON.stringify({
                    status: "executing",
                    createdAt: Date.now(),
                    total: 0,
                    valid: 0,
                    invalid: 0,
                    rows: [],
                }),
            );

            await expect(FGImportService.getPreview("executing-id")).rejects.toThrow(
                "Import already executed",
            );
        });

        it("mengembalikan summary + rows ketika cache valid", async () => {
            const cachePayload = {
                status: "preview" as const,
                createdAt: 1700000000000,
                total: 2,
                valid: 1,
                invalid: 1,
                rows: [
                    {
                        code: "OK",
                        name: "OK",
                        gender: "MEN",
                        size: 100,
                        type: "parfum",
                        unit: "ml",
                        distribution_percentage: 0,
                        safety_percentage: 0,
                        errors: [],
                    },
                ],
            };
            vi.mocked(redisClient.get).mockResolvedValueOnce(JSON.stringify(cachePayload));

            const result = await FGImportService.getPreview("ok-id");

            expect(result.import_id).toBe("ok-id");
            expect(result.total).toBe(2);
            expect(result.rows).toHaveLength(1);
        });
    });
});
