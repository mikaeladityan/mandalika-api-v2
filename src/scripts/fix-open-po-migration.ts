/**
 * fix-open-po-migration.ts
 *
 * Memperbaiki hasil migrasi `migrate-open-po.ts` yang sudah keburu dijalankan
 * di production, dimana semua item dari bulan berbeda ter-merge ke 1 PO
 * dengan tanggal earliest (mayoritas jatuh ke Januari).
 *
 * Yang dilakukan:
 *   1. Safety check — pastikan PO migrasi belum dipakai (status=ORDERED,
 *      qty_received=0, tidak ada receipt yang refer).
 *   2. Hapus purchase_order_items + purchase_orders milik
 *      `created_by='SYSTEM-MIGRATION'`.
 *   3. Reset `raw_material_open_pos.status` MIGRATED → OPEN.
 *   4. Re-migrate dengan grouping baru: per supplier × bulan.
 *
 * Pakai flag:
 *   --dry-run   : hanya print rencana, tidak modifikasi DB
 *   --force     : skip prompt confirmation
 *
 * Jalankan:
 *   cd api && npx tsx src/scripts/fix-open-po-migration.ts --dry-run
 *   cd api && npx tsx src/scripts/fix-open-po-migration.ts
 */

import "dotenv/config";
import prisma from "../config/prisma.js";
import readline from "readline";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

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

async function confirm(question: string): Promise<boolean> {
    if (FORCE) return true;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(`${question} (yes/no): `, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === "yes");
        });
    });
}

async function safetyCheck() {
    console.log("🔍 STEP 1: Safety check — pastikan PO migrasi belum dipakai\n");

    const migratedPOs = await prisma.purchaseOrder.findMany({
        where: { created_by: "SYSTEM-MIGRATION" },
        include: {
            items: true,
            receipts: true,
            receipt_items: true,
        },
    });

    console.log(`   Total PO migrasi: ${migratedPOs.length}`);

    if (migratedPOs.length === 0) {
        console.log("   ⚠️  Tidak ada PO migrasi ditemukan. Tidak ada yang perlu di-rollback.");
        return { canProceed: false, migratedPOs: [] };
    }

    const dirty = {
        nonOrdered: [] as string[],
        withReceived: [] as string[],
        withReceipts: [] as string[],
    };

    for (const po of migratedPOs) {
        if (po.status !== "ORDERED") dirty.nonOrdered.push(po.po_number);
        if (po.items.some((i) => Number(i.qty_received) > 0))
            dirty.withReceived.push(po.po_number);
        if (po.receipts.length > 0 || po.receipt_items.length > 0)
            dirty.withReceipts.push(po.po_number);
    }

    const isDirty =
        dirty.nonOrdered.length + dirty.withReceived.length + dirty.withReceipts.length > 0;

    if (isDirty) {
        console.log("\n   ❌ TIDAK AMAN dihapus — ada PO migrasi yang sudah dipakai:");
        if (dirty.nonOrdered.length)
            console.log(
                `      • Status bukan ORDERED (${dirty.nonOrdered.length}): ${dirty.nonOrdered.slice(0, 5).join(", ")}${dirty.nonOrdered.length > 5 ? "..." : ""}`,
            );
        if (dirty.withReceived.length)
            console.log(
                `      • Sudah ada qty_received (${dirty.withReceived.length}): ${dirty.withReceived.slice(0, 5).join(", ")}${dirty.withReceived.length > 5 ? "..." : ""}`,
            );
        if (dirty.withReceipts.length)
            console.log(
                `      • Punya receipt terkait (${dirty.withReceipts.length}): ${dirty.withReceipts.slice(0, 5).join(", ")}${dirty.withReceipts.length > 5 ? "..." : ""}`,
            );
        console.log(
            "\n   Hentikan. Fix manual untuk PO yang dirty sebelum re-run script ini.",
        );
        return { canProceed: false, migratedPOs };
    }

    console.log("   ✅ Semua PO migrasi masih pristine (status=ORDERED, qty_received=0, no receipts).");

    // Hitung breakdown per bulan SEKARANG (sebelum fix)
    const byMonth = new Map<string, number>();
    for (const po of migratedPOs) {
        const k = monthKey(po.po_date);
        byMonth.set(k, (byMonth.get(k) ?? 0) + 1);
    }
    console.log("\n   Breakdown PO migrasi saat ini (BEFORE fix):");
    for (const [k, v] of [...byMonth.entries()].sort()) {
        console.log(`      ${k}: ${v} PO`);
    }

    return { canProceed: true, migratedPOs };
}

async function rollback(migratedPOIds: number[]) {
    console.log("\n🗑️  STEP 2: Rollback PO migrasi\n");

    if (DRY_RUN) {
        console.log(`   [DRY-RUN] Akan hapus ${migratedPOIds.length} purchase_orders`);
        console.log(`   [DRY-RUN] Akan hapus purchase_order_items terkait (cascade)`);
        const legacyCount = await prisma.rawMaterialOpenPo.count({ where: { status: "MIGRATED" } });
        console.log(`   [DRY-RUN] Akan reset ${legacyCount} raw_material_open_pos: MIGRATED → OPEN`);
        return;
    }

    await prisma.$transaction(async (tx) => {
        const deletedItems = await tx.purchaseOrderItem.deleteMany({
            where: { po_id: { in: migratedPOIds } },
        });
        console.log(`   ✓ Hapus ${deletedItems.count} purchase_order_items`);

        const deletedPOs = await tx.purchaseOrder.deleteMany({
            where: { id: { in: migratedPOIds } },
        });
        console.log(`   ✓ Hapus ${deletedPOs.count} purchase_orders`);

        const reset = await tx.rawMaterialOpenPo.updateMany({
            where: { status: "MIGRATED" },
            data: { status: "OPEN" },
        });
        console.log(`   ✓ Reset ${reset.count} raw_material_open_pos: MIGRATED → OPEN`);
    });

    console.log("✅ Rollback selesai.");
}

