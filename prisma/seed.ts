import prisma from "../src/config/prisma.js";

// async function seedRecipes() {
//     console.log("🌱 Cleaning up Forecast data...");
//     try {
//         const minQty = 1;
//         const findRecipe = await prisma.recipes.updateMany({
//             where: { quantity: { gte: minQty } },
//             data: { use_size_calc: false },
//         });
//         console.log(`✅ Found ${findRecipe.count} recipes.`);
//     } catch (error) {
//         console.error("❌ Cleanup failed:", error);
//         throw error;
//     }
// }

async function seedSupplierSource() {
    console.log("🌱 Migrating source from raw_materials → suppliers...");

    try {
        // Aggregate: per supplier, collect all distinct source values from its raw materials.
        // Priority: if any raw material is IMPORT → supplier becomes IMPORT, else LOCAL.
        const rawMaterials = await prisma.rawMaterial.findMany({
            where: {
                supplier_id: { not: null },
            },
            select: {
                supplier_id: true,
                source: true,
            },
        });

        // Group by supplier_id, pick IMPORT if any row is IMPORT
        const supplierSourceMap = new Map<number, "LOCAL" | "IMPORT">();
        for (const rm of rawMaterials) {
            if (rm.supplier_id === null) continue;
            const current = supplierSourceMap.get(rm.supplier_id);
            if (current === "IMPORT") continue; // already escalated
            supplierSourceMap.set(rm.supplier_id, rm.source as "LOCAL" | "IMPORT");
        }

        if (supplierSourceMap.size === 0) {
            console.log("⚠️  No raw materials with supplier_id found. Nothing to migrate.");
            return;
        }

        let updated = 0;
        for (const [supplierId, source] of supplierSourceMap.entries()) {
            await prisma.supplier.update({
                where: { id: supplierId },
                data: { source },
            });
            updated++;
        }

        console.log(`✅ Updated source for ${updated} suppliers.`);
    } catch (error) {
        console.error("❌ Migration failed:", error);
        throw error;
    }
}

seedSupplierSource()
    .catch((err) => {
        console.error("❌ Seeding failed:", err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
