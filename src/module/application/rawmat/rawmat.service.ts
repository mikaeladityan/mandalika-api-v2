import {
    QueryRawMaterialDTO,
    RequestRawMaterialDTO,
    ResponseRawMaterialDTO,
} from "./rawmat.schema.js";
import prisma from "../../../config/prisma.js";
import { RawMaterial } from "../../../generated/prisma/browser.js";
import { ApiError } from "../../../lib/errors/api.error.js";
import { GetPagination } from "../../../lib/utils/pagination.js";
import {
    Prisma,
    RawMatCategories,
    Supplier,
    UnitRawMaterial,
} from "../../../generated/prisma/index.js";
import { normalizeSlug } from "../../../lib/index.js";
import { MaterialType } from "../../../generated/prisma/index.js";
import ExcelJS from "exceljs";

type RawRow = {
    id: number;
    barcode: string | null;
    name: string;
    price: number | null;
    min_buy: number | null;
    min_stock: number | null;
    lead_time: number | null;
    type: string | null;
    created_at: Date;
    updated_at: Date | null;
    deleted_at: Date | null;
    unit_id: number;
    unit_name: string;
    unit_slug: string;
    cat_id: number | null;
    cat_name: string | null;
    cat_slug: string | null;
    sup_id: number | null;
    sup_name: string | null;
    sup_country: string | null;
    source: "LOCAL" | "IMPORT" | null;
    suppliers_json?: string;
};

const SORT_MAP: Record<string, string> = {
    barcode: "rm.barcode",
    name: "rm.name",
    updated_at: "rm.updated_at",
    current_stock: "rm.current_stock",
    price: "sm.unit_price",
    created_at: "rm.created_at",
    category: "rmc.name",
    supplier: "s.name",
};

function toDTO(r: RawRow): ResponseRawMaterialDTO {
    return {
        id: r.id,
        barcode: r.barcode,
        name: r.name,
        source: r.source,
        price: r.price,
        min_buy: r.min_buy,
        min_stock: r.min_stock,
        lead_time: r.lead_time,
        type: r.type as MaterialType | null,
        unit_raw_material: { id: r.unit_id, name: r.unit_name },
        created_at: r.created_at,
        updated_at: r.updated_at,
        deleted_at: r.deleted_at,
        ...(r.cat_id && {
            raw_mat_category: { id: r.cat_id, name: r.cat_name!, slug: r.cat_slug! },
        }),
        ...(r.sup_id && { supplier: { id: r.sup_id, name: r.sup_name!, country: r.sup_country! } }),
        suppliers: r.suppliers_json ? JSON.parse(r.suppliers_json) : [],
    };
}

export class RawMaterialService {
    static async create(data: RequestRawMaterialDTO) {
        const slugUnit = normalizeSlug(data.unit);
        const slugCategories = normalizeSlug(data.raw_mat_category ?? "");

        const [find, findSlugUnit, findCategory] = await Promise.all([
            prisma.rawMaterial.findUnique({ where: { barcode: String(data.barcode) } }),
            prisma.unitRawMaterial.findUnique({ where: { slug: slugUnit }, select: { id: true } }),
            data.raw_mat_category
                ? prisma.rawMatCategories.findUnique({ where: { slug: slugCategories } })
                : Promise.resolve(null),
        ]);

        if (find)
            throw new ApiError(400, "Barcode telah digunakan, tolong ubah dengan barcode lainnya");

        if (data.supplier_id) {
            const findSupplier = await prisma.supplier.findUnique({
                where: { id: data.supplier_id },
            });
            if (!findSupplier) throw new ApiError(404, "Supplier tidak ditemukan");
        }

        return prisma.$transaction(async (tx) => {
            const unitRelation = findSlugUnit
                ? { connect: { id: findSlugUnit.id } }
                : { create: { name: data.unit, slug: slugUnit } };

            let categoryRelation: { connect?: { id: number }; create?: any } | undefined;
            if (data.raw_mat_category) {
                categoryRelation = findCategory
                    ? { connect: { id: findCategory.id } }
                    : { create: { name: data.raw_mat_category, slug: slugCategories } };
            }

            const rm = await tx.rawMaterial.create({
                data: {
                    barcode: data.barcode ?? null,
                    name: data.name,
                    min_stock: data.min_stock ?? null,
                    type: (data.type as MaterialType) ?? null,
                    unit_raw_material: unitRelation,
                    ...(categoryRelation && { raw_mat_category: categoryRelation }),
                },
            });

            if (data.suppliers && data.suppliers.length > 0) {
                await tx.supplierMaterial.createMany({
                    data: data.suppliers.map((s) => ({
                        supplier_id: s.supplier_id,
                        raw_material_id: rm.id,
                        unit_price: s.unit_price,
                        min_buy: s.min_buy ?? null,
                        lead_time: s.lead_time ?? null,
                        is_preferred: s.is_preferred,
                        status: (s.status as any) ?? "ACTIVE",
                    })),
                });
            } else if (data.supplier_id) {
                await tx.supplierMaterial.create({
                    data: {
                        supplier_id: Number(data.supplier_id),
                        raw_material_id: rm.id,
                        unit_price: data.price ?? 0,
                        min_buy: data.min_buy ?? null,
                        lead_time: data.lead_time ?? null,
                        is_preferred: true,
                        status: "ACTIVE",
                    },
                });
            }

            return this.detail(rm.id);
        });
    }

