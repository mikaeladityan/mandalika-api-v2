import prisma from "../../../../../../config/prisma.js";
import { Prisma } from "../../../../../../generated/prisma/client.js";
import type { FGImportPreviewDTO } from "../import.schema.js";

export type MasterMaps = {
    typeIds: Map<string, number>;
    sizeIds: Map<number, number>;
};

export async function bulkUpsertProducts(
    chunk: FGImportPreviewDTO[],
    maps: MasterMaps,
): Promise<number> {
    if (!chunk.length) return 0;

    const values = chunk.map((row) => {
        const typeId = row.type ? maps.typeIds.get(row.type) ?? null : null;
        const sizeId = row.size > 0 ? maps.sizeIds.get(row.size) ?? null : null;
        return Prisma.sql`(
            ${row.code},
            ${row.name},
            ${row.gender}::"GENDER",
            ${typeId},
            ${sizeId},
            ${row.distribution_percentage},
            ${row.safety_percentage},
            'ACTIVE'::"STATUS",
            NOW(),
            NOW()
        )`;
    });

    return prisma.$executeRaw`
        INSERT INTO "products" (
            code, name, gender, type_id, size_id,
            distribution_percentage, safety_percentage, status,
            created_at, updated_at
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT (code) DO UPDATE SET
            name = EXCLUDED.name,
            gender = EXCLUDED.gender,
            type_id = EXCLUDED.type_id,
            size_id = EXCLUDED.size_id,
            distribution_percentage = EXCLUDED.distribution_percentage,
            safety_percentage = EXCLUDED.safety_percentage,
            updated_at = NOW()
    `;
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}
