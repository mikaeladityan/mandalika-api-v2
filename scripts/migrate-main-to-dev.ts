/**
 * MIGRATION SCRIPT: main → dev schema
 *
 * CARA PAKAI:
 *   1. Pastikan dev schema sudah di-apply ke DB:
 *      npx prisma db push --force-reset
 *
 *   2. Jalankan script ini (ada 2 cara):
 *
 *      # Cara A: argument langsung
 *      npx tsx scripts/migrate-main-to-dev.ts /path/to/backup.sql
 *
 *      # Cara B: env var
 *      BACKUP_FILE=/path/to/backup.sql npx tsx scripts/migrate-main-to-dev.ts
 *
 * YANG DILAKUKAN:
 *   - Parse backup file (main schema)
 *   - Restore semua tabel identik
 *   - Transform raw_materials (hapus kolom dropped)
 *   - Duplikasi 4 supplier yang mixed-source
 *   - Build supplier_materials dari backup raw_materials
 *   - Reset semua PostgreSQL sequences
 */

import fs from "fs";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env dari root api/
config({ path: path.resolve(__dirname, "../.env") });

// ── CONFIG ──────────────────────────────────────────────────────────────────
// Priority: CLI arg > BACKUP_FILE env var > default relative path
const BACKUP_FILE =
    process.argv[2] ??
    process.env.BACKUP_FILE ??
    path.resolve(__dirname, "../../backup_production_20260513_105509.sql");

if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL tidak ditemukan di .env");
    process.exit(1);
}

if (!fs.existsSync(BACKUP_FILE)) {
    console.error(`❌ Backup file tidak ditemukan: ${BACKUP_FILE}`);
    console.error("   Gunakan: npx tsx scripts/migrate-main-to-dev.ts /path/to/backup.sql");
    process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;

// Supplier IDs yang punya mixed source (LOCAL + IMPORT)
// Format: original_id → { keepSource, newSource }
const MIXED_SOURCE_SUPPLIERS: Record<number, { keepSource: string; newSource: string }> = {
    5: { keepSource: "LOCAL", newSource: "IMPORT" },   // OASE PROJECT: 46L / 19I
    9: { keepSource: "IMPORT", newSource: "LOCAL" },   // PT. MARFA SARAH: 3I / 1L
    15: { keepSource: "IMPORT", newSource: "LOCAL" },  // GUANGZHOU DEVI: 12I / 4L
    36: { keepSource: "LOCAL", newSource: "IMPORT" },  // #N/A: 1L / 1I
};

// ── TYPES ────────────────────────────────────────────────────────────────────
type BackupTable = {
    columns: string[];
    rows: (string | null)[][];
};

type SupplierMapping = Map<number, { local_id: number; import_id: number }>;

// ── BACKUP PARSER ─────────────────────────────────────────────────────────
function parseBackup(filePath: string): Map<string, BackupTable> {
    console.log(`📂 Parsing backup: ${filePath}`);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const tables = new Map<string, BackupTable>();

    let currentTable: string | null = null;
    let currentColumns: string[] = [];
    let currentRows: (string | null)[][] = [];

    for (const line of lines) {
        if (line.startsWith("COPY public.")) {
            // e.g. COPY public.raw_materials (id, barcode, ...) FROM stdin;
            const match = line.match(/^COPY public\.(\S+)\s+\(([^)]+)\)/);
            if (match) {
                currentTable = match[1];
                currentColumns = match[2].split(", ").map((c) => c.trim());
                currentRows = [];
            }
            continue;
        }

        if (line === "\\.") {
            if (currentTable) {
                tables.set(currentTable, { columns: currentColumns, rows: currentRows });
                console.log(`   ✓ ${currentTable}: ${currentRows.length} rows`);
            }
            currentTable = null;
            continue;
        }

        if (currentTable && line.length > 0) {
            const values = line.split("\t").map((v) => {
                if (v === "\\N") return null;
                // Unescape PostgreSQL COPY escape sequences
                return v
                    .replace(/\\n/g, "\n")
                    .replace(/\\t/g, "\t")
                    .replace(/\\r/g, "\r")
                    .replace(/\\\\/g, "\\");
            });
            currentRows.push(values);
        }
    }

    console.log(`✅ Parsed ${tables.size} tables\n`);
    return tables;
}

// ── HELPERS ───────────────────────────────────────────────────────────────
function getCol(row: (string | null)[], columns: string[], col: string): string | null {
    const idx = columns.indexOf(col);
    return idx >= 0 ? row[idx] : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
    return result;
}

