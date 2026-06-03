import { describe, it, expect, vi, beforeEach } from "vitest";
import { TypeService } from "../../module/application/product/type/type.service.js";
import prisma from "../../config/prisma.js";
import { ApiError } from "../../lib/errors/api.error.js";
import { Prisma } from "../../generated/prisma/client.js";

const makePrismaError = (code: string, msg: string) =>
    new Prisma.PrismaClientKnownRequestError(msg, { code, clientVersion: "test" });

describe("TypeService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("create", () => {
        it("should throw 400 if type name already exists (P2002)", async () => {
            // @ts-ignore
            prisma.productType.create.mockRejectedValueOnce(
                makePrismaError("P2002", "Unique constraint failed on slug"),
            );

            await expect(TypeService.create({ name: "Apparel" })).rejects.toThrow(ApiError);
        });

        it("should create type successfully when name is unique", async () => {
            // @ts-ignore
            prisma.productType.create.mockResolvedValue({
                id: 5,
                name: "Footwear",
                slug: "footwear",
            });

            const result = await TypeService.create({ name: "Footwear" });

            expect(result.id).toBe(5);
            expect(result.slug).toBe("footwear");
            // @ts-ignore
            expect(prisma.productType.create).toHaveBeenCalledOnce();
        });
    });

    describe("list", () => {
        it("should return list with total count", async () => {
            // @ts-ignore
            prisma.productType.findMany.mockResolvedValue([
                { id: 1, name: "Apparel", slug: "apparel" },
                { id: 2, name: "Accessories", slug: "accessories" },
            ]);
            // @ts-ignore
            prisma.productType.count.mockResolvedValue(2);

            const result = await TypeService.list({ page: 1, take: 10 });

            expect(result.data).toHaveLength(2);
            expect(result.len).toBe(2);
        });

        it("should apply search filter to query", async () => {
            // @ts-ignore
            prisma.productType.findMany.mockResolvedValue([
                { id: 1, name: "Apparel", slug: "apparel" },
            ]);
            // @ts-ignore
            prisma.productType.count.mockResolvedValue(1);

            const result = await TypeService.list({ search: "apparel", page: 1, take: 10 });

            expect(result.len).toBe(1);
            // @ts-ignore
            expect(prisma.productType.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ name: expect.anything() }),
                }),
            );
        });
    });

    describe("update", () => {
        it("should throw 404 if type not found (P2025)", async () => {
            // @ts-ignore
            prisma.productType.update.mockRejectedValueOnce(
                makePrismaError("P2025", "Record to update not found"),
            );

            await expect(TypeService.update(999, { name: "New" })).rejects.toThrow(ApiError);
        });

        it("should throw 400 if new name slug conflicts (P2002)", async () => {
            // @ts-ignore
            prisma.productType.update.mockRejectedValueOnce(
                makePrismaError("P2002", "Unique constraint failed on slug"),
            );

            await expect(TypeService.update(1, { name: "Accessories" })).rejects.toThrow(ApiError);
        });

        it("should update type successfully", async () => {
            // @ts-ignore
            prisma.productType.update.mockResolvedValue({
                id: 1,
                name: "Fashion",
                slug: "fashion",
            });

            const result = await TypeService.update(1, { name: "Fashion" });

            expect(result.name).toBe("Fashion");
        });
    });

    describe("delete", () => {
        it("should throw 404 if type not found (P2025)", async () => {
            // @ts-ignore
            prisma.productType.delete.mockRejectedValueOnce(
                makePrismaError("P2025", "Record to delete not found"),
            );

            await expect(TypeService.delete(999)).rejects.toThrow(ApiError);
        });

        it("should throw 409 if type still used by products (P2003)", async () => {
            // @ts-ignore
            prisma.productType.delete.mockRejectedValueOnce(
                makePrismaError("P2003", "Foreign key constraint failed"),
            );

            await expect(TypeService.delete(1)).rejects.toThrow(ApiError);
        });

        it("should delete type successfully when not referenced", async () => {
            // @ts-ignore
            prisma.productType.delete.mockResolvedValue({ id: 1 });

            await expect(TypeService.delete(1)).resolves.toBeUndefined();
            // @ts-ignore
            expect(prisma.productType.delete).toHaveBeenCalledWith({ where: { id: 1 } });
        });
    });
});
