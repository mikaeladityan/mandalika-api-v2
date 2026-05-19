import ExcelJS from "exceljs";
import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { getOrCreateSlug } from "../../../../lib/utils/upsert-slug.js";
import { RM_IMPORT_HEADERS } from "./import/import.schema.js";
import {
    BulkActionDTO,
    QueryRMDTO,
    RequestRMDTO,
    RequestSupplierMaterialDTO,
    ResponseRMDTO,
} from "./rm.schema.js";

const EXPORT_MAX_ROWS = 50_000;

const RM_INCLUDE = {
    unit_raw_material: true,
    raw_mat_category: true,
    supplier_materials: { include: { supplier: true } },
} satisfies Prisma.RawMaterialInclude;

type RMWithRelations = Prisma.RawMaterialGetPayload<{ include: typeof RM_INCLUDE }>;

const SUPPLIER_EXPORT_GROUP = new Set([
    "supplier",
    "price",
    "min_buy",
    "lead_time",
    "is_preferred",
    "supplier_source",
    "supplier_country",
]);

type NormalizedSuppliers =
    | { kind: "skip" }
    | { kind: "clear" }
    | { kind: "set"; rows: RequestSupplierMaterialDTO[] };

export class RMService {
    static async create(body: RequestRMDTO): Promise<ResponseRMDTO> {
        const { unit, raw_mat_category, suppliers: _s, supplier_id: _sid, ...rest } = body;
        const suppliers = this.normalizeSuppliers(body);
        const initialRows = suppliers.kind === "set" ? suppliers.rows : null;

        try {
            const created = await prisma.$transaction(async (tx) => {
                const [unit_id, raw_mat_categories_id] = await Promise.all([
                    getOrCreateSlug(tx.unitRawMaterial, unit),
                    raw_mat_category
                        ? getOrCreateSlug(tx.rawMatCategories, raw_mat_category)
                        : null,
                ]);

                return tx.rawMaterial.create({
                    data: {
                        barcode: rest.barcode ?? null,
                        name: rest.name,
                        type: rest.type ?? null,
                        min_stock: rest.min_stock ?? null,
                        unit_id,
                        raw_mat_categories_id,
                        ...(initialRows && {
                            supplier_materials: {
                                createMany: { data: initialRows.map(this.toSupplierMaterialBase) },
                            },
                        }),
                    },
                    include: RM_INCLUDE,
                });
            });

            return this.toDTO(created);
        } catch (e) {
            this.rethrowPrismaError(e);
        }
    }

    static async update(id: number, body: Partial<RequestRMDTO>): Promise<ResponseRMDTO> {
        const existing = await prisma.rawMaterial.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new ApiError(404, "Raw material tidak ditemukan");

        const suppliers = this.normalizeSuppliers(body);

        try {
            const updated = await prisma.$transaction(async (tx) => {
                const data: Prisma.RawMaterialUpdateInput = {
                    ...(body.barcode !== undefined && { barcode: body.barcode }),
                    ...(body.name && { name: body.name }),
                    ...(body.min_stock !== undefined && { min_stock: body.min_stock }),
                    ...(body.type !== undefined && { type: body.type }),
                };

                if (body.unit) {
                    const unit_id = await getOrCreateSlug(tx.unitRawMaterial, body.unit);
                    data.unit_raw_material = { connect: { id: unit_id } };
                }
                if (body.raw_mat_category) {
                    const cat_id = await getOrCreateSlug(
                        tx.rawMatCategories,
                        body.raw_mat_category,
                    );
                    data.raw_mat_category = { connect: { id: cat_id } };
                }

                await this.syncSuppliers(tx, id, suppliers, body);

                return tx.rawMaterial.update({ where: { id }, data, include: RM_INCLUDE });
            });

            return this.toDTO(updated);
        } catch (e) {
            this.rethrowPrismaError(e);
        }
    }

    static async detail(id: number): Promise<ResponseRMDTO> {
        const rm = await prisma.rawMaterial.findUnique({ where: { id }, include: RM_INCLUDE });
        if (!rm) throw new ApiError(404, "Raw material tidak ditemukan");
        return this.toDTO(rm);
    }

    static async list(query: QueryRMDTO): Promise<{ data: ResponseRMDTO[]; len: number }> {
        const {
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
        } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.RawMaterialWhereInput = {
            deleted_at: status === "deleted" ? { not: null } : null,
            ...(type && { type }),
            ...(category_id && { raw_mat_categories_id: category_id }),
            ...(unit_id && { unit_id }),
            ...(supplier_id && { supplier_materials: { some: { supplier_id } } }),
            ...(search && {
                OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    { barcode: { startsWith: search } },
                    { unit_raw_material: { name: { contains: search, mode: "insensitive" } } },
                    { raw_mat_category: { name: { contains: search, mode: "insensitive" } } },
                    {
                        supplier_materials: {
                            some: { supplier: { name: { contains: search, mode: "insensitive" } } },
                        },
                    },
                ],
            }),
        };

