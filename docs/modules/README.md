# 📘 Module Docs Index

Dokumentasi per modul backend ERP Mandalika. Untuk overview arsitektur global, lihat [`../ARCHITECTURE.md`](../ARCHITECTURE.md). Untuk endpoint map lengkap, lihat [`../API_REFERENCE.md`](../API_REFERENCE.md).

| Modul                                                       | Path API                                       |
| :---------------------------------------------------------- | :--------------------------------------------- |
| [Auth](./auth.md)                                           | `/api/auth`                                    |
| [Global](./global.md)                                       | `/api/global/*`                                |
| [Product](./product.md)                                     | `/api/app/products`                            |
| [Raw Material](./rawmat.md)                                 | `/api/app/rawmat`                              |
| [Warehouse](./warehouse.md)                                 | `/api/app/warehouses`                          |
| [Outlet](./outlet.md)                                       | `/api/app/outlets`                             |
| [Recipe & BOM](./recipe-bom.md)                             | `/api/app/recipes`, `/api/app/bom`             |
| [Issuance](./issuance.md)                                   | `/api/app/product-issuance`                    |
| [Forecast](./forecast.md)                                   | `/api/app/forecasts`                           |
| [Recommendation V2 + Consolidation](./recommendation.md)    | `/api/app/recomendations-v2`, `/consolidation` |
| [Stock Legacy V1 + Movement Audit](./stock-legacy.md)       | `/api/app/stock-transfers`, `/stock-movements` |
| [Inventory V2 (GR/DO/TG/Return/Monitoring)](./inventory-v2.md) | `/api/app/inventory-v2/*`                   |
| [Manufacturing](./manufacturing.md)                         | `/api/app/manufacturing`                       |
| [Purchasing (RFQ/PO/Receipt/Tracking/Vendor Return)](./purchasing.md) | `/api/app/purchase/*`                |
| [Finance (AP/AR/Cash/Journal/KPI)](./finance.md)            | `/api/app/finance/*`                           |

---

## Konvensi Lintas Modul

Lihat [`../CONVENTIONS.md`](../CONVENTIONS.md) untuk:
- Module pattern (route → controller → service → schema).
- Response shape (`{ status, data, query? }`).
- Zod validation (`validateBody` middleware).
- Error throwing (`ApiError`, kelas turunan).
- Penomoran dokumen (`generate-number.ts`).
- Pola transaksi inventaris.
