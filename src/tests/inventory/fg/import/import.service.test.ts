import { describe, it, expect, vi, beforeEach } from "vitest";
import { FGImportService } from "../../../../module/application/inventory/fg/import/import.service.js";
import { redisClient } from "../../../../config/redis.js";
import {
    enqueueFGImport,
    fgImportQueue,
} from "../../../../module/application/inventory/fg/import/queue/fg-import.queue.js";

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
                },
            ];

            const result = await FGImportService.preview(rows);

            expect(result.total).toBe(1);
            expect(result.valid).toBe(0);
            expect(result.invalid).toBe(1);
        });

        it("normalize GENDER ke WOMEN/MEN/UNISEX", async () => {
            const rows = [
                { "PRODUCT CODE": "A", "PRODUCT NAME": "A", TYPE: "T", GENDER: "Woman", SIZE: 10 },
                { "PRODUCT CODE": "B", "PRODUCT NAME": "B", TYPE: "T", GENDER: "men", SIZE: 10 },
                { "PRODUCT CODE": "C", "PRODUCT NAME": "C", TYPE: "T", GENDER: "", SIZE: 10 },
            ];

            const result = await FGImportService.preview(rows);

            expect(result.valid).toBe(3);
        });
    });

    describe("execute", () => {
        it("throws 409 jika lock tidak bisa di-acquire", async () => {
            vi.mocked(redisClient.set).mockResolvedValueOnce(null);

            await expect(FGImportService.execute("busy-id")).rejects.toThrow(
                "Import sedang diproses, coba lagi sebentar",
            );
        });

        it("throws 400 jika cache tidak ditemukan", async () => {
            vi.mocked(redisClient.set).mockResolvedValueOnce("OK");
            vi.mocked(redisClient.get).mockResolvedValueOnce(null);

            await expect(FGImportService.execute("missing-id")).rejects.toThrow(
                "Import session tidak ditemukan atau sudah kadaluarsa",
            );
            expect(redisClient.del).toHaveBeenCalledWith(
                expect.stringContaining("fg:import:lock:missing-id"),
            );
        });

        it("throws 400 jika tidak ada baris valid", async () => {
            vi.mocked(redisClient.set).mockResolvedValueOnce("OK");
            vi.mocked(redisClient.get).mockResolvedValueOnce(
                JSON.stringify({
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

        it("enqueue job dan kembalikan state queued saat sukses", async () => {
            vi.mocked(redisClient.set).mockResolvedValueOnce("OK");
            vi.mocked(redisClient.get).mockResolvedValueOnce(
                JSON.stringify({
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
                            type: "Parfum",
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
            expect(result.state).toBe("queued");
            expect(result.jobId).toBe("valid-id");
            expect(enqueueFGImport).toHaveBeenCalledWith("valid-id");
        });

        it("melepas lock saat enqueue gagal", async () => {
            vi.mocked(redisClient.set).mockResolvedValueOnce("OK");
            vi.mocked(redisClient.get).mockResolvedValueOnce(
                JSON.stringify({
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
                            type: "Parfum",
                            unit: "ml",
                            distribution_percentage: 0,
                            safety_percentage: 0,
                            errors: [],
                        },
                    ],
                }),
            );
            vi.mocked(enqueueFGImport).mockRejectedValueOnce(new Error("queue down"));

            await expect(FGImportService.execute("fail-id")).rejects.toThrow("queue down");
            expect(redisClient.del).toHaveBeenCalledWith(
                expect.stringContaining("fg:import:lock:fail-id"),
            );
        });
    });

    describe("getStatus", () => {
        it("throws 404 jika job tidak ditemukan", async () => {
            vi.mocked(fgImportQueue.getJob).mockResolvedValueOnce(undefined);

            await expect(FGImportService.getStatus("missing-id")).rejects.toThrow(
                "Import job tidak ditemukan",
            );
        });

        it("mengembalikan state queued untuk waiting job", async () => {
            vi.mocked(fgImportQueue.getJob).mockResolvedValueOnce({
                getState: vi.fn().mockResolvedValue("waiting"),
                progress: 0,
                returnvalue: null,
            } as never);

            const result = await FGImportService.getStatus("waiting-id");

            expect(result.state).toBe("queued");
            expect(result.progress).toBe(0);
        });

        it("mengembalikan result saat completed", async () => {
            vi.mocked(fgImportQueue.getJob).mockResolvedValueOnce({
                getState: vi.fn().mockResolvedValue("completed"),
                progress: 100,
                returnvalue: { import_id: "ok-id", total: 5 },
            } as never);

            const result = await FGImportService.getStatus("ok-id");

            expect(result.state).toBe("completed");
            expect(result.progress).toBe(100);
            expect(result.result).toEqual({ import_id: "ok-id", total: 5 });
        });

        it("mengembalikan failedReason saat failed", async () => {
            vi.mocked(fgImportQueue.getJob).mockResolvedValueOnce({
                getState: vi.fn().mockResolvedValue("failed"),
                progress: 30,
                failedReason: "DB error",
                attemptsMade: 3,
            } as never);

            const result = await FGImportService.getStatus("failed-id");

            expect(result.state).toBe("failed");
            expect(result.failedReason).toBe("DB error");
            expect(result.attemptsMade).toBe(3);
        });
    });

    describe("getPreview", () => {
        it("throws 404 jika cache tidak ada", async () => {
            vi.mocked(redisClient.get).mockResolvedValueOnce(null);

            await expect(FGImportService.getPreview("missing-id")).rejects.toThrow(
                "Import preview tidak ditemukan atau sudah kadaluarsa",
            );
        });

        it("mengembalikan summary + rows ketika cache valid", async () => {
            const cachePayload = {
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
                        type: "Parfum",
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
