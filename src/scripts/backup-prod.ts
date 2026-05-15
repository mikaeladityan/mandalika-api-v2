/**
 * backup-prod.ts
 *
 * Logical backup semua tabel kritis via Prisma client.
 * Output: JSON file di root project (api/backups/backup_<timestamp>.json).
 *
 * Cocok untuk DB yang tidak bisa di-pg_dump langsung (mis. Prisma Accelerate
 * di db.prisma.io). Untuk full SQL backup, pakai Prisma Console snapshot.
 *
 * Jalankan:
 *   cd api && npx tsx src/scripts/backup-prod.ts
 *
 * Restore selektif:
 *   pakai script terpisah `restore-prod.ts` (belum dibuat — restore manual
 *   dengan baca JSON + prisma.<model>.createMany).
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";

const BACKUP_DIR = path.resolve(process.cwd(), "backups");

const TABLES = [
    "purchaseOrder",
    "purchaseOrderItem",
    "purchasePaymentTerm",
    "purchaseTracking",
    "purchaseReceipt",
    "purchaseReceiptItem",
    "purchaseRFQ",
    "rawMaterialOpenPo",
    "rawMaterial",
    "supplier",
    "supplierMaterial",
    "materialPurchaseDraft",
    "goodsReceipt",
    "goodsReceiptItem",
    "rawMaterialInventory",
    "accountPayable",
    "stockMovement",
] as const;

function bigintReplacer(_key: string, value: unknown) {
    return typeof value === "bigint" ? value.toString() : value;
}

async function main() {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const outFile = path.join(BACKUP_DIR, `backup_${ts}.json`);

    console.log(`=== Backup Prod (logical) ===`);
    console.log(`Target: ${outFile}\n`);

    const data: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};

    for (const model of TABLES) {
        try {
            // @ts-expect-error dynamic model access
            const rows = await prisma[model].findMany();
            data[model] = rows;
            counts[model] = rows.length;
            console.log(`  ✓ ${model}: ${rows.length} rows`);
        } catch (err: any) {
            console.log(`  ⚠️  ${model}: skip (${err?.message ?? "unknown error"})`);
            data[model] = [];
            counts[model] = 0;
        }
    }

    const payload = {
        meta: {
            backed_up_at: new Date().toISOString(),
            counts,
            total_rows: Object.values(counts).reduce((a, b) => a + b, 0),
        },
        data,
    };

    fs.writeFileSync(outFile, JSON.stringify(payload, bigintReplacer, 2));

    const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);
    console.log(`\n✅ Backup saved: ${outFile} (${sizeMB} MB)`);
    console.log(`   Total rows: ${payload.meta.total_rows}`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Fatal error:", err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
