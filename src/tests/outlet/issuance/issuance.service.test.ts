import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssuanceService } from "../../../module/application/outlet/issuance/issuance.service.js";
import { Prisma } from "../../../generated/prisma/client.js";
import prisma from "../../../config/prisma.js";

vi.mock("../../../config/prisma.js", () => ({
    default: {
        outletIssuance: {
            findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(),
        },
        $transaction: vi.fn(),
    },
}));

const record = {
    id: 1, outlet_id: 2, product_id: 3, date: new Date("2026-04-01T00:00:00.000Z"), month: 4, year: 2026,
    quantity: 5, import_batch_id: "manual-test", created_at: new Date(), updated_at: new Date(),
    outlet: { id: 2, code: "T1", name: "Toko 1" }, product: { id: 3, code: "P001", name: "Produk 1" },
};

describe("Outlet Issuance CRUD service", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns grid records with outlet and product dimensions", async () => {
        vi.mocked(prisma.outletIssuance.findMany).mockResolvedValue([record] as never);
        const result = await IssuanceService.grid({ month: 4, year: 2026, page: 1, take: 25, sortOrder: "desc" });
        expect(result.columns).toEqual([{ key: "2|2026-04-01", outlet_id: 2, outlet_code: "T1", outlet_name: "Toko 1", date: "2026-04-01" }]);
        expect(result.rows[0]?.values["2|2026-04-01"]).toBe(5);
        expect(result.rows[0]?.ids["2|2026-04-01"]).toBe(1);
    });

    it("creates zero quantity without touching warehouse issuance", async () => {
        const tx = {
            outlet: { findFirst: vi.fn().mockResolvedValue({ id: 2 }) },
            product: { findFirst: vi.fn().mockResolvedValue({ id: 3 }) },
            outletIssuance: { create: vi.fn().mockResolvedValue({ ...record, quantity: 0 }) },
        };
        vi.mocked(prisma.$transaction).mockImplementation((async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never);
        const result = await IssuanceService.create({ outlet_id: 2, product_id: 3, date: "2026-04-01", quantity: 0 });
        expect(result.quantity).toBe(0);
        expect(tx.outletIssuance.create).toHaveBeenCalled();
    });

    it("updates an existing record to zero", async () => {
        const tx = {
            outletIssuance: {
                findUnique: vi.fn().mockResolvedValue({ id: 1, date: record.date }),
                update: vi.fn().mockResolvedValue({ ...record, quantity: 0 }),
            },
            outlet: { findFirst: vi.fn().mockResolvedValue({ id: 2 }) },
            product: { findFirst: vi.fn().mockResolvedValue({ id: 3 }) },
        };
        vi.mocked(prisma.$transaction).mockImplementation((async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never);
        const result = await IssuanceService.update(1, { outlet_id: 2, product_id: 3, date: "2026-04-01", quantity: 0 });
        expect(result.quantity).toBe(0);
        expect(tx.outletIssuance.update).toHaveBeenCalled();
    });

    it("maps a database unique violation to a conflict error", async () => {
        const tx = {
            outlet: { findFirst: vi.fn().mockResolvedValue({ id: 2 }) },
            product: { findFirst: vi.fn().mockResolvedValue({ id: 3 }) },
            outletIssuance: {
                create: vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" })),
            },
        };
        vi.mocked(prisma.$transaction).mockImplementation((async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never);
        await expect(IssuanceService.create({ outlet_id: 2, product_id: 3, date: "2026-04-01", quantity: 4 }))
            .rejects.toThrow("sudah ada");
    });

    it("rejects an update for a missing record", async () => {
        const tx = { outletIssuance: { findUnique: vi.fn().mockResolvedValue(null) } };
        vi.mocked(prisma.$transaction).mockImplementation((async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never);
        await expect(IssuanceService.update(999, { outlet_id: 2, product_id: 3, date: "2026-04-01", quantity: 1 }))
            .rejects.toThrow("Data ISSUANCE tidak ditemukan");
    });
});
