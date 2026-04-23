import prisma from "../../../../config/prisma.js";
import { CreateRFQDTO, UpdateRFQDTO, UpdateRFQStatusDTO, QueryRFQDTO, ConvertToPODTO } from "./rfq.schema.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
    DRAFT: ["SENT", "CANCELLED"],
    SENT: ["RECEIVED", "CANCELLED"],
    RECEIVED: ["APPROVED", "CANCELLED"],
    APPROVED: ["PARTIAL_CONVERTED", "CONVERTED", "CANCELLED"],
    PARTIAL_CONVERTED: ["CONVERTED", "CANCELLED"],
    CONVERTED: [],
    CANCELLED: [],
};

export function generateRFQNumber(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const rand = Math.floor(Math.random() * 9000) + 1000;
    return `RFQ-${y}${m}${d}-${rand}`;
}

export class RFQService {
    static async list(query: QueryRFQDTO) {
        const { page, take, search, status, vendor_id, month, year, sortBy = "created_at", order = "desc" } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: any = {};

        if (search) {
            where.OR = [
                { rfq_number: { contains: search, mode: "insensitive" } },
                { vendor: { name: { contains: search, mode: "insensitive" } } },
                { notes: { contains: search, mode: "insensitive" } },
            ];
        }
        if (status) where.status = status;
        if (vendor_id) where.vendor_id = vendor_id;
        if (month) where.date = { ...where.date, gte: new Date(year ?? new Date().getFullYear(), month - 1, 1), lt: new Date(year ?? new Date().getFullYear(), month, 1) };
        else if (year) where.date = { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) };

