# 🤖 Module: Recommendation V2 + Consolidation

**Path**: `/api/app/recomendations-v2`, `/api/app/consolidation`
**Source**: `src/module/application/recomendation-v2/`, `src/module/application/consolidation/`

Mesin rekomendasi pembelian bahan baku berdasarkan stok terkini, lead time, BOM, dan forecast.

---

## 1. Recommendation V2 — `/recomendations-v2`

| Method | Path                       | Catatan                                   |
| :----- | :------------------------- | :---------------------------------------- |
| GET    | `/`                        | List rekomendasi (per RM x periode)       |
| GET    | `/export`                  | Export Excel                              |
| GET    | `/open-po`                 | List open PO cells (kuantitas reserved)   |
| POST   | `/open-po`                 | Create open PO cell                       |
| PATCH  | `/open-po/:itemId`         | Update qty open PO                        |
| DELETE | `/open-po/:itemId`         | Hapus open PO cell                        |
| POST   | `/order`                   | Save Work Order (draft)                   |
| POST   | `/approve`                 | Approve Work Order                        |
| POST   | `/bulk-horizon`            | Set horizon planning massal               |
| POST   | `/need-override`           | Override kebutuhan per cell               |
| DELETE | `/need-override`           | Hapus override                            |
| PATCH  | `/moq`                     | Update MOQ supplier                       |
| PATCH  | `/hide`                    | Bulk toggle visibility row                |
| GET    | `/suppliers`               | Daftar supplier kandidat per material     |
| DELETE | `/:id`                     | Hapus Work Order                          |

Model utama: `MaterialPurchaseDraft`, `RawMaterialOpenPo`, `RawMaterialNeedOverride`, `SupplierMaterial`, `RecommendationStatus` (enum).

---

## 2. Consolidation — `/consolidation`

Grouping draft pembelian per supplier sebelum di-RFQ-kan.

| Method | Path           | Catatan                                |
| :----- | :------------- | :------------------------------------- |
| GET    | `/`            | List draft purchase                    |
| GET    | `/summary`     | Ringkasan per supplier (total nilai)   |
| GET    | `/export`      | Export Excel                           |
| PATCH  | `/bulk-status` | Bulk update status                     |

Status berubah otomatis saat draft di-convert ke RFQ (flag `In-RFQ`).

---

## Alur Lengkap (Procure-to-Pay)

```
Recommendation V2 → Save Draft → Consolidation → RFQ → PO → Receipt → AP
                                                                        ↓
                                                                  Cash Payment
```

Detail flow di [`./purchasing.md`](./purchasing.md).
