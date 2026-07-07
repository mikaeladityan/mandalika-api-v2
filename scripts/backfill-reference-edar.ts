/**
 * MAINTENANCE SCRIPT: Backfill EDAR ACUAN (reference_distribution_percentage)
 * dari nilai EDAR% (distribution_percentage) yang sudah ada.
 *
 * Kolom reference_distribution_percentage baru ditambahkan dan default 0,
 * sehingga halaman EDAR vs ACUAN tampil kosong. Script ini menyalin nilai
 * EDAR% sebagai baseline acuan awal.
 *
 * CARA PAKAI:
 *   npx tsx scripts/backfill-reference-edar.ts
 *   DRY_RUN=1 npx tsx scripts/backfill-reference-edar.ts   # preview only
 *   FORCE=1 npx tsx scripts/backfill-reference-edar.ts     # timpa acuan yang sudah terisi
 *
 * YANG DILAKUKAN:
 *   - Default: isi reference_distribution_percentage HANYA untuk produk yang
 *     acuannya masih kosong (NULL atau 0) dan EDAR%-nya terisi.
 *   - FORCE=1: timpa semua acuan dengan EDAR% saat ini.
 *
 * IDEMPOTENT: aman dijalankan ulang; run kedua tanpa FORCE tidak mengubah apa pun.
 */

import { config } from "dotenv";
config();

import { Prisma } from "../src/generated/prisma/client.js";
import prisma from "../src/config/prisma.js";

const DRY_RUN = process.env.DRY_RUN === "1";
const FORCE = process.env.FORCE === "1";

async function backfill() {
    console.log(`[backfill-reference-edar] starting (dry-run=${DRY_RUN}, force=${FORCE})`);

    const whereTarget = FORCE
        ? Prisma.sql`p.distribution_percentage IS NOT NULL`
        : Prisma.sql`COALESCE(p.reference_distribution_percentage, 0) = 0
            AND COALESCE(p.distribution_percentage, 0) <> 0`;

    const [stats] = await prisma.$queryRaw<
        { total: bigint; edar_filled: bigint; acuan_filled: bigint; targets: bigint }[]
    >(Prisma.sql`
        SELECT
            count(*)                                                                    AS total,
            count(*) FILTER (WHERE COALESCE(p.distribution_percentage, 0) <> 0)        AS edar_filled,
            count(*) FILTER (WHERE COALESCE(p.reference_distribution_percentage, 0) <> 0) AS acuan_filled,
            count(*) FILTER (WHERE ${whereTarget})                                      AS targets
        FROM products p
    `);

    console.log(`  products total:        ${stats.total}`);
    console.log(`  EDAR% terisi:          ${stats.edar_filled}`);
    console.log(`  EDAR ACUAN terisi:     ${stats.acuan_filled}`);
    console.log(`  akan di-backfill:      ${stats.targets}`);

    if (DRY_RUN) {
        console.log("[backfill-reference-edar] dry-run selesai, tidak ada perubahan");
        return;
    }

    const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE products p
        SET reference_distribution_percentage = p.distribution_percentage,
            updated_at = now()
        WHERE ${whereTarget}
    `);

    console.log(`[backfill-reference-edar] done, updated: ${updated}`);
}

backfill()
    .catch((err) => {
        console.error("[backfill-reference-edar] failed", err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
