import { normalizeSlug } from "../index.js";

// reason: subset delegate untuk lookup table slug-based (mis. UnitRawMaterial, RawMatCategories,
// ProductType, Unit) — pola atomic upsert yang dipakai oleh modul FG & RM.
export type UpsertSlugDelegate = {
    upsert: (args: {
        where: { slug: string };
        update: Record<string, never>;
        create: { name: string; slug: string };
        select: { id: true };
    }) => Promise<{ id: number }>;
};

export async function getOrCreateSlug(
    model: UpsertSlugDelegate,
    name: string,
): Promise<number> {
    const formatted = name.trim();
    const slug = normalizeSlug(formatted);
    const result = await model.upsert({
        where: { slug },
        update: {},
        create: { name: formatted, slug },
        select: { id: true },
    });
    return result.id;
}
