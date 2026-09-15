import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { RawMaterialStockService } from "../../module/application/rawmat/stock/rawmat.stock.service.js";
import { RawMaterialStockController } from "../../module/application/rawmat/stock/rawmat.stock.controller.js";
import { ResponseRawMaterialStockDTO } from "../../module/application/rawmat/stock/rawmat.stock.schema.js";

const material: ResponseRawMaterialStockDTO = {
    id: 1, barcode: "SAME", name: "Material", category: "Packaging", uom: "PCS",
    amount: 100, booked: 30, avail: 70, stock_source: "FG",
    source_warehouses: [
        { warehouse_id: 2, warehouse_name: "FG Surabaya", quantity: 70 },
        { warehouse_id: 3, warehouse_name: "FG Jakarta", quantity: 30 },
    ],
    stocks: { "FG Surabaya": 70, "FG Jakarta": 30 },
    details: {
        "FG Surabaya": { on_hand: 70, booked: 20, avail: 50 },
        "FG Jakarta": { on_hand: 30, booked: 0, avail: 30 },
        "RM Production": { on_hand: 0, booked: 10, avail: -10 },
    },
};

describe("RM stock fallback API and export", () => {
    afterEach(() => vi.restoreAllMocks());

    it("passes the selected warehouse to the service and returns the real FG source warehouses", async () => {
        const list = vi.spyOn(RawMaterialStockService, "listRawMaterialStock").mockResolvedValue({
            data: [material], len: 1, month: 9, year: 2026,
        });
        const app = new Hono().get("/stocks", RawMaterialStockController.listRawMaterialStock);
        const response = await app.request("/stocks?warehouse_id=1&month=9&year=2026");
        expect(response.status).toBe(200);
        expect(list).toHaveBeenCalledWith(expect.objectContaining({ warehouse_id: 1, month: 9, year: 2026 }));
        const body = await response.text();
        expect(body).toContain('"stock_source":"FG"');
        expect(body).toContain('"warehouse_name":"FG Surabaya"');
        expect(body).toContain('"avail":70');
        expect(JSON.parse(body).data).toMatchObject({ month: 9, year: 2026 });
    });

    it("exports the effective balance, booking and named FG sources using the same warehouse scope", async () => {
        const list = vi.spyOn(RawMaterialStockService, "listRawMaterialStock").mockResolvedValue({
            data: [material], len: 1, month: 9, year: 2026,
        });
        const result = await RawMaterialStockService.export({ warehouse_id: 1, month: 9, year: 2026, sortBy: "name", sortOrder: "asc" });
        const csv = Buffer.from(result).toString("utf8");
        expect(list).toHaveBeenCalledWith(expect.objectContaining({ warehouse_id: 1, month: 9, year: 2026, page: 1 }));
        expect(csv).toContain("SUMBER STOK,GUDANG SUMBER (JUMLAH)");
        expect(csv).toContain("FG Surabaya: 70; FG Jakarta: 30");
        expect(csv).toContain(",100,30,70");
    });
});
