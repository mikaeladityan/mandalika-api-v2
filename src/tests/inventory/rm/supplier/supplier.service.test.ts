import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupplierService } from "../../../../module/application/inventory/rm/supplier/supplier.service.js";
import prisma from "../../../../config/prisma.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { SUPPLIER_OBSCURE_REGEX } from "../../../../lib/utils/supplier-obscure.js";

const supplierMock = {
    id: 1,
    name: "PT Supplier ABC",
    slug: "pt-supplier-abc",
    addresses: "Jl. Test 1",
    country: "Indonesia",
    phone: null,
    source: "LOCAL",
    created_at: new Date(),
    updated_at: new Date(),
};

describe("SupplierService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("create", () => {
        it("creates supplier successfully", async () => {
            vi.mocked(prisma.supplier.create).mockResolvedValueOnce(supplierMock as never);
            const result = await SupplierService.create({
                name: "PT Supplier ABC",
                addresses: "Jl. Test 1",
                country: "Indonesia",
                source: "LOCAL",
            });
            expect(result.id).toBe(1);
            expect(result.name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(result.name).toHaveLength(7);
            expect(prisma.supplier.create).toHaveBeenCalledOnce();
        });

        it("throws 400 saat phone duplikat (P2002)", async () => {
            const err = new Prisma.PrismaClientKnownRequestError("dup", {
                code: "P2002",
                clientVersion: "x",
                meta: { target: ["phone"] },
            });
            vi.mocked(prisma.supplier.create).mockRejectedValueOnce(err);
            await expect(
                SupplierService.create({
                    name: "X",
                    addresses: "Y",
                    country: "Z",
                    phone: "08000",
                    source: "LOCAL",
                }),
            ).rejects.toThrow("Nomor telepon supplier sudah digunakan");
        });

        it("throws 400 saat slug duplikat (P2002)", async () => {
            const err = new Prisma.PrismaClientKnownRequestError("dup", {
                code: "P2002",
                clientVersion: "x",
                meta: { target: ["slug"] },
            });
            vi.mocked(prisma.supplier.create).mockRejectedValueOnce(err);
            await expect(
                SupplierService.create({
                    name: "Duplicate Name",
                    addresses: "Y",
                    country: "Z",
                    source: "LOCAL",
                }),
            ).rejects.toThrow("Nama supplier sudah digunakan");
        });
    });

    describe("update", () => {
        it("updates supplier successfully", async () => {
            vi.mocked(prisma.supplier.update).mockResolvedValueOnce(supplierMock as never);
            const result = await SupplierService.update(1, { name: "New Name" });
            expect(result.id).toBe(1);
            expect(result.name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(result.name).toHaveLength(7);
            expect(prisma.supplier.update).toHaveBeenCalledOnce();
        });

        it("throws 404 saat supplier tidak ditemukan (P2025)", async () => {
            const err = new Prisma.PrismaClientKnownRequestError("notfound", {
                code: "P2025",
                clientVersion: "x",
            });
            vi.mocked(prisma.supplier.update).mockRejectedValueOnce(err);
            await expect(SupplierService.update(999, { name: "X" })).rejects.toThrow(ApiError);
        });
    });

    describe("detail", () => {
        it("returns supplier", async () => {
            vi.mocked(prisma.supplier.findUnique).mockResolvedValueOnce(supplierMock as never);
            const result = await SupplierService.detail(1);
            expect(result.id).toBe(1);
            expect(result.name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(result.name).toHaveLength(7);
        });

        it("throws 404 saat tidak ditemukan", async () => {
            vi.mocked(prisma.supplier.findUnique).mockResolvedValueOnce(null);
            await expect(SupplierService.detail(999)).rejects.toThrow("Supplier tidak ditemukan");
        });
    });

    describe("delete", () => {
        it("deletes supplier yang tidak terpakai", async () => {
            vi.mocked(prisma.supplierMaterial.count).mockResolvedValueOnce(0);
            vi.mocked(prisma.supplier.delete).mockResolvedValueOnce(supplierMock as never);
            const result = await SupplierService.delete(1);
            expect(result.deleted).toBe(1);
        });

        it("throws 400 saat supplier masih dipakai", async () => {
            vi.mocked(prisma.supplierMaterial.count).mockResolvedValueOnce(3);
            await expect(SupplierService.delete(1)).rejects.toThrow(
                "Supplier masih digunakan oleh beberapa Raw Material",
            );
            expect(prisma.supplier.delete).not.toHaveBeenCalled();
        });
    });

    describe("bulkDelete", () => {
        it("hapus semua jika tidak ada yang dipakai", async () => {
            vi.mocked(prisma.supplier.findMany).mockResolvedValueOnce([]);
            vi.mocked(prisma.supplier.deleteMany).mockResolvedValueOnce({ count: 2 });
            const result = await SupplierService.bulkDelete([1, 2]);
            expect(result.deleted).toBe(2);
        });

        it("throws 400 dengan nama supplier yang masih dipakai", async () => {
            vi.mocked(prisma.supplier.findMany).mockResolvedValueOnce([
                { id: 1, name: "PT ABC" },
            ] as never);
            await expect(SupplierService.bulkDelete([1, 2])).rejects.toThrow(
                /Beberapa supplier \(SUP-001\) masih digunakan/,
            );
        });

        it("throws 404 jika tidak ada supplier yang cocok", async () => {
            vi.mocked(prisma.supplier.findMany).mockResolvedValueOnce([]);
            vi.mocked(prisma.supplier.deleteMany).mockResolvedValueOnce({ count: 0 });
            await expect(SupplierService.bulkDelete([999])).rejects.toThrow(
                "Tidak ada supplier yang cocok",
            );
        });
    });

    describe("list", () => {
        it("returns paginated suppliers", async () => {
            vi.mocked(prisma.supplier.findMany).mockResolvedValueOnce([supplierMock] as never);
            vi.mocked(prisma.supplier.count).mockResolvedValueOnce(1);
            const result = await SupplierService.list({
                page: 1,
                take: 10,
                sortBy: "updated_at",
                sortOrder: "desc",
            });
            expect(result.len).toBe(1);
            expect(result.data).toHaveLength(1);
        });

        it("uses OR-search ketika search disediakan", async () => {
            vi.mocked(prisma.supplier.findMany).mockResolvedValueOnce([] as never);
            vi.mocked(prisma.supplier.count).mockResolvedValueOnce(0);
            await SupplierService.list({
                page: 1,
                take: 10,
                sortBy: "name",
                sortOrder: "asc",
                search: "abc",
            });
            const call = vi.mocked(prisma.supplier.findMany).mock.calls[0]?.[0];
            expect(call?.where).toMatchObject({ OR: expect.any(Array) });
        });

        it("masks supplier identity in list response (anonymous code only)", async () => {
            vi.mocked(prisma.supplier.findMany).mockResolvedValueOnce([supplierMock] as never);
            vi.mocked(prisma.supplier.count).mockResolvedValueOnce(1);
            const { data } = await SupplierService.list({
                page: 1,
                take: 10,
                sortBy: "updated_at",
                sortOrder: "desc",
            });
            for (const row of data) {
                expect(row.name).toMatch(SUPPLIER_OBSCURE_REGEX);
                expect(row.name).toHaveLength(7);
                expect((row as any).slug).toBeNull();
            }
        });
    });
});
