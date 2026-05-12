import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { CreatePODTO, UpdatePODTO, UpdatePOStatusDTO, QueryPODTO, UpdatePOTrackingDTO, QueryOpenPODTO } from "./po.schema.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { generatePONumber, generateAPNumber } from "../../../../lib/utils/generate-number.js";

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
        const po = await prisma.purchaseOrder.findUniqueOrThrow({
            where: { id },
            include: { payment_terms: true },
        });
        const allowed = VALID_STATUS_TRANSITIONS[po.status] ?? [];

        if (!allowed.includes(body.status)) {
            throw new ApiError(400,
                `Cannot transition from ${po.status} to ${body.status}. Allowed: ${allowed.join(", ") || "none"}.`,
            );
        }

        return await prisma.$transaction(async (tx) => {
            const orderedAt = new Date();
            const data: any = { status: body.status, updated_by: userId };

            if (body.status === "APPROVED") {
                data.approved_by = userId;
                data.approved_at = new Date();
            }
            if (body.status === "ORDERED") {
                data.ordered_at = orderedAt;
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

                // Auto-create DP AP per payment term
                if (po.payment_terms.length > 0) {
                    for (const term of po.payment_terms) {
                        const amount = (Number(po.total_estimated) * Number(term.percentage)) / 100;
                        const dueDate = term.due_days != null
                            ? new Date(orderedAt.getTime() + term.due_days * 86_400_000)
                            : null;

                        await tx.accountPayable.create({
                            data: {
                                ap_number: await generateAPNumber(tx),
                                po_id: id,
                                payment_term_id: term.id,
                                ap_type: "DP",
                                supplier_id: po.supplier_id ?? null,
                                supplier_name: po.supplier_name,
                                amount,
                                remaining_amount: amount,
                                due_date: dueDate,
                                notes: term.notes ?? null,
                                status: "UNPAID",
                                created_by: userId,
                            },
                        });
                    }
                } else {
                    // No payment terms: create single full-amount AP so P2P flow is not broken
                    await tx.accountPayable.create({
                        data: {
                            ap_number: await generateAPNumber(tx),
                            po_id: id,
                            payment_term_id: null,
                            ap_type: "DP",
                            supplier_id: po.supplier_id ?? null,
                            supplier_name: po.supplier_name,
                            amount: Number(po.total_estimated),
                            remaining_amount: Number(po.total_estimated),
                            due_date: null,
                            status: "UNPAID",
                            created_by: userId,
                        },
                    });
                }
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
        const { page, take, search, po_type, supplier_id, warehouse_id, month, year } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const filters: Prisma.Sql[] = [
            Prisma.sql`po.status = 'ORDERED'`,
            Prisma.sql`poi.qty_received < poi.qty_ordered`,
        ];

        if (search) {
            const like = `%${search}%`;
            filters.push(Prisma.sql`(
                po.po_number ILIKE ${like}
                OR po.supplier_name ILIKE ${like}
                OR poi.item_code ILIKE ${like}
                OR poi.item_name ILIKE ${like}
            )`);
        }
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
            created_by: string;
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
                        poi.unit_price::float                                                            AS unit_price,
                        poi.qty_ordered::float                                                           AS qty_ordered,
                        poi.qty_received::float                                                          AS qty_received,
                        (poi.qty_ordered - poi.qty_received)::float                                      AS open_qty,
                        ((poi.qty_ordered - poi.qty_received) * poi.unit_price * COALESCE(po.exchange_rate, 1))::float AS outstanding_value,
                        po.po_number,
                        po.po_date,
                        po.po_type,
                        po.status      AS po_status,
                        po.supplier_name,
                        po.supplier_id,
                        po.warehouse_id,
                        po.created_by
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
