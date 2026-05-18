# 💰 Module: Finance

**Path**: `/api/app/finance`
**Source**: `src/module/application/finance/`

Hutang (AP), Piutang (AR), Kas (Cash), Jurnal (Journal), dan KPI dashboard. Selesai fase 6 (2026-05-13) — 60 tests pass.

---

## 1. Mount

```
/finance/ap          → FinanceAPRoutes
/finance/ar          → FinanceARRoutes
/finance/cash        → FinanceCashRoutes
/finance/journal     → FinanceJournalRoutes
/finance/kpi         → FinanceKpiRoutes
```

---

## 2. Account Payable — `/finance/ap`

Hutang ke vendor, lahir otomatis dari posting Purchase Receipt.

| Method | Path                | Catatan                              |
| :----- | :------------------ | :----------------------------------- |
| GET    | `/`                 | List (`QueryAPSchema`)               |
| GET    | `/:id`              | Detail                                |
| PATCH  | `/:id/payment`      | Record payment (`PayAPSchema`)        |

### Query (`QueryAPSchema`)

```ts
{
  page: 1, take: 50 (max 200),
  search?: string,
  status?: "UNPAID" | "DP_PAID" | "PARTIALLY_PAID" | "PAID",
  ap_type?: "DP" | "GOODS_RECEIPT" | "TERM" | "FULL",
  supplier_id?, po_id?, receipt_id?,
  month?: 1-12, year?: >=2000,
  sortBy?: "due_date" | "created_at" | "amount",
  order?: "asc" | "desc"
}
```

### Pay (`PayAPSchema`)

```ts
{
  paid_amount: number > 0,
  payment_date: string,
  payment_method: "TRANSFER" | "CASH" | "GIRO",
  bank_account?: string,
  invoice_number?, invoice_date?, due_date?, notes?
}
```

Service:
- Validasi `paid_amount <= outstanding_amount`.
- Update `paid_amount`, `outstanding_amount`, `status` (PARTIALLY_PAID/PAID).
- Auto-create `CashEntry` `OUT` + `JournalEntry` (Dr AP / Cr Cash).

Nomor: `AP-YYYYMMDD-NNN` (via `generateAPNumber`).

---

## 3. Account Receivable — `/finance/ar`

Piutang dari outlet/customer.

| Method | Path                | Catatan                              |
| :----- | :------------------ | :----------------------------------- |
| GET    | `/`                 | List                                 |
| POST   | `/`                 | Create (`CreateARSchema`)            |
| GET    | `/:id`              | Detail                                |
| PATCH  | `/:id/receipt`      | Record receipt (`ReceiveARSchema`)   |

Status: `ARStatus`. Partner type: `ARPartnerType` (OUTLET / CUSTOMER).
Nomor: `AR-YYYYMMDD-NNN`.

Receipt → auto-create `CashEntry` `IN` + `JournalEntry`.

---

## 4. Cash Book — `/finance/cash`

Pencatatan arus kas (IN/OUT).

| Method | Path             | Catatan                              |
| :----- | :--------------- | :----------------------------------- |
| GET    | `/`              | List                                  |
| POST   | `/`              | Create (`CreateCashSchema`)           |
| GET    | `/:id`           | Detail                                |
| PATCH  | `/:id/post`      | Posting                               |

Tipe: `CashEntryType` (IN / OUT).
Status: `CashEntryStatus` (DRAFT / POSTED).
Nomor: `CB-YYYYMMDD-NNN`.

---

## 5. Journal — `/finance/journal`

Jurnal manual (adjustment / opening balance / reklasifikasi).

| Method | Path             | Catatan                              |
| :----- | :--------------- | :----------------------------------- |
| GET    | `/`              | List                                  |
| POST   | `/`              | Create (`CreateJournalSchema`)        |
| GET    | `/:id`           | Detail                                |
| PATCH  | `/:id/post`      | Posting                               |

Status: `JournalStatus` (DRAFT / POSTED).
Nomor: `JV-YYYYMMDD-NNN`.

Double-entry: Dr & Cr balance saat posting.

---

## 6. KPI — `/finance/kpi`

| Method | Path | Catatan                                |
| :----- | :--- | :------------------------------------- |
| GET    | `/`  | Summary KPI                            |

Output (contoh, lihat `kpi.service.ts` untuk shape tepatnya):

```json
{
  "cash_on_hand": 0,
  "total_ap_outstanding": 0,
  "total_ar_outstanding": 0,
  "ap_aging": { "0-30": 0, "31-60": 0, "60+": 0 },
  "ar_aging": { ... },
  "monthly_cash_in_out": [...],
  "..."
}
```

---

## 7. Integrasi Lintas Modul

| Trigger                                | Side Effect Finance                                         |
| :------------------------------------- | :---------------------------------------------------------- |
| `POST /purchase/receipt/:id/post`      | Create `AccountPayable` (`AP-...`).                          |
| `PATCH /finance/ap/:id/payment`        | Create `CashEntry` OUT + `JournalEntry` (Dr AP, Cr Cash).    |
| Penjualan ke outlet (POS future)       | Create `AccountReceivable` (`AR-...`).                       |
| `PATCH /finance/ar/:id/receipt`        | Create `CashEntry` IN + `JournalEntry` (Dr Cash, Cr AR).     |
| Manual adjustment                      | Direct `JournalEntry`.                                       |

---

## 8. Payment Method

Enum `PaymentMethod` (di sini direpresentasikan sebagai literal di schema `PayAPSchema`):
- `TRANSFER`
- `CASH`
- `GIRO`

---

## 9. Test

Lokasi: `src/tests/finance/` — total 60 tests pass (lihat `MEMORY.md` Fase 6).
