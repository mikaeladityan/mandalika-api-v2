import prisma from "../../../../config/prisma.js";
import { CreateReceiptDTO, UpdateReceiptDTO, QueryReceiptDTO, QueryOpenPOForReceiptDTO } from "./receipt.schema.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { generateReceiptNumber } from "../../../../lib/utils/generate-number.js";
import { FinanceAPService } from "../../finance/ap/ap.service.js";
import { obscureSupplierName, withObscuredSupplierRelation } from "../../../../lib/utils/supplier-obscure.js";

export class ReceiptService {
    static async list(query: QueryReceiptDTO) {
        const { page, take, search, po_id, warehouse_id, status, month, year, sortBy = "receipt_date", order = "desc" } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: any = {};

        const andConditions: any[] = [];
        if (search) {
            andConditions.push({
                OR: [
                    { receipt_number: { contains: search, mode: "insensitive" } },
                    { notes: { contains: search, mode: "insensitive" } },
                ],
            });
        }
        if (po_id) {
            andConditions.push({
                OR: [{ po_id }, { items: { some: { po_id } } }],
            });
        }
        if (andConditions.length > 0) where.AND = andConditions;
        if (status) where.status = status;
        if (warehouse_id) where.warehouse_id = warehouse_id;

        if (month) {
            where.receipt_date = {
                gte: new Date(year ?? new Date().getFullYear(), month - 1, 1),
                lt: new Date(year ?? new Date().getFullYear(), month, 1),
            };
        } else if (year) {
            where.receipt_date = {
                gte: new Date(year, 0, 1),
                lt: new Date(year + 1, 0, 1),
            };
        }

        const [data, total] = await Promise.all([
            prisma.purchaseReceipt.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy]: order },
                include: {
                    warehouse: { select: { id: true, name: true, code: true } },
                    po: { select: { id: true, po_number: true, supplier_id: true, supplier_name: true } },
                    _count: { select: { items: true } },
                },
            }),
            prisma.purchaseReceipt.count({ where }),
        ]);

        const obscured = data.map((r) => ({
            ...r,
            po: r.po
                ? { ...r.po, supplier_name: obscureSupplierName(r.po.supplier_id) }
                : r.po,
        }));
        return { data: obscured, total };
    }

    static async listOpenPOs(query: QueryOpenPOForReceiptDTO) {
        const { page, take, search, supplier_id, warehouse_id, po_type, month, year } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: any = {
            status: { in: ["ORDERED", "SHIPPED", "ARRIVED"] },
        };

        if (search) {
            where.OR = [
                { po_number: { contains: search, mode: "insensitive" } },
                { supplier_name: { contains: search, mode: "insensitive" } },
            ];
        }
        if (supplier_id) where.supplier_id = supplier_id;
        if (warehouse_id) where.warehouse_id = warehouse_id;
        if (po_type) where.po_type = po_type;

        if (month) {
            const y = year ?? new Date().getFullYear();
            where.po_date = {
                gte: new Date(y, month - 1, 1),
                lt: new Date(y, month, 1),
            };
        } else if (year) {
            where.po_date = {
                gte: new Date(year, 0, 1),
                lt: new Date(year + 1, 0, 1),
            };
        }

        const [data, total] = await Promise.all([
            prisma.purchaseOrder.findMany({
                where,
                skip,
                take: limit,
                orderBy: { po_date: "desc" },
                include: {
                    supplier: { select: { id: true, name: true, country: true } },
                    warehouse: { select: { id: true, name: true, code: true } },
                    tracking: { select: { order_status: true, eta_date: true, arrive_date: true } },
                    items: {
                        select: {
                            id: true,
                            item_code: true,
                            item_name: true,
                            item_category: true,
                            item_type: true,
                            uom: true,
                            unit_price: true,
                            qty_ordered: true,
                            qty_received: true,
                            raw_material_id: true,
                        },
                    },
                },
            }),
            prisma.purchaseOrder.count({ where }),
        ]);

        const mapped = data.map((po) => ({
            ...po,
            items: po.items
                .filter((item) => Number(item.qty_ordered) - Number(item.qty_received) > 0.001)
                .map((item) => ({
                    ...item,
                    open_qty: Number(item.qty_ordered) - Number(item.qty_received),
                })),
        }));

        const obscured = mapped.map((row) =>
            withObscuredSupplierRelation({
                ...row,
                supplier_name: obscureSupplierName(row.supplier_id),
                supplier_code: null,
            }),
        );
        return { data: obscured, total };
    }

    static async detail(id: number) {
        const row = await prisma.purchaseReceipt.findUniqueOrThrow({
            where: { id },
            include: {
                warehouse: { select: { id: true, name: true, code: true } },
                items: {
                    include: {
                        po: { select: { id: true, po_number: true, supplier_id: true, supplier_name: true } },
                        po_item: { select: { id: true, item_code: true, item_name: true, qty_ordered: true, qty_received: true } },
                        raw_material: { select: { id: true, barcode: true, name: true } },
                    },
                },
                account_payables: {
                    select: { id: true, ap_number: true, amount: true, status: true, due_date: true },
                },
            },
        });
        return {
            ...row,
            items: row.items.map((it) => ({
                ...it,
                po: it.po
                    ? { ...it.po, supplier_name: obscureSupplierName(it.po.supplier_id) }
                    : it.po,
            })),
        };
    }

    static async create(body: CreateReceiptDTO, userId: string) {
        const poItemIds = body.items.map((i) => i.po_item_id);

        // Load all PO items at once
        const poItems = await prisma.purchaseOrderItem.findMany({
            where: { id: { in: poItemIds } },
            include: { po: { select: { id: true, status: true, supplier_id: true, supplier_name: true } } },
        });

        const poItemMap = new Map(poItems.map((i) => [i.id, i]));

        // Validate all items
        for (const item of body.items) {
            const poItem = poItemMap.get(item.po_item_id);
            if (!poItem) {
                throw new ApiError(400, `PO item ID ${item.po_item_id} not found.`);
            }
            if (poItem.po_id !== item.po_id) {
                throw new ApiError(400, `PO item ${item.po_item_id} does not belong to PO ${item.po_id}.`);
            }
            if (poItem.po.status !== "ORDERED") {
                throw new ApiError(400, `PO ${poItem.po.id} must be in ORDERED status to receive items.`);
            }
            const openQty = Number(poItem.qty_ordered) - Number(poItem.qty_received);
            if (item.qty_received > openQty + 0.001) {
                throw new ApiError(
                    400,
                    `Item "${poItem.item_name}": qty_received (${item.qty_received}) exceeds open qty (${openQty.toFixed(2)}).`,
                );
            }
        }

        const poIds = [...new Set(body.items.map((i) => i.po_id))];
        const singlePoId = poIds.length === 1 ? poIds[0] : null;

        return await prisma.$transaction(async (tx) => {
            let totalQty = 0;
            let totalAmount = 0;

            const receiptItemsData = body.items.map((item) => {
                const poItem = poItemMap.get(item.po_item_id)!;
                const amount = item.qty_received * Number(poItem.unit_price);
                totalQty += item.qty_received;
                totalAmount += amount;
                return {
                    po_id: item.po_id,
                    po_item_id: item.po_item_id,
                    raw_material_id: poItem.raw_material_id ?? null,
                    item_code: poItem.item_code,
                    item_name: poItem.item_name,
                    uom: poItem.uom,
                    qty_received: item.qty_received,
                    unit_price: poItem.unit_price,
                    amount,
                    notes: item.notes ?? null,
                };
            });

            return await tx.purchaseReceipt.create({
                data: {
                    receipt_number: await generateReceiptNumber(tx),
                    receipt_date: body.receipt_date ?? new Date(),
                    po_id: singlePoId,
                    warehouse_id: body.warehouse_id,
                    status: "DRAFT",
                    total_qty: totalQty,
                    total_amount: totalAmount,
                    notes: body.notes ?? null,
                    created_by: userId,
                    items: { create: receiptItemsData },
                },
                include: { items: true },
            });
        });
    }

    static async update(id: number, body: UpdateReceiptDTO, userId: string) {
        const receipt = await prisma.purchaseReceipt.findUniqueOrThrow({ where: { id } });

        if (receipt.status !== "DRAFT") {
            throw new ApiError(400, `Cannot edit a receipt with status ${receipt.status}.`);
        }

        return await prisma.$transaction(async (tx) => {
            if (body.items !== undefined) {
                const poItemIds = body.items.map((i) => i.po_item_id);
                const poItems = await tx.purchaseOrderItem.findMany({
                    where: { id: { in: poItemIds } },
                    include: { po: { select: { id: true, status: true } } },
                });
                const poItemMap = new Map(poItems.map((i) => [i.id, i]));

                for (const item of body.items) {
                    const poItem = poItemMap.get(item.po_item_id);
                    if (!poItem) {
                        throw new ApiError(400, `PO item ID ${item.po_item_id} not found.`);
                    }
                    if (poItem.po_id !== item.po_id) {
                        throw new ApiError(400, `PO item ${item.po_item_id} does not belong to PO ${item.po_id}.`);
                    }
                    if (poItem.po.status !== "ORDERED") {
                        throw new ApiError(400, `PO ${poItem.po.id} must be in ORDERED status to receive items.`);
                    }
                    const openQty = Number(poItem.qty_ordered) - Number(poItem.qty_received);
                    if (item.qty_received > openQty + 0.001) {
                        throw new ApiError(
                            400,
                            `Item "${poItem.item_name}": qty exceeds open qty (${openQty.toFixed(2)}).`,
                        );
                    }
                }

                const updatedPoIds = [...new Set(body.items.map((i) => i.po_id))];
                const singlePoId = updatedPoIds.length === 1 ? updatedPoIds[0] : null;

                await tx.purchaseReceiptItem.deleteMany({ where: { receipt_id: id } });

                let totalQty = 0;
                let totalAmount = 0;
                const newItems = body.items.map((item) => {
                    const poItem = poItemMap.get(item.po_item_id)!;
                    const amount = item.qty_received * Number(poItem.unit_price);
                    totalQty += item.qty_received;
                    totalAmount += amount;
                    return {
                        receipt_id: id,
                        po_id: item.po_id,
                        po_item_id: item.po_item_id,
                        raw_material_id: poItem.raw_material_id ?? null,
                        item_code: poItem.item_code,
                        item_name: poItem.item_name,
                        uom: poItem.uom,
                        qty_received: item.qty_received,
                        unit_price: poItem.unit_price,
                        amount,
                        notes: item.notes ?? null,
                    };
                });
                await tx.purchaseReceiptItem.createMany({ data: newItems });

                await tx.purchaseReceipt.update({
                    where: { id },
                    data: {
                        po_id: singlePoId,
                        warehouse_id: body.warehouse_id ?? undefined,
                        receipt_date: body.receipt_date ?? undefined,
                        notes: body.notes !== undefined ? body.notes : undefined,
                        total_qty: totalQty,
                        total_amount: totalAmount,
                        updated_by: userId,
                    },
                });
            } else {
                await tx.purchaseReceipt.update({
                    where: { id },
                    data: {
                        warehouse_id: body.warehouse_id ?? undefined,
                        receipt_date: body.receipt_date ?? undefined,
                        notes: body.notes !== undefined ? body.notes : undefined,
                        updated_by: userId,
                    },
                });
            }

            return await tx.purchaseReceipt.findUniqueOrThrow({
                where: { id },
                include: { items: true },
            });
        });
    }

    static async post(id: number, userId: string) {
        const receipt = await prisma.purchaseReceipt.findUniqueOrThrow({
            where: { id },
            include: {
                items: true,
                warehouse: { select: { id: true } },
            },
        });

        if (receipt.status !== "DRAFT") {
            throw new ApiError(400, `Receipt is already in status ${receipt.status}.`);
        }
        if (receipt.items.length === 0) {
            throw new ApiError(400, "Cannot post an empty receipt.");
        }

        const poIds = [...new Set(receipt.items.map((i) => i.po_id))];
        const pos = await prisma.purchaseOrder.findMany({
            where: { id: { in: poIds } },
            include: { items: true },
        });
        const poMap = new Map(pos.map((p) => [p.id, p]));

        return await prisma.$transaction(async (tx) => {
            // 1. Mark receipt as POSTED
            await tx.purchaseReceipt.update({
                where: { id },
                data: { status: "POSTED", posted_at: new Date(), updated_by: userId },
            });

            // Group items by po_id for inventory & tracking updates
            const itemsByPo = new Map<number, typeof receipt.items>();
            for (const item of receipt.items) {
                if (!itemsByPo.has(item.po_id)) itemsByPo.set(item.po_id, []);
                itemsByPo.get(item.po_id)!.push(item);
            }

            for (const [poId, poItems] of itemsByPo) {
                const po = poMap.get(poId);
                if (!po) throw new ApiError(400, `PO ${poId} not found.`);

                // 2. Update PurchaseOrderItem.qty_received
                for (const item of poItems) {
                    await tx.purchaseOrderItem.update({
                        where: { id: item.po_item_id },
                        data: { qty_received: { increment: Number(item.qty_received) } },
                    });
                }

                // 3. Check if all items in this PO are fully received
                const updatedItems = await tx.purchaseOrderItem.findMany({ where: { po_id: poId } });
                const allReceived = updatedItems.every(
                    (i) => Number(i.qty_received) >= Number(i.qty_ordered) - 0.001,
                );
                const hasPartial = updatedItems.some((i) => Number(i.qty_received) > 0);

                if (allReceived && po.status !== "CLOSED") {
                    await tx.purchaseOrder.update({
                        where: { id: poId },
                        data: { status: "CLOSED", closed_at: new Date(), updated_by: userId },
                    });
                }

                // 4. Update PurchaseTracking
                const trackingOrderStatus = allReceived ? "RECEIVED" : (hasPartial ? "PARTIALLY_RECEIVED" : "ARRIVED");
                await tx.purchaseTracking.upsert({
                    where: { po_id: poId },
                    create: {
                        po_id: poId,
                        order_status: trackingOrderStatus,
                        payment_status: "UNPAID",
                        updated_by: userId,
                    },
                    update: { order_status: trackingOrderStatus, updated_by: userId },
                });

                // 5. Upsert RawMaterialInventory & create StockMovement per item
                const receiptDate = receipt.receipt_date ?? new Date();
                for (const item of poItems) {
                    if (!item.raw_material_id) continue;

                    const existing = await tx.rawMaterialInventory.findUnique({
                        where: {
                            raw_material_id_warehouse_id_date_month_year: {
                                raw_material_id: item.raw_material_id,
                                warehouse_id: receipt.warehouse_id,
                                date: receiptDate.getDate(),
                                month: receiptDate.getMonth() + 1,
                                year: receiptDate.getFullYear(),
                            },
                        },
                    });

                    const qtyBefore = existing ? Number(existing.quantity) : 0;
                    const qtyAfter = qtyBefore + Number(item.qty_received);

                    await tx.rawMaterialInventory.upsert({
                        where: {
                            raw_material_id_warehouse_id_date_month_year: {
                                raw_material_id: item.raw_material_id,
                                warehouse_id: receipt.warehouse_id,
                                date: receiptDate.getDate(),
                                month: receiptDate.getMonth() + 1,
                                year: receiptDate.getFullYear(),
                            },
                        },
                        create: {
                            raw_material_id: item.raw_material_id,
                            warehouse_id: receipt.warehouse_id,
                            quantity: qtyAfter,
                            date: receiptDate.getDate(),
                            month: receiptDate.getMonth() + 1,
                            year: receiptDate.getFullYear(),
                        },
                        update: { quantity: { increment: Number(item.qty_received) } },
                    });

                    await tx.stockMovement.create({
                        data: {
                            entity_type: "RAW_MATERIAL",
                            entity_id: item.raw_material_id,
                            location_type: "WAREHOUSE",
                            location_id: receipt.warehouse_id,
                            movement_type: "IN",
                            quantity: item.qty_received,
                            qty_before: qtyBefore,
                            qty_after: qtyAfter,
                            reference_id: id,
                            reference_type: "GOODS_RECEIPT",
                            notes: item.notes ?? null,
                            created_by: userId,
                        },
                    });
                }

            }

            // 6. Create AccountPayable records via Finance service (handles all POs, idempotent)
            await FinanceAPService.createFromReceipt(id, userId, tx);

            return await tx.purchaseReceipt.findUniqueOrThrow({
                where: { id },
                include: {
                    items: true,
                    account_payables: { select: { id: true, ap_number: true, amount: true, status: true } },
                },
            });
        });
    }

    static async approve(id: number, userId: string) {
        const receipt = await prisma.purchaseReceipt.findUniqueOrThrow({ where: { id } });

        if (receipt.status !== "POSTED") {
            throw new ApiError(400, `Receipt must be POSTED before it can be approved. Current: ${receipt.status}.`);
        }

        return await prisma.purchaseReceipt.update({
            where: { id },
            data: { status: "APPROVED", approved_by: userId, updated_by: userId },
        });
    }

    static async destroy(id: number) {
        const receipt = await prisma.purchaseReceipt.findUniqueOrThrow({ where: { id } });
        if (receipt.status !== "DRAFT") {
            throw new ApiError(400, "Only DRAFT receipts can be deleted.");
        }
        return await prisma.purchaseReceipt.delete({ where: { id } });
    }
}
