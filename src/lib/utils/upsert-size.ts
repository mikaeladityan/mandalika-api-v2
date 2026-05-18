import { Prisma } from "../../generated/prisma/client.js";

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
