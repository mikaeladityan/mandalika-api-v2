import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductService } from "../../module/application/product/product.service.js";
import { ForecastService } from "../../module/application/forecast/forecast.service.js";
import { UpdateProductSchema } from "../../module/application/product/product.schema.js";

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), run: vi.fn(), sync: vi.fn(),
}));
vi.mock("../../config/prisma.js", () => {
    const product = { findUnique: mocks.findUnique, findMany: mocks.findMany, update: mocks.update };
    return { default: { product, $transaction: async (fn: (tx: { product: typeof product }) => Promise<object>) => fn({ product }) } };
});
vi.mock("../../module/application/product/sheet/product-sheet.queue.js", () => ({ enqueueProductSheetSync: mocks.sync }));

const period = { start_month: 9, start_year: 2026, horizon: 3 };
const product = (id: number, slug: string, size = 110, status = "ACTIVE", edar: number | null = 0.5) => ({
    id, name: "GORGEOUS TUBEROSE", code: `FG-${id}`, status,
    size_id: size, size: { size }, product_type: { slug },
    distribution_percentage: edar, z_value: 1.65, safety_percentage: 0,
});
let rows: ReturnType<typeof product>[];

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(ForecastService, "run").mockImplementation(mocks.run);
    mocks.run.mockResolvedValue({ message: "ok", processed_records: 6, safety_stock_records: 6 });
    rows = [product(1, "edp"), product(2, "parfume-intense")];
    mocks.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) => rows.find((row) => row.id === where.id));
    mocks.findMany.mockImplementation(async ({ where }: { where: { size_id: number; id: { not: number } } }) =>
        rows.filter((row) => row.id !== where.id.not && row.size_id === where.size_id));
    mocks.update.mockImplementation(async ({ where, data }: { where: { id: number }; data: Partial<ReturnType<typeof product>> }) => {
        const row = rows.find((item) => item.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
    });
});

describe("EDAR pairing and automatic forecast", () => {
    it.each([0, 0.6, 1])("updates opposite family to complement of %s and reruns once", async (percentage) => {
        rows.push(product(3, "parfum", 2), product(4, "pooler"));
        await ProductService.update(1, { distribution_percentage: percentage, rerun: period });
        expect(rows.map((row) => row.distribution_percentage)).toEqual([percentage, 1 - percentage, 0.5, 0.5]);
        expect(mocks.run).toHaveBeenCalledExactlyOnceWith({ product_id: 1, ...period });
        expect(mocks.sync).toHaveBeenCalledWith({ action: "upsert", productId: 2 });
    });
    it("balances Vial separately from bottle sizes", async () => {
        rows.push(product(3, "edp", 2), product(4, "parfum", 2));
        await ProductService.update(3, { distribution_percentage: 0.7 });
        expect(rows.map((row) => row.distribution_percentage)).toEqual([0.5, 0.5, 0.7, 0.3]);
        expect(mocks.run).toHaveBeenCalledOnce();
    });
    it.each([0.5, 0, null])("discontinues with initial EDAR %s and gives active partner 100%%", async (edar) => {
        rows[0]!.distribution_percentage = edar;
        await ProductService.status(1, "PENDING", period);
        expect(rows[0]!.status).toBe("PENDING");
        expect(rows.map((row) => row.distribution_percentage)).toEqual([0, 1]);
        expect(mocks.run).toHaveBeenCalledExactlyOnceWith({ product_id: 1, ...period });
    });
    it("keeps both discontinued variants at zero", async () => {
        rows[1]!.status = "PENDING";
        await ProductService.status(1, "PENDING", period);
        expect(rows.map((row) => row.distribution_percentage)).toEqual([0, 0]);
        expect(mocks.run).toHaveBeenCalledOnce();
    });
    it("discontinues unpaired product and reruns", async () => {
        rows.pop();
        await ProductService.status(1, "PENDING", period);
        expect(rows[0]!.distribution_percentage).toBe(0);
        expect(mocks.run).toHaveBeenCalledOnce();
    });
    it("does not redistribute pooler EDAR", async () => {
        rows[0]!.product_type.slug = "pooler";
        await ProductService.update(1, { distribution_percentage: 0.2 });
        expect(rows[1]!.distribution_percentage).toBe(0.5);
        expect(mocks.run).toHaveBeenCalledOnce();
    });
    it("never assigns positive EDAR to a discontinued FG", async () => {
        rows[0]!.status = "PENDING";
        const result = await ProductService.update(1, { distribution_percentage: 0.6 });
        expect(result.distribution_percentage).toBe(0);
        expect(rows.map((row) => row.distribution_percentage)).toEqual([0, 1]);
    });
    it("keeps the sole active partner at 100% when its pair is discontinued", async () => {
        rows[1]!.status = "PENDING";
        const result = await ProductService.update(1, { distribution_percentage: 0.6 });
        expect(result.distribution_percentage).toBe(1);
        expect(rows.map((row) => row.distribution_percentage)).toEqual([1, 0]);
    });
    it("reports saved changes explicitly if rerun fails", async () => {
        mocks.run.mockRejectedValueOnce(new Error("Persentase belum diatur"));
        await expect(ProductService.update(1, { distribution_percentage: 0.6 })).rejects.toThrow("Perubahan produk tersimpan, tetapi rerun Forecast gagal");
        expect(rows[1]!.distribution_percentage).toBe(0.4);
    });
    it("rejects percentages outside 0–100% at the API boundary", () => {
        expect(UpdateProductSchema.safeParse({ distribution_percentage: 1.01 }).success).toBe(false);
        expect(UpdateProductSchema.safeParse({ distribution_percentage: -0.01 }).success).toBe(false);
    });
});
