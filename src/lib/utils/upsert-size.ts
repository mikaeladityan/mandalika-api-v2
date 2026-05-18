import { Prisma } from "../../generated/prisma/client.js";

// reason: atomic upsert helper untuk ProductSize — dipakai oleh modul FG (create/update)
// dan FG Import (bulk insert). Pola mirroring getOrCreateSlug di upsert-slug.ts.
export async function getOrCreateSize(
    tx: Prisma.TransactionClient,
    size: number,
): Promise<number> {
    const result = await tx.productSize.upsert({
        where: { size },
        update: {},
        create: { size },
        select: { id: true },
    });
    return result.id;
}
