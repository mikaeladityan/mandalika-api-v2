import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { CreateVendorReturnDTO, UpdateVendorReturnDTO, QueryVendorReturnDTO } from "./vendor-return.schema.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { generateReturnNumber } from "../../../../lib/utils/generate-number.js";

export class VendorReturnService {
    static async list(query: QueryVendorReturnDTO) {
        const { page, take, search, receipt_id, warehouse_id, status, month, year, sortBy = "return_date", order = "desc" } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.VendorReturnWhereInput = {};
        if (search) {
            where.OR = [
                { return_number: { contains: search, mode: "insensitive" } },
                { reason: { contains: search, mode: "insensitive" } },
                { notes: { contains: search, mode: "insensitive" } },
            ];
        }
        if (status) where.status = status;
        if (receipt_id) where.receipt_id = receipt_id;
        if (warehouse_id) where.warehouse_id = warehouse_id;

        if (month) {
            where.return_date = {
                gte: new Date(year ?? new Date().getFullYear(), month - 1, 1),
                lt: new Date(year ?? new Date().getFullYear(), month, 1),
            };
        } else if (year) {
            where.return_date = {
                gte: new Date(year, 0, 1),
                lt: new Date(year + 1, 0, 1),
            };
        }

        const [data, total] = await Promise.all([
            prisma.vendorReturn.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy]: order },
                include: {
                    receipt: { select: { id: true, receipt_number: true } },
                    warehouse: { select: { id: true, name: true, code: true } },
                    _count: { select: { items: true } },
                },
            }),
            prisma.vendorReturn.count({ where }),
        ]);

        return { data, total };
    }

    static async detail(id: number) {
        return await prisma.vendorReturn.findUniqueOrThrow({
            where: { id },
            include: {
                receipt: { select: { id: true, receipt_number: true, receipt_date: true } },
                warehouse: { select: { id: true, name: true, code: true } },
                items: {
                    include: {
                        receipt_item: {
                            select: {
                                id: true,
                                item_code: true,
                                item_name: true,
                                qty_received: true,
                                unit_price: true,
                                po_id: true,
                            },
                        },
                        raw_material: { select: { id: true, barcode: true, name: true } },
                    },
                },
            },
        });
    }

    static async create(body: CreateVendorReturnDTO, userId: string) {
        // Receipt must be POSTED
        const receipt = await prisma.purchaseReceipt.findUniqueOrThrow({
            where: { id: body.receipt_id },
            include: { items: true },
        });

        if (receipt.status !== "POSTED" && receipt.status !== "APPROVED") {
            throw new ApiError(400, `Receipt must be POSTED to create a return. Current: ${receipt.status}.`);
        }

        const receiptItemMap = new Map(receipt.items.map((i) => [i.id, i]));

        // Validate item IDs belong to this receipt (before entering transaction)
        for (const item of body.items) {
            if (!receiptItemMap.has(item.receipt_item_id)) {
                throw new ApiError(400, `Receipt item ${item.receipt_item_id} not found in receipt ${body.receipt_id}.`);
            }
        }

        return await prisma.$transaction(async (tx) => {
            // Validate qty inside transaction to prevent race conditions
            const returnItemsData: Array<{
                receipt_item_id: number;
                raw_material_id: number | null;
                item_code: string;
                item_name: string;
                uom: string;
                qty_returned: number;
                unit_price: any;
                amount: number;
                reason: string | null;
            }> = [];

            // Single groupBy instead of N+1 aggregate per item
            const receiptItemIds = body.items.map((i) => i.receipt_item_id);
            const returnedAggs = await tx.vendorReturnItem.groupBy({
                by: ["receipt_item_id"],
                where: { receipt_item_id: { in: receiptItemIds } },
                _sum: { qty_returned: true },
            });
            const returnedMap = new Map(
                returnedAggs.map((r) => [r.receipt_item_id, Number(r._sum.qty_returned ?? 0)])
            );

            for (const item of body.items) {
                const receiptItem = receiptItemMap.get(item.receipt_item_id)!;

                const totalReturned = returnedMap.get(item.receipt_item_id) ?? 0;
                const available = Number(receiptItem.qty_received) - totalReturned;

                if (item.qty_returned > available + 0.001) {
                    throw new ApiError(
                        400,
                        `Item "${receiptItem.item_name}": qty_returned (${item.qty_returned}) exceeds available qty (${available.toFixed(2)}).`,
                    );
                }

                returnItemsData.push({
                    receipt_item_id: item.receipt_item_id,
                    raw_material_id: receiptItem.raw_material_id ?? null,
                    item_code: receiptItem.item_code,
                    item_name: receiptItem.item_name,
                    uom: receiptItem.uom,
                    qty_returned: item.qty_returned,
                    unit_price: receiptItem.unit_price,
                    amount: item.qty_returned * Number(receiptItem.unit_price),
                    reason: item.reason ?? null,
                });
            }

            return await tx.vendorReturn.create({
                data: {
                    return_number: await generateReturnNumber(tx),
                    return_date: body.return_date ?? new Date(),
                    receipt_id: body.receipt_id,
                    warehouse_id: body.warehouse_id,
                    status: "DRAFT",
                    reason: body.reason ?? null,
                    notes: body.notes ?? null,
                    created_by: userId,
                    items: { create: returnItemsData },
                },
                include: { items: true },
            });
        });
    }

    static async update(id: number, body: UpdateVendorReturnDTO, userId: string) {
        const vendorReturn = await prisma.vendorReturn.findUniqueOrThrow({
            where: { id },
            include: { items: true },
        });

        if (vendorReturn.status !== "DRAFT") {
            throw new ApiError(400, `Cannot edit a return with status ${vendorReturn.status}.`);
        }

        return await prisma.$transaction(async (tx) => {
            if (body.items !== undefined) {
                const receipt = await tx.purchaseReceipt.findUniqueOrThrow({
                    where: { id: vendorReturn.receipt_id },
                    include: { items: true },
                });
                const receiptItemMap = new Map(receipt.items.map((i) => [i.id, i]));

                if (!["POSTED", "APPROVED"].includes(receipt.status)) {
                    throw new ApiError(400, `Receipt must be POSTED to modify return items.`);
                }

                // Single groupBy instead of N+1 aggregate per item
                const updateReceiptItemIds = body.items.map((i) => i.receipt_item_id);
                const otherReturnAggs = await tx.vendorReturnItem.groupBy({
                    by: ["receipt_item_id"],
                    where: { receipt_item_id: { in: updateReceiptItemIds }, return_id: { not: id } },
                    _sum: { qty_returned: true },
                });
                const otherReturnedMap = new Map(
                    otherReturnAggs.map((r) => [r.receipt_item_id, Number(r._sum.qty_returned ?? 0)])
                );

                for (const item of body.items) {
                    const receiptItem = receiptItemMap.get(item.receipt_item_id);
                    if (!receiptItem) {
                        throw new ApiError(400, `Receipt item ${item.receipt_item_id} not found.`);
                    }
                    const totalOtherReturns = otherReturnedMap.get(item.receipt_item_id) ?? 0;
                    const available = Number(receiptItem.qty_received) - totalOtherReturns;
                    if (item.qty_returned > available + 0.001) {
                        throw new ApiError(400, `Item "${receiptItem.item_name}": qty_returned exceeds available (${available.toFixed(2)}).`);
                    }
                }

                await tx.vendorReturnItem.deleteMany({ where: { return_id: id } });
                await tx.vendorReturnItem.createMany({
                    data: body.items.map((item) => {
                        const receiptItem = receiptItemMap.get(item.receipt_item_id)!;
                        return {
                            return_id: id,
                            receipt_item_id: item.receipt_item_id,
                            raw_material_id: receiptItem.raw_material_id ?? null,
                            item_code: receiptItem.item_code,
                            item_name: receiptItem.item_name,
                            uom: receiptItem.uom,
                            qty_returned: item.qty_returned,
                            unit_price: receiptItem.unit_price,
                            amount: item.qty_returned * Number(receiptItem.unit_price),
                            reason: item.reason ?? null,
                        };
                    }),
                });
            }

            await tx.vendorReturn.update({
                where: { id },
                data: {
                    warehouse_id: body.warehouse_id ?? undefined,
                    return_date: body.return_date ?? undefined,
                    reason: body.reason !== undefined ? body.reason : undefined,
                    notes: body.notes !== undefined ? body.notes : undefined,
                    updated_by: userId,
                },
            });

            return await tx.vendorReturn.findUniqueOrThrow({
                where: { id },
                include: { items: true },
            });
        });
    }

    static async post(id: number, userId: string) {
        const vendorReturn = await prisma.vendorReturn.findUniqueOrThrow({
            where: { id },
            include: {
                items: true,
                warehouse: { select: { id: true } },
            },
        });

        if (vendorReturn.status !== "DRAFT") {
            throw new ApiError(400, `Return is already in status ${vendorReturn.status}.`);
        }
        if (vendorReturn.items.length === 0) {
            throw new ApiError(400, "Cannot post an empty return.");
        }

        return await prisma.$transaction(async (tx) => {
            // 1. Mark as POSTED
            await tx.vendorReturn.update({
                where: { id },
                data: { status: "POSTED", posted_at: new Date(), updated_by: userId },
            });

            const returnDate = vendorReturn.return_date ?? new Date();

            // 2. Reduce inventory + create stock movement per item
            for (const item of vendorReturn.items) {
                if (!item.raw_material_id) continue;

                const existing = await tx.rawMaterialInventory.findUnique({
                    where: {
                        raw_material_id_warehouse_id_date_month_year: {
                            raw_material_id: item.raw_material_id,
                            warehouse_id: vendorReturn.warehouse_id,
                            date: returnDate.getDate(),
                            month: returnDate.getMonth() + 1,
                            year: returnDate.getFullYear(),
                        },
                    },
                });

                const qtyBefore = existing ? Number(existing.quantity) : 0;
                const qtyAfter = Math.max(0, qtyBefore - Number(item.qty_returned));

                await tx.rawMaterialInventory.upsert({
                    where: {
                        raw_material_id_warehouse_id_date_month_year: {
                            raw_material_id: item.raw_material_id,
                            warehouse_id: vendorReturn.warehouse_id,
                            date: returnDate.getDate(),
                            month: returnDate.getMonth() + 1,
                            year: returnDate.getFullYear(),
                        },
                    },
                    create: {
                        raw_material_id: item.raw_material_id,
                        warehouse_id: vendorReturn.warehouse_id,
                        quantity: qtyAfter,
                        date: returnDate.getDate(),
                        month: returnDate.getMonth() + 1,
                        year: returnDate.getFullYear(),
                    },
                    update: { quantity: qtyAfter },
                });

                await tx.stockMovement.create({
                    data: {
                        entity_type: "RAW_MATERIAL",
                        entity_id: item.raw_material_id,
                        location_type: "WAREHOUSE",
                        location_id: vendorReturn.warehouse_id,
                        movement_type: "OUT",
                        quantity: item.qty_returned,
                        qty_before: qtyBefore,
                        qty_after: qtyAfter,
                        reference_id: id,
                        reference_type: "STOCK_RETURN",
                        notes: item.reason ?? null,
                        created_by: userId,
                    },
                });
            }

            // 3. Credit linked APs
            // Pre-load receipt items to get po_id per return item
            const receiptItemRows = await tx.purchaseReceiptItem.findMany({
                where: { id: { in: vendorReturn.items.map((i) => i.receipt_item_id) } },
                select: { id: true, po_id: true },
            });
            const receiptItemPoMap = new Map(receiptItemRows.map((r) => [r.id, r.po_id]));

            const poIds = [...new Set(receiptItemRows.map((r) => r.po_id))];

            for (const poId of poIds) {
                const ap = await tx.accountPayable.findFirst({
                    where: { po_id: poId, receipt_id: vendorReturn.receipt_id },
                });
                if (!ap) continue;

                const returnTotal = vendorReturn.items
                    .filter((item) => receiptItemPoMap.get(item.receipt_item_id) === poId)
                    .reduce((sum, i) => sum + Number(i.amount), 0);

                if (returnTotal > 0) {
                    const newRemaining = Math.max(0, Number(ap.remaining_amount) - returnTotal);
                    await tx.accountPayable.update({
                        where: { id: ap.id },
                        data: {
                            remaining_amount: newRemaining,
                            notes: ap.notes
                                ? `${ap.notes} | RTN-credit: ${returnTotal}`
                                : `RTN-credit: ${returnTotal}`,
                        },
                    });
                }
            }

            return await tx.vendorReturn.findUniqueOrThrow({
                where: { id },
                include: { items: true },
            });
        });
    }

    static async approve(id: number, userId: string) {
        const vendorReturn = await prisma.vendorReturn.findUniqueOrThrow({ where: { id } });

        if (vendorReturn.status !== "POSTED") {
            throw new ApiError(400, `Return must be POSTED before approval. Current: ${vendorReturn.status}.`);
        }

        return await prisma.vendorReturn.update({
            where: { id },
            data: { status: "APPROVED", updated_by: userId },
        });
    }

    static async destroy(id: number) {
        const vendorReturn = await prisma.vendorReturn.findUniqueOrThrow({ where: { id } });
        if (vendorReturn.status !== "DRAFT") {
            throw new ApiError(400, "Only DRAFT returns can be deleted.");
        }
        return await prisma.vendorReturn.delete({ where: { id } });
    }
}
