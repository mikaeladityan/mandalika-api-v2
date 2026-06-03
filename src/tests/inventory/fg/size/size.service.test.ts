import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { FGSizeService } from "../../../../module/application/inventory/fg/size/size.service.js";

describe("FGSizeService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("create", () => {
        it("creates a new size", async () => {
            const result = await FGSizeService.create({ size: 44 });
            expect(result.size).toBe(44);
            expect(prisma.productSize.create).toHaveBeenCalledWith({ data: { size: 44 } });
        });

        it("throws ApiError 400 on P2002 unique violation", async () => {
            const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
                code: "P2002",
                clientVersion: "test",
            });
            vi.mocked(prisma.productSize.create).mockRejectedValueOnce(p2002);

            await expect(FGSizeService.create({ size: 44 })).rejects.toBeInstanceOf(ApiError);
        });

        it("re-throws non-P2002 errors", async () => {
            vi.mocked(prisma.productSize.create).mockRejectedValueOnce(new Error("db down"));
            await expect(FGSizeService.create({ size: 44 })).rejects.toThrow("db down");
        });
    });

    describe("list", () => {
        it("returns paginated data + count", async () => {
            const result = await FGSizeService.list({ page: 1, take: 25 });
            expect(result.data).toBeDefined();
            expect(typeof result.len).toBe("number");
            expect(prisma.productSize.findMany).toHaveBeenCalled();
            expect(prisma.productSize.count).toHaveBeenCalled();
        });

        it("applies size filter when search provided", async () => {
            await FGSizeService.list({ page: 1, take: 25, search: 40 });
            expect(vi.mocked(prisma.productSize.findMany).mock.calls[0]?.[0]).toMatchObject({
                where: { size: 40 },
            });
        });
    });

    describe("update", () => {
        it("returns current row when body.size is undefined", async () => {
            const result = await FGSizeService.update(1, {});
            expect(result.id).toBe(1);
            expect(prisma.productSize.update).not.toHaveBeenCalled();
        });

        it("throws 404 when undefined body but row missing", async () => {
            vi.mocked(prisma.productSize.findUnique).mockResolvedValueOnce(null);
            await expect(FGSizeService.update(999, {})).rejects.toBeInstanceOf(ApiError);
        });

        it("updates size", async () => {
            const result = await FGSizeService.update(1, { size: 39 });
            expect(result.size).toBe(39);
            expect(prisma.productSize.update).toHaveBeenCalledWith({
                where: { id: 1 },
                data: { size: 39 },
            });
        });

        it("throws 404 on P2025", async () => {
            const p2025 = new Prisma.PrismaClientKnownRequestError("notfound", {
                code: "P2025",
                clientVersion: "test",
            });
            vi.mocked(prisma.productSize.update).mockRejectedValueOnce(p2025);

            await expect(FGSizeService.update(1, { size: 39 })).rejects.toBeInstanceOf(ApiError);
        });

        it("throws 400 on P2002", async () => {
            const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
                code: "P2002",
                clientVersion: "test",
            });
            vi.mocked(prisma.productSize.update).mockRejectedValueOnce(p2002);

            await expect(FGSizeService.update(1, { size: 39 })).rejects.toBeInstanceOf(ApiError);
        });
    });

    describe("delete", () => {
        it("deletes when no related products", async () => {
            vi.mocked(prisma.productSize.findUnique).mockResolvedValueOnce({
                _count: { products: 0 },
            } as never);

            await FGSizeService.delete(1);
            expect(prisma.productSize.delete).toHaveBeenCalledWith({ where: { id: 1 } });
        });

        it("throws 404 when not found", async () => {
            vi.mocked(prisma.productSize.findUnique).mockResolvedValueOnce(null);
            await expect(FGSizeService.delete(999)).rejects.toBeInstanceOf(ApiError);
        });

        it("throws 400 when still referenced by products", async () => {
            vi.mocked(prisma.productSize.findUnique).mockResolvedValueOnce({
                _count: { products: 3 },
            } as never);

            await expect(FGSizeService.delete(1)).rejects.toBeInstanceOf(ApiError);
            expect(prisma.productSize.delete).not.toHaveBeenCalled();
        });
    });
});
