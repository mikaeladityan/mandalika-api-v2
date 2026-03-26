import prisma from "../../../config/prisma.js";
import { GetPagination } from "../../../lib/utils/pagination.js";
import { QueryPurchaseDTO } from "./purchase.schema.js";
import ExcelJS from "exceljs";

export class PurchaseService {
    static async list(query: QueryPurchaseDTO) {
        const { search, page, take, month, year } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const now = new Date();
        const currentMonth = month ?? now.getMonth() + 1;
        const currentYear = year ?? now.getFullYear();

        const query_condition: any = {
            status: "DRAFT",
            month: currentMonth,
            year: currentYear,
            quantity: {
                gt: 0,
            },
        };

        if (query.supplier_id) {
            query_condition.raw_material = {
                supplier_id: query.supplier_id,
            };
        }

        if (search) {
            query_condition.raw_material = {
                name: {
                    contains: search,
                    mode: "insensitive",
                },
            };
        }

        const total = await prisma.materialRecommendationOrder.count({
            where: query_condition,
        });

        const data = await prisma.materialRecommendationOrder.findMany({
            where: query_condition,
            include: {
                raw_material: {
                    include: {
                        supplier: true,
                        unit_raw_material: true,
                    },
                },
            },
            orderBy: {
                updated_at: "desc",
            },
            skip,
            take: limit,
        });

        const parsedData = data.map((item) => ({
            recommendation_id: item.id,
            material_id: item.raw_mat_id,
            barcode: item.raw_material?.barcode || null,
            material_name: item.raw_material?.name || "Unknown",
            supplier_name: item.raw_material?.supplier?.name || "-",
            quantity: Number(item.quantity) || 0,
            uom: item.raw_material?.unit_raw_material?.name || "UNIT",
            price: Number(item.raw_material?.price) || 0,
            moq: item.raw_material?.min_buy ? Number(item.raw_material.min_buy) : null,
            pic_id: item.pic_id,
            status: item.status,
            created_at: item.created_at,
        }));

        return { data: parsedData, len: total };
    }

    static async summaryBySupplier(query: QueryPurchaseDTO) {
        const { search, month, year } = query;

        const now = new Date();
        const currentMonth = month ?? now.getMonth() + 1;
        const currentYear = year ?? now.getFullYear();

        const query_condition: any = {
            status: "DRAFT",
            month: currentMonth,
            year: currentYear,
            quantity: {
                gt: 0,
            },
        };

        if (query.supplier_id) {
            query_condition.raw_material = {
                supplier_id: query.supplier_id,
            };
        }

        if (search) {
            query_condition.raw_material = {
                name: {
                    contains: search,
                    mode: "insensitive",
                },
            };
        }

        const data = await prisma.materialRecommendationOrder.findMany({
            where: query_condition,
            include: {
                raw_material: {
                    include: {
                        supplier: true,
                        unit_raw_material: true,
                    },
                },
            },
            orderBy: {
                raw_material: {
                    supplier: {
                        name: "asc",
                    },
                },
            },
        });

        const grouping: Record<string, any> = {};

        data.forEach((item) => {
            const supplierId = item.raw_material?.supplier?.id || "N/A";
            const supplierName = item.raw_material?.supplier?.name || "No Supplier";

            if (!grouping[supplierId]) {
                grouping[supplierId] = {
                    supplier_id: supplierId,
                    supplier_name: supplierName,
                    total_amount: 0,
                    total_items: 0,
                    items: [],
                };
            }

            const itemPrice = Number(item.raw_material?.price) || 0;
            const itemQty = Number(item.quantity) || 0;
            const subtotal = itemPrice * itemQty;

            grouping[supplierId].total_amount += subtotal;
            grouping[supplierId].total_items += 1;
            grouping[supplierId].items.push({
                material_name: item.raw_material?.name,
                barcode: item.raw_material?.barcode,
                quantity: itemQty,
                price: itemPrice,
                subtotal: subtotal,
                uom: item.raw_material?.unit_raw_material?.name,
                status: item.status,
            });
        });

        return Object.values(grouping);
    }

    static async export(query: QueryPurchaseDTO) {
        const { data } = await this.list({ ...query, take: 1000000, page: 1 });

        // Filter: Only include DRAFT items, exclude ORDERED (ACC)
        const draftItems = data.filter((item) => item.status === "DRAFT");
        const supplierName = (draftItems.length > 0 && query.supplier_id) ? draftItems[0]?.supplier_name : "";

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet(supplierName ? `Pesanan - ${supplierName}` : "Pengajuan Purchase");

        sheet.columns = [
            { header: "No", key: "no", width: 5 },
            { header: "Barcode", key: "barcode", width: 15 },
            { header: "Nama Material", key: "material_name", width: 35 },
            { header: "Supplier", key: "supplier_name", width: 25 },
            { header: "Quantity", key: "quantity", width: 12 },
            { header: "MOQ", key: "moq", width: 10 },
            { header: "UOM", key: "uom", width: 10 },
            { header: "Harga Satuan", key: "price", width: 15 },
            { header: "Total Harga", key: "total_price", width: 18 },
            { header: "Status", key: "status", width: 12 },
            { header: "Tanggal Pengajuan", key: "created_at", width: 25 },
            { header: "PIC", key: "pic_id", width: 15 },
        ];

        let grandTotal = 0;
        draftItems.forEach((item, index) => {
            const totalPrice = (item.price || 0) * (item.quantity || 0);
            grandTotal += totalPrice;

            sheet.addRow({
                no: index + 1,
                barcode: item.barcode || "-",
                material_name: item.material_name,
                supplier_name: item.supplier_name,
                quantity: item.quantity,
                moq: item.moq || 0,
                uom: item.uom?.toUpperCase(),
                price: item.price,
                total_price: totalPrice,
                status: "DRAFT",
                created_at: item.created_at
                    ? new Date(item.created_at).toLocaleString("id-ID")
                    : "-",
                pic_id: item.pic_id || "System",
            });
        });

        // Add Grand Total row for draft items
        const totalRow = sheet.addRow({
            no: "",
            barcode: "",
            material_name: "GRAND TOTAL",
            supplier_name: "",
            quantity: "",
            moq: "",
            uom: "",
            price: "",
            total_price: grandTotal,
            status: "",
            created_at: "",
            pic_id: "",
        });
        totalRow.font = { bold: true };

        // Styling (Blue header like recommendation-v2)
        sheet.getRow(1).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
        sheet.getRow(1).height = 25;
        sheet.getRow(1).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF0070C0" }, // Professional Blue
        };
        sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

        return await workbook.xlsx.writeBuffer();
    }
}
