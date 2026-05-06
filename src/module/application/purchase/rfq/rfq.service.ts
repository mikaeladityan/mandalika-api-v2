import prisma from "../../../../config/prisma.js";
import { CreateRFQDTO, UpdateRFQDTO, UpdateRFQStatusDTO, QueryRFQDTO, ConvertToPODTO } from "./rfq.schema.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { ApiError } from "../../../../lib/errors/api.error.js";

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
    DRAFT: ["SUBMITTED", "CLOSED"],
    SUBMITTED: ["REVIEWED", "CLOSED"],
    REVIEWED: ["APPROVED", "CLOSED"],
    APPROVED: ["CONVERTED", "CLOSED"],
    CONVERTED: [],
    CLOSED: [],
};

export function generateRFQNumber(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const rand = Math.floor(Math.random() * 9000) + 1000;
    return `RFQ-${y}${m}${d}-${rand}`;
}

export function generatePONumber(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const rand = Math.floor(Math.random() * 9000) + 1000;
    return `PO-${y}${m}${d}-${rand}`;
}

export class RFQService {
    static async list(query: QueryRFQDTO) {
        const { page, take, search, status, supplier_id, month, year, sortBy = "rfq_date", order = "desc" } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: any = {};

        if (search) {
            where.OR = [
                { rfq_number: { contains: search, mode: "insensitive" } },
                { supplier_name: { contains: search, mode: "insensitive" } },
                { notes: { contains: search, mode: "insensitive" } },
            ];
        }
        if (status) where.status = status;
        if (supplier_id) where.supplier_id = supplier_id;
        
        if (month) {
            where.rfq_date = { 
                gte: new Date(year ?? new Date().getFullYear(), month - 1, 1), 
                lt: new Date(year ?? new Date().getFullYear(), month, 1) 
            };
        } else if (year) {
            where.rfq_date = { 
                gte: new Date(year, 0, 1), 
                lt: new Date(year + 1, 0, 1) 
            };
        }

        const [data, total] = await Promise.all([
            prisma.purchaseRFQ.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy]: order },
                include: {
                    supplier: { select: { id: true, name: true, country: true } },
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
                    _count: { select: { items: true, purchase_orders: true } },
                },
            }),
            prisma.purchaseRFQ.count({ where }),
        ]);

        return { data, total };
    }

    static async detail(id: number) {
        return await prisma.purchaseRFQ.findUniqueOrThrow({
            where: { id },
            include: {
                supplier: true,
                items: {
                    include: {
                        raw_material: {
                            include: {
                                unit_raw_material: { select: { name: true } },
                            },
                        },
                        purchase_draft: {
                            select: { id: true, quantity: true, horizon: true, month: true, year: true },
                        },
                    },
                },
                purchase_orders: {
                    select: { id: true, po_number: true, status: true, po_date: true },
                },
            },
        });
    }

    static async create(body: CreateRFQDTO, userId: string) {
        // Validation: Ensure purchase_draft_ids are not already linked
        const draftIds = body.items
            .map((i) => i.purchase_draft_id)
            .filter(Boolean) as number[];

        if (draftIds.length > 0) {
            const existing = await prisma.purchaseRFQItem.findFirst({
                where: { purchase_draft_id: { in: draftIds } },
            });
            if (existing) {
                throw new ApiError(400, `Purchase draft ${existing.purchase_draft_id} is already linked to another RFQ item.`);
            }
        }

        // Resolve supplier_name from master data when using an existing supplier
        if (body.supplier_id && !body.is_new_supplier) {
            const supplier = await prisma.supplier.findUnique({
                where: { id: body.supplier_id },
                select: { name: true },
            });
            if (supplier) body.supplier_name = supplier.name;
        }

        return await prisma.$transaction(async (tx) => {

            let supplierId = body.supplier_id;

            if (body.is_new_supplier) {
                const newSupplier = await tx.supplier.create({
                    data: {
                        name: body.supplier_name,
                        addresses: body.addresses || "-",
                        country: body.country || "-",
                        source: body.supplier_source || "LOCAL",
                    },
                });
                supplierId = newSupplier.id;
            }

            const rfq = await tx.purchaseRFQ.create({
                data: {
                    rfq_number: body.rfq_number || generateRFQNumber(),
                    rfq_date: body.rfq_date || new Date(),
                    supplier_id: supplierId || null,
                    supplier_name: body.supplier_name,
                    supplier_code: body.supplier_code || null,
                    is_new_supplier: body.is_new_supplier || false,
                    supplier_category: body.supplier_category || null,
                    location_code: body.location_code || null,
                    notes: body.notes || null,
                    source_draft_ids: body.source_draft_ids ? (body.source_draft_ids as any) : null,
                    created_by: userId,
                    items: {
                        create: body.items.map((item) => ({
                            raw_material_id: item.raw_material_id || null,
                            purchase_draft_id: item.purchase_draft_id || null,
                            item_code: item.item_code,
                            item_name: item.item_name,
                            item_category: item.item_category || null,
                            uom: item.uom,
                            qty_requested: item.qty_requested,
                            unit_price: item.unit_price ?? 0,
                            moq: item.moq ?? null,
                            lead_time: item.lead_time ?? null,
                            notes: item.notes || null,
                        })),
                    },
                },
                include: {
                    items: true,
                },
            });

            // Link materials to the supplier (new or existing) to update sourcing catalog
            if (supplierId) {
                const masterItems = body.items.filter((i) => i.raw_material_id);
                if (masterItems.length > 0) {
                    // De-duplicate items to prevent multiple upserts for the same RM in one transaction
                    const uniqueMap = new Map();
                    for (const item of masterItems) {
                        uniqueMap.set(item.raw_material_id, item);
                    }
                    const uniqueItems = Array.from(uniqueMap.values());

                    for (const item of uniqueItems) {
                        const existingSM = await tx.supplierMaterial.findUnique({
                            where: {
                                supplier_id_raw_material_id: {
                                    supplier_id: supplierId,
                                    raw_material_id: item.raw_material_id!,
                                },
                            },
                        });

                        if (existingSM) {
                            await tx.supplierMaterial.update({
                                where: { id: existingSM.id },
                                data: {
                                    unit_price: item.unit_price !== undefined ? item.unit_price : undefined,
                                    min_buy: item.moq !== undefined ? item.moq : undefined,
                                    lead_time: item.lead_time !== undefined ? item.lead_time : undefined,
                                },
                            });
                        } else {
                            await tx.supplierMaterial.create({
                                data: {
                                    supplier_id: supplierId,
                                    raw_material_id: item.raw_material_id!,
                                    unit_price: item.unit_price || 0,
                                    min_buy: item.moq || null,
                                    lead_time: item.lead_time || null,
                                    is_preferred: false,
                                },
                            });
                        }
                    }
                }
            }

            return rfq;
        });
    }

    static async update(id: number, body: UpdateRFQDTO, userId: string) {
        const rfq = await prisma.purchaseRFQ.findUniqueOrThrow({ where: { id } });

        if (rfq.status === "CONVERTED" || rfq.status === "CLOSED") {
            throw new ApiError(400, `Cannot edit an RFQ with status ${rfq.status}.`);
        }

        // Resolve supplier_name from master data when using an existing supplier
        if (body.supplier_id && !body.supplier_name) {
            const supplier = await prisma.supplier.findUnique({
                where: { id: body.supplier_id },
                select: { name: true },
            });
            if (supplier) body.supplier_name = supplier.name;
        }

        return await prisma.$transaction(async (tx) => {
            
            // Update header
            const updated = await tx.purchaseRFQ.update({
                where: { id },
                data: {
                    rfq_date: body.rfq_date || undefined,
                    supplier_id: body.supplier_id !== undefined ? body.supplier_id : undefined,
                    supplier_name: body.supplier_name || undefined,
                    supplier_code: body.supplier_code !== undefined ? body.supplier_code : undefined,
                    supplier_category: body.supplier_category !== undefined ? body.supplier_category : undefined,
                    location_code: body.location_code !== undefined ? body.location_code : undefined,
                    notes: body.notes !== undefined ? body.notes : undefined,
                    updated_by: userId,
                },
            });

            // Replace items if provided
            if (body.items !== undefined) {
                await tx.purchaseRFQItem.deleteMany({ where: { rfq_id: id } });
                await tx.purchaseRFQItem.createMany({
                    data: body.items.map((item) => ({
                        rfq_id: id,
                        raw_material_id: item.raw_material_id || null,
                        purchase_draft_id: item.purchase_draft_id || null,
                        item_code: item.item_code,
                        item_name: item.item_name,
                        item_category: item.item_category || null,
                        uom: item.uom,
                        qty_requested: item.qty_requested,
                        unit_price: item.unit_price ?? 0,
                        moq: item.moq ?? null,
                        lead_time: item.lead_time ?? null,
                        notes: item.notes || null,
                    })),
                });

                // Update supplier material catalog if supplier is known
                const currentSupplierId = updated.supplier_id;
                if (currentSupplierId) {
                    const masterItems = body.items.filter((i) => i.raw_material_id);
                    // De-duplicate items
                    const uniqueMap = new Map();
                    for (const item of masterItems) {
                        uniqueMap.set(item.raw_material_id, item);
                    }
                    const uniqueItems = Array.from(uniqueMap.values());

                    for (const item of uniqueItems) {
                        const existingSM = await tx.supplierMaterial.findUnique({
                            where: {
                                supplier_id_raw_material_id: {
                                    supplier_id: currentSupplierId,
                                    raw_material_id: item.raw_material_id!,
                                },
                            },
                        });

                        if (existingSM) {
                            await tx.supplierMaterial.update({
                                where: { id: existingSM.id },
                                data: {
                                    unit_price: item.unit_price !== undefined ? item.unit_price : undefined,
                                    min_buy: item.moq !== undefined ? item.moq : undefined,
                                    lead_time: item.lead_time !== undefined ? item.lead_time : undefined,
                                },
                            });
                        } else {
                            await tx.supplierMaterial.create({
                                data: {
                                    supplier_id: currentSupplierId,
                                    raw_material_id: item.raw_material_id!,
                                    unit_price: item.unit_price || 0,
                                    min_buy: item.moq || null,
                                    lead_time: item.lead_time || null,
                                    is_preferred: false,
                                },
                            });
                        }
                    }
                }
            }

            return updated;
        });
    }

    static async updateStatus(id: number, body: UpdateRFQStatusDTO, userId: string) {
        const rfq = await prisma.purchaseRFQ.findUniqueOrThrow({ where: { id } });
        const allowed = VALID_STATUS_TRANSITIONS[rfq.status] ?? [];

        if (!allowed.includes(body.status)) {
            throw new ApiError(400, 
                `Cannot transition from ${rfq.status} to ${body.status}. Allowed: ${allowed.join(", ") || "none"}.`,
            );
        }

        const data: any = { status: body.status, updated_by: userId };
        
        if (body.status === "APPROVED") {
            data.approved_by = userId;
            data.approved_at = new Date();
        }

        return await prisma.purchaseRFQ.update({
            where: { id },
            data,
        });
    }

    static async destroy(id: number) {
        const rfq = await prisma.purchaseRFQ.findUniqueOrThrow({ where: { id } });
        if (rfq.status !== "DRAFT") {
            throw new ApiError(400, "Only DRAFT RFQs can be deleted.");
        }
        return await prisma.purchaseRFQ.delete({ where: { id } });
    }

    static async convertToPO(id: number, body: ConvertToPODTO, userId: string) {
        const rfq = await prisma.purchaseRFQ.findUniqueOrThrow({
            where: { id },
            include: { items: true },
        });

        if (rfq.status !== "APPROVED") {
            throw new ApiError(400, "Only APPROVED RFQs can be converted to PO.");
        }

        if (rfq.converted_at) {
            throw new ApiError(400, "This RFQ has already been converted.");
        }

        const selectedItems = rfq.items.filter(item => body.item_ids.includes(item.id));
        if (selectedItems.length === 0) {
            throw new ApiError(400, "At least one item must be selected for PO conversion.");
        }

        return await prisma.$transaction(async (tx) => {
            const poItems = selectedItems.map(item => ({
                raw_material_id: item.raw_material_id,
                item_code: item.item_code,
                item_name: item.item_name,
                item_category: item.item_category,
                item_type: item.raw_material_id ? ("MASTER" as const) : ("MANUAL" as const),
                uom: item.uom,
                moq: item.moq,
                qty_ordered: item.qty_requested,
                unit_price: Number(item.unit_price),
                subtotal: Number(item.qty_requested) * Number(item.unit_price),
            }));

            const totalEstimated = poItems.reduce((sum, item) => sum + item.subtotal, 0);

            const po = await tx.purchaseOrder.create({
                data: {
                    po_number: generatePONumber(),
                    po_date: new Date(),
                    po_type: "LOCAL",
                    supplier_id: rfq.supplier_id,
                    supplier_name: rfq.supplier_name,
                    supplier_code: rfq.supplier_code,
                    is_new_supplier: rfq.is_new_supplier,
                    source_rfq_id: rfq.id,
                    currency: "IDR",
                    exchange_rate: 1,
                    total_estimated: totalEstimated,
                    status: "DRAFT",
                    created_by: userId,
                    items: {
                        create: poItems,
                    },
                },
                include: { items: true },
            });

            await tx.purchaseRFQ.update({
                where: { id },
                data: {
                    status: "CONVERTED",
                    converted_at: new Date(),
                    updated_by: userId,
                },
            });

            return po;
        });
    }
}
