import prisma from "../src/config/prisma.js";

async function main() {
    console.log("✅ Seed: nothing to do. Source migration is handled in migration SQL.");
}

main()
    .catch((err) => {
        console.error("❌ Seeding failed:", err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