        const orderByMap: Record<string, Prisma.RawMaterialOrderByWithRelationInput> = {
            barcode: { barcode: sortOrder },
            name: { name: sortOrder },
            updated_at: { updated_at: sortOrder },
            created_at: { created_at: sortOrder },
            category: { raw_mat_category: { name: sortOrder } },
        };
        const orderBy = orderByMap[sortBy] ?? { updated_at: sortOrder };

        const [rows, len] = await Promise.all([
            prisma.rawMaterial.findMany({
                where,
                include: RM_INCLUDE,
                orderBy,
                skip,
                take: limit,
            }),
            prisma.rawMaterial.count({ where }),
        ]);

        return { data: rows.map((r) => this.toDTO(r)), len };
    }

    static async delete(id: number) {
        const find = await prisma.rawMaterial.findUnique({
            where: { id },
            select: { deleted_at: true },
        });
        if (!find) throw new ApiError(404, "Raw material tidak ditemukan");
        if (find.deleted_at !== null)
            throw new ApiError(400, "Raw material sudah berada pada status deleted");

        return prisma.rawMaterial.update({ where: { id }, data: { deleted_at: new Date() } });
    }

    static async restore(id: number) {
        const find = await prisma.rawMaterial.findUnique({
            where: { id },
            select: { deleted_at: true },
        });
        if (!find) throw new ApiError(404, "Raw material tidak ditemukan");
        if (find.deleted_at === null)
            throw new ApiError(400, "Raw material tidak berada pada status deleted");

        return prisma.rawMaterial.update({ where: { id }, data: { deleted_at: null } });
    }

    static async bulkStatus(ids: number[], status: BulkActionDTO) {
        if (!ids?.length) throw new ApiError(400, "Tidak ada raw material yang dipilih");

        const { count } = await prisma.rawMaterial.updateMany({
            where: { id: { in: ids } },
            data: { deleted_at: status === "DELETE" ? new Date() : null },
        });

        if (count === 0)
            throw new ApiError(404, "Tidak ada raw material yang cocok dengan id terpilih");
        return { affected: count };
    }

    static async clean() {
        return prisma.$transaction(async (tx) => {
            const softDeleted = await tx.rawMaterial.findMany({
                where: { deleted_at: { not: null } },
                select: { id: true },
            });
            if (softDeleted.length === 0)
                throw new ApiError(400, "Tidak ada raw material yang akan dihapus");

            const ids = softDeleted.map((s) => s.id);

            // Relasi RESTRICT tanpa cascade — cek paralel supaya tx tidak abort dengan FK error mentah.
            const [recipeRefs, poItemRefs, prodRefs] = await Promise.all([
                tx.recipes.count({ where: { raw_mat_id: { in: ids } } }),
                tx.purchaseOrderItem.count({ where: { raw_material_id: { in: ids } } }),
                tx.productionOrderItem.count({ where: { raw_material_id: { in: ids } } }),
            ]);

            if (recipeRefs > 0)
                throw new ApiError(
                    409,
                    "Raw material masih dipakai pada Recipe. Hapus permanen ditolak.",
                );
            if (poItemRefs > 0)
                throw new ApiError(
                    409,
                    "Raw material masih terkait dengan Purchase Order. Hapus permanen ditolak.",
                );
            if (prodRefs > 0)
                throw new ApiError(
                    409,
                    "Raw material masih terkait dengan Production Order. Hapus permanen ditolak.",
                );

            await tx.stockMovement.deleteMany({
                where: { entity_type: "RAW_MATERIAL", entity_id: { in: ids } },
            });

            const { count } = await tx.rawMaterial.deleteMany({ where: { id: { in: ids } } });
            return { deleted: count };
        });
    }

    static async export(query: QueryRMDTO) {
        const { data, len } = await this.list({ ...query, take: EXPORT_MAX_ROWS, page: 1 });
        if (len > EXPORT_MAX_ROWS) {
            throw new ApiError(
                400,
                `Data terlalu besar (${len} baris). Gunakan filter untuk membatasi maksimal ${EXPORT_MAX_ROWS} baris.`,
            );
        }

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Data Raw Materials");

        const visibleCols = query.visibleColumns
            ? query.visibleColumns.split(",").map((s) => s.trim()).filter(Boolean)
            : [];
        const expandSupplierGroup = visibleCols.includes("supplier_details");
        const hasVisibility = visibleCols.length > 0;

        // Header export selaras dengan RM_IMPORT_HEADERS agar round-trip export → import valid (SOP §1.I).
        const allColumns = [
            { header: "ID", key: "id", width: 10, id: "id" },
            { header: RM_IMPORT_HEADERS.barcode, key: "barcode", width: 20, id: "barcode" },
            { header: RM_IMPORT_HEADERS.category, key: "category", width: 25, id: "category" },
            { header: RM_IMPORT_HEADERS.name, key: "name", width: 40, id: "name" },
            { header: RM_IMPORT_HEADERS.unit, key: "unit", width: 15, id: "unit" },
            { header: RM_IMPORT_HEADERS.supplier, key: "supplier", width: 25, id: "supplier" },
            { header: RM_IMPORT_HEADERS.price, key: "price", width: 15, id: "price" },
            { header: RM_IMPORT_HEADERS.moq, key: "min_buy", width: 12, id: "min_buy" },
            { header: RM_IMPORT_HEADERS.leadTime, key: "lead_time", width: 12, id: "lead_time" },
            { header: "UTAMA?", key: "is_preferred", width: 10, id: "is_preferred" },
            { header: RM_IMPORT_HEADERS.source, key: "supplier_source", width: 15, id: "supplier_source" },
            { header: RM_IMPORT_HEADERS.country, key: "supplier_country", width: 15, id: "supplier_country" },
            { header: RM_IMPORT_HEADERS.minStock, key: "min_stock", width: 12, id: "min_stock" },
            { header: "TIPE", key: "type", width: 15, id: "type" },
            { header: "DIBUAT", key: "created_at", width: 15, id: "created_at" },
            { header: "UPDATE", key: "updated_at", width: 15, id: "updated_at" },
        ];

        const filteredColumns = hasVisibility
            ? allColumns.filter(
                  (col) =>
                      col.id === "id" ||
                      (expandSupplierGroup && SUPPLIER_EXPORT_GROUP.has(col.id)) ||
                      visibleCols.includes(col.id),
              )
            : allColumns;

        sheet.columns = filteredColumns.map(({ header, key, width }) => ({ header, key, width }));

        for (const item of data) {
            const supplierRows =
                item.suppliers && item.suppliers.length > 0 ? item.suppliers : [null];

            for (const sup of supplierRows) {
                sheet.addRow({
                    id: item.id,
                    barcode: item.barcode ?? "",
                    name: item.name,
                    category: item.raw_mat_category?.name ?? "",
                    supplier: sup?.supplier_name ?? "",
                    unit: item.unit_raw_material.name,
                    type: item.type ?? "",
                    supplier_source: sup?.supplier_source ?? item.source ?? "",
                    supplier_country: sup?.supplier_country ?? "",
                    price: sup?.unit_price ?? 0,
                    min_buy: sup?.min_buy ?? 0,
                    min_stock: item.min_stock ?? 0,
                    lead_time: sup?.lead_time ?? 0,
                    is_preferred: sup ? (sup.is_preferred ? "YA" : "TIDAK") : "-",
                    created_at: item.created_at,
                    updated_at: item.updated_at,
                });
            }
        }

        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
        headerRow.height = 25;
        headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0070C0" } };
        headerRow.alignment = { vertical: "middle", horizontal: "center" };

        return workbook.csv.writeBuffer();
    }

    // --- Helpers ---

    private static toDTO(rm: RMWithRelations): ResponseRMDTO {
        const preferred = rm.supplier_materials.find((sm) => sm.is_preferred);
        return {
            id: rm.id,
            barcode: rm.barcode,
            name: rm.name,
            type: rm.type,
            min_stock: rm.min_stock !== null ? Number(rm.min_stock) : null,
            source: preferred?.supplier.source ?? null,
            price: preferred ? Number(preferred.unit_price) : null,
            min_buy: preferred?.min_buy != null ? Number(preferred.min_buy) : null,
            lead_time: preferred?.lead_time ?? null,
            unit_raw_material: { id: rm.unit_raw_material.id, name: rm.unit_raw_material.name },
            ...(rm.raw_mat_category && {
                raw_mat_category: {
                    id: rm.raw_mat_category.id,
                    name: rm.raw_mat_category.name,
                    slug: rm.raw_mat_category.slug,
                },
            }),
            ...(preferred && {
                supplier: {
                    id: preferred.supplier.id,
                    name: preferred.supplier.name,
                    country: preferred.supplier.country,
                },
            }),
            suppliers: rm.supplier_materials.map((sm) => ({
                supplier_id: sm.supplier_id,
                supplier_name: sm.supplier.name,
                supplier_country: sm.supplier.country,
                supplier_source: sm.supplier.source,
                unit_price: Number(sm.unit_price),
                min_buy: sm.min_buy != null ? Number(sm.min_buy) : null,
                lead_time: sm.lead_time,
                is_preferred: sm.is_preferred,
                status: sm.status,
            })),
            created_at: rm.created_at,
            updated_at: rm.updated_at,
            deleted_at: rm.deleted_at,
        };
    }

    private static normalizeSuppliers(
        payload: Pick<
            RequestRMDTO,
            "suppliers" | "supplier_id" | "price" | "min_buy" | "lead_time"
        >,
    ): NormalizedSuppliers {
        if (Array.isArray(payload.suppliers)) {
            return payload.suppliers.length === 0
                ? { kind: "clear" }
                : { kind: "set", rows: payload.suppliers };
        }
        if (typeof payload.supplier_id === "number" && payload.supplier_id > 0) {
            return {
                kind: "set",
                rows: [
                    {
                        supplier_id: payload.supplier_id,
                        unit_price: payload.price ?? 0,
                        min_buy: payload.min_buy ?? null,
                        lead_time: payload.lead_time ?? null,
                        is_preferred: true,
                        status: "ACTIVE",
                    },
                ],
            };
        }
        return { kind: "skip" };
    }

    private static async syncSuppliers(
        tx: Prisma.TransactionClient,
        rawMaterialId: number,
        suppliers: NormalizedSuppliers,
        body: Partial<RequestRMDTO>,
    ) {
        if (suppliers.kind === "clear") {
            await tx.supplierMaterial.deleteMany({ where: { raw_material_id: rawMaterialId } });
            return;
        }

        if (suppliers.kind === "set") {
            const incomingIds = suppliers.rows.map((s) => s.supplier_id);
            await tx.supplierMaterial.deleteMany({
                where: { raw_material_id: rawMaterialId, supplier_id: { notIn: incomingIds } },
            });

            // Composite key supplier_id+raw_material_id unik per baris → upsert aman paralel.
            await Promise.all(
                suppliers.rows.map((s) =>
                    tx.supplierMaterial.upsert({
                        where: {
                            supplier_id_raw_material_id: {
                                supplier_id: s.supplier_id,
                                raw_material_id: rawMaterialId,
                            },
                        },
                        create: {
                            ...this.toSupplierMaterialBase(s),
                            raw_material_id: rawMaterialId,
                        },
                        update: this.toSupplierMaterialPatch(s),
                    }),
                ),
            );
            return;
        }

        if (body.supplier_id === null) {
            await tx.supplierMaterial.updateMany({
                where: { raw_material_id: rawMaterialId },
                data: { is_preferred: false },
            });
            return;
        }

        if (
            body.price !== undefined ||
            body.min_buy !== undefined ||
            body.lead_time !== undefined
        ) {
            await tx.supplierMaterial.updateMany({
                where: { raw_material_id: rawMaterialId, is_preferred: true },
                data: {
                    ...(body.price != null && { unit_price: body.price }),
                    ...(body.min_buy !== undefined && { min_buy: body.min_buy }),
                    ...(body.lead_time !== undefined && { lead_time: body.lead_time }),
                },
            });
        }
    }

    private static toSupplierMaterialBase(s: RequestSupplierMaterialDTO) {
        return {
            supplier_id: s.supplier_id,
            unit_price: s.unit_price,
            min_buy: s.min_buy ?? null,
            lead_time: s.lead_time ?? null,
            is_preferred: s.is_preferred,
            status: s.status ?? "ACTIVE",
        };
    }

    private static toSupplierMaterialPatch(s: RequestSupplierMaterialDTO) {
        return {
            unit_price: s.unit_price,
            min_buy: s.min_buy ?? null,
            lead_time: s.lead_time ?? null,
            is_preferred: s.is_preferred,
            ...(s.status !== undefined && { status: s.status }),
        };
    }

    private static rethrowPrismaError(e: unknown): never {
        if (e instanceof Prisma.PrismaClientKnownRequestError) {
            if (e.code === "P2002") {
                throw new ApiError(
                    400,
                    "Barcode telah digunakan, tolong ubah dengan barcode lainnya",
                );
            }
            if (e.code === "P2003" || e.code === "P2025") {
                throw new ApiError(404, "Supplier tidak ditemukan");
            }
        }
        throw e;
    }
}
