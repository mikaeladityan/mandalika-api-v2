/**
 * migrate-open-po.ts
 *
 * Migrates all OPEN records from `raw_material_open_pos` (legacy) into
 * `purchase_orders` + `purchase_order_items` (new PO system).
 *
 * Grouping strategy: one PurchaseOrder per preferred supplier.
 * Items without a preferred supplier are collected into a single fallback PO.
 *
 * Run:
 *   cd api && npx tsx src/scripts/migrate-open-po.ts
 */

import "dotenv/config";
import prisma from "../config/prisma.js";

type OpenPoWithRelations = Awaited<ReturnType<typeof fetchOpenPOs>>[number];

async function fetchOpenPOs() {
    return prisma.rawMaterialOpenPo.findMany({
        where: { status: "OPEN" },
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
        orderBy: { raw_material_id: "asc" },
    });
}

function buildPONumber(refDate: Date, index: number): string {
    const y = refDate.getFullYear();
    const m = String(refDate.getMonth() + 1).padStart(2, "0");
    const d = String(refDate.getDate()).padStart(2, "0");
    return `MPO-${y}${m}${d}-${String(index).padStart(3, "0")}`;
}

function monthKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
}

function groupBySupplierAndMonth(records: OpenPoWithRelations[]) {
    const groups = new Map<string, OpenPoWithRelations[]>();

    for (const record of records) {
        const supplier = record.raw_material?.supplier_materials?.[0]?.supplier;
        const supplierKey = supplier?.id ?? "NO_SUPPLIER";
        const key = `${supplierKey}|${monthKey(record.order_date)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(record);
    }

    return groups;
}

async function main() {
    console.log("=== Open PO Migration ===\n");

    const totalOpen = await prisma.rawMaterialOpenPo.count({ where: { status: "OPEN" } });

    if (totalOpen === 0) {
        console.log("✅ Tidak ada record OPEN di raw_material_open_pos. Migration dilewati.");
        return;
    }

    console.log(`Ditemukan ${totalOpen} record OPEN untuk dimigrasi.\n`);

    const openPOs = await fetchOpenPOs();
    const groups = groupBySupplierAndMonth(openPOs);

    console.log(`Dikelompokkan menjadi ${groups.size} group (supplier × bulan).\n`);

    let poIndex = 1;
    let createdPOs = 0;
    let createdItems = 0;
    const errors: string[] = [];

    for (const items of groups.values()) {
        if (items.length === 0) continue;

        const preferredSMFirst = items[0]!.raw_material?.supplier_materials?.[0];
        const supplier = preferredSMFirst?.supplier ?? null;

        const supplierName = supplier?.name ?? "Unknown Supplier";
        const poType: "LOCAL" | "IMPORT" = supplier?.source === "IMPORT" ? "IMPORT" : "LOCAL";

        const firstDate = items[0]!.order_date;
        const earliestDate = items.reduce(
            (min, item) => (item.order_date < min ? item.order_date : min),
            firstDate,
        );

        const poNumber = buildPONumber(earliestDate, poIndex++);

        const itemsData = items.map((item) => {
            const sm = item.raw_material?.supplier_materials?.[0];
            const unitPrice = Number(sm?.unit_price ?? 0);
            const qty = Number(item.quantity);
            return {
                raw_material_id: item.raw_material_id,
                item_code: item.raw_material?.barcode ?? `RM-${item.raw_material_id}`,
                item_name: item.raw_material?.name ?? "Unknown Material",
                uom: item.raw_material?.unit_raw_material?.name ?? "UNIT",
                moq: sm?.min_buy ? Number(sm.min_buy) : null,
                unit_price: unitPrice,
                qty_ordered: qty,
                qty_received: 0,
                subtotal: unitPrice * qty,
            };
        });

        const totalEstimated = itemsData.reduce((sum, i) => sum + i.subtotal, 0);

        try {
            await prisma.$transaction(async (tx) => {
                await tx.purchaseOrder.create({
                    data: {
                        po_number: poNumber,
                        po_date: earliestDate,
                        po_type: poType,
                        supplier_id: supplier?.id ?? null,
                        supplier_name: supplierName,
                        supplier_code: null,
                        is_new_supplier: false,
                        currency: "IDR",
                        exchange_rate: 1,
                        total_estimated: totalEstimated,
                        status: "ORDERED",
                        ordered_at: earliestDate,
                        notes: `[MIGRATED] ${items.length} item(s) dari sistem Open PO lama.`,
                        created_by: "SYSTEM-MIGRATION",
                        items: {
                            createMany: { data: itemsData },
                        },
                    },
                });
            });

            createdPOs++;
            createdItems += itemsData.length;
            console.log(`✅ PO ${poNumber} → Supplier: "${supplierName}" (${itemsData.length} item)`);
        } catch (err: any) {
            const msg = `❌ Gagal buat PO untuk supplier "${supplierName}": ${err?.message}`;
            console.error(msg);
            errors.push(msg);
        }
    }

    console.log(`
=== Ringkasan Migrasi ===
  Source records  : ${totalOpen}
  Supplier groups : ${groups.size}
  PO dibuat       : ${createdPOs}
  Items dibuat    : ${createdItems}
  Gagal           : ${errors.length}
`);

    if (errors.length > 0) {
        console.error("Error detail:");
        errors.forEach((e) => console.error(" -", e));
        process.exit(1);
    }

    // Tutup semua record lama di raw_material_open_pos
    const closed = await prisma.rawMaterialOpenPo.updateMany({
        where: { status: "OPEN" },
        data: { status: "MIGRATED" },
    });
    console.log(`✅ ${closed.count} record lama ditutup (status → MIGRATED)\n`);
    console.log("✅ Migrasi selesai.\n");
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Fatal error:", err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
