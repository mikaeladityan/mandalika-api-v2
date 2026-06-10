import { describe, it, expect, vi, beforeEach } from "vitest";
import { RMService } from "../../../module/application/inventory/rm/rm.service.js";
import { ApiError } from "../../../lib/errors/api.error.js";
import prisma from "../../../config/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { RequestRMDTO } from "../../../module/application/inventory/rm/rm.schema.js";
import { SUPPLIER_OBSCURE_REGEX } from "../../../lib/utils/supplier-obscure.js";

const makeRMBody = (overrides: Partial<RequestRMDTO> = {}): RequestRMDTO => ({
    barcode: "RM-001",
    name: "Kain Katun",
    type: "FO",
    min_stock: 5,
    unit: "meter",
    raw_mat_category: "Fabric",
    suppliers: undefined,
    supplier_id: undefined,
    price: undefined,
    min_buy: undefined,
    lead_time: undefined,
    ...overrides,
});

describe("RMService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("create", () => {
        it("creates raw material dengan unit & kategori (slug upsert)", async () => {
            const result = await RMService.create(makeRMBody());

            expect(result).toBeDefined();
            expect(result.name).toBe("Kain Katun");
            expect(result.barcode).toBe("RM-001");
            expect(prisma.$transaction).toHaveBeenCalled();
        });

        it("creates dengan suppliers array dipetakan ke supplier_materials.createMany", async () => {
            const result = await RMService.create(
                makeRMBody({
                    suppliers: [
                        {
                            supplier_id: 1,
                            unit_price: 50000,
                            min_buy: 10,
                            lead_time: 7,
                            is_preferred: true,
                            status: "ACTIVE",
                        },
                    ],
                }),
            );

            expect(result).toBeDefined();
        });

        it("memetakan supplier_id+price (legacy) ke single preferred supplier", async () => {
            const result = await RMService.create(
                makeRMBody({ supplier_id: 1, price: 50000, min_buy: 10, lead_time: 7 }),
            );

            expect(result).toBeDefined();
        });

        it("throws ApiError 400 saat Prisma P2002 (barcode duplicate)", async () => {
            const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
                code: "P2002",
                clientVersion: "test",
            });
            vi.mocked(prisma.$transaction).mockRejectedValueOnce(p2002);

            await expect(RMService.create(makeRMBody())).rejects.toBeInstanceOf(ApiError);
        });

        it("throws ApiError 404 saat P2003 (supplier FK violation)", async () => {
            const p2003 = new Prisma.PrismaClientKnownRequestError("fk", {
                code: "P2003",
                clientVersion: "test",
            });
            vi.mocked(prisma.$transaction).mockRejectedValueOnce(p2003);

            await expect(
                RMService.create(
                    makeRMBody({
                        suppliers: [
                            {
                                supplier_id: 999,
                                unit_price: 1000,
                                is_preferred: true,
                                status: "ACTIVE",
                            },
                        ],
                    }),
                ),
            ).rejects.toBeInstanceOf(ApiError);
        });

        it("re-throws non-Prisma error apa adanya", async () => {
            vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error("DB down"));

            await expect(RMService.create(makeRMBody())).rejects.toThrow("DB down");
        });
    });

    describe("update", () => {
        it("throws 404 saat raw material tidak ditemukan", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(null);

            await expect(RMService.update(999, { name: "X" })).rejects.toBeInstanceOf(ApiError);
        });

        it("update dasar (name) sukses", async () => {
            const result = await RMService.update(1, { name: "Kain Katun Updated" });

            expect(result).toBeDefined();
            expect(prisma.$transaction).toHaveBeenCalled();
        });

        it("clear semua supplier saat suppliers=[]", async () => {
            await RMService.update(1, { suppliers: [] });

            expect(prisma.$transaction).toHaveBeenCalled();
        });

        it("throws 400 saat P2002 barcode duplicate", async () => {
            const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
                code: "P2002",
                clientVersion: "test",
            });
            vi.mocked(prisma.$transaction).mockRejectedValueOnce(p2002);

            await expect(RMService.update(1, { barcode: "DUPED" })).rejects.toBeInstanceOf(
                ApiError,
            );
        });
    });

    describe("detail", () => {
        it("throws 404 saat raw material tidak ditemukan", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(null);

            await expect(RMService.detail(999)).rejects.toBeInstanceOf(ApiError);
        });

        it("serialize Decimal & flatten relasi ke DTO", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce({
                id: 1,
                barcode: "RM-001",
                name: "Kain Katun",
                min_stock: "5.00",
                type: "FO",
                deleted_at: null,
                created_at: new Date(),
                updated_at: null,
                unit_raw_material: { id: 1, name: "meter", slug: "meter" },
                raw_mat_category: { id: 1, name: "Fabric", slug: "fabric" },
                supplier_materials: [
                    {
                        supplier_id: 1,
                        unit_price: "50000.00",
                        min_buy: "10.00",
                        lead_time: 7,
                        is_preferred: true,
                        status: "ACTIVE",
                        supplier: {
                            id: 1,
                            name: "PT Supplier ABC",
                            country: "Indonesia",
                            source: "LOCAL",
                        },
                    },
                ],
            } as never);

            const result = await RMService.detail(1);

            expect(result.min_stock).toBe(5);
            expect(typeof result.min_stock).toBe("number");
            expect(result.suppliers).toHaveLength(1);
            const preferred = result.suppliers.find((s) => s.is_preferred);
            expect(preferred?.unit_price).toBe(50000);
            expect(preferred?.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(preferred?.supplier_name).toHaveLength(7);
            expect(preferred?.supplier_source).toBe("LOCAL");
        });

        it("suppliers = [] saat tidak ada supplier_materials", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce({
                id: 1,
                barcode: "RM-001",
                name: "Kain Katun",
                min_stock: null,
                type: null,
                deleted_at: null,
                created_at: new Date(),
                updated_at: null,
                unit_raw_material: { id: 1, name: "meter", slug: "meter" },
                raw_mat_category: null,
                supplier_materials: [],
            } as never);

            const result = await RMService.detail(1);

            expect(result.suppliers).toEqual([]);
        });
    });

    describe("list", () => {
        it("returns data + len, default filter deleted_at=null", async () => {
            vi.mocked(prisma.rawMaterial.findMany).mockResolvedValueOnce([] as never);
            vi.mocked(prisma.rawMaterial.count).mockResolvedValueOnce(0);

            await RMService.list({
                page: 1,
                take: 10,
                sortBy: "updated_at",
                sortOrder: "asc",
                status: "actived",
            });

            expect(prisma.rawMaterial.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ deleted_at: null }),
                }),
            );
        });

        it("filter status=deleted → deleted_at != null", async () => {
            vi.mocked(prisma.rawMaterial.findMany).mockResolvedValueOnce([] as never);
            vi.mocked(prisma.rawMaterial.count).mockResolvedValueOnce(0);

            await RMService.list({
                page: 1,
                take: 10,
                sortBy: "updated_at",
                sortOrder: "asc",
                status: "deleted",
            });

            expect(prisma.rawMaterial.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ deleted_at: { not: null } }),
                }),
            );
        });

        it("applies search OR clause untuk name/barcode/supplier", async () => {
            vi.mocked(prisma.rawMaterial.findMany).mockResolvedValueOnce([] as never);
            vi.mocked(prisma.rawMaterial.count).mockResolvedValueOnce(0);

            await RMService.list({
                page: 1,
                take: 10,
                sortBy: "name",
                sortOrder: "asc",
                status: "actived",
                search: "katun",
            });

            const call = vi.mocked(prisma.rawMaterial.findMany).mock.calls[0]?.[0];
            expect(call?.where).toHaveProperty("OR");
        });

        it("masks supplier identity in list response (suppliers[].supplier_name obscured)", async () => {
            vi.mocked(prisma.rawMaterial.findMany).mockResolvedValueOnce([
                {
                    id: 1,
                    barcode: "X1",
                    name: "RM-1",
                    type: "FO",
                    min_stock: 1,
                    created_at: new Date(),
                    updated_at: new Date(),
                    deleted_at: null,
                    unit_raw_material: { id: 1, name: "kg" },
                    raw_mat_category: null,
                    supplier_materials: [
                        {
                            supplier_id: 42,
                            supplier: { id: 42, name: "PT Real Vendor", country: "ID", source: "LOCAL" },
                            unit_price: 100,
                            min_buy: 1,
                            lead_time: 1,
                            is_preferred: true,
                            status: "ACTIVE",
                        },
                        {
                            supplier_id: 1000,
                            supplier: { id: 1000, name: "PT Other Vendor", country: "ID", source: "IMPORT" },
                            unit_price: 200,
                            min_buy: 1,
                            lead_time: 1,
                            is_preferred: false,
                            status: "ACTIVE",
                        },
                    ],
                },
            ] as never);
            vi.mocked(prisma.rawMaterial.count).mockResolvedValueOnce(1);

            const { data } = await RMService.list({ page: 1, take: 10 } as never);

            expect(data[0].suppliers[0].supplier_name).toBe("SUP-042");
            expect(data[0].suppliers[1].supplier_name).toBe("SUP1000");
            for (const s of data[0].suppliers) {
                expect(s.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
                expect(s.supplier_name).toHaveLength(7);
            }
        });
    });

    describe("delete", () => {
        it("throws 404 saat tidak ada", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(null);

            await expect(RMService.delete(999)).rejects.toBeInstanceOf(ApiError);
        });

        it("throws 400 saat sudah deleted", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce({
                deleted_at: new Date(),
            } as never);

            await expect(RMService.delete(1)).rejects.toBeInstanceOf(ApiError);
        });

        it("set deleted_at saat sukses", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce({
                deleted_at: null,
            } as never);

            await RMService.delete(1);

            expect(prisma.rawMaterial.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ deleted_at: expect.any(Date) }),
                }),
            );
        });
    });

    describe("restore", () => {
        it("throws 404 saat tidak ada", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(null);

            await expect(RMService.restore(999)).rejects.toBeInstanceOf(ApiError);
        });

        it("throws 400 saat tidak dalam status deleted", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce({
                deleted_at: null,
            } as never);

            await expect(RMService.restore(1)).rejects.toBeInstanceOf(ApiError);
        });

        it("set deleted_at=null saat sukses", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce({
                deleted_at: new Date(),
            } as never);

            await RMService.restore(1);

            expect(prisma.rawMaterial.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { deleted_at: null } }),
            );
        });
    });

    describe("bulkStatus", () => {
        it("throws 400 saat ids kosong", async () => {
            await expect(RMService.bulkStatus([], "DELETE")).rejects.toBeInstanceOf(ApiError);
        });

        it("throws 404 saat tidak ada yang match", async () => {
            vi.mocked(prisma.rawMaterial.updateMany).mockResolvedValueOnce({ count: 0 });

            await expect(RMService.bulkStatus([999], "DELETE")).rejects.toBeInstanceOf(ApiError);
        });

        it("DELETE → set deleted_at=Date", async () => {
            vi.mocked(prisma.rawMaterial.updateMany).mockResolvedValueOnce({ count: 2 });

            const result = await RMService.bulkStatus([1, 2], "DELETE");

            expect(result.affected).toBe(2);
            expect(prisma.rawMaterial.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: { deleted_at: expect.any(Date) },
                }),
            );
        });

        it("ACTIVE → set deleted_at=null", async () => {
            vi.mocked(prisma.rawMaterial.updateMany).mockResolvedValueOnce({ count: 2 });

            await RMService.bulkStatus([1, 2], "ACTIVE");

            expect(prisma.rawMaterial.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: { deleted_at: null },
                }),
            );
        });
    });

    describe("clean", () => {
        it("throws 400 saat tidak ada raw material yang akan dihapus", async () => {
            vi.mocked(prisma.$transaction).mockImplementationOnce(((cb: unknown) => {
                const fn = cb as (tx: {
                    rawMaterial: { findMany: () => Promise<unknown[]> };
                }) => unknown;
                return fn({ rawMaterial: { findMany: async () => [] } });
            }) as never);

            await expect(RMService.clean()).rejects.toBeInstanceOf(ApiError);
        });

        it("throws 409 saat masih dipakai Recipe", async () => {
            vi.mocked(prisma.$transaction).mockImplementationOnce(((cb: unknown) => {
                const fn = cb as (tx: {
                    rawMaterial: { findMany: () => Promise<Array<{ id: number }>> };
                    recipes: { count: () => Promise<number> };
                    purchaseOrderItem: { count: () => Promise<number> };
                    productionOrderItem: { count: () => Promise<number> };
                }) => unknown;
                return fn({
                    rawMaterial: { findMany: async () => [{ id: 1 }] },
                    recipes: { count: async () => 3 },
                    purchaseOrderItem: { count: async () => 0 },
                    productionOrderItem: { count: async () => 0 },
                });
            }) as never);

            await expect(RMService.clean()).rejects.toThrow(/Recipe/);
        });

        it("throws 409 saat masih terkait Purchase Order", async () => {
            vi.mocked(prisma.$transaction).mockImplementationOnce(((cb: unknown) => {
                const fn = cb as (tx: {
                    rawMaterial: { findMany: () => Promise<Array<{ id: number }>> };
                    recipes: { count: () => Promise<number> };
                    purchaseOrderItem: { count: () => Promise<number> };
                    productionOrderItem: { count: () => Promise<number> };
                }) => unknown;
                return fn({
                    rawMaterial: { findMany: async () => [{ id: 1 }] },
                    recipes: { count: async () => 0 },
                    purchaseOrderItem: { count: async () => 5 },
                    productionOrderItem: { count: async () => 0 },
                });
            }) as never);

            await expect(RMService.clean()).rejects.toThrow(/Purchase Order/);
        });
    });

    describe("export", () => {
        it("throws 400 saat data melebihi EXPORT_MAX_ROWS", async () => {
            vi.mocked(prisma.rawMaterial.findMany).mockResolvedValueOnce([] as never);
            vi.mocked(prisma.rawMaterial.count).mockResolvedValueOnce(60_000);

            await expect(
                RMService.export({
                    page: 1,
                    take: 10,
                    sortBy: "updated_at",
                    sortOrder: "asc",
                    status: "actived",
                }),
            ).rejects.toBeInstanceOf(ApiError);
        });

        it("returns CSV buffer saat data dalam batas", async () => {
            vi.mocked(prisma.rawMaterial.findMany).mockResolvedValueOnce([
                {
                    id: 1,
                    barcode: "RM-001",
                    name: "Kain Katun",
                    min_stock: "5.00",
                    type: "FO",
                    deleted_at: null,
                    created_at: new Date(),
                    updated_at: null,
                    unit_raw_material: { id: 1, name: "meter", slug: "meter" },
                    raw_mat_category: { id: 1, name: "Fabric", slug: "fabric" },
                    supplier_materials: [],
                },
            ] as never);
            vi.mocked(prisma.rawMaterial.count).mockResolvedValueOnce(1);

            const buffer = await RMService.export({
                page: 1,
                take: 10,
                sortBy: "updated_at",
                sortOrder: "asc",
                status: "actived",
            });

            expect(buffer.byteLength).toBeGreaterThan(0);
        });
    });

});
