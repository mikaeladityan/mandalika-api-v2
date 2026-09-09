import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { DiscontinueAnchorKey, DiscontinueNeed, SaveDiscontinueAnchor } from "./discontinue.schema.js";

type RecipeRequirement = {
    product_id: number;
    material_id: number;
    material_name: string;
    quantity: Prisma.Decimal;
};

type Anchor = {
    product_id: number;
    anchor_material_id: number;
    quantity: Prisma.Decimal;
};

// Keep calculations in decimal arithmetic; round only the final RM quantity.
export function calculateDiscontinueNeeds(recipes: RecipeRequirement[], anchors: Anchor[]): DiscontinueNeed[] {
    const anchorByProduct = new Map(anchors.map((anchor) => [anchor.product_id, anchor]));
    const requirementByMaterial = new Map(recipes.map((recipe) => [`${recipe.product_id}_${recipe.material_id}`, recipe]));
    return recipes.map((recipe) => {
        const anchor = anchorByProduct.get(recipe.product_id);
        const anchorRecipe = anchor && requirementByMaterial.get(`${recipe.product_id}_${anchor.anchor_material_id}`);
        const valid = !!anchorRecipe && anchorRecipe.quantity.gt(0) && recipe.quantity.gt(0);
        const equivalentFg = anchor && anchorRecipe && valid ? anchor.quantity.div(anchorRecipe.quantity) : null;
        return {
            product_id: recipe.product_id,
            material_id: recipe.material_id,
            recipe_quantity: recipe.quantity.toNumber(),
            total_needed: equivalentFg ? equivalentFg.mul(recipe.quantity).toDecimalPlaces(8).toNumber() : 0,
            anchor_material_id: anchor?.anchor_material_id ?? null,
            anchor_quantity: anchor?.quantity.toNumber() ?? null,
            anchor_material_name: anchorRecipe?.material_name ?? null,
            equivalent_fg: equivalentFg?.toDecimalPlaces(8).toNumber() ?? null,
            anchor_valid: !anchor || valid,
        };
    });
}

export class DiscontinueService {
    static async recipes(productIds: number[], db: Prisma.TransactionClient = prisma): Promise<RecipeRequirement[]> {
        if (!productIds.length) return [];
        return db.$queryRaw<RecipeRequirement[]>(Prisma.sql`
            SELECT r.product_id, r.raw_mat_id AS material_id, rm.name AS material_name,
                SUM(r.quantity * CASE WHEN r.use_size_calc THEN COALESCE(ps.size, 1) ELSE 1 END
                    * CASE WHEN rm.barcode = 'KA-0.6MM' THEN 5000::numeric / 14000
                           WHEN rm.barcode = 'KA-0.4MM' THEN (144::numeric * 5000) / 2946120
                           ELSE 1 END)::numeric AS quantity
            FROM recipes r
            JOIN products p ON p.id = r.product_id AND p.status = 'PENDING' AND p.deleted_at IS NULL
            JOIN raw_materials rm ON rm.id = r.raw_mat_id AND rm.deleted_at IS NULL
            LEFT JOIN product_size ps ON ps.id = p.size_id
            WHERE r.product_id IN (${Prisma.join(productIds)}) AND r.is_active = true
                AND rm.barcode IS DISTINCT FROM 'FO-ALK'
            GROUP BY r.product_id, r.raw_mat_id, rm.name
        `);
    }

    static async needs(productIds: number[], month: number, year: number): Promise<DiscontinueNeed[]> {
        if (!productIds.length) return [];
        const [recipes, anchors] = await Promise.all([
            this.recipes(productIds),
            prisma.discontinueNeedAnchor.findMany({ where: { product_id: { in: productIds }, month, year } }),
        ]);
        return calculateDiscontinueNeeds(recipes, anchors);
    }

    static async save(body: SaveDiscontinueAnchor) {
        return prisma.$transaction(async (tx) => {
            const recipes = await this.recipes([body.product_id], tx);
            const anchorRecipe = recipes.find((recipe) => recipe.material_id === body.anchor_material_id);
            if (!anchorRecipe || !anchorRecipe.quantity.gt(0)) {
                throw new ApiError(400, "RM acuan harus memiliki recipe aktif dengan kebutuhan positif untuk FG Discontinue ini.");
            }
            const anchor = await tx.discontinueNeedAnchor.upsert({
                where: { product_id_month_year: { product_id: body.product_id, month: body.month, year: body.year } },
                create: { ...body, quantity: new Prisma.Decimal(body.quantity) },
                update: { anchor_material_id: body.anchor_material_id, quantity: new Prisma.Decimal(body.quantity) },
            });
            return calculateDiscontinueNeeds(recipes, [anchor]);
        });
    }

    static async reset(key: DiscontinueAnchorKey) {
        await prisma.discontinueNeedAnchor.deleteMany({ where: key });
        return { reset: true };
    }
}
