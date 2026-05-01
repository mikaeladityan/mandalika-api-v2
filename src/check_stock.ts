
import { PrismaClient } from '../api/src/generated/prisma/client.ts';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), 'api/.env') });

const prisma = new PrismaClient();

async function main() {
    try {
        console.log("--- WAREHOUSES ---");
        const warehouses = await prisma.warehouse.findMany({
            select: { id: true, code: true, name: true, type: true }
        });
        console.table(warehouses);

        console.log("\n--- RECENT RAW MATERIAL INVENTORIES ---");
        const inventories = await prisma.rawMaterialInventory.findMany({
            take: 10,
            orderBy: { created_at: 'desc' },
            include: {
                raw_material: { select: { name: true, barcode: true } },
                warehouse: { select: { code: true } }
            }
        });
        console.table(inventories.map(i => ({
            rm: i.raw_material.name,
            wh: i.warehouse.code,
            qty: i.quantity,
            period: `${i.month}/${i.year}`
        })));

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