async function insertRows(
    client: pg.Client,
    table: string,
    columns: string[],
    rows: (string | null)[][],
    batchSize = 500,
) {
    if (rows.length === 0) return;

    const batches = chunk(rows, batchSize);
    for (const batch of batches) {
        const placeholders = batch.map(
            (_, ri) =>
                `(${columns.map((_, ci) => `$${ri * columns.length + ci + 1}`).join(", ")})`,
        );
        const values = batch.flat();
        const sql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`;
        await client.query(sql, values);
    }
}

// ── STEP 1: Tabel identik (direct restore) ────────────────────────────────
const DIRECT_TABLES_ORDER = [
    // No dependencies
    "suspicious_activities",
    "logging_activities",
    "unit_of_materials",
    "unit_raw_materials",
    "product_size",
    "product_types",
    "warehouses",
    "raw_mat_categories",
    // Depends on above
    "accounts",
    "email_verifies",
    "users",
    "addresses",
    "products",
    "warehouse_addresses",
    "outlets",
    "outlet_addresses",
    "outlet_warehouses",
    "outlet_inventories",
    "forecasts_percentages",
];

async function restoreDirectTables(
    client: pg.Client,
    backup: Map<string, BackupTable>,
) {
    console.log("📋 STEP 1: Restore direct tables...");
    for (const tableName of DIRECT_TABLES_ORDER) {
        const table = backup.get(tableName);
        if (!table) {
            console.log(`   ⚠️  ${tableName}: not found in backup, skip`);
            continue;
        }
        await insertRows(client, tableName, table.columns, table.rows);
        console.log(`   ✓ ${tableName}: ${table.rows.length} rows`);
    }
    console.log("✅ Direct tables done\n");
}

// ── STEP 2: Suppliers + handle source + duplikasi mixed ──────────────────
async function restoreSuppliers(
    client: pg.Client,
    backup: Map<string, BackupTable>,
): Promise<SupplierMapping> {
    console.log("📋 STEP 2: Restore suppliers + handle mixed source...");

    const suppliersTable = backup.get("suppliers")!;
    const { columns, rows } = suppliersTable;
    const supplierMapping: SupplierMapping = new Map();
    const rmTable = backup.get("raw_materials")!;
    const rmCols = rmTable.columns;

    // Build source map per supplier from raw_materials data
    const supplierSourceMap = new Map<number, Set<string>>();
    for (const rmRow of rmTable.rows) {
        const suppId = getCol(rmRow, rmCols, "supplier_id");
        const src = getCol(rmRow, rmCols, "source");
        if (suppId && src) {
            if (!supplierSourceMap.has(parseInt(suppId))) {
                supplierSourceMap.set(parseInt(suppId), new Set());
            }
            supplierSourceMap.get(parseInt(suppId))!.add(src);
        }
    }

    // PASS 1: Insert ALL original suppliers first (preserves IDs)
    for (const row of rows) {
        const id = parseInt(getCol(row, columns, "id")!);
        const name = getCol(row, columns, "name");
        const addresses = getCol(row, columns, "addresses");
        const country = getCol(row, columns, "country");
        const phone = getCol(row, columns, "phone");
        const created_at = getCol(row, columns, "created_at");
        const updated_at = getCol(row, columns, "updated_at");
        const slug = getCol(row, columns, "slug");

        const mixed = MIXED_SOURCE_SUPPLIERS[id];
        let primarySource = "LOCAL";

        if (mixed) {
            primarySource = mixed.keepSource;
        } else {
            const sources = supplierSourceMap.get(id);
            if (sources) {
                if (sources.has("IMPORT") && !sources.has("LOCAL")) primarySource = "IMPORT";
                else primarySource = "LOCAL";
            } else if (country?.toUpperCase() === "IMPORT") {
                primarySource = "IMPORT";
            }
        }

        await client.query(
            `INSERT INTO "suppliers" ("id", "name", "addresses", "country", "phone", "source", "created_at", "updated_at", "slug")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT ("id") DO NOTHING`,
            [id, name, addresses, country, phone, primarySource, created_at, updated_at, slug],
        );

        // Non-mixed: same ID for both sources
        if (!mixed) {
            supplierMapping.set(id, { local_id: id, import_id: id });
        }
    }

    // Advance sequence past max existing ID before inserting duplicates
    await client.query(
        `SELECT setval(pg_get_serial_sequence('"suppliers"', 'id'), (SELECT MAX(id) FROM suppliers))`,
    );

    // PASS 2: Insert duplicate suppliers for mixed-source (auto-increment gives new IDs)
    for (const row of rows) {
        const id = parseInt(getCol(row, columns, "id")!);
        const mixed = MIXED_SOURCE_SUPPLIERS[id];
        if (!mixed) continue;

        const name = getCol(row, columns, "name");
        const addresses = getCol(row, columns, "addresses");
        const country = getCol(row, columns, "country");
        const created_at = getCol(row, columns, "created_at");
        const updated_at = getCol(row, columns, "updated_at");
        const slug = getCol(row, columns, "slug");
        const newSlug = slug ? `${slug}-${mixed.newSource.toLowerCase()}` : null;

        const dupResult = await client.query(
            `INSERT INTO "suppliers" ("name", "addresses", "country", "phone", "source", "created_at", "updated_at", "slug")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [
                `${name} (${mixed.newSource})`,
                addresses,
                country,
                null,   // phone unique → null
                mixed.newSource,
                created_at,
                updated_at,
                null,   // slug unique → null for duplicates
            ],
        );

        const newId = dupResult.rows[0].id;
        console.log(
            `   🔀 Duplikasi ID ${id} "${name}": ${mixed.keepSource}→ID${id}, ${mixed.newSource}→ID${newId}`,
        );

        supplierMapping.set(id, {
            local_id: mixed.keepSource === "LOCAL" ? id : newId,
            import_id: mixed.keepSource === "IMPORT" ? id : newId,
        });
    }

    console.log(`   ✓ suppliers: ${rows.length} original + ${Object.keys(MIXED_SOURCE_SUPPLIERS).length} duplicates`);
    console.log("✅ Suppliers done\n");
    return supplierMapping;
}

