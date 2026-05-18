import { describe, it, expect, vi, beforeEach } from "vitest";
import { FGService } from "../../../module/application/inventory/fg/fg.service.js";
import { ApiError } from "../../../lib/errors/api.error.js";
import prisma from "../../../config/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { STATUS } from "../../../generated/prisma/enums.js";
import type { RequestFGDTO } from "../../../module/application/inventory/fg/fg.schema.js";

const makeFGBody = (overrides: Partial<RequestFGDTO> = {}): RequestFGDTO => ({
    code: "FG_001",
    name: "FG Test Product",
    size: 100,
    gender: "UNISEX",
    status: "PENDING",
    z_value: 1.65,
    lead_time: 14,
    review_period: 30,
    product_type: "Parfum",
    distribution_percentage: 0,
    safety_percentage: 0,
    description: null,
    ...overrides,
});

describe("FGService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("create", () => {
        it("creates FG and serializes Decimal fields ke Number", async () => {
            const result = await FGService.create(makeFGBody());

            expect(result).toBeDefined();
            expect(result.code).toBe("TSHIRT"); // dari global tx mock
            expect(typeof result.z_value).toBe("number");
            expect(prisma.$transaction).toHaveBeenCalled();
        });

        it("throws ApiError 400 saat Prisma P2002 unique violation", async () => {
            const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
                code: "P2002",
                clientVersion: "test",
            });
            vi.mocked(prisma.$transaction).mockRejectedValueOnce(p2002);

            await expect(FGService.create(makeFGBody({ code: "DUP_001" }))).rejects.toBeInstanceOf(
                ApiError,
            );
        });

        it("re-throws non-P2002 errors apa adanya", async () => {
            const otherErr = new Error("DB connection lost");
            vi.mocked(prisma.$transaction).mockRejectedValueOnce(otherErr);

            await expect(FGService.create(makeFGBody())).rejects.toThrow("DB connection lost");
        });
    });

    describe("update", () => {
        it("throws 404 jika produk tidak ditemukan", async () => {
            vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(null);

            await expect(FGService.update(999, { name: "X" })).rejects.toBeInstanceOf(ApiError);
        });

        it("updates produk yang ada dan serialize Decimals", async () => {
            const result = await FGService.update(1, { name: "Updated Name" });

            expect(result).toBeDefined();
            expect(typeof result.z_value).toBe("number");
        });

        it("throws ApiError 400 saat update menabrak P2002", async () => {
            const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
                code: "P2002",
                clientVersion: "test",
            });
            vi.mocked(prisma.$transaction).mockRejectedValueOnce(p2002);

            await expect(FGService.update(1, { code: "EXISTING_CODE" })).rejects.toBeInstanceOf(
                ApiError,
            );
        });
    });

    describe("status", () => {
        it("throws 404 jika produk tidak ada", async () => {
            vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(null);

            await expect(FGService.status(999, STATUS.ACTIVE)).rejects.toBeInstanceOf(ApiError);
        });

        it("set deleted_at = Date saat status DELETE", async () => {
            await FGService.status(1, STATUS.DELETE);

            expect(prisma.product.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 1 },
                    data: expect.objectContaining({
                        status: STATUS.DELETE,
                        deleted_at: expect.any(Date),
                    }),
                }),
            );
        });

        it("set deleted_at = null saat status non-DELETE", async () => {
            await FGService.status(1, STATUS.ACTIVE);

            expect(prisma.product.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 1 },
                    data: expect.objectContaining({
                        status: STATUS.ACTIVE,
                        deleted_at: null,
                    }),
                }),
            );
        });
    });

    describe("bulkStatus", () => {
        it("throws 400 jika ids kosong", async () => {
            await expect(FGService.bulkStatus([], STATUS.ACTIVE)).rejects.toBeInstanceOf(ApiError);
        });

        it("throws 404 jika tidak ada produk yang match", async () => {
            vi.mocked(prisma.product.updateMany).mockResolvedValueOnce({ count: 0 });

            await expect(FGService.bulkStatus([999], STATUS.ACTIVE)).rejects.toBeInstanceOf(
                ApiError,
            );
        });

        it("returns affected count saat sukses", async () => {
            vi.mocked(prisma.product.updateMany).mockResolvedValueOnce({ count: 3 });

            const result = await FGService.bulkStatus([1, 2, 3], STATUS.ACTIVE);

            expect(result.affected).toBe(3);
        });
    });

    describe("list", () => {
        it("returns data + total len dengan default sort updated_at", async () => {
            vi.mocked(prisma.product.findMany).mockResolvedValueOnce([
                {
                    id: 1,
                    code: "FG_001",
                    name: "FG One",
                    z_value: "1.65",
                    distribution_percentage: "0.5",
                    safety_percentage: "0.1",
                    product_type: { id: 1, name: "Parfum", slug: "parfum" },
                    size: { id: 1, size: 100 },
                } as never,
            ]);
            vi.mocked(prisma.product.count).mockResolvedValueOnce(1);

            const result = await FGService.list({ page: 1, take: 10, sortBy: "updated_at", sortOrder: "desc" });

            expect(result.data).toHaveLength(1);
            expect(result.len).toBe(1);
            expect(result.data[0]?.z_value).toBe(1.65);
            expect(result.data[0]?.product_type).toBe("Parfum");
            expect(result.data[0]?.size).toBe("100 ML");
        });

        it("filter status default ke != DELETE saat status undefined", async () => {
            vi.mocked(prisma.product.findMany).mockResolvedValueOnce([]);
            vi.mocked(prisma.product.count).mockResolvedValueOnce(0);

            await FGService.list({ page: 1, take: 10, sortBy: "updated_at", sortOrder: "desc" });

            expect(prisma.product.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        status: { not: STATUS.DELETE },
                    }),
                }),
            );
        });
    });

    describe("detail", () => {
        it("throws 404 jika produk tidak ditemukan", async () => {
            vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(null);

            await expect(FGService.detail(999)).rejects.toBeInstanceOf(ApiError);
        });

        it("flatten size/unit/product_type ke string", async () => {
            vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
                id: 1,
                code: "FG_001",
                name: "FG One",
                z_value: "1.65",
                distribution_percentage: "0.5",
                safety_percentage: "0.1",
                product_type: { id: 1, name: "Parfum", slug: "parfum" },
                size: { id: 1, size: 100 },
                product_inventories: [],
                recipes: [],
            } as never);

            const result = await FGService.detail(1);

            expect(result.size).toBe("100 ML");
            expect(result.product_type).toBe("Parfum");
            expect(typeof result.z_value).toBe("number");
        });
    });

    describe("export", () => {
        it("throws 400 saat data melebihi EXPORT_MAX_ROWS", async () => {
            // Mock list() return len > 50_000
            vi.mocked(prisma.product.findMany).mockResolvedValueOnce([]);
            vi.mocked(prisma.product.count).mockResolvedValueOnce(60_000);

            await expect(FGService.export({ page: 1, take: 10, sortBy: "updated_at", sortOrder: "desc" })).rejects.toBeInstanceOf(ApiError);
        });

        it("returns CSV buffer saat data dalam batas", async () => {
            vi.mocked(prisma.product.findMany).mockResolvedValueOnce([
                {
                    id: 1,
                    code: "FG_001",
                    name: "FG One",
                    gender: "UNISEX",
                    status: "ACTIVE",
                    z_value: "1.65",
                    distribution_percentage: "0.5",
                    safety_percentage: "0.1",
                    lead_time: 14,
                    product_type: { id: 1, name: "Parfum", slug: "parfum" },
                    size: { id: 1, size: 100 },
                } as never,
            ]);
            vi.mocked(prisma.product.count).mockResolvedValueOnce(1);

            const buffer = await FGService.export({ page: 1, take: 10, sortBy: "updated_at", sortOrder: "desc" });

            expect(buffer).toBeDefined();
            // Buffer-like (ArrayBuffer / Uint8Array)
            expect(buffer.byteLength).toBeGreaterThan(0);
        });
    });

    describe("clean", () => {
        it("throws 400 saat tidak ada produk dengan deleted_at != null", async () => {
            vi.mocked(prisma.$transaction).mockImplementationOnce(((cb: unknown) => {
                const fn = cb as (tx: { product: { findMany: () => Promise<unknown[]> } }) => unknown;
                return fn({ product: { findMany: async () => [] } });
            }) as never);

            await expect(FGService.clean()).rejects.toBeInstanceOf(ApiError);
        });

        it("throws 409 saat produk masih terkait Production Order (RESTRICT FK)", async () => {
            vi.mocked(prisma.$transaction).mockImplementationOnce(((cb: unknown) => {
                const fn = cb as (tx: {
                    product: { findMany: () => Promise<Array<{ id: number }>> };
                    productionOrder: { count: () => Promise<number> };
                }) => unknown;
                return fn({
                    product: { findMany: async () => [{ id: 1 }] },
                    productionOrder: { count: async () => 5 },
                });
            }) as never);

            await expect(FGService.clean()).rejects.toThrow(/Production Order/);
        });
    });
});
