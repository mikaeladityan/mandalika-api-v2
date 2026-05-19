import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { RawMatCategoryService } from "../../../../module/application/inventory/rm/category/category.service.js";

const categoryMock = {
    id: 1,
    name: "Kain",
    slug: "kain",
    status: "ACTIVE" as const,
    created_at: new Date(),
    updated_at: new Date(),
};

describe("RawMatCategoryService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("create", () => {
        it("creates category dengan slug ter-normalize", async () => {
            vi.mocked(prisma.rawMatCategories.create).mockResolvedValueOnce(categoryMock as never);
            const result = await RawMatCategoryService.create({ name: "  Kain  " });
            expect(result.id).toBe(1);
            const call = vi.mocked(prisma.rawMatCategories.create).mock.calls[0]?.[0];
            expect(call?.data).toMatchObject({ name: "Kain", slug: "kain", status: "ACTIVE" });
        });

        it("memakai status dari payload kalau ada", async () => {
            vi.mocked(prisma.rawMatCategories.create).mockResolvedValueOnce(categoryMock as never);
            await RawMatCategoryService.create({ name: "Kain", status: "BLOCK" });
            const call = vi.mocked(prisma.rawMatCategories.create).mock.calls[0]?.[0];
            expect(call?.data).toMatchObject({ status: "BLOCK" });
        });

        it("throws 400 saat slug duplikat (P2002)", async () => {
            const err = new Prisma.PrismaClientKnownRequestError("dup", {
                code: "P2002",
                clientVersion: "x",
                meta: { target: ["slug"] },
            });
            vi.mocked(prisma.rawMatCategories.create).mockRejectedValueOnce(err);
            await expect(RawMatCategoryService.create({ name: "Kain" })).rejects.toThrow(
                "Category dengan nama tersebut sudah tersedia",
            );
        });
    });

    describe("update", () => {
        it("update name + auto regenerate slug", async () => {
            vi.mocked(prisma.rawMatCategories.update).mockResolvedValueOnce(categoryMock as never);
            await RawMatCategoryService.update(1, { name: "  Benang  " });
            const call = vi.mocked(prisma.rawMatCategories.update).mock.calls[0]?.[0];
            expect(call?.data).toMatchObject({ name: "Benang", slug: "benang" });
        });

        it("partial update status saja tanpa rename slug", async () => {
            vi.mocked(prisma.rawMatCategories.update).mockResolvedValueOnce(categoryMock as never);
            await RawMatCategoryService.update(1, { status: "BLOCK" });
            const call = vi.mocked(prisma.rawMatCategories.update).mock.calls[0]?.[0];
            expect(call?.data).toEqual({ status: "BLOCK" });
        });

        it("throws 404 saat category tidak ditemukan (P2025)", async () => {
            const err = new Prisma.PrismaClientKnownRequestError("notfound", {
                code: "P2025",
                clientVersion: "x",
            });
            vi.mocked(prisma.rawMatCategories.update).mockRejectedValueOnce(err);
            await expect(RawMatCategoryService.update(999, { name: "X" })).rejects.toThrow(
                ApiError,
            );
        });

        it("throws 400 saat slug bentrok (P2002)", async () => {
            const err = new Prisma.PrismaClientKnownRequestError("dup", {
                code: "P2002",
                clientVersion: "x",
                meta: { target: ["slug"] },
            });
            vi.mocked(prisma.rawMatCategories.update).mockRejectedValueOnce(err);
            await expect(RawMatCategoryService.update(1, { name: "Kain" })).rejects.toThrow(
                "Category dengan nama tersebut sudah tersedia",
            );
        });
    });

    describe("changeStatus", () => {
        it("mengganti status", async () => {
            vi.mocked(prisma.rawMatCategories.update).mockResolvedValueOnce(categoryMock as never);
            await RawMatCategoryService.changeStatus(1, "BLOCK");
            const call = vi.mocked(prisma.rawMatCategories.update).mock.calls[0]?.[0];
            expect(call?.data).toEqual({ status: "BLOCK" });
        });

        it("throws 404 saat tidak ditemukan (P2025)", async () => {
            const err = new Prisma.PrismaClientKnownRequestError("notfound", {
                code: "P2025",
                clientVersion: "x",
            });
            vi.mocked(prisma.rawMatCategories.update).mockRejectedValueOnce(err);
            await expect(RawMatCategoryService.changeStatus(999, "ACTIVE")).rejects.toThrow(
                ApiError,
            );
        });
    });

    describe("detail", () => {
        it("returns category yang ditemukan", async () => {
            vi.mocked(prisma.rawMatCategories.findUnique).mockResolvedValueOnce(
                categoryMock as never,
            );
            const result = await RawMatCategoryService.detail(1);
            expect(result.id).toBe(1);
        });

        it("throws 404 saat tidak ditemukan", async () => {
            vi.mocked(prisma.rawMatCategories.findUnique).mockResolvedValueOnce(null);
            await expect(RawMatCategoryService.detail(999)).rejects.toThrow(
                "Category tidak ditemukan",
            );
        });
    });

    describe("list", () => {
        it("returns paginated categories", async () => {
            vi.mocked(prisma.rawMatCategories.findMany).mockResolvedValueOnce([
                categoryMock,
            ] as never);
            vi.mocked(prisma.rawMatCategories.count).mockResolvedValueOnce(1);
            const result = await RawMatCategoryService.list({
                page: 1,
                take: 10,
                sortBy: "updated_at",
                sortOrder: "desc",
            });
            expect(result.len).toBe(1);
            expect(result.data).toHaveLength(1);
        });

        it("pakai OR-search untuk name/slug", async () => {
            vi.mocked(prisma.rawMatCategories.findMany).mockResolvedValueOnce([] as never);
            vi.mocked(prisma.rawMatCategories.count).mockResolvedValueOnce(0);
            await RawMatCategoryService.list({
                page: 1,
                take: 10,
                sortBy: "name",
                sortOrder: "asc",
                search: "kain",
            });
            const call = vi.mocked(prisma.rawMatCategories.findMany).mock.calls[0]?.[0];
            expect(call?.where).toMatchObject({ OR: expect.any(Array) });
        });

        it("filter status diteruskan ke where", async () => {
            vi.mocked(prisma.rawMatCategories.findMany).mockResolvedValueOnce([] as never);
            vi.mocked(prisma.rawMatCategories.count).mockResolvedValueOnce(0);
            await RawMatCategoryService.list({
                page: 1,
                take: 10,
                sortBy: "updated_at",
                sortOrder: "desc",
                status: "BLOCK",
            });
            const call = vi.mocked(prisma.rawMatCategories.findMany).mock.calls[0]?.[0];
            expect(call?.where).toMatchObject({ status: "BLOCK" });
        });
    });

    describe("delete", () => {
        it("delete category yang tidak terpakai", async () => {
            vi.mocked(prisma.rawMaterial.count).mockResolvedValueOnce(0);
            vi.mocked(prisma.rawMatCategories.delete).mockResolvedValueOnce(categoryMock as never);
            const result = await RawMatCategoryService.delete(1);
            expect(result.deleted).toBe(1);
        });

        it("throws 400 saat category masih dipakai RM", async () => {
            vi.mocked(prisma.rawMaterial.count).mockResolvedValueOnce(5);
            await expect(RawMatCategoryService.delete(1)).rejects.toThrow(
                "Category masih digunakan oleh beberapa Raw Material",
            );
            expect(prisma.rawMatCategories.delete).not.toHaveBeenCalled();
        });

        it("throws 404 saat category tidak ditemukan (P2025)", async () => {
            vi.mocked(prisma.rawMaterial.count).mockResolvedValueOnce(0);
            const err = new Prisma.PrismaClientKnownRequestError("notfound", {
                code: "P2025",
                clientVersion: "x",
            });
            vi.mocked(prisma.rawMatCategories.delete).mockRejectedValueOnce(err);
            await expect(RawMatCategoryService.delete(999)).rejects.toThrow(ApiError);
        });
    });
});