    static async update(id: number, payload: Partial<RequestRawMaterialDTO>) {
        const find = await this.findRaw(id);
        if (!find) throw new ApiError(404, "Data raw material tidak ditemukan");

        if (typeof payload.supplier_id === "number" && payload.supplier_id > 0) {
            const findSupplier = await prisma.supplier.findUnique({
                where: { id: payload.supplier_id },
            });
            if (!findSupplier) throw new ApiError(404, "Supplier tidak ditemukan");
        }

        return prisma.$transaction(async (tx) => {
            const exists = await tx.rawMaterial.findFirst({ where: { id, deleted_at: null } });
            if (!exists) throw new ApiError(404, "Raw material tidak ditemukan");

            if (payload.barcode !== undefined) {
                const duplicate = await tx.rawMaterial.findFirst({
                    where: { barcode: payload.barcode, id: { not: id } },
                    select: { id: true },
                });
                if (duplicate) throw new ApiError(400, "Barcode telah digunakan, tolong ubah dengan barcode lainnya");
            }

            const data: Prisma.RawMaterialUpdateInput = {
                ...(payload.barcode !== undefined && { barcode: payload.barcode }),
                ...(payload.name && { name: payload.name }),
                ...(payload.min_stock !== undefined && { min_stock: payload.min_stock }),
                ...(payload.type !== undefined && { type: payload.type as MaterialType }),
            };

            if (payload.unit) {
                data.unit_raw_material = await this.buildUnitRelationBySlug(tx, payload.unit);
            }

            if (payload.raw_mat_category) {
                data.raw_mat_category = await this.buildCategoryRelationBySlug(
                    tx,
                    payload.raw_mat_category,
                );
            }

            await tx.rawMaterial.update({ where: { id }, data });

            // Handle Multiple Suppliers Sync
            if (payload.suppliers && payload.suppliers.length > 0) {
                // 1. Delete ones not in the list
                const incomingSupplierIds = payload.suppliers.map(s => s.supplier_id);
                await tx.supplierMaterial.deleteMany({
                    where: { 
                        raw_material_id: id,
                        supplier_id: { notIn: incomingSupplierIds }
                    }
                });

                // 2. Upsert each
                for (const s of payload.suppliers) {
                    await tx.supplierMaterial.upsert({
                        where: {
                            supplier_id_raw_material_id: {
                                supplier_id: s.supplier_id,
                                raw_material_id: id
                            }
                        },
                        create: {
                            supplier_id: s.supplier_id,
                            raw_material_id: id,
                            unit_price: s.unit_price,
                            min_buy: s.min_buy ?? null,
                            lead_time: s.lead_time ?? null,
                            is_preferred: s.is_preferred,
                            status: (s.status as any) ?? "ACTIVE",
                        },
                        update: {
                            unit_price: s.unit_price,
                            min_buy: s.min_buy ?? null,
                            lead_time: s.lead_time ?? null,
                            is_preferred: s.is_preferred,
                            ...(s.status !== undefined && { status: s.status as any }),
                        }
                    });
                }
            } else if (typeof payload.supplier_id === "number" && payload.supplier_id > 0) {
                // Backward compatibility: Single supplier update
                await tx.supplierMaterial.upsert({
                    where: {
                        supplier_id_raw_material_id: {
                            supplier_id: payload.supplier_id,
                            raw_material_id: id,
                        },
                    },
                    create: {
                        supplier_id: payload.supplier_id,
                        raw_material_id: id,
                        unit_price: payload.price ?? 0,
                        min_buy: payload.min_buy ?? null,
                        lead_time: payload.lead_time ?? null,
                        is_preferred: true,
                    },
                    update: {
                        ...(payload.price != null && { unit_price: payload.price }),
                        ...(payload.min_buy !== undefined && { min_buy: payload.min_buy }),
                        ...(payload.lead_time !== undefined && { lead_time: payload.lead_time }),
                        is_preferred: true,
                    },
                });
                // Demote other suppliers for this material
                await tx.supplierMaterial.updateMany({
                    where: { raw_material_id: id, supplier_id: { not: payload.supplier_id } },
                    data: { is_preferred: false },
                });
            } else if (payload.supplier_id === null) {
                // Remove preferred flag from all suppliers for this material
                await tx.supplierMaterial.updateMany({
                    where: { raw_material_id: id },
                    data: { is_preferred: false },
                });
            } else if (payload.price !== undefined || payload.min_buy !== undefined || payload.lead_time !== undefined) {
                // Update pricing on existing preferred supplier
                await tx.supplierMaterial.updateMany({
                    where: { raw_material_id: id, is_preferred: true },
                    data: {
                        ...(payload.price != null && { unit_price: payload.price }),
                        ...(payload.min_buy !== undefined && { min_buy: payload.min_buy }),
                        ...(payload.lead_time !== undefined && { lead_time: payload.lead_time }),
                    },
                });
            }

            return this.detail(id);
        });
    }

