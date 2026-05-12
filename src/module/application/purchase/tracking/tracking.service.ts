import prisma from "../../../../config/prisma.js";
import { QueryTrackingDTO, UpdateTrackingDTO } from "./tracking.schema.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { ApiError } from "../../../../lib/errors/api.error.js";

export class TrackingService {
    static async list(query: QueryTrackingDTO) {
        const { page, take, search, order_status, payment_status, supplier_id, month, year, sortBy = "created_at", order = "desc" } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: any = {};

        if (order_status) where.tracking = { ...where.tracking, order_status };
        if (payment_status) where.tracking = { ...where.tracking, payment_status };
        if (supplier_id) where.supplier_id = supplier_id;

        if (search) {
            where.OR = [
                { po_number: { contains: search, mode: "insensitive" } },
                { supplier_name: { contains: search, mode: "insensitive" } },
            ];
        }

        if (month) {
            where.po_date = {
                gte: new Date(year ?? new Date().getFullYear(), month - 1, 1),
                lt: new Date(year ?? new Date().getFullYear(), month, 1),
            };
        } else if (year) {
            where.po_date = {
                gte: new Date(year, 0, 1),
                lt: new Date(year + 1, 0, 1),
            };
        }

        const [orders, total] = await Promise.all([
            prisma.purchaseOrder.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy]: order },
                include: {
                    tracking: true,
                    supplier: { select: { id: true, name: true, country: true } },
                },
            }),
            prisma.purchaseOrder.count({ where }),
        ]);

        const data = orders.map(order => {
            if (order.tracking) {
                return {
                    ...order.tracking,
                    po: order
                };
            }
            return {
                id: 0, // Virtual ID since no tracking record exists yet
                po_id: order.id,
                order_status: "ORDERED",
                payment_status: "UNPAID",
                eta_date: null,
                ship_date: null,
                arrive_date: null,
                dp_paid_date: null,
                dp_paid_pct: null,
                final_paid_date: null,
                tracking_number: null,
                notes: null,
                updated_by: null,
                created_at: order.created_at,
                updated_at: order.updated_at,
                po: order
            };
        });

        return { data, total };
    }

    static async detail(poId: number) {
        const tracking = await prisma.purchaseTracking.findUnique({
            where: { po_id: poId },
            include: {
                po: {
                    include: {
                        supplier: { select: { id: true, name: true } },
                        warehouse: { select: { id: true, name: true, code: true } },
                        items: {
                            select: {
                                id: true,
                                item_code: true,
                                item_name: true,
                                qty_ordered: true,
                                qty_received: true,
                                unit_price: true,
                                uom: true,
                            },
                        },
                        payment_terms: true,
                    },
                },
            },
        });

        if (!tracking) throw new ApiError(404, `No tracking record found for PO ID ${poId}.`);
        return tracking;
    }

    static async update(poId: number, body: UpdateTrackingDTO, userId: string) {
        const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });

        if (!["ORDERED", "CLOSED"].includes(po.status)) {
            throw new ApiError(400, `Cannot update tracking for PO with status ${po.status}. Must be ORDERED or CLOSED.`);
        }

        return await prisma.purchaseTracking.upsert({
            where: { po_id: poId },
            create: {
                po_id: poId,
                order_status: body.order_status ?? "ORDERED",
                payment_status: body.payment_status ?? "UNPAID",
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
}