// ── STEP 3: raw_materials (tanpa dropped columns) ────────────────────────
async function restoreRawMaterials(
    client: pg.Client,
    backup: Map<string, BackupTable>,
) {
    console.log("📋 STEP 3: Restore raw_materials (without dropped columns)...");

    const { columns, rows } = backup.get("raw_materials")!;

    // Kolom yang ADA di dev schema (exclude: price, min_buy, supplier_id, lead_time, source)
    const devColumns = ["id", "barcode", "name", "min_stock", "unit_id", "raw_mat_categories_id", "created_at", "deleted_at", "updated_at", "type"];

    const mapped = rows.map((row) =>
        devColumns.map((col) => getCol(row, columns, col)),
    );

    await insertRows(client, "raw_materials", devColumns, mapped);
    console.log(`   ✓ raw_materials: ${rows.length} rows (dropped: price, min_buy, supplier_id, lead_time, source)`);
    console.log("✅ raw_materials done\n");
}

// ── STEP 4: Build supplier_materials dari backup ─────────────────────────
async function buildSupplierMaterials(
    client: pg.Client,
    backup: Map<string, BackupTable>,
    supplierMapping: SupplierMapping,
) {
    console.log("📋 STEP 4: Build supplier_materials from backup data...");

    const { columns, rows } = backup.get("raw_materials")!;

    let count = 0;
    const smRows: any[][] = [];

    for (const row of rows) {
        const rmId = parseInt(getCol(row, columns, "id")!);
        const supplierId = getCol(row, columns, "supplier_id");
        const price = getCol(row, columns, "price");
        const minBuy = getCol(row, columns, "min_buy");
        const leadTime = getCol(row, columns, "lead_time");
        const source = getCol(row, columns, "source") ?? "LOCAL";

        if (!supplierId || supplierId === "\\N") continue;

        const originalSupplierId = parseInt(supplierId);
        const mapping = supplierMapping.get(originalSupplierId);

        let resolvedSupplierId: number;
        if (mapping) {
            resolvedSupplierId = source === "LOCAL" ? mapping.local_id : mapping.import_id;
        } else {
            resolvedSupplierId = originalSupplierId;
        }

        const now = new Date().toISOString();
        smRows.push([
            resolvedSupplierId,
            rmId,
            price ?? "0",
            minBuy,
            leadTime,
            true,   // is_preferred
            "ACTIVE",
            now,    // created_at
            now,    // updated_at
        ]);
        count++;
    }

    await insertRows(
        client,
        "supplier_materials",
        ["supplier_id", "raw_material_id", "unit_price", "min_buy", "lead_time", "is_preferred", "status", "created_at", "updated_at"],
        smRows,
    );

    console.log(`   ✓ supplier_materials: ${count} rows built`);
    console.log("✅ supplier_materials done\n");
}

