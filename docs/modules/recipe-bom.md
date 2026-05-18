# 🧾 Module: Recipe & BOM

**Path**: `/api/app/recipes`, `/api/app/bom`
**Source**: `src/module/application/recipe/`, `src/module/application/bom/`

Recipe = formula bahan baku untuk 1 produk. BOM = preview kebutuhan agregat untuk produksi.

---

## 1. Recipe

| Method | Path           | Catatan                                |
| :----- | :------------- | :------------------------------------- |
| GET    | `/recipes/`    | List recipe                            |
| POST   | `/recipes/`    | Upsert (`RequestRecipeSchema`)         |
| DELETE | `/recipes/`    | Delete (`RequestDeleteRecipeSchema`)   |
| GET    | `/recipes/:id` | Detail                                 |
| GET    | `/recipes/export` | Export Excel                         |
| —      | `/recipes/import/...` | Sub-modul import CSV/Excel        |

`Recipes` model:
- `product_id` × `raw_material_id` unik per pair.
- `quantity` (Decimal) = jumlah RM per 1 produk.
- Untuk paper Absorb 0.4MM: quantity = `1/144` per pcs (lihat [`rumus_kertas.md`](../../../docs/rumus_kertas.md)).

### Upsert (`POST /`)

Service `upsert` menerima array recipe item dan menulis dengan `upsert(create/update)` per `(product_id, raw_material_id)`.

---

## 2. BOM Preview

| Method | Path        | Catatan                              |
| :----- | :---------- | :----------------------------------- |
| GET    | `/bom/`     | List BOM agregat (multiple produk)   |
| GET    | `/bom/:id`  | Detail untuk satu produk             |

BOM bersifat read-only — aggregator dari `Recipes` + `RawMaterial`.

---

## Integrasi

- **Manufacturing** menggunakan BOM untuk allocate raw material saat `PLANNING → RELEASED`.
- **Recommendation V2** menggunakan BOM untuk hitung kebutuhan procurement.
- **Forecast** mengkonsumsi BOM untuk proyeksi RM 6-12 bulan ke depan.