async function remigrate() {
    console.log("\n🚀 STEP 3: Re-migrate dengan grouping baru (supplier × bulan)\n");

    const totalOpen = await prisma.rawMaterialOpenPo.count({ where: { status: "OPEN" } });
    if (totalOpen === 0) {
        console.log("   ⚠️  Tidak ada record OPEN. Skip.");
        return;
    }

    console.log(`   Source: ${totalOpen} record OPEN`);

    const openPOs = await fetchOpenPOs();
    const groups = groupBySupplierAndMonth(openPOs);
    console.log(`   Grouped: ${groups.size} group (supplier × bulan)`);

    if (DRY_RUN) {
        const byMonth = new Map<string, number>();
        for (const items of groups.values()) {
            const earliest = items.reduce(
                (m, it) => (it.order_date < m ? it.order_date : m),
                items[0]!.order_date,
            );
            const k = monthKey(earliest);
            byMonth.set(k, (byMonth.get(k) ?? 0) + 1);
        }
        console.log("\n   [DRY-RUN] Preview PO yang akan dibuat (AFTER fix):");
        for (const [k, v] of [...byMonth.entries()].sort()) {
            console.log(`      ${k}: ${v} PO`);
        }
        return;
    }

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
            (min, it) => (it.order_date < min ? it.order_date : min),
            firstDate,
        );

        const poNumber = buildPONumber(earliestDate, poIndex++);

        const itemsData = items.map((it) => {
            const sm = it.raw_material?.supplier_materials?.[0];
            const unitPrice = Number(sm?.unit_price ?? 0);
            const qty = Number(it.quantity);
            return {
                raw_material_id: it.raw_material_id,
                item_code: it.raw_material?.barcode ?? `RM-${it.raw_material_id}`,
                item_name: it.raw_material?.name ?? "Unknown Material",
                uom: it.raw_material?.unit_raw_material?.name ?? "UNIT",
                moq: sm?.min_buy ? Number(sm.min_buy) : null,
                unit_price: unitPrice,
                qty_ordered: qty,
                qty_received: 0,
                subtotal: unitPrice * qty,
            };
        });

        const totalEstimated = itemsData.reduce((s, i) => s + i.subtotal, 0);

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
                        notes: `[MIGRATED] ${items.length} item(s) dari sistem Open PO lama (${monthKey(earliestDate)}).`,
                        created_by: "SYSTEM-MIGRATION",
                        items: { createMany: { data: itemsData } },
                    },
                });
            });

            createdPOs++;
            createdItems += itemsData.length;
            console.log(
                `   ✓ ${poNumber} → ${supplierName} | ${monthKey(earliestDate)} | ${itemsData.length} item`,
            );
        } catch (err: any) {
            const msg = `   ✗ Gagal PO ${supplierName} (${monthKey(earliestDate)}): ${err?.message}`;
            console.error(msg);
            errors.push(msg);
        }
    }

    console.log(`
   === Ringkasan ===
   Source records  : ${totalOpen}
   Groups          : ${groups.size}
   PO dibuat       : ${createdPOs}
   Items dibuat    : ${createdItems}
   Gagal           : ${errors.length}
`);

    if (errors.length > 0) {
        console.error("   Errors:");
        errors.forEach((e) => console.error(" -", e));
        throw new Error("Re-migrate gagal sebagian. Cek error di atas.");
    }

    const closed = await prisma.rawMaterialOpenPo.updateMany({
        where: { status: "OPEN" },
        data: { status: "MIGRATED" },
    });
    console.log(`   ✓ Reset ${closed.count} raw_material_open_pos: OPEN → MIGRATED`);
}

async function verify() {
    console.log("\n📊 STEP 4: Verify hasil akhir\n");

    const result = await prisma.purchaseOrder.findMany({
        where: { created_by: "SYSTEM-MIGRATION" },
        select: { po_date: true },
    });

    const byMonth = new Map<string, number>();
    for (const r of result) {
        const k = monthKey(r.po_date);
        byMonth.set(k, (byMonth.get(k) ?? 0) + 1);
    }

    console.log("   Distribusi PO migrasi per bulan (AFTER fix):");
    for (const [k, v] of [...byMonth.entries()].sort()) {
        console.log(`      ${k}: ${v} PO`);
    }
    console.log(`   Total: ${result.length} PO`);
}

async function main() {
    console.log("=== Fix Open PO Migration ===");
    console.log(`Mode: ${DRY_RUN ? "DRY-RUN (no DB changes)" : "LIVE"}`);
    console.log(`Force: ${FORCE ? "yes" : "no (prompt confirmation)"}\n`);

    const { canProceed, migratedPOs } = await safetyCheck();
    if (!canProceed) return;

    if (!DRY_RUN) {
        const ok = await confirm(
            `\n⚠️  Lanjut hapus ${migratedPOs.length} PO migrasi + remigrate?`,
        );
        if (!ok) {
            console.log("Dibatalkan.");
            return;
        }
    }

    await rollback(migratedPOs.map((p) => p.id));
    await remigrate();
    if (!DRY_RUN) await verify();

    console.log(`\n${DRY_RUN ? "✅ Dry-run selesai (tidak ada perubahan)." : "🎉 Fix selesai."}`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Fatal error:", err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
