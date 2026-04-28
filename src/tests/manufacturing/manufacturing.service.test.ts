import { describe, it, expect, vi, beforeEach } from "vitest";
import { ManufacturingService } from "../../module/application/manufacturing/manufacturing.service.js";
import prisma from "../../config/prisma.js";
import { ApiError } from "../../lib/errors/api.error.js";
import { ProductionStatus } from "../../generated/prisma/enums.js";

vi.mock("../../config/prisma.js", () => {
    const mockPrisma = {
        $transaction: vi.fn(),
        productionOrder: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
        productionOrderItem: { update: vi.fn(), updateMany: vi.fn() },
        productionOrderWaste: { create: vi.fn() },
        productInventory: { findMany: vi.fn(), update: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
        rawMaterialInventory: { findMany: vi.fn(), update: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
        stockTransfer: { create: vi.fn() },
        warehouse: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
        product: { findUnique: vi.fn() },
        goodsReceipt: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
        stockMovement: { create: vi.fn() },
        rawMaterial: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
        goodsReceiptItem: { createMany: vi.fn(), create: vi.fn() },
        productionOrderOutput: { update: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        if (Array.isArray(cb)) return Promise.all(cb);
        return cb(mockPrisma);
    });
    return { default: mockPrisma };
});

const mockProduct = {
    id: 1,
    name: "Parfum EDP 100ml",
    code: "EDP_100",
    recipes: [
        { id: 1, raw_mat_id: 10, quantity: 2, is_active: true, product_id: 1 },
        { id: 2, raw_mat_id: 11, quantity: 0.5, is_active: true, product_id: 1 },
    ],
};

const mockOrder = {
    id: 1,
    mfg_number: "MFG-202604-0001",
    product_id: 1,
    quantity_planned: 100,
    quantity_actual: null,
    status: ProductionStatus.PLANNING,
    items: [
        { id: 10, production_order_id: 1, raw_material_id: 10, warehouse_id: 3, quantity_planned: 200, quantity_actual: null, raw_material: { id: 10, name: "Material A" } },
        { id: 11, production_order_id: 1, raw_material_id: 11, warehouse_id: 3, quantity_planned: 50, quantity_actual: null, raw_material: { id: 11, name: "Material B" } },
    ],
    goods_receipt: null,
    product: { id: 1, name: "Parfum EDP 100ml", code: "EDP_100" },
};

describe("ManufacturingService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (prisma.productInventory.findMany as any).mockResolvedValue([
            { id: 1, quantity: 1000, product: { id: 1, name: "Parfum EDP 100ml", code: "EDP_100" } }
        ]);
        (prisma.rawMaterialInventory.findMany as any).mockResolvedValue([
            { id: 1, quantity: 1000, raw_material: { id: 10, name: "Material A" } }
        ]);
        (prisma.productInventory.findFirst as any).mockResolvedValue({ id: 1, quantity: 1000, product: { id: 1, name: "Parfum EDP 100ml", code: "EDP_100" } });
        (prisma.rawMaterialInventory.findFirst as any).mockResolvedValue({ id: 1, quantity: 1000, raw_material: { id: 10, name: "Material A" } });
        (prisma.warehouse.findMany as any).mockResolvedValue([]);
    });

    describe("create", () => {
        it("should create a production order in PLANNING status from manual items", async () => {
            // @ts-ignore
            prisma.product.findUnique.mockResolvedValue(mockProduct);
            // @ts-ignore
            prisma.productionOrder.create.mockResolvedValue({ ...mockOrder, status: ProductionStatus.PLANNING });

            const payload = {
                product_id: 1,
                quantity_planned: 100,
                items: [
                    { raw_material_id: 10, quantity_planned: 200 },
                    { raw_material_id: 11, quantity_planned: 50 },
                ],
            };

            const result = await ManufacturingService.create(payload);
            expect(result.status).toBe(ProductionStatus.PLANNING);
            // @ts-ignore
            expect(prisma.productionOrder.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ product_id: 1, quantity_planned: 100 }),
                }),
            );
        });

        it("should auto-populate items from BOM when no items provided", async () => {
            // @ts-ignore
            prisma.product.findUnique.mockResolvedValue(mockProduct);
            // @ts-ignore
            prisma.productionOrder.create.mockResolvedValue({ ...mockOrder, status: ProductionStatus.PLANNING });

            const payload = { product_id: 1, quantity_planned: 100 };
            const result = await ManufacturingService.create(payload);
            expect(result).toBeDefined();

            const createCall = (prisma.productionOrder.create as any).mock.calls[0][0];
            const createdItems = createCall.data.items.create;
            expect(createdItems).toHaveLength(2);
            expect(createdItems[0].quantity_planned).toBe(200); // 2 * 100
            expect(createdItems[1].quantity_planned).toBe(50);  // 0.5 * 100
        });

        it("should throw 404 if product not found", async () => {
            // @ts-ignore
            prisma.product.findUnique.mockResolvedValue(null);
            await expect(ManufacturingService.create({ product_id: 999, quantity_planned: 100 })).rejects.toThrow(ApiError);
        });

        it("should throw 400 if product has no BOM and no items provided", async () => {
            // @ts-ignore
            prisma.product.findUnique.mockResolvedValue({ ...mockProduct, recipes: [] });
            await expect(ManufacturingService.create({ product_id: 1, quantity_planned: 100 })).rejects.toThrow(ApiError);
        });

        it("should trigger automatic RM transfer if stock is low in PRD but high in KDG", async () => {
            // @ts-ignore
            prisma.product.findUnique.mockResolvedValue(mockProduct);
            // @ts-ignore
            prisma.productionOrder.create.mockResolvedValue(mockOrder);
            // @ts-ignore
            prisma.warehouse.findUnique.mockImplementation(({ where }: any) => {
                if (where.code === "GRM-PRD") return Promise.resolve({ id: 3, code: "GRM-PRD" });
                if (where.code === "GRM-KDG") return Promise.resolve({ id: 4, code: "GRM-KDG" });
                return Promise.resolve(null);
            });
            // @ts-ignore
            prisma.rawMaterialInventory.findFirst.mockResolvedValue({ month: 4, year: 2026 });
            // PRD has 10, KDG has 500. Needed is 200.
            // @ts-ignore
            prisma.rawMaterialInventory.findMany.mockImplementation(({ where }: any) => {
                if (where.warehouse_id === 3) return Promise.resolve([{ id: 1, quantity: 10 }]); 
                if (where.warehouse_id === 4) return Promise.resolve([{ id: 2, quantity: 500 }]);
                return Promise.resolve([]);
            });
            // @ts-ignore
            prisma.stockTransfer.create.mockResolvedValue({ id: 100 });

            await ManufacturingService.create({ product_id: 1, quantity_planned: 100 });

            // Should create stock transfer for shortfall (190)
            // @ts-ignore
            expect(prisma.stockTransfer.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        production_order_id: mockOrder.id,
                        from_warehouse_id: 4,
                        to_warehouse_id: 3,
                    })
                })
            );
        });
    });

    describe("changeStatus - RELEASED", () => {
        it("should release order when RM stock is sufficient", async () => {
            const planningOrder = { ...mockOrder, status: ProductionStatus.PLANNING };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(planningOrder);
            // @ts-ignore
            prisma.rawMaterialInventory.findMany.mockResolvedValue([
                { id: 1, raw_material_id: 10, warehouse_id: 3, quantity: 500 },
                { id: 2, raw_material_id: 11, warehouse_id: 3, quantity: 100 },
            ]);
            // @ts-ignore
            prisma.productionOrderItem.updateMany.mockResolvedValue({ count: 1 });
            // @ts-ignore
            prisma.productionOrder.update.mockResolvedValue({ ...planningOrder, status: ProductionStatus.RELEASED });

            const result = await ManufacturingService.changeStatus(1, { status: "RELEASED" });
            expect(result.status).toBe(ProductionStatus.RELEASED);
        });

        it("should throw 400 when RM stock is insufficient", async () => {
            const planningOrder = { ...mockOrder, status: ProductionStatus.PLANNING };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(planningOrder);
            // @ts-ignore
            prisma.rawMaterialInventory.findMany.mockResolvedValue([
                { id: 1, raw_material_id: 10, warehouse_id: 3, quantity: 10 }, // only 10, need 200
            ]);

            await expect(ManufacturingService.changeStatus(1, { status: "RELEASED" })).rejects.toThrow(ApiError);
        });

        it("should throw 400 for invalid transition (PROCESSING → RELEASED)", async () => {
            const processingOrder = { ...mockOrder, status: ProductionStatus.PROCESSING };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(processingOrder);

            await expect(ManufacturingService.changeStatus(1, { status: "RELEASED" })).rejects.toThrow(ApiError);
        });

        it("should throw 404 if order not found", async () => {
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(null);
            await expect(ManufacturingService.changeStatus(999, { status: "RELEASED" })).rejects.toThrow(ApiError);
        });
    });

    describe("changeStatus - PROCESSING", () => {
        it("should deduct RM stock when transitioning to PROCESSING", async () => {
            const releasedOrder = { ...mockOrder, status: ProductionStatus.RELEASED };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(releasedOrder);
            // @ts-ignore
            prisma.rawMaterialInventory.findFirst.mockResolvedValue({ id: 1, quantity: 500, warehouse_id: 3 });
            // @ts-ignore
            prisma.rawMaterialInventory.update.mockResolvedValue({ id: 1, quantity: 300 });
            // @ts-ignore
            prisma.stockMovement.create.mockResolvedValue({ id: 1 });
            // @ts-ignore
            prisma.productionOrder.update.mockResolvedValue({ ...releasedOrder, status: ProductionStatus.PROCESSING });

            const result = await ManufacturingService.changeStatus(1, { status: "PROCESSING" });
            expect(result.status).toBe(ProductionStatus.PROCESSING);
            // @ts-ignore
            expect(prisma.rawMaterialInventory.update).toHaveBeenCalled();
            // @ts-ignore
            expect(prisma.stockMovement.create).toHaveBeenCalled();
        });

        it("should throw 400 if item has no allocated warehouse", async () => {
            const releasedOrder = {
                ...mockOrder,
                status: ProductionStatus.RELEASED,
                items: [{ id: 10, raw_material_id: 10, warehouse_id: null, quantity_planned: 200 }],
            };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(releasedOrder);

            await expect(ManufacturingService.changeStatus(1, { status: "PROCESSING" })).rejects.toThrow(ApiError);
        });
    });

    describe("submitResult", () => {
        it("should update actual quantities and move to COMPLETED", async () => {
            const processingOrder = { ...mockOrder, status: ProductionStatus.PROCESSING };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(processingOrder);
            // @ts-ignore
            prisma.productionOrderItem.update.mockResolvedValue({});
            // @ts-ignore
            prisma.rawMaterialInventory.findFirst.mockResolvedValue({ id: 1, quantity: 0, warehouse_id: 3 });
            // @ts-ignore
            prisma.productionOrder.update.mockResolvedValue({
                ...processingOrder,
                status: ProductionStatus.COMPLETED,
                quantity_actual: 95,
                wastes: [],
            });

            const payload = {
                quantity_actual: 95,
                items: [
                    { id: 10, quantity_actual: 190 }, // used less than 200 → waste
                    { id: 11, quantity_actual: 50 },  // exact
                ],
            };

            const result = await ManufacturingService.submitResult(1, payload);
            expect(result.status).toBe(ProductionStatus.COMPLETED);
            // @ts-ignore
            expect(prisma.productionOrderItem.update).toHaveBeenCalledTimes(2);
        });

        it("should create RM waste when actual < planned", async () => {
            const processingOrder = { ...mockOrder, status: ProductionStatus.PROCESSING };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(processingOrder);
            // @ts-ignore
            prisma.productionOrderItem.update.mockResolvedValue({});
            // @ts-ignore
            prisma.rawMaterialInventory.findFirst.mockResolvedValue({ id: 1, quantity: 0, warehouse_id: 3 });
            // @ts-ignore
            prisma.rawMaterialInventory.update.mockResolvedValue({});
            // @ts-ignore
            prisma.stockMovement.create.mockResolvedValue({});
            // @ts-ignore
            prisma.productionOrderWaste.create.mockResolvedValue({});
            // @ts-ignore
            prisma.productionOrder.update.mockResolvedValue({
                ...processingOrder,
                status: ProductionStatus.COMPLETED,
                wastes: [{ id: 1, waste_type: "RAW_MATERIAL", quantity: 10 }],
            });

            const payload = {
                quantity_actual: 95,
                items: [
                    { id: 10, quantity_actual: 190 }, // 200 - 190 = 10 waste
                    { id: 11, quantity_actual: 50 },
                ],
            };

            await ManufacturingService.submitResult(1, payload);
            // @ts-ignore
            expect(prisma.productionOrderWaste.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ 
                        waste_type: "RAW_MATERIAL", 
                        quantity: 10, 
                        notes: expect.stringContaining("Pengembalian Sisa Bahan") 
                    }),
                }),
            );
        });

        it("should throw 400 if order is not in PROCESSING status", async () => {
            const completedOrder = { ...mockOrder, status: ProductionStatus.COMPLETED };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(completedOrder);

            const payload = { quantity_actual: 95, items: [] };
            await expect(ManufacturingService.submitResult(1, payload)).rejects.toThrow(ApiError);
        });

        it("should handle overconsumption and deduct more stock", async () => {
            const processingOrder = { ...mockOrder, status: ProductionStatus.PROCESSING };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(processingOrder);
            // @ts-ignore
            prisma.productionOrderItem.update.mockResolvedValue({});
            
            const payload = {
                quantity_actual: 100,
                items: [
                    { id: 10, quantity_actual: 250 }, // used MORE than 200 → additional deduction
                ],
            };

            // @ts-ignore
            prisma.rawMaterialInventory.findFirst.mockResolvedValue({ id: 1, quantity: 500 });
            // @ts-ignore
            prisma.productionOrder.update.mockResolvedValue({
                ...processingOrder,
                status: ProductionStatus.COMPLETED,
            });

            await ManufacturingService.submitResult(1, payload);

            // Verify waste creation for overconsumption
            // @ts-ignore
            expect(prisma.productionOrderWaste.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ 
                        waste_type: "RAW_MATERIAL", 
                        quantity: 50,
                        notes: "Pemakaian Berlebih (Overconsumption)"
                    }),
                }),
            );

            // Verify stock movement note
            // @ts-ignore
            expect(prisma.stockMovement.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ 
                        notes: expect.stringContaining("Pemakaian Tambahan Kumulatif")
                    }),
                }),
            );
        });

        it("should create yield loss waste if actual product < planned", async () => {
             const processingOrder = { ...mockOrder, status: ProductionStatus.PROCESSING };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(processingOrder);
            // @ts-ignore
            prisma.productionOrder.update.mockResolvedValue({
                ...processingOrder,
                status: ProductionStatus.QC_REVIEW,
            });

            const payload = {
                quantity_actual: 80, // planned was 100
                items: [
                    { id: 10, quantity_actual: 200 },
                    { id: 11, quantity_actual: 50 },
                ],
            };

            await ManufacturingService.submitResult(1, payload);

            // Verify yield loss waste
            // @ts-ignore
            expect(prisma.productionOrderWaste.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ 
                        waste_type: "RAW_MATERIAL", 
                        quantity: 20, // 100 - 80
                        notes: "Selisih Hasil Produksi (Yield Loss)"
                    }),
                }),
            );
        });
    });

    describe("qcAction", () => {
        it("should finalize QC, create GR and FG waste when there are rejections", async () => {
            const qcOrder = { ...mockOrder, status: ProductionStatus.QC_REVIEW, quantity_actual: 95 };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(qcOrder);
            // @ts-ignore
            prisma.warehouse.findUnique.mockResolvedValue({ id: 1, name: "Gudang FG", type: "FINISH_GOODS" });
            // @ts-ignore
            prisma.goodsReceipt.create.mockResolvedValue({ id: 5, gr_number: "GR-202604-0001" });
            // @ts-ignore
            prisma.productInventory.findFirst.mockResolvedValue({ id: 1, quantity: 50 });
            // @ts-ignore
            prisma.productInventory.update.mockResolvedValue({});
            // @ts-ignore
            prisma.stockMovement.create.mockResolvedValue({});
            // @ts-ignore
            prisma.productionOrderWaste.create.mockResolvedValue({});
            // @ts-ignore
            prisma.productionOrder.update.mockResolvedValue({
                ...qcOrder,
                status: ProductionStatus.FINISHED,
                quantity_accepted: 90,
                quantity_rejected: 5,
                goods_receipt: { id: 5 },
            });

            const payload = { quantity_accepted: 90, quantity_rejected: 5, fg_warehouse_id: 1 };
            const result = await ManufacturingService.qcAction(1, payload);

            expect(result.status).toBe(ProductionStatus.FINISHED);
            // @ts-ignore
            expect(prisma.goodsReceipt.create).toHaveBeenCalled();
            // @ts-ignore
            expect(prisma.productionOrderWaste.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ waste_type: "FINISH_GOODS", quantity: 5 }),
                }),
            );
        });

        it("should throw 400 if total QC exceeds actual quantity", async () => {
            const qcOrder = { ...mockOrder, status: ProductionStatus.QC_REVIEW, quantity_actual: 50 };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(qcOrder);
            // @ts-ignore
            prisma.warehouse.findUnique.mockResolvedValue({ id: 1, name: "Gudang FG", type: "FINISH_GOODS" });

            const payload = { quantity_accepted: 50, quantity_rejected: 10, fg_warehouse_id: 1 };
            await expect(ManufacturingService.qcAction(1, payload)).rejects.toThrow(ApiError);
        });

        it("should throw 400 if order is not in QC_REVIEW status", async () => {
            const planningOrder = { ...mockOrder, status: ProductionStatus.PLANNING };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(planningOrder);

            const payload = { quantity_accepted: 90, quantity_rejected: 5, fg_warehouse_id: 1 };
            await expect(ManufacturingService.qcAction(1, payload)).rejects.toThrow(ApiError);
        });

        it("should throw 404 if warehouse not found", async () => {
            const qcOrder = { ...mockOrder, status: ProductionStatus.QC_REVIEW };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(qcOrder);
            // @ts-ignore
            prisma.warehouse.findUnique.mockResolvedValue(null);

            const payload = { quantity_accepted: 90, quantity_rejected: 5, fg_warehouse_id: 999 };
            await expect(ManufacturingService.qcAction(1, payload)).rejects.toThrow(ApiError);
        });
    });

    describe("list", () => {
        it("should return paginated list", async () => {
            // @ts-ignore
            prisma.productionOrder.findMany.mockResolvedValue([mockOrder]);
            // @ts-ignore
            prisma.productionOrder.count.mockResolvedValue(1);

            const result = await ManufacturingService.list({ page: 1, take: 10 });
            expect(result.data).toHaveLength(1);
            expect(result.len).toBe(1);
        });
    });

    describe("detail", () => {
        it("should return order detail", async () => {
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue({ ...mockOrder, wastes: [], goods_receipt: null });
            const result = await ManufacturingService.detail(1);
            expect(result.id).toBe(1);
        });

        it("should throw 404 if order not found", async () => {
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(null);
            await expect(ManufacturingService.detail(999)).rejects.toThrow(ApiError);
        });
    });
});
