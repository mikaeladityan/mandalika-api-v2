import { describe, it, expect, vi, beforeEach } from "vitest";

const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }));

vi.mock("../../module/application/product/sheet/product-sheet.queue.js", () => ({
    enqueueProductSheetSync: enqueueMock,
    productSheetSyncQueue: { add: vi.fn() },
    PRODUCT_SHEET_QUEUE_NAME: "product-sheet-sync",
}));

vi.mock("../../config/prisma.js", () => {
    const tx = {
        productType: { upsert: vi.fn().mockResolvedValue({ id: 1 }) },
        unit: { upsert: vi.fn().mockResolvedValue({ id: 1 }) },
        productSize: { upsert: vi.fn().mockResolvedValue({ id: 1 }) },
        product: {
            create: vi.fn(),
            update: vi.fn(),
        },
    };
    return {
        default: {
            product: {
                findUnique: vi.fn(),
                update: vi.fn().mockResolvedValue({}),
            },
            $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
        },
    };
});

import prisma from "../../config/prisma.js";
import { ProductService } from "../../module/application/product/product.service.js";

describe("ProductService → sheet sync enqueue", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("create() enqueues upsert with new productId", async () => {
        // create() runs inside $transaction; the tx.product.create mock returns a shape
        // resembling Prisma include.
        const txMock = vi.mocked(prisma.$transaction);
        txMock.mockImplementationOnce(async () => ({ id: 42, code: "X-1" }) as never);

        await ProductService.create({
            code: "X-1",
            name: "Test",
            size: 100,
            gender: "UNISEX",
            status: "PENDING",
            z_value: 1.65,
            lead_time: 14,
            review_period: 30,
            unit: null,
            product_type: null,
            distribution_percentage: 0,
            safety_percentage: 0,
            description: null,
        } as never);

        expect(enqueueMock).toHaveBeenCalledWith({ action: "upsert", productId: 42 });
    });

    it("update() enqueues upsert with oldCode when code changes", async () => {
        vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
            id: 7,
            code: "OLD",
        } as never);
        const txMock = vi.mocked(prisma.$transaction);
        txMock.mockImplementationOnce(async () => ({ id: 7, code: "NEW" }) as never);

        await ProductService.update(7, { code: "NEW", name: "X" } as never);

        expect(enqueueMock).toHaveBeenCalledWith({
            action: "upsert",
            productId: 7,
            oldCode: "OLD",
        });
    });

    it("update() enqueues upsert WITHOUT oldCode when code unchanged", async () => {
        vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
            id: 7,
            code: "SAME",
        } as never);
        const txMock = vi.mocked(prisma.$transaction);
        txMock.mockImplementationOnce(async () => ({ id: 7, code: "SAME" }) as never);

        await ProductService.update(7, { code: "SAME", name: "Renamed" } as never);

        expect(enqueueMock).toHaveBeenCalledWith({ action: "upsert", productId: 7 });
    });

    it("status(DELETE) enqueues delete with snapshot code", async () => {
        vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
            id: 9,
            code: "BYE",
        } as never);

        await ProductService.status(9, "DELETE");

        expect(enqueueMock).toHaveBeenCalledWith({
            action: "delete",
            productId: 9,
            code: "BYE",
        });
    });

    it("status(ACTIVE) on restore enqueues upsert", async () => {
        vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
            id: 9,
            code: "BACK",
        } as never);

        await ProductService.status(9, "ACTIVE");

        expect(enqueueMock).toHaveBeenCalledWith({ action: "upsert", productId: 9 });
    });
});
