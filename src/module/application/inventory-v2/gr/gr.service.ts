import { Prisma } from "../../../../generated/prisma/client.js";
import prisma from "../../../../config/prisma.js";
import { CreateGoodsReceiptDTO, QueryGoodsReceiptDTO } from "./gr.schema.js";
import {
    GoodsReceiptStatus,
    MovementType,
    MovementEntityType,
    MovementRefType,
} from "../../../../generated/prisma/enums.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";

function generateGRNumber() {
    const date = new Date();
    const prefix = "GR";
    const ym = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
    const random = Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, "0");
    return `${prefix}-${ym}-${random}`;
}

export class GoodsReceiptService {
    static async create(payload: CreateGoodsReceiptDTO, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const gr_number = generateGRNumber();

            const gr = await tx.goodsReceipt.create({
                data: {
                    gr_number,
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
                include: { items: true },
            });
            return gr;
        });
    }

    static async post(id: number, userId: string = "system") {
        return await prisma.$transaction(async (tx) => {
            const gr = await tx.goodsReceipt.findUnique({
                where: { id },
                include: { items: true },
            });

            if (!gr) throw new ApiError(404, "Goods receipt not found");
            if (gr.status !== GoodsReceiptStatus.PENDING) {
                throw new ApiError(400, `Cannot post goods receipt in ${gr.status} state`);
            }

            // Update status
            const updatedGr = await tx.goodsReceipt.update({
                where: { id },
                data: {
                    status: GoodsReceiptStatus.COMPLETED,
                    posted_at: new Date(),
                },
                include: { items: true },
            });

            // Add to warehouse inventory
            await this.addInventory(tx, gr.warehouse_id, gr.items, gr.id, userId);

            return updatedGr;
        });
    }

    private static async addInventory(
        tx: Prisma.TransactionClient,
        warehouse_id: number,
        items: any[],
        gr_id: number,
        userId: string,
    ) {
        const currentDate = new Date();
        for (const item of items) {
            const addAmount = Number(item.quantity_actual);

            let pi = await tx.productInventory.findFirst({
                where: { product_id: item.product_id, warehouse_id },
                orderBy: { created_at: "desc" },
            });

            let qty_before = 0;
            let targetPiId: number;

            if (pi) {
                qty_before = Number(pi.quantity);
                const updatedPi = await tx.productInventory.update({
                    where: { id: pi.id },
                    data: { quantity: qty_before + addAmount },
                });
                targetPiId = updatedPi.id;
            } else {
                const newPi = await tx.productInventory.create({
                    data: {
                        product_id: item.product_id,
                        warehouse_id,
                        quantity: addAmount,
                        date: currentDate.getDate(),
                        month: currentDate.getMonth() + 1,
                        year: currentDate.getFullYear(),
                    },
                });
                targetPiId = newPi.id;
            }
            const qty_after = qty_before + addAmount;

            await tx.stockMovement.create({
                data: {
                    entity_type: MovementEntityType.PRODUCT,
                    entity_id: item.product_id,
                    location_type: "WAREHOUSE",
                    location_id: warehouse_id,
                    movement_type: MovementType.IN,
                    quantity: addAmount,
                    qty_before,
                    qty_after,
                    reference_id: gr_id,
                    reference_type: MovementRefType.GOODS_RECEIPT,
                    created_by: userId,
                },
            });
        }
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
            ...(search && {
                gr_number: { contains: search, mode: "insensitive" },
            }),
            ...(status && { status }),
            ...(type && { type }),
            ...(warehouse_id && { warehouse_id }),
        };

        const [data, len] = await Promise.all([
            prisma.goodsReceipt.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy as any]: sortOrder },
                include: {
                    items: { include: { product: true } },
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
                items: { include: { product: true } },
                warehouse: true,
            },
        });

        if (!result) throw new ApiError(404, "Goods receipt not found");
        return result;
    }

    static async cancel(id: number) {
        const gr = await prisma.goodsReceipt.findUnique({ where: { id } });

        if (!gr) {
            throw new Error("Goods Receipt tidak ditemukan.");
        }

        if (gr.status !== GoodsReceiptStatus.PENDING) {
            throw new Error("Hanya Goods Receipt berstatus PENDING yang dapat dibatalkan.");
        }

        return prisma.goodsReceipt.update({
            where: { id },
            data: {
                status: GoodsReceiptStatus.CANCELLED,
            },
        });
    }
}
