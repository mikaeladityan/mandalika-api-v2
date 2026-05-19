import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { UnitRawMaterialService } from "../../../../module/application/inventory/rm/unit/unit.service.js";

const unitMock = {
    id: 1,
    name: "Kilogram",
    slug: "kilogram",
};

describe("UnitRawMaterialService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("create", () => {
        it("creates unit dengan slug ter-normalize", async () => {
            vi.mocked(prisma.unitRawMaterial.create).mockResolvedValueOnce(unitMock as never);
            const result = await UnitRawMaterialService.create({ name: "  Kilogram  " });
            expect(result.id).toBe(1);
            const call = vi.mocked(prisma.unitRawMaterial.create).mock.calls[0]?.[0];
            expect(call?.data).toMatchObject({ name: "Kilogram", slug: "kilogram" });
        });

        it("throws 400 saat slug duplikat (P2002)", async () => {
            const err = new Prisma.PrismaClientKnownRequestError("dup", {
                code: "P2002",
                clientVersion: "x",
                meta: { target: ["slug"] },
            });
            vi.mocked(prisma.unitRawMaterial.create).mockRejectedValueOnce(err);
            await expect(UnitRawMaterialService.create({ name: "Kilogram" })).rejects.toThrow(
                "Unit dengan nama tersebut sudah tersedia",
            );
        });
    });

    describe("update", () => {
        it("update name + regenerate slug", async () => {
            vi.mocked(prisma.unitRawMaterial.update).mockResolvedValueOnce(unitMock as never);
            await UnitRawMaterialService.update(1, { name: "  Gram  " });
            const call = vi.mocked(prisma.unitRawMaterial.update).mock.calls[0]?.[0];
            expect(call?.data).toMatchObject({ name: "Gram", slug: "gram" });
        });

        it("throws 400 saat name kosong", async () => {
            await expect(UnitRawMaterialService.update(1, {})).rejects.toThrow(
                "Nama unit wajib diisi",
            );
            expect(prisma.unitRawMaterial.update).not.toHaveBeenCalled();
        });

        it("throws 404 saat unit tidak ditemukan (P2025)", async () => {
            const err = new Prisma.PrismaClientKnownRequestError("notfound", {
                code: "P2025",
                clientVersion: "x",
            });
            vi.mocked(prisma.unitRawMaterial.update).mockRejectedValueOnce(err);
            await expect(UnitRawMaterialService.update(999, { name: "X" })).rejects.toThrow(
                ApiError,
            );
        });

        it("throws 400 saat slug bentrok (P2002)", async () => {
            const err = new Prisma.PrismaClientKnownRequestError("dup", {
                code: "P2002",
                clientVersion: "x",
                meta: { target: ["slug"] },
            });
            vi.mocked(prisma.unitRawMaterial.update).mockRejectedValueOnce(err);
            await expect(UnitRawMaterialService.update(1, { name: "Kilogram" })).rejects.toThrow(
                "Unit dengan nama tersebut sudah tersedia",
            );
        });
    });

    describe("detail", () => {
        it("returns unit yang ditemukan", async () => {
            vi.mocked(prisma.unitRawMaterial.findUnique).mockResolvedValueOnce(unitMock as never);
            const result = await UnitRawMaterialService.detail(1);
            expect(result.id).toBe(1);
        });

        it("throws 404 saat tidak ditemukan", async () => {
            vi.mocked(prisma.unitRawMaterial.findUnique).mockResolvedValueOnce(null);
            await expect(UnitRawMaterialService.detail(999)).rejects.toThrow(
                "Unit tidak ditemukan",
            );
        });
    });

    describe("list", () => {
        it("returns paginated units", async () => {
            vi.mocked(prisma.unitRawMaterial.findMany).mockResolvedValueOnce([unitMock] as never);
            vi.mocked(prisma.unitRawMaterial.count).mockResolvedValueOnce(1);
            const result = await UnitRawMaterialService.list({
                page: 1,
                take: 10,
                sortBy: "name",
                sortOrder: "asc",
            });
            expect(result.len).toBe(1);
            expect(result.data).toHaveLength(1);
        });

        it("pakai OR-search untuk name/slug", async () => {
            vi.mocked(prisma.unitRawMaterial.findMany).mockResolvedValueOnce([] as never);
            vi.mocked(prisma.unitRawMaterial.count).mockResolvedValueOnce(0);
            await UnitRawMaterialService.list({
                page: 1,
                take: 10,
                sortBy: "name",
                sortOrder: "asc",
                search: "kg",
            });
            const call = vi.mocked(prisma.unitRawMaterial.findMany).mock.calls[0]?.[0];
            expect(call?.where).toMatchObject({ OR: expect.any(Array) });
        });

        it("where kosong saat search tidak diberi", async () => {
            vi.mocked(prisma.unitRawMaterial.findMany).mockResolvedValueOnce([] as never);
            vi.mocked(prisma.unitRawMaterial.count).mockResolvedValueOnce(0);
            await UnitRawMaterialService.list({
                page: 1,
                take: 10,
                sortBy: "id",
                sortOrder: "asc",
            });
            const call = vi.mocked(prisma.unitRawMaterial.findMany).mock.calls[0]?.[0];
            expect(call?.where).toEqual({});
        });
    });

    describe("delete", () => {
        it("delete unit yang tidak terpakai", async () => {
            vi.mocked(prisma.rawMaterial.count).mockResolvedValueOnce(0);
            vi.mocked(prisma.unitRawMaterial.delete).mockResolvedValueOnce(unitMock as never);
            const result = await UnitRawMaterialService.delete(1);
            expect(result.deleted).toBe(1);
        });

        it("throws 400 saat unit masih dipakai RM", async () => {
            vi.mocked(prisma.rawMaterial.count).mockResolvedValueOnce(3);
            await expect(UnitRawMaterialService.delete(1)).rejects.toThrow(
                "Satuan masih digunakan oleh beberapa Raw Material",
            );
            expect(prisma.unitRawMaterial.delete).not.toHaveBeenCalled();
        });

        it("throws 404 saat unit tidak ditemukan (P2025)", async () => {
            vi.mocked(prisma.rawMaterial.count).mockResolvedValueOnce(0);
            const err = new Prisma.PrismaClientKnownRequestError("notfound", {
                code: "P2025",
                clientVersion: "x",
            });
            vi.mocked(prisma.unitRawMaterial.delete).mockRejectedValueOnce(err);
            await expect(UnitRawMaterialService.delete(999)).rejects.toThrow(ApiError);
        });
    });
});
