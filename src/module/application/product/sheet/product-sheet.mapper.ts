import { Prisma } from "../../../../generated/prisma/client.js";

export type ProductWithSheetRelations = Prisma.ProductGetPayload<{
    include: {
        product_type: { select: { name: true } };
        unit: { select: { name: true } };
        size: { select: { size: true } };
    };
}>;

export function productToRow(p: ProductWithSheetRelations): string[] {
    return [
        p.code ?? "",
        p.name,
        p.product_type?.name ?? "",
        p.gender ?? "UNISEX",
        p.size?.size != null ? String(p.size.size) : "",
        p.unit?.name ?? "",
        p.distribution_percentage != null ? String(p.distribution_percentage) : "0",
        p.safety_percentage != null ? String(p.safety_percentage) : "0",
    ];
}
