import { Prisma } from "../../../../generated/prisma/client.js";

export type ProductWithSheetRelations = Prisma.ProductGetPayload<{
    include: {
        product_type: { select: { name: true } };
        unit: { select: { name: true } };
        size: { select: { size: true } };
    };
}>;

/**
 * Returns 8 cells matching the FG sheet column layout B–I:
 *   CODE | SAFETY % | NAME | TYPE | GENDER | SIZE | UOM | DISTRIBUTION %
 *
 * Column A (UID) is reserved for an external linked-sheet workflow and is
 * intentionally NOT touched by sync — neither read nor written.
 *
 * Percentages are written as the raw Decimal value from DB. If the sheet
 * convention differs (e.g. DB stores 0.50 but sheet expects 50), multiply
 * here.
 */
export function productToRow(p: ProductWithSheetRelations): string[] {
    return [
        p.code ?? "",
        p.safety_percentage != null ? String(p.safety_percentage) : "0",
        p.name,
        p.product_type?.name ?? "",
        p.gender ?? "UNISEX",
        p.size?.size != null ? String(p.size.size) : "",
        p.unit?.name ?? "",
        p.distribution_percentage != null ? String(p.distribution_percentage) : "0",
    ];
}
