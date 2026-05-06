import prisma from "../../../../config/prisma.js";
import { CreatePODTO, UpdatePODTO, UpdatePOStatusDTO, QueryPODTO, UpdatePOTrackingDTO, ReceiveItemsDTO } from "./po.schema.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { generatePONumber } from "../rfq/rfq.service.js";

function generateReceiptNumber(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const rand = Math.floor(Math.random() * 9000) + 1000;
    return `RCV-${y}${m}${d}-${rand}`;
}

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
    DRAFT: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["APPROVED", "CANCELLED"],
    APPROVED: ["ORDERED", "CANCELLED"],
    ORDERED: ["CLOSED", "CANCELLED"],
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
            // Default values if not provided (especially for tests)
            const currency = body.currency || "IDR";
            const exchangeRate = body.exchange_rate || 1;

            // Validation Logic for PO Type & Exchange Rate
            if (body.po_type === "IMPORT" && currency === "IDR") {
                throw new ApiError(400, "Import PO must use foreign currency.");
            }
            if (currency !== "IDR" && (!exchangeRate || exchangeRate <= 0)) {
                throw new ApiError(400, "Exchange rate is required for foreign currency.");
            }

            // Fetch supplier details
            const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: body.supplier_id } });

            const po = await tx.purchaseOrder.create({
                data: {
                    po_number: body.po_number || generatePONumber(),
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

            // Update header
            const updated = await tx.purchaseOrder.update({
                where: { id },
                data,
            });

            // Replace items if provided
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

            // Replace payment terms if provided
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

            // Auto-create PurchaseTracking when ORDERED
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

            const receipt = await tx.purchaseReceipt.create({
                data: {
                    receipt_number: generateReceiptNumber(),
                    receipt_date: body.receipt_date || new Date(),
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

            const updatedItems = await tx.purchaseOrderItem.findMany({ where: { po_id: id } });
            const allReceived = updatedItems.every(
                (i) => Number(i.qty_received) >= Number(i.qty_ordered) - 0.001,
            );
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

            return receipt;
        });
    }

    static async listReceipts(id: number) {
        await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });
        return await prisma.purchaseReceipt.findMany({
            where: { po_id: id },
            orderBy: { receipt_date: "desc" },
            include: {
                items: true,
                warehouse: { select: { id: true, name: true, code: true } },
            },
        });
    }
}
