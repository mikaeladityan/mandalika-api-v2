import { Prisma } from "../../../../generated/prisma/client.js";
import { RecomendationV2Service } from "../recomendation-v2.service.js";
import { QueryDiscontinueMaterialRecommendationDTO } from "./material-recommendation.schema.js";

type RecommendationRow = Awaited<ReturnType<typeof RecomendationV2Service.list>>["data"][number];

export function aggregateDiscontinueMaterialRows(rows: RecommendationRow[]) {
    const rowsByMaterial = new Map<number, RecommendationRow[]>();
    for (const row of rows) {
        const materialId = Number(row.material_id);
        rowsByMaterial.set(materialId, [...(rowsByMaterial.get(materialId) ?? []), row]);
    }

    return [...rowsByMaterial.entries()].map(([materialId, materialRows]) => {
        const first = materialRows[0]!;
        const finishedGoods = new Map<number, { id: number; code: string; name: string }>();
        const breakdown = [];
        let grossNeed = new Prisma.Decimal(0);

        for (const row of materialRows) {
            for (const fg of row.finished_goods) finishedGoods.set(fg.id, fg);
            const need = row.discontinue_anchor;
            const fg = row.finished_goods[0];
            if (!need?.anchor_valid || need.total_needed <= 0 || !fg) continue;
            grossNeed = grossNeed.plus(need.total_needed);
            breakdown.push({
                product_id: need.product_id,
                fg_code: fg.code,
                fg_name: fg.name,
                contribution_quantity: need.total_needed,
                anchor_material_id: need.anchor_material_id,
                anchor_material_name: need.anchor_material_name,
            });
        }

        const totalNeeded = grossNeed.toDecimalPlaces(8).toNumber();
        const recommendationQuantity = grossNeed.gt(0)
            ? Prisma.Decimal.max(0, grossNeed.minus(first.current_stock).minus(first.open_po)).toDecimalPlaces(8).toNumber()
            : 0;

        return {
            ...first,
            row_id: String(materialId),
            product_status: "PENDING" as const,
            finished_goods: [...finishedGoods.values()],
            discontinue_anchor: null,
            discontinue_breakdown: breakdown,
            total_needed_horizon: totalNeeded,
            recommendation_quantity: recommendationQuantity,
            general_recommendation_quantity: 0,
            discontinue_recommendation_quantity: recommendationQuantity,
            weight_kg: first.is_special_paper ? recommendationQuantity : undefined,
        };
    });
}

export class DiscontinueMaterialRecommendationService {
    static async list(query: QueryDiscontinueMaterialRecommendationDTO) {
        const source = await RecomendationV2Service.list({
            ...query,
            page: 1,
            take: 1_000_000,
            product_status: "PENDING",
        });
        const rows = aggregateDiscontinueMaterialRows(source.data);
        const skip = (query.page - 1) * query.take;
        return {
            ...source,
            data: rows.slice(skip, skip + query.take),
            len: rows.length,
        };
    }

    static async export(query: QueryDiscontinueMaterialRecommendationDTO) {
        const result = await this.list({ ...query, page: 1, take: 1_000_000 });
        const selectedIds = new Set(
            query.selectedIds?.split(",").map(Number).filter(Number.isFinite) ?? [],
        );
        const rows = selectedIds.size > 0
            ? result.data.filter((row) => selectedIds.has(Number(row.material_id)))
            : result.data;
        const escapeCsv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const csv = [
            ["Barcode", "Material", "FG Discontinue", "Total Need", "Current Stock", "Open PO", "Recommendation", "UOM"],
            ...rows.map((row) => [
                row.barcode,
                row.material_name,
                row.finished_goods.map((fg) => `${fg.code} - ${fg.name}`).join("; "),
                row.total_needed_horizon ?? 0,
                row.current_stock,
                row.open_po,
                row.recommendation_quantity,
                row.uom,
            ]),
        ].map((columns) => columns.map(escapeCsv).join(",")).join("\n");
        return Buffer.from(csv, "utf8");
    }
}
