import { Prisma } from "../../../../generated/prisma/client.js";
import prisma from "../../../../config/prisma.js";
import { RequestGoodsReceiptDTO, QueryGoodsReceiptDTO } from "./gr.schema.js";
import { GoodsReceiptStatus, MovementType, MovementRefType } from "../../../../generated/prisma/enums.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import ExcelJS from "exceljs";
import { InventoryHelper } from "../inventory.helper.js";
import { EXPORT_ROW_LIMIT, PRODUCT_INCLUDE, generateDocNumber } from "../inventory.constants.js";
import { ReturnService } from "../return/return.service.js";

export class GoodsReceiptService {
    static async create(payload: RequestGoodsReceiptDTO, userId: string = "system") {
        return prisma.goodsReceipt.create({
            data: {
                gr_number: generateDocNumber("GR", 3),
                type: payload.type,
                warehouse_id: payload.warehouse_id,
                date: payload.date ? new Date(payload.date) : new Date(),
                notes: payload.notes,
                created_by: userId,
                status: GoodsReceiptStatus.PENDING,
                items: {
                    create: payload.items.map((i) => ({
                        product_id: i.product_id,
                        quantity_planned: i.quantity_planned,
                        quantity_actual: i.quantity_actual,
                        notes: i.notes,
                    })),
                },
            },
            include: { items: { include: { product: true } }, warehouse: true },
        });
    }

    static async post(id: number, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const gr = await tx.goodsReceipt.findUnique({
                where: { id },
                include: { items: true },
            });

            if (!gr) throw new ApiError(404, "Data Goods Receipt tidak ditemukan");
            if (gr.status !== GoodsReceiptStatus.PENDING) {
                throw new ApiError(400, `Tidak dapat melakukan POST pada Goods Receipt berstatus ${gr.status}`);
            }

            const updatedGr = await tx.goodsReceipt.update({
                where: { id },
                data: { status: GoodsReceiptStatus.COMPLETED, posted_at: new Date() },
                include: { items: { include: { product: true } }, warehouse: true },
            });

            const items = gr.items.map((i) => ({
                product_id: i.product_id,
                // We add the planned quantity here because the ReturnService will immediately 
                // generate a Return for (planned - actual) and deduct it back out.
                quantity: Number(i.quantity_planned),
            }));

            await InventoryHelper.addWarehouseStock(
                tx, gr.warehouse_id, items,
                gr.id, MovementRefType.GOODS_RECEIPT, MovementType.IN, userId,
            );

            // Create Return if there are missing/rejected items
            const createdReturn = await ReturnService.createFromRejection(
                tx, 
                gr, 
                userId
            );

            return {
                ...updatedGr,
                created_return: createdReturn ? {
                    id: createdReturn.id,
                    return_number: createdReturn.return_number
                } : null
            };
        });
    }

    static async list(query: QueryGoodsReceiptDTO) {
        const {
            page = 1,
            take = 10,
            sortBy = "created_at",
            sortOrder = "desc",
            search,
            status,
            type,
            warehouse_id,
        } = query;

        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.GoodsReceiptWhereInput = {
            ...(search && { gr_number: { contains: search, mode: "insensitive" } }),
            ...(status && { status }),
            ...(type && { type }),
            ...(warehouse_id && { warehouse_id }),
        };

        const [data, len] = await Promise.all([
            prisma.goodsReceipt.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy as string]: sortOrder },
                include: {
                    items: { include: { product: PRODUCT_INCLUDE } },
                    warehouse: true,
                    _count: { select: { items: true } },
                },
            }),
            prisma.goodsReceipt.count({ where }),
        ]);

        return { data, len };
    }

    static async detail(id: number) {
        const result = await prisma.goodsReceipt.findUnique({
            where: { id },
            include: {
                items: { include: { product: PRODUCT_INCLUDE } },
                warehouse: true,
            },
        });

        if (!result) throw new ApiError(404, "Data Goods Receipt tidak ditemukan");
        return result;
    }

    static async cancel(id: number) {
        const gr = await prisma.goodsReceipt.findUnique({ where: { id } });
        if (!gr) throw new ApiError(404, "Data Goods Receipt tidak ditemukan");
        if (gr.status !== GoodsReceiptStatus.PENDING) {
            throw new ApiError(400, "Hanya Goods Receipt berstatus PENDING yang dapat dibatalkan.");
        }

        return prisma.goodsReceipt.update({
            where: { id },
            data: { status: GoodsReceiptStatus.CANCELLED },
            include: { warehouse: true },
        });
    }

    static async export(query: QueryGoodsReceiptDTO) {
        const { data } = await this.list({ ...query, take: EXPORT_ROW_LIMIT, page: 1 });

        const headers = {
            gr_number: "No. GR",
            date: "Tanggal",
            "warehouse.name": "Gudang",
            type: "Tipe",
            "_count.items": "Total SKU",
            status: "Status",
            created_by: "Dibuat Oleh",
            notes: "Catatan",
        };

        const mappedData = data.map((item) => ({
            ...item,
            date: item.date ? new Date(item.date).toLocaleDateString("id-ID") : "-",
        }));

        return InventoryHelper.toCSV(mappedData, headers);
    }

    static async getStats() {
        const [total, pending, completed, cancelled] = await Promise.all([
            prisma.goodsReceipt.count(),
            prisma.goodsReceipt.count({ where: { status: GoodsReceiptStatus.PENDING } }),
            prisma.goodsReceipt.count({ where: { status: GoodsReceiptStatus.COMPLETED } }),
            prisma.goodsReceipt.count({ where: { status: GoodsReceiptStatus.CANCELLED } }),
        ]);

        return { total, pending, completed, cancelled };
    }

}
