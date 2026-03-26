import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutletService } from "../../module/application/outlet/outlet.service.js";
import prisma from "../../config/prisma.js";
import { ApiError } from "../../lib/errors/api.error.js";

const mockOutlet = {
    id: 1,
    name: "Toko Utama",
    code: "TOKO001",
    phone: null,
    is_active: true,
    warehouse_id: 1,
    deleted_at: null,
    created_at: new Date(),
    updated_at: null,
    address: null,
    warehouse: { id: 1, name: "Gudang Utama", type: "FINISH_GOODS" },
    _count: { inventories: 0 },
};

const mockWarehouse = {
    id: 1,
    name: "Gudang Utama",
    type: "FINISH_GOODS",
    deleted_at: null,
};

describe("OutletService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─── CREATE ───────────────────────────────────────────────────────────────

    describe("create", () => {
        const body = {
            name: "Toko Baru",
            code: "TOKO002",
            phone: null,
        };

        it("should throw 409 if code already exists", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(mockOutlet);

            await expect(OutletService.create(body)).rejects.toThrow(ApiError);
            await expect(OutletService.create(body)).rejects.toThrow(
                `Kode outlet "${body.code}" sudah digunakan`,
            );
        });

        it("should throw 404 if warehouse_id given but not found", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null); // no duplicate code
            // @ts-ignore
            prisma.warehouse.findUnique.mockResolvedValue(null); // warehouse not found

            await expect(
                OutletService.create({ ...body, warehouse_id: 999 }),
            ).rejects.toThrow("Gudang tidak ditemukan");
        });

        it("should throw 422 if warehouse is not FINISH_GOODS type", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null);
            // @ts-ignore
            prisma.warehouse.findUnique.mockResolvedValue({
                id: 3, name: "Gudang Bahan Baku", type: "RAW_MATERIAL", deleted_at: null,
            });
            await expect(
                OutletService.create({ ...body, warehouse_id: 3 }),
            ).rejects.toThrow("Outlet hanya dapat terhubung dengan gudang bertipe Barang Jadi");
        });

        it("should create outlet without address and warehouse", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null);
            // @ts-ignore
            prisma.outlet.create.mockResolvedValue({ ...mockOutlet, name: "Toko Baru", code: "TOKO002" });

            const result = await OutletService.create(body);

            expect(result.name).toBe("Toko Baru");
            // @ts-ignore
            expect(prisma.outlet.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        name: "Toko Baru",
                        code: "TOKO002",
                        address: undefined,
                        warehouse_id: null,
                    }),
                }),
            );
        });

        it("should create outlet with address", async () => {
            const address = {
                street: "Jl. Pasar No. 5",
                district: "Ciputat",
                sub_district: "Ciputat Timur",
                city: "Tangerang Selatan",
                province: "Banten",
                country: "Indonesia",
                postal_code: "15411",
            };
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null);
            // @ts-ignore
            prisma.outlet.create.mockResolvedValue({ ...mockOutlet, address });

            const result = await OutletService.create({ ...body, address });

            expect(result).toBeDefined();
            // @ts-ignore
            expect(prisma.outlet.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        address: { create: address },
                    }),
                }),
            );
        });

        it("should create outlet with warehouse_id when warehouse exists", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null);
            // @ts-ignore
            prisma.warehouse.findUnique.mockResolvedValue(mockWarehouse);
            // @ts-ignore
            prisma.outlet.create.mockResolvedValue({ ...mockOutlet, warehouse_id: 1 });

            const result = await OutletService.create({ ...body, warehouse_id: 1 });

            expect(result.warehouse_id).toBe(1);
        });
    });

    // ─── UPDATE ───────────────────────────────────────────────────────────────

    describe("update", () => {
        it("should throw 404 if outlet not found", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null);

            await expect(OutletService.update(999, { name: "X" })).rejects.toThrow(ApiError);
            await expect(OutletService.update(999, { name: "X" })).rejects.toThrow(
                "Outlet tidak ditemukan",
            );
        });

        it("should throw 409 if new code already taken by another outlet", async () => {
            // @ts-ignore
            (prisma.outlet.findUnique as any)
                .mockResolvedValueOnce(mockOutlet)              // outlet exists
                .mockResolvedValueOnce({ id: 2, code: "TOKO999" }); // code conflict

            await expect(OutletService.update(1, { code: "TOKO999" })).rejects.toThrow(
                `Kode outlet "TOKO999" sudah digunakan`,
            );
        });

        it("should not check code uniqueness if code is unchanged", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(mockOutlet);
            // @ts-ignore
            prisma.outlet.update.mockResolvedValue({ ...mockOutlet, name: "Updated Name" });

            const result = await OutletService.update(1, { code: "TOKO001", name: "Updated Name" });

            expect(result.name).toBe("Updated Name");
            // code is same as existing, so findUnique for duplicate check should NOT be called twice
            // @ts-ignore
            expect(prisma.outlet.findUnique).toHaveBeenCalledTimes(1);
        });

        it("should throw 404 if warehouse_id given but not found", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(mockOutlet);
            // @ts-ignore
            prisma.warehouse.findUnique.mockResolvedValue(null);

            await expect(OutletService.update(1, { warehouse_id: 999 })).rejects.toThrow(
                "Gudang tidak ditemukan",
            );
        });

        it("should throw 422 if warehouse is not FINISH_GOODS type on update", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(mockOutlet);
            // @ts-ignore
            prisma.warehouse.findUnique.mockResolvedValue({
                id: 3, name: "Gudang Bahan Baku", type: "RAW_MATERIAL", deleted_at: null,
            });

            await expect(OutletService.update(1, { warehouse_id: 3 })).rejects.toThrow(
                "Outlet hanya dapat terhubung dengan gudang bertipe Barang Jadi",
            );
        });

        it("should update outlet successfully", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(mockOutlet);
            // @ts-ignore
            prisma.outlet.update.mockResolvedValue({ ...mockOutlet, name: "Toko Updated", code: "TOKO001" });

            const result = await OutletService.update(1, { name: "Toko Updated" });

            expect(result.name).toBe("Toko Updated");
            // @ts-ignore
            expect(prisma.outlet.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 1 } }),
            );
        });

        it("should upsert address when provided on update", async () => {
            const address = { street: "Jl. Baru", district: "Baru", sub_district: "Baru", city: "Jakarta", province: "DKI Jakarta", country: "Indonesia", postal_code: "10110" };
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(mockOutlet);
            // @ts-ignore
            prisma.outlet.update.mockResolvedValue({ ...mockOutlet, address });

            await OutletService.update(1, { address });

            // @ts-ignore
            expect(prisma.outlet.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        address: { upsert: { create: address, update: address } },
                    }),
                }),
            );
        });
    });

    // ─── TOGGLE STATUS ────────────────────────────────────────────────────────

    describe("toggleStatus", () => {
        it("should throw 404 if outlet not found", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null);

            await expect(OutletService.toggleStatus(999)).rejects.toThrow(ApiError);
            await expect(OutletService.toggleStatus(999)).rejects.toThrow(
                "Outlet tidak ditemukan",
            );
        });

        it("should deactivate an active outlet", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue({ ...mockOutlet, is_active: true });
            // @ts-ignore
            prisma.outlet.update.mockResolvedValue({ id: 1, name: "Toko Utama", code: "TOKO001", is_active: false });

            const result = await OutletService.toggleStatus(1);

            expect(result.is_active).toBe(false);
            // @ts-ignore
            expect(prisma.outlet.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: { is_active: false },
                }),
            );
        });

        it("should activate an inactive outlet", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue({ ...mockOutlet, is_active: false });
            // @ts-ignore
            prisma.outlet.update.mockResolvedValue({ id: 1, name: "Toko Utama", code: "TOKO001", is_active: true });

            const result = await OutletService.toggleStatus(1);

            expect(result.is_active).toBe(true);
            // @ts-ignore
            expect(prisma.outlet.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: { is_active: true },
                }),
            );
        });
    });

    // ─── DELETE ───────────────────────────────────────────────────────────────

    describe("delete", () => {
        it("should throw 404 if outlet not found", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null);

            await expect(OutletService.delete(999)).rejects.toThrow(ApiError);
            await expect(OutletService.delete(999)).rejects.toThrow("Outlet tidak ditemukan");
        });

        it("should soft-delete outlet by setting deleted_at", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(mockOutlet);
            // @ts-ignore
            prisma.outlet.update.mockResolvedValue({ id: 1, name: "Toko Utama", code: "TOKO001" });

            const result = await OutletService.delete(1);

            expect(result).toBeDefined();
            // @ts-ignore
            expect(prisma.outlet.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 1 },
                    data: { deleted_at: expect.any(Date) },
                }),
            );
        });

        it("should not call update if outlet not found", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null);

            await expect(OutletService.delete(999)).rejects.toThrow(ApiError);
            // @ts-ignore
            expect(prisma.outlet.update).not.toHaveBeenCalled();
        });
    });

    // ─── LIST ─────────────────────────────────────────────────────────────────

    describe("list", () => {
        it("should return list with default pagination", async () => {
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValue([mockOutlet]);
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(1);

            const result = await OutletService.list({ sortBy: "updated_at", sortOrder: "asc" });

            expect(result.data).toHaveLength(1);
            expect(result.len).toBe(1);
        });

        it("should filter by is_active=true", async () => {
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValue([mockOutlet]);
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(1);

            await OutletService.list({ is_active: "true", sortBy: "updated_at", sortOrder: "asc" });

            // @ts-ignore
            expect(prisma.outlet.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ is_active: true }),
                }),
            );
        });

        it("should filter by is_active=false", async () => {
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValue([]);
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(0);

            await OutletService.list({ is_active: "false", sortBy: "updated_at", sortOrder: "asc" });

            // @ts-ignore
            expect(prisma.outlet.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ is_active: false }),
                }),
            );
        });

        it("should filter by warehouse_id", async () => {
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValue([mockOutlet]);
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(1);

            await OutletService.list({ warehouse_id: 1, sortBy: "updated_at", sortOrder: "asc" });

            // @ts-ignore
            expect(prisma.outlet.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ warehouse_id: 1 }),
                }),
            );
        });

        it("should filter by search term (name OR code)", async () => {
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValue([mockOutlet]);
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(1);

            await OutletService.list({ search: "toko", sortBy: "name", sortOrder: "asc" });

            // @ts-ignore
            expect(prisma.outlet.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        OR: [
                            { name: { contains: "toko", mode: "insensitive" } },
                            { code: { contains: "toko", mode: "insensitive" } },
                        ],
                    }),
                }),
            );
        });

        it("should return empty list when no outlets found", async () => {
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValue([]);
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(0);

            const result = await OutletService.list({ sortBy: "updated_at", sortOrder: "asc" });

            expect(result.data).toHaveLength(0);
            expect(result.len).toBe(0);
        });

        it("should apply deleted_at: null filter", async () => {
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValue([]);
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(0);

            await OutletService.list({ sortBy: "updated_at", sortOrder: "asc" });

            // @ts-ignore
            expect(prisma.outlet.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ deleted_at: null }),
                }),
            );
        });
    });

    // ─── CLEAN ────────────────────────────────────────────────────────────────

    describe("clean", () => {
        it("should throw 400 if no inactive+deleted outlets exist", async () => {
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(0);

            await expect(OutletService.clean()).rejects.toThrow(ApiError);
            await expect(OutletService.clean()).rejects.toThrow(
                "Data outlet yang non aktif tidak ditemukan",
            );
        });

        it("should permanently delete all inactive soft-deleted outlets", async () => {
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(3);
            // @ts-ignore
            prisma.outlet.deleteMany.mockResolvedValue({ count: 3 });

            const result = await OutletService.clean();

            expect(result.message).toContain("berhasil dihapus");
            // @ts-ignore
            expect(prisma.outlet.deleteMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        is_active: false,
                        deleted_at: { not: null },
                    }),
                }),
            );
        });
    });

    // ─── DETAIL ───────────────────────────────────────────────────────────────

    describe("detail", () => {
        it("should return outlet detail", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(mockOutlet);

            const result = await OutletService.detail(1);

            expect(result.id).toBe(1);
            expect(result.name).toBe("Toko Utama");
            expect(result.code).toBe("TOKO001");
        });

        it("should throw 404 if outlet not found", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null);

            await expect(OutletService.detail(999)).rejects.toThrow(ApiError);
            await expect(OutletService.detail(999)).rejects.toThrow("Outlet tidak ditemukan");
        });

        it("should throw 404 for soft-deleted outlet", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null); // deleted_at: null filter excludes it

            await expect(OutletService.detail(1)).rejects.toThrow(ApiError);
        });
    });
});