    static async detail(id: number): Promise<ResponseRawMaterialDTO> {
        const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
            SELECT
                rm.id, rm.barcode, rm.name,
                sm.unit_price::float8 AS price,
                sm.min_buy::float8 AS min_buy,
                rm.min_stock::float8 AS min_stock,
                sm.lead_time, rm.type, s.source,
                rm.created_at, rm.updated_at, rm.deleted_at,
                urm.id AS unit_id, urm.name AS unit_name, urm.slug AS unit_slug,
                rmc.id AS cat_id, rmc.name AS cat_name, rmc.slug AS cat_slug,
                s.id AS sup_id, s.name AS sup_name, s.country AS sup_country,
                (
                    SELECT json_agg(json_build_object(
                        'supplier_id', sm2.supplier_id,
                        'supplier_name', s2.name,
                        'supplier_country', s2.country,
                        'unit_price', sm2.unit_price::float8,
                        'min_buy', sm2.min_buy::float8,
                        'lead_time', sm2.lead_time,
                        'is_preferred', sm2.is_preferred,
                        'status', sm2.status
                    ))
                    FROM supplier_materials sm2
                    JOIN suppliers s2 ON s2.id = sm2.supplier_id
                    WHERE sm2.raw_material_id = rm.id
                )::text AS suppliers_json
            FROM raw_materials rm
            JOIN unit_raw_materials urm ON urm.id = rm.unit_id
            LEFT JOIN raw_mat_categories rmc ON rmc.id = rm.raw_mat_categories_id
            LEFT JOIN supplier_materials sm ON sm.raw_material_id = rm.id AND sm.is_preferred = true
            LEFT JOIN suppliers s ON s.id = sm.supplier_id
            WHERE rm.id = ${id}
            LIMIT 1
        `);

        if (!rows.length) throw new ApiError(404, "Raw material tidak ditemukan");

        return toDTO(rows[0] as RawRow);
    }

    static async list({
        page = 1,
        take = 10,
        sortBy = "updated_at",
        sortOrder = "asc",
        search,
        status,
        type,
        category_id,
        supplier_id,
        unit_id,
    }: QueryRawMaterialDTO): Promise<{ data: ResponseRawMaterialDTO[]; len: number }> {
        const { skip, take: limit } = GetPagination(page, take);
        const sortCol = Prisma.raw(SORT_MAP[sortBy] ?? "rm.updated_at");
        const sortDir = Prisma.raw(sortOrder.toUpperCase() === "DESC" ? "DESC" : "ASC");

        const conditions: Prisma.Sql[] = [
            status === "deleted"
                ? Prisma.sql`rm.deleted_at IS NOT NULL`
                : Prisma.sql`rm.deleted_at IS NULL`,
        ];

        if (type) conditions.push(Prisma.sql`rm.type::text = ${type}`);
        if (search) {
            const pat = `%${search}%`;
            conditions.push(Prisma.sql`(
                rm.name ILIKE ${pat}
                OR rm.barcode ILIKE ${pat}
                OR urm.name ILIKE ${pat}
                OR rmc.name ILIKE ${pat}
                OR EXISTS (
                    SELECT 1 FROM supplier_materials sm3
                    JOIN suppliers s3 ON s3.id = sm3.supplier_id
                    WHERE sm3.raw_material_id = rm.id AND s3.name ILIKE ${pat}
                )
            )`);
        }

        if (category_id) {
            conditions.push(Prisma.sql`rm.raw_mat_categories_id = ${category_id}`);
        }
        if (supplier_id) {
            conditions.push(Prisma.sql`EXISTS (
                SELECT 1 FROM supplier_materials sm2
                WHERE sm2.raw_material_id = rm.id AND sm2.supplier_id = ${supplier_id}
            )`);
        }
        if (unit_id) {
            conditions.push(Prisma.sql`rm.unit_id = ${unit_id}`);
        }

        const where = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
        const joins = Prisma.sql`
            FROM raw_materials rm
            JOIN unit_raw_materials urm ON urm.id = rm.unit_id
            LEFT JOIN raw_mat_categories rmc ON rmc.id = rm.raw_mat_categories_id
            LEFT JOIN supplier_materials sm ON sm.raw_material_id = rm.id 
                AND sm.supplier_id = COALESCE(${supplier_id}, (SELECT sm_inner.supplier_id FROM supplier_materials sm_inner WHERE sm_inner.raw_material_id = rm.id AND sm_inner.is_preferred = true LIMIT 1))
            LEFT JOIN suppliers s ON s.id = sm.supplier_id
        `;

        const [rows, [{ count }]] = await Promise.all([
            prisma.$queryRaw<RawRow[]>(Prisma.sql`
                SELECT
                    rm.id, rm.barcode, rm.name,
                    sm.unit_price::float8 AS price,
                    sm.min_buy::float8 AS min_buy,
                    rm.min_stock::float8 AS min_stock,
                    sm.lead_time, rm.type, s.source,
                    rm.created_at, rm.updated_at, rm.deleted_at,
                    urm.id AS unit_id, urm.name AS unit_name, urm.slug AS unit_slug,
                    rmc.id AS cat_id, rmc.name AS cat_name, rmc.slug AS cat_slug,
                    s.id AS sup_id, s.name AS sup_name, s.country AS sup_country,
                    (
                        SELECT json_agg(json_build_object(
                            'supplier_id', sm2.supplier_id,
                            'supplier_name', s2.name,
                            'supplier_country', s2.country,
                            'unit_price', sm2.unit_price::float8,
                            'min_buy', sm2.min_buy::float8,
                            'lead_time', sm2.lead_time,
                            'is_preferred', sm2.is_preferred,
                            'status', sm2.status
                        ))
                        FROM supplier_materials sm2
                        JOIN suppliers s2 ON s2.id = sm2.supplier_id
                        WHERE sm2.raw_material_id = rm.id
                    )::text AS suppliers_json
                ${joins}
                ${where}
                ORDER BY ${sortCol} ${sortDir}
                LIMIT ${limit} OFFSET ${skip}
            `),
            prisma.$queryRaw<[{ count: bigint }]>(Prisma.sql`
                SELECT COUNT(*) AS count ${joins} ${where}
            `),
        ]);

        return { len: Number(count), data: rows.map(toDTO) };
    }

    static async delete(id: number) {
        const find = await this.findRaw(id);
        if (!find) throw new ApiError(404, "Data raw material tidak ditemukan");
        if (find.deleted_at !== null)
            throw new ApiError(400, "Raw material sudah berada pada status deleted");

        return prisma.rawMaterial.update({
            where: { id, deleted_at: null },
            data: { deleted_at: new Date() },
        });
    }

    static async restore(id: number) {
        const find = await this.findRaw(id);
        if (!find) throw new ApiError(404, "Data raw material tidak ditemukan");
        if (find.deleted_at === null)
            throw new ApiError(400, "Raw material tidak berada pada status deleted");

        return prisma.rawMaterial.update({
            where: { id, deleted_at: { not: null } },
            data: { deleted_at: null },
        });
    }
    
    static async bulkStatus(ids: number[], status: "ACTIVE" | "DELETE") {
        return prisma.rawMaterial.updateMany({
            where: { id: { in: ids } },
            data: { deleted_at: status === "DELETE" ? new Date() : null },
        });
    }

    static async export(query: QueryRawMaterialDTO) {
        const { data } = await this.list({ ...query, take: 1000000, page: 1 });

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Data Raw Materials");

        const visibleCols = query.visibleColumns ? query.visibleColumns.split(",") : [];
        const hasVisibility = visibleCols.length > 0;

        const allColumns = [
             // Additional Columns
            { header: "ID", key: "id", width: 10, id: "id" },
            // Mandatory Columns (Match Import Template)
            { header: "BARCODE", key: "barcode", width: 20, id: "barcode" },
            { header: "CATEGORY", key: "category", width: 25, id: "category" },
            { header: "MATERIAL NAME", key: "name", width: 40, id: "name" },
            { header: "UOM", key: "unit", width: 15, id: "unit" },
            { header: "SUPPLIER", key: "supplier", width: 25, id: "supplier" },
            { header: "PRICE", key: "price", width: 15, id: "price" },
            { header: "MOQ", key: "min_buy", width: 12, id: "min_buy" },
            { header: "MIN STOCK", key: "min_stock", width: 12, id: "min_stock" },
            { header: "LEAD TIME", key: "lead_time", width: 12, id: "lead_time" },
            { header: "LOCAL/IMPORT", key: "source", width: 15, id: "source" },
            { header: "Tipe", key: "type", width: 15, id: "type" },
            { header: "Dibuat", key: "created_at", width: 15, id: "created_at" },
            { header: "Update", key: "updated_at", width: 15, id: "updated_at" },
        ];

        const filteredColumns = hasVisibility
            ? allColumns.filter((col) => col.id === "id" || visibleCols.includes(col.id))
            : allColumns;

        sheet.columns = filteredColumns.map(({ header, key, width }) => ({ header, key, width }));

        data.forEach((item, index) => {
            const typeLabel = item.type === "FO" ? "FO" : item.type === "PCKG" ? "PCKG" : "";
            sheet.addRow({
                id: item.id,
                barcode: item.barcode || "",
                name: item.name,
                category: item.raw_mat_category?.name || "",
                supplier: item.supplier?.name || "",
                unit: item.unit_raw_material.name,
                type: typeLabel,
                source: item.source,
                price: item.price,
                min_buy: item.min_buy || 0,
                min_stock: item.min_stock || 0,
                lead_time: item.lead_time || 0,
                created_at: item.created_at,
                updated_at: item.updated_at,
            });
        });

        return await workbook.csv.writeBuffer();
    }

    static async clean() {
        const softDeleted = await prisma.rawMaterial.findMany({
            where: { deleted_at: { not: null } },
            select: { id: true },
        });

        if (softDeleted.length === 0)
            throw new ApiError(400, "Tidak ada raw material yang akan dihapus");

        const ids = softDeleted.map((s) => s.id);

        return prisma.$transaction(async (tx) => {
            // 1. Manually clean polymorphic/loose relations
            await tx.stockMovement.deleteMany({
                where: {
                    entity_type: "RAW_MATERIAL",
                    entity_id: { in: ids },
                },
            });

            // 2. Clear bulk Status (soft deleted)
            return tx.rawMaterial.deleteMany({
                where: { id: { in: ids } },
            });
        });
    }

    static async getUtils(): Promise<{
        units: Pick<UnitRawMaterial, "name" | "slug">[];
        suppliers: Pick<Supplier, "name" | "id" | "country" | "source">[];
        categories: Pick<RawMatCategories, "slug" | "name">[];
    }> {
        const [units, suppliers, categories] = await Promise.all([
            prisma.unitRawMaterial.findMany({ select: { name: true, slug: true } }),
            prisma.supplier.findMany({ select: { id: true, name: true, country: true, source: true } }),
            prisma.rawMatCategories.findMany({
                select: { name: true, slug: true },
                where: { status: { notIn: ["BLOCK", "DELETE", "PENDING"] } },
            }),
        ]);

        return { units, suppliers, categories };
    }

    static async countUtils(): Promise<{ units: number; suppliers: number; categories: number }> {
        const [units, suppliers, categories] = await Promise.all([
            prisma.unitRawMaterial.count(),
            prisma.supplier.count(),
            prisma.rawMatCategories.count({
                where: { status: { notIn: ["BLOCK", "DELETE", "PENDING"] } },
            }),
        ]);

        return { units, suppliers, categories };
    }

    static async redisRawMaterial(): Promise<{ id: number; name: string }[]> {
        return prisma.rawMaterial.findMany({
            where: { deleted_at: null },
            select: { id: true, name: true },
        });
    }

    private static async findRaw(id: number): Promise<RawMaterial | null> {
        return prisma.rawMaterial.findUnique({ where: { id } });
    }

    private static async buildUnitRelationBySlug(tx: Prisma.TransactionClient, unit: string) {
        const slug = normalizeSlug(unit);
        const existing = await tx.unitRawMaterial.findUnique({
            where: { slug },
            select: { id: true },
        });
        return existing ? { connect: { id: existing.id } } : { create: { name: unit, slug } };
    }

    private static async buildCategoryRelationBySlug(
        tx: Prisma.TransactionClient,
        category: string,
    ) {
        const slug = normalizeSlug(category);
        const existing = await tx.rawMatCategories.findUnique({
            where: { slug },
            select: { id: true },
        });
        return existing ? { connect: { id: existing.id } } : { create: { name: category, slug } };
    }
}