// ── STEP 5: Tabel yang bergantung pada raw_materials + suppliers ──────────
async function restoreDependentTables(
    client: pg.Client,
    backup: Map<string, BackupTable>,
) {
    console.log("📋 STEP 5: Restore dependent tables...");

    const dependentOrder = [
        "raw_material_inventories",
        "raw_material_open_pos",
        "raw_material_need_overrides",
        "product_inventories",
        "product_issuances",
        "forecasts",
        "safety_stock",
        "recipes",
        "material_purchase_drafts",
        "production_orders",
        "goods_receipts",
        "stock_transfers",
    ];

    for (const tableName of dependentOrder) {
        const table = backup.get(tableName);
        if (!table) {
            console.log(`   ⚠️  ${tableName}: not found, skip`);
            continue;
        }
        await insertRows(client, tableName, table.columns, table.rows);
        console.log(`   ✓ ${tableName}: ${table.rows.length} rows`);
    }

    // production_order_items: columns changed (named relation, + nullable cols)
    // Backup columns: (id, production_order_id, raw_material_id, warehouse_id, quantity_planned, quantity_actual, created_at, updated_at)
    // Dev schema: same columns + substitute_raw_material_id, override_reason (both nullable, not in backup)
    const poItems = backup.get("production_order_items");
    if (poItems) {
        await insertRows(client, "production_order_items", poItems.columns, poItems.rows);
        console.log(`   ✓ production_order_items: ${poItems.rows.length} rows`);
    }

    // production_order_wastes: same logic
    // Backup: (id, production_order_id, waste_type, raw_material_id, product_id, warehouse_id, quantity, notes, created_at)
    // Dev: same + returned_at, returned_by (nullable, not in backup)
    const poWastes = backup.get("production_order_wastes");
    if (poWastes) {
        await insertRows(client, "production_order_wastes", poWastes.columns, poWastes.rows);
        console.log(`   ✓ production_order_wastes: ${poWastes.rows.length} rows`);
    }

    // Tables depending on above
    const finalOrder = [
        "goods_receipt_items",
        "stock_transfer_items",
        "stock_transfer_photos",
        "stock_returns",
        "stock_return_items",
        "stock_movements",
    ];

    for (const tableName of finalOrder) {
        const table = backup.get(tableName);
        if (!table) {
            console.log(`   ⚠️  ${tableName}: not found, skip`);
            continue;
        }
        await insertRows(client, tableName, table.columns, table.rows);
        console.log(`   ✓ ${tableName}: ${table.rows.length} rows`);
    }

    console.log("✅ Dependent tables done\n");
}

// ── STEP 6: Reset sequences ──────────────────────────────────────────────
async function resetSequences(client: pg.Client) {
    console.log("📋 STEP 6: Reset PostgreSQL sequences...");

    const sequences = [
        { table: "accounts", col: "id", seq: "accounts_id_seq" },
        { table: "addresses", col: "id", seq: "addresses_id_seq" },
        { table: "email_verifies", col: "id", seq: "email_verifies_id_seq" },
        { table: "suppliers", col: "id", seq: "suppliers_id_seq" },
        { table: "raw_materials", col: "id", seq: "raw_materials_id_seq" },
        { table: "supplier_materials", col: "id", seq: "supplier_materials_id_seq" },
        { table: "warehouses", col: "id", seq: "warehouses_id_seq" },
        { table: "products", col: "id", seq: "products_id_seq" },
        { table: "product_inventories", col: "id", seq: "product_inventories_id_seq" },
        { table: "raw_material_inventories", col: "id", seq: "raw_material_inventories_id_seq" },
        { table: "raw_material_open_pos", col: "id", seq: "raw_material_open_pos_id_seq" },
        { table: "raw_material_need_overrides", col: "id", seq: "raw_material_need_overrides_id_seq" },
        { table: "material_purchase_drafts", col: "id", seq: "material_purchase_drafts_id_seq" },
        { table: "production_orders", col: "id", seq: "production_orders_id_seq" },
        { table: "production_order_items", col: "id", seq: "production_order_items_id_seq" },
        { table: "production_order_wastes", col: "id", seq: "production_order_wastes_id_seq" },
        { table: "goods_receipts", col: "id", seq: "goods_receipts_id_seq" },
        { table: "goods_receipt_items", col: "id", seq: "goods_receipt_items_id_seq" },
        { table: "stock_transfers", col: "id", seq: "stock_transfers_id_seq" },
        { table: "stock_transfer_items", col: "id", seq: "stock_transfer_items_id_seq" },
        { table: "stock_transfer_photos", col: "id", seq: "stock_transfer_photos_id_seq" },
        { table: "stock_returns", col: "id", seq: "stock_returns_id_seq" },
        { table: "stock_return_items", col: "id", seq: "stock_return_items_id_seq" },
        { table: "stock_movements", col: "id", seq: "stock_movements_id_seq" },
        { table: "outlets", col: "id", seq: "outlets_id_seq" },
        { table: "outlet_warehouses", col: "id", seq: "outlet_warehouses_id_seq" },
        { table: "outlet_inventories", col: "id", seq: "outlet_inventories_id_seq" },
        { table: "recipes", col: "id", seq: "recipes_id_seq" },
        { table: "forecasts", col: "id", seq: "forecasts_id_seq" },
        { table: "forecasts_percentages", col: "id", seq: "forecasts_percentages_id_seq" },
        { table: "safety_stock", col: "id", seq: "safety_stock_id_seq" },
        { table: "product_issuances", col: "id", seq: "product_issuances_id_seq" },
        { table: "unit_raw_materials", col: "id", seq: "unit_raw_materials_id_seq" },
        { table: "raw_mat_categories", col: "id", seq: "raw_mat_categories_id_seq" },
        { table: "logging_activities", col: "id", seq: "logging_activities_id_seq" },
        { table: "email_verifies", col: "id", seq: "email_verifies_id_seq" },
    ];

    for (const { table, col, seq } of sequences) {
        try {
            await client.query(
                `SELECT setval('${seq}', COALESCE((SELECT MAX("${col}") FROM "${table}"), 1))`,
            );
        } catch {
            // Sequence might not exist or have different name — skip
        }
    }

    // Reset suppliers sequence specifically (we added new rows)
    await client.query(
        `SELECT setval(pg_get_serial_sequence('"suppliers"', 'id'), COALESCE((SELECT MAX(id) FROM suppliers), 1))`,
    );

    console.log("✅ Sequences reset done\n");
}

