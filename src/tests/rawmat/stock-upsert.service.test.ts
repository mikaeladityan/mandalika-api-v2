import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "../../config/prisma.js";
import { RawMaterialStockService } from "../../module/application/rawmat/stock/rawmat.stock.service.js";

const anyPrisma = prisma as any;

describe("RawMaterialStockService.upsertStock period targeting", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("writes to the snapshot the Rekap Stok view already shows for that period", async () => {
        // The period already has an imported snapshot at date=7 — that is the row
        // rm_periods (ORDER BY date DESC) ranks first, so it is the one on screen.
        anyPrisma.rawMaterialInventory.findFirst.mockResolvedValue({ date: 7 });

        await RawMaterialStockService.upsertStock({
            raw_material_id: 5350,
            warehouse_id: 2,
            quantity: 777,
            month: 4,
            year: 2026,
        });

        const call = anyPrisma.rawMaterialInventory.upsert.mock.calls[0][0];
        expect(call.where.raw_material_id_warehouse_id_date_month_year.date).toBe(7);
        expect(call.create.date).toBe(7);
        expect(call.update.quantity).toBe(777);
    });

    it("looks up the latest snapshot scoped to the same material, warehouse and period", async () => {
        anyPrisma.rawMaterialInventory.findFirst.mockResolvedValue({ date: 10 });

        await RawMaterialStockService.upsertStock({
            raw_material_id: 5350,
            warehouse_id: 2,
            quantity: 5,
            month: 4,
            year: 2026,
        });

        const lookup = anyPrisma.rawMaterialInventory.findFirst.mock.calls[0][0];
        expect(lookup.where).toMatchObject({
            raw_material_id: 5350,
            warehouse_id: 2,
            month: 4,
            year: 2026,
        });
        expect(lookup.orderBy).toEqual([{ date: "desc" }, { updated_at: "desc" }, { id: "desc" }]);
    });

    it("falls back to today's day-of-month when the period has no snapshot yet", async () => {
        anyPrisma.rawMaterialInventory.findFirst.mockResolvedValue(null);
        vi.setSystemTime(new Date("2026-09-16T10:00:00Z"));

        await RawMaterialStockService.upsertStock({
            raw_material_id: 6296,
            warehouse_id: 2,
            quantity: 120,
            month: 9,
            year: 2026,
        });

        const call = anyPrisma.rawMaterialInventory.upsert.mock.calls[0][0];
        expect(call.create.date).toBe(16);
        vi.useRealTimers();
    });
});
