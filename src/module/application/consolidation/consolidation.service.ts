import { Prisma } from "../../../generated/prisma/client.js";
import prisma from "../../../config/prisma.js";
import { GetPagination } from "../../../lib/utils/pagination.js";
import { QueryConsolidationDTO } from "./consolidation.schema.js";
import { ApiError } from "../../../lib/errors/api.error.js";
import { RecomendationV2Service } from "../recomendation-v2/recomendation-v2.service.js";

const USD_RATE = 17000;

type ConsolidationRow = {
    recommendation_id: number;
    material_id: number | null;
    barcode: string | null;
    material_name: string;
    supplier_name: string;
    quantity: number;
    uom: string;
    price: number;
    moq: number | null;
    pic_id: string | null;
    status: string;
    created_at: Date | string | null;
};

type ExportColumn = {
    header: string;
    uiId: string;
    value: (row: ConsolidationRow, index: number) => string | number;
};

const escapeCsv = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const s = typeof val === "number" ? String(val) : String(val);
    if (/[",\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
};

export class ConsolidationService {
    static async list(query: QueryConsolidationDTO) {
        const { search, page, take, month, year } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const now = new Date();
        const currentMonth = month ?? now.getMonth() + 1;
        const currentYear = year ?? now.getFullYear();

        const type_condition = ConsolidationService.buildTypeCondition(query.type);

        const query_condition: any = {
            status: { in: ["DRAFT", "ACC"] },
            month: currentMonth,
            year: currentYear,
            quantity: {
                gt: 0,
            },
        };

        if (query.supplier_id || query.type || search) {
            query_condition.raw_material = {
                ...(query.supplier_id && {
                    supplier_materials: { some: { supplier_id: query.supplier_id } },
                }),
                ...(query.type && type_condition),
                ...(search && {
                    name: {
                        contains: search,
                        mode: "insensitive",
                    },
                }),
            };
        }

        const total = await prisma.materialPurchaseDraft.count({
            where: query_condition,
        });

        const dir: "asc" | "desc" = query.order === "asc" ? "asc" : "desc";
        const sortInMemoryBySupplier = query.sortBy === "supplier_name";

        let orderByClause: any = { updated_at: "desc" };

        if (query.sortBy && !sortInMemoryBySupplier) {
            switch (query.sortBy) {
                case "material_name":
                    orderByClause = { raw_material: { name: dir } };
                    break;
                case "barcode":
                    orderByClause = { raw_material: { barcode: dir } };
                    break;
                case "quantity":
                    orderByClause = { quantity: dir };
                    break;
                case "created_at":
                    orderByClause = { created_at: dir };
                    break;
                default:
                    break;
            }
        }

        const includeRelations = {
            raw_material: {
                include: {
                    supplier_materials: {
                        where: { is_preferred: true },
                        include: { supplier: true },
                        take: 1,
                    },
                    unit_raw_material: true,
                },
            },
        } as const;

        const data = await prisma.materialPurchaseDraft.findMany({
            where: query_condition,
            include: includeRelations,
            // Prisma tidak mendukung orderBy lewat to-many relation (supplier_materials -> supplier.name),
            // jadi untuk sortBy=supplier_name kita ambil semua row dulu, sort di memory, baru paginate.
            orderBy: sortInMemoryBySupplier ? { updated_at: "desc" } : orderByClause,
            ...(sortInMemoryBySupplier ? {} : { skip, take: limit }),
        });

        const parsedAll = data.map((item) => {
            const preferredSM = item.raw_material?.supplier_materials?.[0];
            return {
                recommendation_id: item.id,
                material_id: item.raw_mat_id,
                barcode: item.raw_material?.barcode || null,
                material_name: item.raw_material?.name || "Unknown",
                supplier_name: preferredSM?.supplier?.name || "-",
                quantity: Number(item.quantity) || 0,
                uom: item.raw_material?.unit_raw_material?.name || "UNIT",
                price: Number(preferredSM?.unit_price) || 0,
                moq: preferredSM?.min_buy ? Number(preferredSM.min_buy) : null,
                pic_id: item.pic_id,
                status: item.status,
                created_at: item.created_at,
            };
        });

        if (sortInMemoryBySupplier) {
            const collator = new Intl.Collator("id", { sensitivity: "base", numeric: true });
            parsedAll.sort((a, b) => {
                const cmp = collator.compare(a.supplier_name || "", b.supplier_name || "");
                return dir === "asc" ? cmp : -cmp;
            });
            return { data: parsedAll.slice(skip, skip + limit), len: total };
        }

        return { data: parsedAll, len: total };
    }

    static async summaryBySupplier(query: QueryConsolidationDTO) {
        const { search, month, year } = query;

        const now = new Date();
        const currentMonth = month ?? now.getMonth() + 1;
        const currentYear = year ?? now.getFullYear();

        const type_condition = ConsolidationService.buildTypeCondition(query.type);

        const query_condition: any = {
            status: { in: ["DRAFT", "ACC"] },
            month: currentMonth,
            year: currentYear,
            quantity: {
                gt: 0,
            },
        };

        if (query.supplier_id || query.type || search) {
            query_condition.raw_material = {
                ...(query.supplier_id && {
                    supplier_materials: { some: { supplier_id: query.supplier_id } },
                }),
                ...(query.type && type_condition),
                ...(search && {
                    name: {
                        contains: search,
                        mode: "insensitive",
                    },
                }),
            };
        }

        const data = await prisma.materialPurchaseDraft.findMany({
            where: query_condition,
            include: {
                raw_material: {
                    include: {
                        supplier_materials: {
                            where: { is_preferred: true },
                            include: { supplier: true },
                            take: 1,
                        },
                        unit_raw_material: true,
                    },
                },
            },
            orderBy: { raw_material: { name: "asc" } },
        });

        const grouping: Record<string, any> = {};

        data.forEach((item) => {
            const preferredSM = item.raw_material?.supplier_materials?.[0];
            const supplierId = preferredSM?.supplier?.id || "N/A";
            const supplierName = preferredSM?.supplier?.name || "No Supplier";
            const supplierAddress = preferredSM?.supplier?.addresses || "";
            const supplierPhone = preferredSM?.supplier?.phone || "";
            const supplierCountry = preferredSM?.supplier?.country || "";
            const source = preferredSM?.supplier?.source || "LOCAL";

            if (!grouping[supplierId]) {
                grouping[supplierId] = {
                    supplier_id: supplierId,
                    supplier_name: supplierName,
                    supplier_address: supplierAddress,
                    supplier_phone: supplierPhone,
                    supplier_country: supplierCountry,
                    source: source,
                    total_amount: 0,
                    total_items: 0,
                    items: [],
                };
            }

            const itemPrice = Number(preferredSM?.unit_price) || 0;
            const itemQty = Number(item.quantity) || 0;
            const subtotal = itemPrice * itemQty;

            grouping[supplierId].total_amount += subtotal;
            grouping[supplierId].total_items += 1;
            grouping[supplierId].items.push({
                material_name: item.raw_material?.name,
                barcode: item.raw_material?.barcode,
                quantity: itemQty,
                price: itemPrice,
                subtotal: subtotal,
                uom: item.raw_material?.unit_raw_material?.name,
                status: item.status,
            });
        });

        return Object.values(grouping);
    }

    static async export(query: QueryConsolidationDTO): Promise<Buffer> {
        const { data } = await this.list({ ...query, take: 1000000, page: 1 });

        let draftItems: ConsolidationRow[] = data.filter((item) => ["DRAFT", "ACC"].includes(item.status));

        if (query.selectedIds) {
            const ids = query.selectedIds.split(",").map(Number).filter(Boolean);
            if (ids.length > 0) {
                draftItems = draftItems.filter((item) => ids.includes(item.recommendation_id));
            }
        }

        const isImpor = query.type === "impor";

        const visibleCols = query.visibleColumns ? new Set(query.visibleColumns.split(",")) : null;
        const isVisible = (uiId: string) => !visibleCols || visibleCols.has(uiId);

        const allColumns: ExportColumn[] = [
            { header: "No", uiId: "no", value: (_r, i) => i + 1 },
            { header: "Barcode", uiId: "material_name", value: (r) => r.barcode ?? "-" },
            { header: "Nama Material", uiId: "material_name", value: (r) => r.material_name },
            { header: "Supplier", uiId: "supplier_name", value: (r) => r.supplier_name },
            { header: "Quantity", uiId: "quantity", value: (r) => r.quantity },
            { header: "MOQ", uiId: "moq", value: (r) => r.moq ?? 0 },
            { header: "UOM", uiId: "uom", value: (r) => r.uom?.toUpperCase() ?? "" },
            { header: isImpor ? "Harga Satuan (IDR)" : "Harga Satuan", uiId: "price", value: (r) => r.price },
            ...(isImpor ? [{ header: "Harga Satuan (USD)", uiId: "price", value: (r: ConsolidationRow) => (r.price || 0) / USD_RATE }] : []),
            { header: isImpor ? "Total Harga (IDR)" : "Total Harga", uiId: "subtotal", value: (r) => (r.price || 0) * (r.quantity || 0) },
            ...(isImpor ? [{ header: "Total Harga (USD)", uiId: "subtotal", value: (r: ConsolidationRow) => ((r.price || 0) * (r.quantity || 0)) / USD_RATE }] : []),
            { header: "Status", uiId: "status", value: (r) => r.status },
            { header: "Tanggal Pengajuan", uiId: "created_at", value: (r) => (r.created_at ? new Date(r.created_at).toLocaleString("id-ID") : "-") },
            { header: "PIC", uiId: "pic_id", value: (r) => r.pic_id ?? "System" },
        ];

        const columns = allColumns.filter((col) => isVisible(col.uiId));

        if (query.columnOrder) {
            const orderArr = query.columnOrder.split(",");
            columns.sort((a, b) => {
                const ia = orderArr.indexOf(a.uiId);
                const ib = orderArr.indexOf(b.uiId);
                if (ia !== -1 && ib !== -1) return ia - ib;
                if (ia !== -1) return -1;
                if (ib !== -1) return 1;
                return 0;
            });
        }

        const lines: string[] = [];
        lines.push(columns.map((c) => escapeCsv(c.header)).join(","));

        let grandTotal = 0;
        draftItems.forEach((item, index) => {
            grandTotal += (item.price || 0) * (item.quantity || 0);
            lines.push(columns.map((c) => escapeCsv(c.value(item, index))).join(","));
        });

        // Grand total row: label di kolom visible pertama agar selalu terlihat,
        // nilai total ditaruh di kolom dengan uiId "subtotal".
        if (columns.length > 0) {
            const totalCells = columns.map((c) => {
                if (c.uiId === "subtotal") {
                    const isUsdCol = c.header.includes("USD");
                    return escapeCsv(isUsdCol ? grandTotal / USD_RATE : grandTotal);
                }
                return "";
            });
            totalCells[0] = escapeCsv("GRAND TOTAL");
            lines.push(totalCells.join(","));
        }

        // BOM agar Excel mengenali UTF-8; CRLF mengikuti RFC 4180.
        const csv = "﻿" + lines.join("\r\n");
        return Buffer.from(csv, "utf8");
    }

    static async bulkUpdateStatus(ids: number[], status: any, userId?: string) {
        if (status === "DRAFT") {
            const linkedItems = await prisma.purchaseRFQItem.findMany({
                where: { purchase_draft_id: { in: ids } },
                include: { rfq: { select: { id: true, rfq_number: true, status: true } } },
            });

            const blocked = linkedItems.filter((i) =>
                i.rfq.status === "APPROVED" || i.rfq.status === "CONVERTED",
            );

            if (blocked.length > 0) {
                const nums = blocked.map((i) => i.rfq.rfq_number).join(", ");
                throw new ApiError(
                    400,
                    `Tidak dapat rollback: item sudah terikat ke RFQ ${nums} yang berstatus ${blocked[0]!.rfq.status}. Batalkan atau tutup RFQ tersebut terlebih dahulu.`,
                );
            }

            const editableLinkedIds = linkedItems
                .filter((i) => ["DRAFT", "SUBMITTED", "REVIEWED"].includes(i.rfq.status))
                .map((i) => i.id);

            const drafts = await prisma.materialPurchaseDraft.findMany({
                where: { id: { in: ids } },
                select: { id: true, raw_mat_id: true, month: true, year: true },
            });

            type PoItemRow = {
                item_id: number;
                po_id: number;
                raw_material_id: number;
                qty_received: number;
                po_number: string;
                month: number;
                year: number;
            };
            const matchingItems: PoItemRow[] = drafts.length === 0
                ? []
                : await prisma.$queryRaw<PoItemRow[]>`
                    SELECT
                        poi.id::int                          AS item_id,
                        poi.po_id::int                       AS po_id,
                        poi.raw_material_id::int             AS raw_material_id,
                        poi.qty_received::float              AS qty_received,
                        po.po_number                         AS po_number,
                        EXTRACT(MONTH FROM po.po_date)::int  AS month,
                        EXTRACT(YEAR  FROM po.po_date)::int  AS year
                    FROM purchase_order_items poi
                    JOIN purchase_orders po ON po.id = poi.po_id
                    WHERE poi.raw_material_id IN (${Prisma.join(drafts.map((d) => d.raw_mat_id))})
                      AND po.status::text IN ('SUBMITTED', 'APPROVED', 'ORDERED')
                `;

            const draftKeys = new Set(drafts.map((d) => `${d.raw_mat_id}|${d.year}|${d.month}`));
            const toRemove = matchingItems.filter((it) =>
                draftKeys.has(`${it.raw_material_id}|${it.year}|${it.month}`),
            );

            const received = toRemove.filter((it) => Number(it.qty_received) > 0);
            if (received.length > 0) {
                const nums = [...new Set(received.map((it) => it.po_number))].join(", ");
                throw new ApiError(
                    400,
                    `Tidak dapat rollback: PO ${nums} sudah ada penerimaan barang. Batalkan receipt terlebih dahulu.`,
                );
            }

            const affectedPoIds = [...new Set(toRemove.map((it) => it.po_id))];
            if (affectedPoIds.length > 0) {
                const apCount = await prisma.accountPayable.count({
                    where: { po_id: { in: affectedPoIds } },
                });
                if (apCount > 0) {
                    throw new ApiError(
                        400,
                        `Tidak dapat rollback: PO terkait sudah punya Account Payable. Batalkan AP terlebih dahulu.`,
                    );
                }
            }

            const itemIdsToDelete = toRemove.map((it) => it.item_id);

            return await prisma.$transaction(async (tx) => {
                if (editableLinkedIds.length > 0) {
                    await tx.purchaseRFQItem.deleteMany({
                        where: { id: { in: editableLinkedIds } },
                    });
                }

                if (itemIdsToDelete.length > 0) {
                    await tx.purchaseOrderItem.deleteMany({
                        where: { id: { in: itemIdsToDelete } },
                    });

                    const remaining = await tx.purchaseOrderItem.groupBy({
                        by: ["po_id"],
                        where: { po_id: { in: affectedPoIds } },
                        _count: { id: true },
                    });
                    const stillHasItems = new Set(remaining.map((r) => r.po_id));
                    const emptyPoIds = affectedPoIds.filter((id) => !stillHasItems.has(id));
                    if (emptyPoIds.length > 0) {
                        await tx.purchaseOrder.deleteMany({
                            where: { id: { in: emptyPoIds } },
                        });
                    }
                }

                return tx.materialPurchaseDraft.updateMany({
                    where: { id: { in: ids } },
                    data: { status: "DRAFT", updated_at: new Date() },
                });
            });
        }

        if (status === "ACC") {
            if (!userId) {
                throw new ApiError(401, "User tidak terotentikasi untuk approve work order");
            }
            return await RecomendationV2Service.createOpenPosFromDrafts(ids, userId);
        }

        return await prisma.materialPurchaseDraft.updateMany({
            where: { id: { in: ids } },
            data: {
                status: status,
                updated_at: new Date(),
            },
        });
    }

    private static buildTypeCondition(type?: string): any {
        if (!type) return {};

        const ffoFilter = {
            OR: [
                { slug: { contains: "fragrance-oil", mode: "insensitive" } },
                { slug: { contains: "ffo", mode: "insensitive" } },
            ],
        };

        const notFfoCondition = {
            OR: [
                { raw_mat_categories_id: null },
                { raw_mat_category: { NOT: ffoFilter } },
            ],
        };

        const notTesterCondition = {
            OR: [
                { barcode: null },
                {
                    AND: [
                        { NOT: { barcode: { startsWith: "KTL-" } } },
                        { NOT: { barcode: { startsWith: "KTP-" } } },
                        { NOT: { barcode: { startsWith: "KA-" } } },
                        { NOT: { barcode: { startsWith: "KTB-" } } },
                    ],
                },
            ],
        };

        switch (type) {
            case "ffo":
                return { raw_mat_category: ffoFilter };
            case "lokal":
                return {
                    AND: [
                        { supplier_materials: { some: { supplier: { source: "LOCAL" } } } },
                        notFfoCondition,
                        notTesterCondition,
                    ],
                };
            case "impor":
                return {
                    AND: [
                        { supplier_materials: { some: { supplier: { source: "IMPORT" } } } },
                        notFfoCondition,
                        notTesterCondition,
                    ],
                };
            case "tester":
                return {
                    AND: [
                        notFfoCondition,
                        {
                            OR: [
                                { barcode: { startsWith: "KTL-" } },
                                { barcode: { startsWith: "KTP-" } },
                                { barcode: { startsWith: "KA-" } },
                                { barcode: { startsWith: "KTB-" } },
                            ],
                        },
                    ],
                };
            default:
                return {};
        }
    }
}