// ── STEP 7: Verify ──────────────────────────────────────────────────────
async function verify(client: pg.Client) {
    console.log("📋 STEP 7: Verify row counts...");

    const tables = [
        "suppliers", "supplier_materials", "raw_materials",
        "products", "recipes", "warehouses",
        "production_orders", "production_order_items", "production_order_wastes",
        "material_purchase_drafts", "raw_material_open_pos",
        "stock_transfers", "stock_transfer_items",
        "forecasts", "safety_stock",
    ];

    for (const t of tables) {
        const res = await client.query(`SELECT COUNT(*) FROM "${t}"`);
        console.log(`   ${t}: ${res.rows[0].count} rows`);
    }

    // Check supplier source distribution
    const srcDist = await client.query(
        `SELECT source, COUNT(*) FROM suppliers GROUP BY source`,
    );
    console.log("\n   Supplier source distribution:");
    for (const r of srcDist.rows) {
        console.log(`     ${r.source}: ${r.count}`);
    }

    // Check supplier_materials
    const smCheck = await client.query(
        `SELECT COUNT(*) as total, COUNT(CASE WHEN is_preferred THEN 1 END) as preferred FROM supplier_materials`,
    );
    console.log(`\n   supplier_materials: ${smCheck.rows[0].total} total, ${smCheck.rows[0].preferred} preferred`);

    console.log("✅ Verify done\n");
}

// ── MAIN ─────────────────────────────────────────────────────────────────
async function main() {
    console.log("🚀 MIGRATION: main schema → dev schema\n");
    console.log("⚠️  PASTIKAN prisma db push --force-reset sudah dijalankan!\n");

    if (!fs.existsSync(BACKUP_FILE)) {
        console.error(`❌ Backup file tidak ditemukan: ${BACKUP_FILE}`);
        process.exit(1);
    }

    const backup = parseBackup(BACKUP_FILE);

    const client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    console.log("🔗 Connected to database\n");

    try {
        // Phase 1: Bulk insert dalam satu transaction
        await client.query("SET session_replication_role = replica");
        await client.query("BEGIN");

        await restoreDirectTables(client, backup);
        const supplierMapping = await restoreSuppliers(client, backup);
        await restoreRawMaterials(client, backup);
        await buildSupplierMaterials(client, backup, supplierMapping);
        await restoreDependentTables(client, backup);

        await client.query("COMMIT");
        await client.query("SET session_replication_role = DEFAULT");
        console.log("✅ All data committed\n");

        // Phase 2: Reset sequences SETELAH commit (di luar transaction)
        await resetSequences(client);

        // Phase 3: Verify
        await verify(client);

        console.log("🎉 MIGRATION SELESAI!");
        console.log("\nNext steps:");
        console.log("  1. Deploy API dari branch main (post-merge)");
        console.log("  2. Test endpoint: GET /rawmat, GET /supplier, GET /consolidation");
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        await client.query("SET session_replication_role = DEFAULT").catch(() => {});
        console.error("❌ MIGRATION FAILED:", err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

main();
