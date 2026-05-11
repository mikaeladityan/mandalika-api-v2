import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { CreatePODTO, UpdatePODTO, UpdatePOStatusDTO, QueryPODTO, UpdatePOTrackingDTO, QueryOpenPODTO, ReceiveItemsDTO } from "./po.schema.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { generatePONumber, generateReceiptNumber, generateAPNumber } from "../../../../lib/utils/generate-number.js";

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
    DRAFT: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["APPROVED", "CANCELLED"],
    APPROVED: ["ORDERED", "CANCELLED"],
    ORDERED: ["CLOSED"],
    CLOSED: [],
    CANCELLED: [],
};

export class POService {
    static async list(query: QueryPODTO) {
        const { page, take, search, status, po_type, supplier_id, warehouse_id, month, year, sortBy = "po_date", order = "desc" } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: any = {};

        if (search) {
            where.OR = [
                { po_number: { contains: search, mode: "insensitive" } },
                { supplier_name: { contains: search, mode: "insensitive" } },
                { notes: { contains: search, mode: "insensitive" } },
            ];
        }
        if (status) where.status = status;
        if (po_type) where.po_type = po_type;
        if (supplier_id) where.supplier_id = supplier_id;
        if (warehouse_id) where.warehouse_id = warehouse_id;
        
        if (month) {
            where.po_date = { 
                gte: new Date(year ?? new Date().getFullYear(), month - 1, 1), 
                lt: new Date(year ?? new Date().getFullYear(), month, 1) 
            };
        } else if (year) {
            where.po_date = { 
                gte: new Date(year, 0, 1), 
                lt: new Date(year + 1, 0, 1) 
            };
        }

        const [data, total] = await Promise.all([
            prisma.purchaseOrder.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy]: order },
                include: {
                    supplier: { select: { id: true, name: true, country: true } },
                    warehouse: { select: { id: true, name: true, code: true } },
                    tracking: { select: { eta_date: true, order_status: true, payment_status: true } },
                    _count: { select: { items: true, receipt_items: true } },
                },
            }),
            prisma.purchaseOrder.count({ where }),
        ]);

        return { data, total };
    }

    static async detail(id: number) {
        return await prisma.purchaseOrder.findUniqueOrThrow({
            where: { id },
            include: {
                supplier: true,
                warehouse: true,
                source_rfq: {
                    select: { id: true, rfq_number: true },
                },
                items: {
                    include: {
                        raw_material: {
                            include: {
                                unit_raw_material: { select: { name: true } },
                            },
                        },
                    },
                },
                payment_terms: true,
                tracking: true,
                _count: { select: { receipt_items: true } },
            },
        });
    }

    static async create(body: CreatePODTO, userId: string) {
        return await prisma.$transaction(async (tx) => {
            const currency = body.currency || "IDR";
            const exchangeRate = body.exchange_rate || 1;

            if (body.po_type === "IMPORT" && currency === "IDR") {
                throw new ApiError(400, "Import PO must use foreign currency.");
            }
            if (currency !== "IDR" && (!exchangeRate || exchangeRate <= 0)) {
                throw new ApiError(400, "Exchange rate is required for foreign currency.");
            }

            const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: body.supplier_id } });

            const po = await tx.purchaseOrder.create({
                data: {
                    po_number: body.po_number || await generatePONumber(tx),
                    po_date: body.po_date || new Date(),
                    po_type: body.po_type,
                    supplier_id: body.supplier_id,
                    supplier_name: supplier.name,
                    supplier_code: supplier.slug || null,
                    is_new_supplier: false,
                    warehouse_id: body.warehouse_id || null,
                    source_rfq_id: body.source_rfq_id || null,
                    currency: currency,
                    exchange_rate: exchangeRate,
                    total_estimated: body.total_estimated,
                    status: "DRAFT",
                    notes: body.notes || null,
                    payment_notes: body.payment_notes || null,
                    created_by: userId,
                    items: {
                        create: body.items.map((item) => ({
                            raw_material_id: item.raw_material_id || null,
                            item_code: item.item_code,
                            item_name: item.item_name,
                            item_category: item.item_category || null,
                            item_type: item.item_type,
                            uom: item.uom,
                            moq: item.moq || null,
                            unit_price: item.unit_price,
                            qty_ordered: item.qty_ordered,
                            subtotal: item.subtotal,
                            notes: item.notes || null,
                        })),
                    },
                    payment_terms: body.payment_terms ? {
                        create: body.payment_terms.map((term) => ({
                            term_seq: term.term_seq,
                            percentage: term.percentage,
                            due_days: term.due_days || null,
                            notes: term.notes || null,
                        })),
                    } : undefined,
                },
                include: {
                    items: true,
                },
            });

            return po;
        });
    }

    static async update(id: number, body: UpdatePODTO, userId: string) {
        const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });

        if (!["DRAFT", "SUBMITTED"].includes(po.status)) {
            throw new ApiError(400, `Cannot edit a PO with status ${po.status}.`);
        }

        const effectiveType = body.po_type ?? po.po_type;
        const effectiveCurrency = body.currency ?? po.currency;
        if (effectiveType === "IMPORT" && effectiveCurrency === "IDR") {
            throw new ApiError(400, "Import PO must use foreign currency.");
        }

        return await prisma.$transaction(async (tx) => {
            const data: any = {
                po_date: body.po_date || undefined,
                po_type: body.po_type || undefined,
                warehouse_id: body.warehouse_id !== undefined ? body.warehouse_id : undefined,
                currency: body.currency || undefined,
                exchange_rate: body.exchange_rate !== undefined ? body.exchange_rate : undefined,
                total_estimated: body.total_estimated !== undefined ? body.total_estimated : undefined,
                notes: body.notes !== undefined ? body.notes : undefined,
                payment_notes: body.payment_notes !== undefined ? body.payment_notes : undefined,
                updated_by: userId,
            };

            const updated = await tx.purchaseOrder.update({
                where: { id },
                data,
            });

            if (body.items !== undefined) {
                await tx.purchaseOrderItem.deleteMany({ where: { po_id: id } });
                await tx.purchaseOrderItem.createMany({
                    data: body.items.map((item) => ({
                        po_id: id,
                        raw_material_id: item.raw_material_id || null,
                        item_code: item.item_code,
                        item_name: item.item_name,
                        item_category: item.item_category || null,
                        item_type: item.item_type || "MASTER",
                        uom: item.uom,
                        moq: item.moq || null,
                        unit_price: item.unit_price,
                        qty_ordered: item.qty_ordered,
                        subtotal: item.subtotal,
                        notes: item.notes || null,
                    })),
                });
            }

            if (body.payment_terms !== undefined) {
                await tx.purchasePaymentTerm.deleteMany({ where: { po_id: id } });
                await tx.purchasePaymentTerm.createMany({
                    data: body.payment_terms.map((term) => ({
                        po_id: id,
                        term_seq: term.term_seq,
                        percentage: term.percentage,
                        due_days: term.due_days || null,
                        notes: term.notes || null,
                    })),
                });
            }

            return updated;
        });
    }

    static async updateStatus(id: number, body: UpdatePOStatusDTO, userId: string) {
        const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });
        const allowed = VALID_STATUS_TRANSITIONS[po.status] ?? [];

        if (!allowed.includes(body.status)) {
            throw new ApiError(400, 
                `Cannot transition from ${po.status} to ${body.status}. Allowed: ${allowed.join(", ") || "none"}.`,
            );
        }

        return await prisma.$transaction(async (tx) => {
            const data: any = { status: body.status, updated_by: userId };
            
            if (body.status === "APPROVED") {
                data.approved_by = userId;
                data.approved_at = new Date();
            }
            if (body.status === "ORDERED") {
                data.ordered_at = new Date();
            }
            if (body.status === "CLOSED") {
                data.closed_at = new Date();
            }
            if (body.status === "CANCELLED") {
                data.cancelled_at = new Date();
                data.cancelled_by = userId;
            }

            const updated = await tx.purchaseOrder.update({
                where: { id },
                data,
            });

            if (body.status === "ORDERED") {
                await tx.purchaseTracking.upsert({
                    where: { po_id: id },
                    create: {
                        po_id: id,
                        order_status: "ORDERED",
                        payment_status: "UNPAID",
                        updated_by: userId,
                    },
                    update: {
                        order_status: "ORDERED",
                        updated_by: userId,
                    }
                });
            }

            return updated;
        });
    }

    static async destroy(id: number) {
        const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });
        if (po.status !== "DRAFT") {
            throw new ApiError(400, "Only DRAFT POs can be deleted.");
        }
        return await prisma.purchaseOrder.delete({ where: { id } });
    }

    static async updateTracking(id: number, body: UpdatePOTrackingDTO, userId: string) {
        const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });

        if (!["ORDERED", "CLOSED"].includes(po.status)) {
            throw new ApiError(400, `Cannot update tracking for PO with status ${po.status}. PO must be ORDERED or CLOSED.`);
        }

        return await prisma.purchaseTracking.upsert({
            where: { po_id: id },
            create: {
                po_id: id,
                order_status: body.order_status || "ORDERED",
                payment_status: body.payment_status || "UNPAID",
                eta_date: body.eta_date ?? null,
                ship_date: body.ship_date ?? null,
                arrive_date: body.arrive_date ?? null,
                dp_paid_date: body.dp_paid_date ?? null,
                dp_paid_pct: body.dp_paid_pct ?? null,
                final_paid_date: body.final_paid_date ?? null,
                tracking_number: body.tracking_number ?? null,
                notes: body.notes ?? null,
                updated_by: userId,
            },
            update: {
                ...(body.order_status !== undefined && { order_status: body.order_status }),
                ...(body.payment_status !== undefined && { payment_status: body.payment_status }),
                ...(body.eta_date !== undefined && { eta_date: body.eta_date }),
                ...(body.ship_date !== undefined && { ship_date: body.ship_date }),
                ...(body.arrive_date !== undefined && { arrive_date: body.arrive_date }),
                ...(body.dp_paid_date !== undefined && { dp_paid_date: body.dp_paid_date }),
                ...(body.dp_paid_pct !== undefined && { dp_paid_pct: body.dp_paid_pct }),
                ...(body.final_paid_date !== undefined && { final_paid_date: body.final_paid_date }),
                ...(body.tracking_number !== undefined && { tracking_number: body.tracking_number }),
                ...(body.notes !== undefined && { notes: body.notes }),
                updated_by: userId,
            },
        });
    }

    static async receiveItems(id: number, body: ReceiveItemsDTO, userId: string) {
        const po = await prisma.purchaseOrder.findUniqueOrThrow({
            where: { id },
            include: { items: true },
        });

        if (po.status !== "ORDERED") {
            throw new ApiError(400, `Cannot receive items for PO with status ${po.status}. PO must be ORDERED.`);
        }

        return await prisma.$transaction(async (tx) => {
            let totalQty = 0;
            let totalAmount = 0;

            type ReceiptItemPayload = {
                poItem: (typeof po.items)[number];
                qty_received: number;
                amount: number;
                notes: string | null | undefined;
            };
            const receiptItemsData: ReceiptItemPayload[] = [];

            for (const item of body.items) {
                const poItem = po.items.find((i) => i.id === item.po_item_id);
                if (!poItem) {
                    throw new ApiError(400, `Item ID ${item.po_item_id} does not belong to PO #${id}.`);
                }

                const remaining = Number(poItem.qty_ordered) - Number(poItem.qty_received);
                if (item.qty_received > remaining + 0.001) {
                    throw new ApiError(
                        400,
                        `Item "${poItem.item_name}": qty_received (${item.qty_received}) exceeds remaining qty (${remaining.toFixed(2)}).`,
                    );
                }

                const amount = item.qty_received * Number(poItem.unit_price);
                totalQty += item.qty_received;
                totalAmount += amount;
                receiptItemsData.push({ poItem, qty_received: item.qty_received, amount, notes: item.notes });
            }

            const receiptDate = body.receipt_date || new Date();
            const receipt = await tx.purchaseReceipt.create({
                data: {
                    receipt_number: await generateReceiptNumber(tx),
                    receipt_date: receiptDate,
                    po_id: id,
                    warehouse_id: body.warehouse_id,
                    status: "POSTED",
                    total_qty: totalQty,
                    total_amount: totalAmount,
                    notes: body.notes || null,
                    posted_at: new Date(),
                    created_by: userId,
                    items: {
                        create: receiptItemsData.map(({ poItem, qty_received, amount, notes }) => ({
                            po_id: id,
                            po_item_id: poItem.id,
                            raw_material_id: poItem.raw_material_id || null,
                            item_code: poItem.item_code,
                            item_name: poItem.item_name,
                            uom: poItem.uom,
                            qty_received,
                            unit_price: poItem.unit_price,
                            amount,
                            notes: notes || null,
                        })),
                    },
                },
                include: { items: true },
            });

            for (const { poItem, qty_received } of receiptItemsData) {
                await tx.purchaseOrderItem.update({
                    where: { id: poItem.id },
                    data: { qty_received: { increment: qty_received } },
                });
            }

            const allReceived = po.items.every((i) => {
                const received = receiptItemsData.find((r) => r.poItem.id === i.id);
                const totalReceived = Number(i.qty_received) + (received?.qty_received ?? 0);
                return totalReceived >= Number(i.qty_ordered) - 0.001;
            });
            const newOrderStatus = allReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";

            await tx.purchaseTracking.upsert({
                where: { po_id: id },
                create: {
                    po_id: id,
                    order_status: newOrderStatus,
                    payment_status: "UNPAID",
                    updated_by: userId,
                },
                update: { order_status: newOrderStatus, updated_by: userId },
            });

            if (allReceived) {
                await tx.purchaseOrder.update({
                    where: { id },
                    data: { status: "CLOSED", closed_at: new Date(), updated_by: userId },
                });
            }

            const inventoryItems = receiptItemsData.filter(({ poItem }) => poItem.raw_material_id);
            const inventoryKey = (rmId: number) => ({
                raw_material_id_warehouse_id_date_month_year: {
                    raw_material_id: rmId,
                    warehouse_id: body.warehouse_id,
                    date: receiptDate.getDate(),
                    month: receiptDate.getMonth() + 1,
                    year: receiptDate.getFullYear(),
                },
            });

            const existingInventories = await Promise.all(
                inventoryItems.map(({ poItem }) =>
                    tx.rawMaterialInventory.findUnique({ where: inventoryKey(poItem.raw_material_id!) }),
                ),
            );

            await Promise.all(
                inventoryItems.map(async ({ poItem, qty_received }, i) => {
                    const qtyBefore = existingInventories[i] ? Number(existingInventories[i]!.quantity) : 0;
                    const qtyAfter = qtyBefore + qty_received;
                    await tx.rawMaterialInventory.upsert({
                        where: inventoryKey(poItem.raw_material_id!),
                        create: {
                            raw_material_id: poItem.raw_material_id!,
                            warehouse_id: body.warehouse_id,
                            quantity: qtyAfter,
                            date: receiptDate.getDate(),
                            month: receiptDate.getMonth() + 1,
                            year: receiptDate.getFullYear(),
                        },
                        update: { quantity: { increment: qty_received } },
                    });
                    await tx.stockMovement.create({
                        data: {
                            entity_type: "RAW_MATERIAL",
                            entity_id: poItem.raw_material_id!,
                            location_type: "WAREHOUSE",
                            location_id: body.warehouse_id,
                            movement_type: "IN",
                            quantity: qty_received,
                            qty_before: qtyBefore,
                            qty_after: qtyAfter,
                            reference_id: receipt.id,
                            reference_type: "GOODS_RECEIPT",
                            notes: null,
                            created_by: userId,
                        },
                    });
                }),
            );

            await tx.accountPayable.create({
                data: {
                    ap_number: await generateAPNumber(tx),
                    po_id: id,
                    receipt_id: receipt.id,
                    supplier_id: po.supplier_id ?? null,
                    supplier_name: po.supplier_name,
                    amount: totalAmount,
                    remaining_amount: totalAmount,
                    status: "UNPAID",
                    created_by: userId,
                },
            });

            return receipt;
        });
    }

    static async listReceipts(id: number) {
        await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });
        return await prisma.purchaseReceipt.findMany({
            where: {
                OR: [
                    { po_id: id },
                    { items: { some: { po_id: id } } },
                ],
            },
            orderBy: { receipt_date: "desc" },
            include: {
                items: {
                    where: { po_id: id },
                    include: { po_item: { select: { id: true, item_code: true, item_name: true, qty_ordered: true } } },
                },
                warehouse: { select: { id: true, name: true, code: true } },
            },
        });
    }

    static async listOpenPO(query: QueryOpenPODTO) {
        const { page, take, po_type, supplier_id, warehouse_id, month, year } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const filters: Prisma.Sql[] = [
            Prisma.sql`po.status NOT IN ('CANCELLED', 'CLOSED')`,
            Prisma.sql`poi.qty_received < poi.qty_ordered`,
        ];

        if (po_type) filters.push(Prisma.sql`po.po_type = ${po_type}`);
        if (supplier_id) filters.push(Prisma.sql`po.supplier_id = ${supplier_id}`);
        if (warehouse_id) filters.push(Prisma.sql`po.warehouse_id = ${warehouse_id}`);

        if (month) {
            const y = year ?? new Date().getFullYear();
            const dateFrom = new Date(y, month - 1, 1);
            const dateTo = new Date(y, month, 1);
            filters.push(Prisma.sql`po.po_date >= ${dateFrom} AND po.po_date < ${dateTo}`);
        } else if (year) {
            const dateFrom = new Date(year, 0, 1);
            const dateTo = new Date(year + 1, 0, 1);
            filters.push(Prisma.sql`po.po_date >= ${dateFrom} AND po.po_date < ${dateTo}`);
        }

        const where = Prisma.join(filters, " AND ");

        type OpenPORow = {
            id: number;
            po_id: number;
            item_code: string;
            item_name: string;
            item_category: string | null;
            item_type: string;
            uom: string;
            unit_price: number;
            qty_ordered: number;
            qty_received: number;
            open_qty: number;
            outstanding_value: number;
            po_number: string;
            po_date: Date;
            po_type: string;
            po_status: string;
            supplier_name: string;
            supplier_id: number | null;
            warehouse_id: number | null;
        };

        const [rows, countRows] = await Promise.all([
            prisma.$queryRaw<OpenPORow[]>(
                Prisma.sql`
                    SELECT
                        poi.id,
                        poi.po_id,
                        poi.item_code,
                        poi.item_name,
                        poi.item_category,
                        poi.item_type,
                        poi.uom,
                        poi.unit_price::float   AS unit_price,
                        poi.qty_ordered::float  AS qty_ordered,
                        poi.qty_received::float AS qty_received,
                        (poi.qty_ordered - poi.qty_received)::float                     AS open_qty,
                        ((poi.qty_ordered - poi.qty_received) * poi.unit_price)::float  AS outstanding_value,
                        po.po_number,
                        po.po_date,
                        po.po_type,
                        po.status               AS po_status,
                        po.supplier_name,
                        po.supplier_id,
                        po.warehouse_id
                    FROM purchase_order_items poi
                    JOIN purchase_orders po ON po.id = poi.po_id
                    WHERE ${where}
                    ORDER BY po.po_date DESC
                    LIMIT ${limit} OFFSET ${skip}
                `,
            ),
            prisma.$queryRaw<[{ count: bigint }]>(
                Prisma.sql`
                    SELECT COUNT(*) AS count
                    FROM purchase_order_items poi
                    JOIN purchase_orders po ON po.id = poi.po_id
                    WHERE ${where}
                `,
            ),
        ]);

        return { data: rows, total: Number(countRows[0].count) };
    }
}