        const [data, total] = await Promise.all([
            prisma.requestForQuotation.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy]: order },
                include: {
                    vendor: { select: { id: true, name: true, country: true } },
                    warehouse: { select: { id: true, name: true, code: true } },
                    items: {
                        include: {
                            raw_material: {
                                select: {
                                    id: true, barcode: true, name: true,
                                    unit_raw_material: { select: { name: true } },
                                },
                            },
                        },
                    },
                    _count: { select: { items: true, open_pos: true } },
                },
            }),
            prisma.requestForQuotation.count({ where }),
        ]);

        return { data, total };
    }

    static async detail(id: number) {
        const rfq = await prisma.requestForQuotation.findUniqueOrThrow({
            where: { id },
            include: {
                vendor: true,
                warehouse: { select: { id: true, name: true, code: true } },
                items: {
                    include: {
                        raw_material: {
                            select: {
                                id: true, barcode: true, name: true, price: true,
                                unit_raw_material: { select: { name: true } },
                            },
                        },
                        purchase_draft: {
                            select: { id: true, quantity: true, horizon: true, month: true, year: true },
                        },
                    },
                },
                open_pos: {
                    select: { id: true, po_number: true, quantity: true, status: true, order_date: true },
                },
            },
        });
        return rfq;
    }

    static async create(body: CreateRFQDTO) {
        const rfq_number = generateRFQNumber();

        // Ensure purchase_draft_ids are not already linked to another RFQ item
        const draftIds = body.items
            .map((i) => i.purchase_draft_id)
            .filter(Boolean) as number[];

        if (draftIds.length > 0) {
            const existing = await prisma.rFQItem.findFirst({
                where: { purchase_draft_id: { in: draftIds } },
            });
            if (existing) {
                throw new Error(`Purchase draft ${existing.purchase_draft_id} is already linked to an RFQ item.`);
            }
        }

        return await prisma.requestForQuotation.create({
            data: {
                rfq_number,
                vendor_id: body.vendor_id ?? null,
                warehouse_id: body.warehouse_id ?? null,
                date: body.date ?? new Date(),
                notes: body.notes ?? null,
                items: {
                    create: body.items.map((item) => ({
                        raw_material_id: item.raw_material_id,
                        purchase_draft_id: item.purchase_draft_id ?? null,
                        quantity: item.quantity,
                        unit_price: item.unit_price ?? null,
                        notes: item.notes ?? null,
                    })),
                },
            },
            include: {
                items: true,
                vendor: { select: { id: true, name: true } },
            },
        });
    }

    static async update(id: number, body: UpdateRFQDTO) {
        const rfq = await prisma.requestForQuotation.findUniqueOrThrow({ where: { id } });

        if (rfq.status === "CONVERTED" || rfq.status === "CANCELLED") {
            throw new Error(`Cannot edit an RFQ with status ${rfq.status}.`);
        }

        return await prisma.$transaction(async (tx) => {
            // Update header
            const updated = await tx.requestForQuotation.update({
                where: { id },
                data: {
                    vendor_id: body.vendor_id !== undefined ? body.vendor_id : undefined,
                    warehouse_id: body.warehouse_id !== undefined ? body.warehouse_id : undefined,
                    date: body.date ?? undefined,
                    notes: body.notes !== undefined ? body.notes : undefined,
                },
            });

            // Replace items if provided
            if (body.items !== undefined) {
                await tx.rFQItem.deleteMany({ where: { rfq_id: id } });
                await tx.rFQItem.createMany({
                    data: body.items.map((item) => ({
                        rfq_id: id,
                        raw_material_id: item.raw_material_id,
                        purchase_draft_id: item.purchase_draft_id ?? null,
                        quantity: item.quantity,
                        unit_price: item.unit_price ?? null,
                        notes: item.notes ?? null,
                    })),
                });
            }

            return updated;
        });
    }

    static async updateStatus(id: number, body: UpdateRFQStatusDTO) {
        const rfq = await prisma.requestForQuotation.findUniqueOrThrow({ where: { id } });
        const allowed = VALID_STATUS_TRANSITIONS[rfq.status] ?? [];

        if (!allowed.includes(body.status)) {
            throw new Error(
                `Cannot transition from ${rfq.status} to ${body.status}. Allowed: ${allowed.join(", ") || "none"}.`,
            );
        }

        return await prisma.requestForQuotation.update({
            where: { id },
            data: { status: body.status as any },
        });
    }

    static async convertToPO(id: number, body: ConvertToPODTO) {
        const rfq = await prisma.requestForQuotation.findUniqueOrThrow({
            where: { id },
            include: { items: { include: { raw_material: true } } },
        });

        if (rfq.status !== "APPROVED" && rfq.status !== "PARTIAL_CONVERTED") {
            throw new Error(`RFQ must be APPROVED or PARTIAL_CONVERTED to convert. Current: ${rfq.status}.`);
        }

        const selectedItems = rfq.items.filter((item) => body.item_ids.includes(item.id));
        if (selectedItems.length === 0) throw new Error("No valid items found for conversion.");

        return await prisma.$transaction(async (tx) => {
            const createdPos = await Promise.all(
                selectedItems.map((item) =>
                    tx.rawMaterialOpenPo.create({
                        data: {
                            raw_material_id: item.raw_material_id,
                            quantity: item.quantity,
                            status: "OPEN",
                            order_date: new Date(),
                            expected_arrival: body.expected_arrival ?? null,
                            rfq_id: id,
                        },
                    }),
                ),
            );

            // Determine new RFQ status
            const allConverted = rfq.items.length === selectedItems.length;
            const newStatus = allConverted ? "CONVERTED" : "PARTIAL_CONVERTED";

            await tx.requestForQuotation.update({
                where: { id },
                data: { status: newStatus as any },
            });

            return { created_pos: createdPos, rfq_status: newStatus };
        });
    }

    static async destroy(id: number) {
        const rfq = await prisma.requestForQuotation.findUniqueOrThrow({ where: { id } });
        if (rfq.status !== "DRAFT") {
            throw new Error("Only DRAFT RFQs can be deleted.");
        }
        return await prisma.requestForQuotation.delete({ where: { id } });
    }
}
