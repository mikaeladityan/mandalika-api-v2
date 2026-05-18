import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { FGTypeService } from "../../../../module/application/inventory/fg/type/type.service.js";

describe("FGTypeService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("create", () => {
        it("creates with normalized slug", async () => {
            const result = await FGTypeService.create({ name: "New Type" });
            expect(result.id).toBeDefined();
            const callArgs = vi.mocked(prisma.productType.create).mock.calls[0]?.[0];
            expect(callArgs?.data.name).toBe("New Type");
            expect(callArgs?.data.slug).toBeDefined();
        });

        it("throws ApiError 400 on P2002", async () => {
            const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
                code: "P2002",
                clientVersion: "test",
            });
            vi.mocked(prisma.productType.create).mockRejectedValueOnce(p2002);
            await expect(FGTypeService.create({ name: "Dup" })).rejects.toBeInstanceOf(ApiError);
        });
    });

    describe("list", () => {
        it("returns data + count", async () => {
            const result = await FGTypeService.list({ page: 1, take: 25 });
            expect(result.data).toBeDefined();
            expect(typeof result.len).toBe("number");
        });

        it("applies case-insensitive contains filter when search provided", async () => {
            await FGTypeService.list({ page: 1, take: 25, search: "par" });
            expect(vi.mocked(prisma.productType.findMany).mock.calls[0]?.[0]).toMatchObject({
                where: { name: { contains: "par", mode: "insensitive" } },
            });
        });
    });

    describe("update", () => {
        it("returns current row when body.name undefined", async () => {
            const result = await FGTypeService.update(1, {});
            expect(result.id).toBe(1);
            expect(prisma.productType.update).not.toHaveBeenCalled();
        });

        it("throws 404 when undefined body and row missing", async () => {
            vi.mocked(prisma.productType.findUnique).mockResolvedValueOnce(null);
            await expect(FGTypeService.update(999, {})).rejects.toBeInstanceOf(ApiError);
        });

        it("updates name and recomputes slug", async () => {
            const result = await FGTypeService.update(1, { name: "Renamed" });
            expect(result.id).toBe(1);
            const args = vi.mocked(prisma.productType.update).mock.calls[0]?.[0];
            expect(args?.data.name).toBe("Renamed");
            expect(args?.data.slug).toBeDefined();
        });

        it("throws 404 on P2025", async () => {
            const p2025 = new Prisma.PrismaClientKnownRequestError("nf", {
                code: "P2025",
                clientVersion: "test",
            });
            vi.mocked(prisma.productType.update).mockRejectedValueOnce(p2025);
            await expect(FGTypeService.update(1, { name: "X" })).rejects.toBeInstanceOf(ApiError);
        });

        it("throws 400 on P2002", async () => {
            const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
                code: "P2002",
                clientVersion: "test",
            });
            vi.mocked(prisma.productType.update).mockRejectedValueOnce(p2002);
            await expect(FGTypeService.update(1, { name: "X" })).rejects.toBeInstanceOf(ApiError);
        });
    });

    describe("delete", () => {
        it("deletes when no products reference it", async () => {
            vi.mocked(prisma.productType.findUnique).mockResolvedValueOnce({
                _count: { products: 0 },
            } as never);

            await FGTypeService.delete(1);
            expect(prisma.productType.delete).toHaveBeenCalledWith({ where: { id: 1 } });
        });

        it("throws 404 when not found", async () => {
            vi.mocked(prisma.productType.findUnique).mockResolvedValueOnce(null);
            await expect(FGTypeService.delete(999)).rejects.toBeInstanceOf(ApiError);
        });

        it("throws 400 when still in use", async () => {
            vi.mocked(prisma.productType.findUnique).mockResolvedValueOnce({
                _count: { products: 5 },
            } as never);
            await expect(FGTypeService.delete(1)).rejects.toBeInstanceOf(ApiError);
            expect(prisma.productType.delete).not.toHaveBeenCalled();
        });
    });
});
