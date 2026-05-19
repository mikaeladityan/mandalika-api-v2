import { describe, it, expect, vi, beforeEach } from "vitest";
import { RMImportService } from "../../../../module/application/inventory/rm/import/import.service.js";
import { redisClient } from "../../../../config/redis.js";
import {
    enqueueRMImport,
    rmImportQueue,
} from "../../../../module/application/inventory/rm/import/queue/rm-import.queue.js";

describe("RMImportService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("preview", () => {
        it("parses valid row dan mengembalikan import_id + counters", async () => {
            const rows = [
                {
                    BARCODE: "RM-001",
                    "MATERIAL NAME": "Kain Katun",
                    CATEGORY: "FABRIC",
                    UOM: "meter",
                    MOQ: 10,
                    "MIN STOCK": 5,
                    "LEAD TIME": 7,
                    SUPPLIER: "PT Supplier ABC",
                    "LOCAL/IMPORT": "LOCAL",
                    COUNTRY: "Indonesia",
                    PRICE: 15000,
                },
            ];

            const result = await RMImportService.preview(rows);

            expect(result.total).toBe(1);
            expect(result.valid).toBe(1);
            expect(result.invalid).toBe(0);
            expect(result.import_id).toMatch(/^[0-9a-f-]{36}$/i);
            expect(redisClient.set).toHaveBeenCalled();
        });

        it("menandai row invalid dengan errors[] terisi", async () => {
            const rows = [
                {
                    BARCODE: "",
                    "MATERIAL NAME": "Kain Tanpa Barcode",
                    CATEGORY: "FABRIC",
                },
            ];

            const result = await RMImportService.preview(rows);

            expect(result.total).toBe(1);
            expect(result.valid).toBe(0);
            expect(result.invalid).toBe(1);
        });

        it("normalize LOCAL/IMPORT ke LOCAL/IMPORT enum", async () => {
            const rows = [
                {
                    BARCODE: "RM-A",
                    "MATERIAL NAME": "A",
                    CATEGORY: "C",
                    UOM: "PCS",
                    "LOCAL/IMPORT": "IMPORT",
                },
                {
                    BARCODE: "RM-B",
                    "MATERIAL NAME": "B",
                    CATEGORY: "C",
                    UOM: "PCS",
                    "LOCAL/IMPORT": "lokal",
                },
                {
                    BARCODE: "RM-C",
                    "MATERIAL NAME": "C",
                    CATEGORY: "C",
                    UOM: "PCS",
                },
            ];

            const result = await RMImportService.preview(rows);
            expect(result.valid).toBe(3);
        });
    });

    describe("execute", () => {
        it("throws 409 jika lock tidak bisa di-acquire", async () => {
            vi.mocked(redisClient.set).mockResolvedValueOnce(null);

            await expect(RMImportService.execute("busy-id")).rejects.toThrow(
                "Import sedang diproses, coba lagi sebentar",
            );
        });

        it("throws 400 jika cache tidak ditemukan", async () => {
            vi.mocked(redisClient.set).mockResolvedValueOnce("OK");
            vi.mocked(redisClient.get).mockResolvedValueOnce(null);

            await expect(RMImportService.execute("missing-id")).rejects.toThrow(
                "Import session tidak ditemukan atau sudah kadaluarsa",
            );
            expect(redisClient.del).toHaveBeenCalledWith(
                expect.stringContaining("rm:import:lock:missing-id"),
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
                            barcode: "",
                            name: "",
                            category: "",
                            unit: "",
                            min_buy: 0,
                            min_stock: 0,
                            lead_time: 0,
                            supplier: null,
                            source: "LOCAL",
                            country: "",
                            price: 0,
                            errors: ["bad"],
                        },
                    ],
                }),
            );

            await expect(RMImportService.execute("invalid-rows-id")).rejects.toThrow(
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
                            barcode: "RM-001",
                            name: "Kain",
                            category: "FABRIC",
                            unit: "METER",
                            min_buy: 10,
                            min_stock: 5,
                            lead_time: 7,
                            supplier: "PT ABC",
                            source: "LOCAL",
                            country: "Indonesia",
                            price: 15000,
                            errors: [],
                        },
                    ],
                }),
            );

            const result = await RMImportService.execute("valid-id");

            expect(result.import_id).toBe("valid-id");
            expect(result.state).toBe("queued");
            expect(result.jobId).toBe("valid-id");
            expect(enqueueRMImport).toHaveBeenCalledWith("valid-id");
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
                            barcode: "RM-001",
                            name: "Kain",
                            category: "FABRIC",
                            unit: "METER",
                            min_buy: 0,
                            min_stock: 0,
                            lead_time: 0,
                            supplier: null,
                            source: "LOCAL",
                            country: "",
                            price: 0,
                            errors: [],
                        },
                    ],
                }),
            );
            vi.mocked(enqueueRMImport).mockRejectedValueOnce(new Error("queue down"));

            await expect(RMImportService.execute("fail-id")).rejects.toThrow("queue down");
            expect(redisClient.del).toHaveBeenCalledWith(
                expect.stringContaining("rm:import:lock:fail-id"),
            );
        });
    });

    describe("getStatus", () => {
        it("throws 404 jika job tidak ditemukan", async () => {
            vi.mocked(rmImportQueue.getJob).mockResolvedValueOnce(undefined);

            await expect(RMImportService.getStatus("missing-id")).rejects.toThrow(
                "Import job tidak ditemukan",
            );
        });

        it("mengembalikan state queued untuk waiting job", async () => {
            vi.mocked(rmImportQueue.getJob).mockResolvedValueOnce({
                getState: vi.fn().mockResolvedValue("waiting"),
                progress: 0,
                returnvalue: null,
            } as never);

            const result = await RMImportService.getStatus("waiting-id");

            expect(result.state).toBe("queued");
            expect(result.progress).toBe(0);
        });

        it("mengembalikan result saat completed", async () => {
            vi.mocked(rmImportQueue.getJob).mockResolvedValueOnce({
                getState: vi.fn().mockResolvedValue("completed"),
                progress: 100,
                returnvalue: { import_id: "ok-id", total: 5 },
            } as never);

            const result = await RMImportService.getStatus("ok-id");

            expect(result.state).toBe("completed");
            expect(result.progress).toBe(100);
            expect(result.result).toEqual({ import_id: "ok-id", total: 5 });
        });

        it("mengembalikan failedReason saat failed", async () => {
            vi.mocked(rmImportQueue.getJob).mockResolvedValueOnce({
                getState: vi.fn().mockResolvedValue("failed"),
                progress: 30,
                failedReason: "DB error",
                attemptsMade: 3,
            } as never);

            const result = await RMImportService.getStatus("failed-id");

            expect(result.state).toBe("failed");
            expect(result.failedReason).toBe("DB error");
            expect(result.attemptsMade).toBe(3);
        });
    });

    describe("getPreview", () => {
        it("throws 404 jika cache tidak ada", async () => {
            vi.mocked(redisClient.get).mockResolvedValueOnce(null);

            await expect(RMImportService.getPreview("missing-id")).rejects.toThrow(
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
                        barcode: "RM-001",
                        name: "Kain",
                        category: "FABRIC",
                        unit: "METER",
                        min_buy: 10,
                        min_stock: 5,
                        lead_time: 7,
                        supplier: "PT ABC",
                        source: "LOCAL",
                        country: "Indonesia",
                        price: 15000,
                        errors: [],
                    },
                ],
            };
            vi.mocked(redisClient.get).mockResolvedValueOnce(JSON.stringify(cachePayload));

            const result = await RMImportService.getPreview("ok-id");

            expect(result.import_id).toBe("ok-id");
            expect(result.total).toBe(2);
            expect(result.rows).toHaveLength(1);
        });
    });
});
