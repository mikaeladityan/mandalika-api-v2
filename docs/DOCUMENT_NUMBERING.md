# 🔢 Document Numbering

Format penomoran dokumen otomatis. Helper: `src/lib/utils/generate-number.ts`.

---

## 1. Format Umum

```
<PREFIX>-YYYYMMDD-NNN
```

- `YYYYMMDD` = tanggal sistem saat dokumen dibuat.
- `NNN` = sequence harian, pad 3 digit (`001`, `002`, ...).
  > Sequence dihitung dari `prisma.<model>.count({ where: { <field>: { startsWith: prefix } } })`. Sederhana, **bukan strict-atomic** — untuk insert paralel sangat tinggi pertimbangkan beralih ke sequence DB native.

---

## 2. Daftar Prefix

| Dokumen              | Helper                  | Model Prisma         | Field               | Contoh               |
| :------------------- | :---------------------- | :------------------- | :------------------ | :------------------- |
| Request For Quotation| `generateRFQNumber`     | `PurchaseRFQ`        | `rfq_number`        | `RFQ-20260513-001`   |
| Purchase Order       | `generatePONumber`      | `PurchaseOrder`      | `po_number`         | `PO-20260513-001`    |
| Purchase Receipt     | `generateReceiptNumber` | `PurchaseReceipt`    | `receipt_number`    | `RCV-RM-20260513-001`|
| Vendor Return        | `generateReturnNumber`  | `VendorReturn`       | `return_number`     | `RTN-20260513-001`   |
| Account Payable      | `generateAPNumber`      | `AccountPayable`     | `ap_number`         | `AP-20260513-001`    |
| Account Receivable   | `generateARNumber`      | `AccountReceivable`  | `ar_number`         | `AR-20260513-001`    |
| Cash Entry           | `generateCashNumber`    | `CashEntry`          | `cash_number`       | `CB-20260513-001`    |
| Journal Voucher      | `generateJournalNumber` | `JournalEntry`       | `journal_number`    | `JV-20260513-001`    |

> Manufacturing menggunakan format **bulanan**: `MFG-YYYYMM-XXXX` (lihat modul Manufacturing — generator ada di service, bukan di `generate-number.ts`).

> Inventory V2 (GR/DO/TG/RET) menggunakan random suffix (lihat `docs/TODO.md` di root — Phase 4 P4.1 rencana migrasi ke sequence `TRF-YYYYMM-0001`).

---

## 3. Contoh Pemakaian

```ts
import {
    generateRFQNumber,
    generatePONumber,
    generateReceiptNumber,
} from "../../../lib/utils/generate-number.js";
import prisma from "../../../config/prisma.js";

const rfqNumber = await generateRFQNumber(prisma);
const poNumber  = await generatePONumber(prisma);
const rcvNumber = await generateReceiptNumber(prisma);

await prisma.purchaseRFQ.create({
    data: { rfq_number: rfqNumber, vendor_id, items: { create: items } },
});
```

Parameter `db` boleh `prisma` global atau `tx` (transaction client) — interface `DocNumberClient` cukup punya `count` per model. Untuk generate **di dalam transaksi**, pass `tx`:

```ts
await prisma.$transaction(async (tx) => {
    const poNumber = await generatePONumber(tx as any);
    await tx.purchaseOrder.create({ data: { po_number: poNumber, ... } });
});
```

---

## 4. Race Condition

Karena algoritma = `count + 1`, ada peluang dua transaksi paralel menghasilkan nomor sama.

**Mitigasi singkat**:
- DB punya `@unique` di field `*_number` → insert kedua gagal `P2002`.
- Service retry sekali (atau biarkan client retry).

**Mitigasi proper** (future): pakai `prisma.$queryRaw\`SELECT nextval('seq_rfq')\`` atau advisory lock `pg_advisory_xact_lock`. Lihat issue tracker / `docs/TODO.md`.

---

## 5. Reset Sequence

Sequence reset otomatis setiap hari karena prefix berisi tanggal. Tidak ada cron khusus.

Jika ingin **rebuild ulang**: hapus record dengan prefix tanggal target lalu insert ulang — atau jalankan migrasi backfill manual.

---

## 6. Konvensi Field

- Tipe field SQL: `VARCHAR(50)` atau `VARCHAR(100)`.
- `@unique` di schema Prisma agar enforce uniqueness.
- Index gabungan: `@@index([<field>, status])` untuk filter list cepat.

```prisma
model PurchaseRFQ {
  id          Int      @id @default(autoincrement())
  rfq_number  String   @unique @db.VarChar(50)
  // ...
  @@index([rfq_number])
}
```

---

_Lihat juga: [`modules/purchasing.md`](./modules/purchasing.md), [`modules/finance.md`](./modules/finance.md)._
