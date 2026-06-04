import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "../../../generated/prisma/client.js";
import prisma from "../../../config/prisma.js";
import { ApiError } from "../../../lib/errors/api.error.js";
import { ForecastPercentageService } from "../../../module/application/forecast/percentages/percentages.service.js";

describe("ForecastPercentageService — history", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─── update() ─────────────────────────────────────────────────────────────
    describe("update()", () => {
        it("writes a history row when value changes", async () => {
            const txMock = {
                $queryRaw: vi.fn().mockResolvedValue([{ id: 1 }]),
                forecastPercentage: {
                    findUnique: vi.fn().mockResolvedValue({
                        id: 1,
                        month: 6,
                        year: 2026,
                        value: {
                            equals: (_other: any) => false,
                            toString: () => "19.00",
                        },
                    }),
                    update: vi.fn().mockResolvedValue({
                        id: 1,
                        month: 6,
                        year: 2026,
                        value: "25.00",
                    }),
                },
                forecastPercentageHistory: {
                    create: vi.fn().mockResolvedValue({ id: 11 }),
                },
            };
            // @ts-ignore
            prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(txMock));

            const result = await ForecastPercentageService.update(
                1,
                { value: 25, reason: "Koreksi Juni" },
                { changed_by: "user@test.com" },
            );

            expect(result.value).toBe(25);
            expect(txMock.forecastPercentageHistory.create).toHaveBeenCalledOnce();
            const createArg = txMock.forecastPercentageHistory.create.mock.calls[0]![0];
            expect(createArg.data).toMatchObject({
                forecast_percentage_id: 1,
                month: 6,
                year: 2026,
                action: "UPDATE",
                changed_by: "user@test.com",
                reason: "Koreksi Juni",
            });
            expect(txMock.forecastPercentage.update).toHaveBeenCalledOnce();
        });

        it("skips history and skips DB update when value is identical", async () => {
            const txMock = {
                $queryRaw: vi.fn().mockResolvedValue([{ id: 1 }]),
                forecastPercentage: {
                    findUnique: vi.fn().mockResolvedValue({
                        id: 1,
                        month: 6,
                        year: 2026,
                        value: {
                            equals: (_other: any) => true,
                            toString: () => "19.00",
                        },
                    }),
                    update: vi.fn(),
                },
                forecastPercentageHistory: { create: vi.fn() },
            };
            // @ts-ignore
            prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(txMock));

            const result = await ForecastPercentageService.update(
                1,
                { value: 19 },
                { changed_by: "user@test.com" },
            );

            expect(result.value).toBe(19);
            expect(txMock.forecastPercentageHistory.create).not.toHaveBeenCalled();
            expect(txMock.forecastPercentage.update).not.toHaveBeenCalled();
        });

        it("throws 404 when record not found", async () => {
            const txMock = {
                $queryRaw: vi.fn().mockResolvedValue([]),
                forecastPercentage: { findUnique: vi.fn().mockResolvedValue(null) },
                forecastPercentageHistory: { create: vi.fn() },
            };
            // @ts-ignore
            prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(txMock));

            await expect(
                ForecastPercentageService.update(
                    999,
                    { value: 10 },
                    { changed_by: "user@test.com" },
                ),
            ).rejects.toThrow(ApiError);
        });
    });

    // ─── createMany() ─────────────────────────────────────────────────────────
    describe("createMany()", () => {
        it("writes BULK_UPDATE history only for items whose value actually changed", async () => {
            const existing = [
                { id: 1, month: 1, year: 2026, value: new Prisma.Decimal("10.00") },
                { id: 2, month: 2, year: 2026, value: new Prisma.Decimal("12.00") },
            ];
            const txMock = {
                forecastPercentage: {
                    findMany: vi.fn().mockResolvedValue(existing),
                    upsert: vi.fn().mockImplementation(async ({ create }: any) => ({
                        id: create.month,
                        month: create.month,
                        year: create.year,
                        value: String(create.value),
                    })),
                },
                forecastPercentageHistory: {
                    createMany: vi.fn().mockResolvedValue({ count: 1 }),
                },
            };
            // @ts-ignore
            prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(txMock));

            const result = await ForecastPercentageService.createMany(
                {
                    items: [
                        { month: 1, year: 2026, value: 10 }, // same → no history
                        { month: 2, year: 2026, value: 15 }, // changed → history
                        { month: 3, year: 2026, value: 8 },  // new → no history
                    ],
                    reason: "Q1 adjustment",
                },
                { changed_by: "user@test.com" },
            );

            expect(result.count).toBe(3);
            expect(txMock.forecastPercentageHistory.createMany).toHaveBeenCalledOnce();
            const call = txMock.forecastPercentageHistory.createMany.mock.calls[0]![0];
            expect(call.data).toHaveLength(1);
            expect(call.data[0]).toMatchObject({
                month: 2,
                year: 2026,
                action: "BULK_UPDATE",
                changed_by: "user@test.com",
                reason: "Q1 adjustment",
            });
        });

        it("does not call history.createMany when no items changed", async () => {
            const existing = [
                { id: 1, month: 1, year: 2026, value: new Prisma.Decimal("10.00") },
            ];
            const txMock = {
                forecastPercentage: {
                    findMany: vi.fn().mockResolvedValue(existing),
                    upsert: vi.fn().mockResolvedValue({
                        id: 1,
                        month: 1,
                        year: 2026,
                        value: "10.00",
                    }),
                },
                forecastPercentageHistory: { createMany: vi.fn() },
            };
            // @ts-ignore
            prisma.$transaction.mockImplementationOnce(async (cb: any) => cb(txMock));

            await ForecastPercentageService.createMany(
                { items: [{ month: 1, year: 2026, value: 10 }] },
                { changed_by: "user@test.com" },
            );

            expect(txMock.forecastPercentageHistory.createMany).not.toHaveBeenCalled();
        });
    });

    // ─── listHistory() ────────────────────────────────────────────────────────
    describe("listHistory()", () => {
        it("returns paginated history for month+year, ordered created_at desc", async () => {
            // @ts-ignore
            prisma.forecastPercentageHistory.findMany.mockResolvedValueOnce([
                {
                    id: 2,
                    forecast_percentage_id: 1,
                    month: 6,
                    year: 2026,
                    old_value: "19.00",
                    new_value: "25.00",
                    action: "UPDATE",
                    changed_by: "user@test.com",
                    reason: null,
                    created_at: new Date("2026-06-04T11:00:00Z"),
                },
                {
                    id: 1,
                    forecast_percentage_id: 1,
                    month: 6,
                    year: 2026,
                    old_value: "0.00",
                    new_value: "19.00",
                    action: "BULK_UPDATE",
                    changed_by: "user@test.com",
                    reason: "Initial seed",
                    created_at: new Date("2026-06-03T10:00:00Z"),
                },
            ]);
            // @ts-ignore
            prisma.forecastPercentageHistory.count.mockResolvedValueOnce(2);

            const result = await ForecastPercentageService.listHistory({
                month: 6,
                year: 2026,
                page: 1,
                take: 25,
            });

            expect(result.len).toBe(2);
            expect(result.data).toHaveLength(2);
            expect(typeof result.data[0]!.old_value).toBe("number");
            expect(typeof result.data[0]!.new_value).toBe("number");
            // @ts-ignore
            const callArgs = prisma.forecastPercentageHistory.findMany.mock.calls[0]![0];
            expect(callArgs.where).toEqual({ month: 6, year: 2026 });
            expect(callArgs.orderBy).toEqual({ created_at: "desc" });
        });
    });
});
