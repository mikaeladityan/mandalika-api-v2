import { describe, it, expect, vi, beforeEach } from "vitest";
import { InventoryHelper } from "../../module/application/shared/inventory.helper.js";
import { MovementRefType, MovementType } from "../../generated/prisma/client.js";

const NOW_MONTH = new Date().getMonth() + 1;
const NOW_YEAR  = new Date().getFullYear();
const PRIOR_MONTH = NOW_MONTH === 1 ? 12 : NOW_MONTH - 1;
const PRIOR_YEAR  = NOW_MONTH === 1 ? NOW_YEAR - 1 : NOW_YEAR;

function buildTx(latest: { id: number; quantity: string; month: number; year: number } | null) {
    return {
        outletInventory: {
            findMany: vi.fn().mockResolvedValue(latest ? [latest] : []),
            update: vi.fn().mockResolvedValue({ id: latest?.id ?? 1 }),
            create: vi.fn().mockResolvedValue({ id: 99 }),
        },
        stockMovement: {
            create: vi.fn().mockResolvedValue({ id: 1 }),
        },
    } as any;
}

describe("InventoryHelper outlet period semantics", () => {
    beforeEach(() => vi.clearAllMocks());

    describe("getCurrentInventoryPeriod", () => {
        it("returns current month and year from system clock", () => {
            const { month, year } = InventoryHelper.getCurrentInventoryPeriod();
            expect(month).toBe(NOW_MONTH);
            expect(year).toBe(NOW_YEAR);
        });
    });

    describe("deductOutletStock", () => {
        it("updates existing row when current-period row exists", async () => {
            const tx = buildTx({ id: 5, quantity: "10.00", month: NOW_MONTH, year: NOW_YEAR });

            await InventoryHelper.deductOutletStock(
                tx, 1,
                [{ product_id: 1, quantity: 3, product: { name: "X" } }],
                100, MovementRefType.MANUAL, MovementType.POS_SALE, "user-1",
            );

            expect(tx.outletInventory.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { quantity: 7 } });
            expect(tx.outletInventory.create).not.toHaveBeenCalled();
        });

        it("creates a new current-period row carrying balance forward when latest is older period", async () => {
            const tx = buildTx({ id: 3, quantity: "10.00", month: PRIOR_MONTH, year: PRIOR_YEAR });

            await InventoryHelper.deductOutletStock(
                tx, 1,
                [{ product_id: 1, quantity: 3, product: { name: "X" } }],
                100, MovementRefType.MANUAL, MovementType.POS_SALE, "user-1",
            );

            expect(tx.outletInventory.create).toHaveBeenCalledWith({
                data: { outlet_id: 1, product_id: 1, quantity: 7, month: NOW_MONTH, year: NOW_YEAR },
            });
            expect(tx.outletInventory.update).not.toHaveBeenCalled();
        });

        it("throws when prior balance is insufficient", async () => {
            const tx = buildTx({ id: 1, quantity: "2.00", month: NOW_MONTH, year: NOW_YEAR });

            await expect(
                InventoryHelper.deductOutletStock(
                    tx, 1,
                    [{ product_id: 1, quantity: 5, product: { name: "X" } }],
                    100, MovementRefType.MANUAL, MovementType.POS_SALE, "user-1",
                ),
            ).rejects.toThrow("Stok tidak mencukupi di Outlet");
        });

        it("throws when no prior row exists (cold start) and deduction requested", async () => {
            const tx = buildTx(null);

            await expect(
                InventoryHelper.deductOutletStock(
                    tx, 1,
                    [{ product_id: 1, quantity: 1, product: { name: "X" } }],
                    100, MovementRefType.MANUAL, MovementType.POS_SALE, "user-1",
                ),
            ).rejects.toThrow("Stok tidak mencukupi di Outlet");
        });
    });

    describe("addOutletStock", () => {
        it("creates current-period row on cold start", async () => {
            const tx = buildTx(null);

            await InventoryHelper.addOutletStock(
                tx, 1,
                [{ product_id: 1, quantity: 5, product: { name: "X" } }],
                100, MovementRefType.GOODS_RECEIPT, MovementType.IN, "user-1",
            );

            expect(tx.outletInventory.create).toHaveBeenCalledWith({
                data: { outlet_id: 1, product_id: 1, quantity: 5, month: NOW_MONTH, year: NOW_YEAR },
            });
        });

        it("carries balance forward when latest row is older period", async () => {
            const tx = buildTx({ id: 7, quantity: "12.00", month: PRIOR_MONTH, year: PRIOR_YEAR });

            await InventoryHelper.addOutletStock(
                tx, 1,
                [{ product_id: 1, quantity: 3, product: { name: "X" } }],
                100, MovementRefType.GOODS_RECEIPT, MovementType.IN, "user-1",
            );

            expect(tx.outletInventory.create).toHaveBeenCalledWith({
                data: { outlet_id: 1, product_id: 1, quantity: 15, month: NOW_MONTH, year: NOW_YEAR },
            });
        });

        it("updates existing current-period row", async () => {
            const tx = buildTx({ id: 9, quantity: "8.00", month: NOW_MONTH, year: NOW_YEAR });

            await InventoryHelper.addOutletStock(
                tx, 1,
                [{ product_id: 1, quantity: 2, product: { name: "X" } }],
                100, MovementRefType.GOODS_RECEIPT, MovementType.IN, "user-1",
            );

            expect(tx.outletInventory.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { quantity: 10 } });
        });
    });
});
