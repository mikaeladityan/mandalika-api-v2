---
name: frontend-ui-design
description: Use when membangun atau memodifikasi UI di Next.js app (`app/src/components/**`, `app/src/app/**`) — komponen visual baru, page layout, dialog, table, form, badge, KPI card, atau styling apapun yang harus konsisten dengan ERP Mandalika Gold/Zinc design system.
---

# ERP Mandalika — Frontend UI Design System

Canonical design language untuk seluruh frontend ERP. Sumber: `docs/UI_DESIGN_GUIDE.md` + pola Tailwind utility yang sudah hidup di `app/src/components/pages/**`.

**Filosofi:** Premium aesthetics (Gold + Deep Zinc), modular component, information density tinggi (compact data presentation).

---

## 1. Color Tokens

CSS variable resmi di `app/src/app/globals.css`. Selalu pakai token, **jangan hardcode hex** di komponen.

| Token / Class             | OKLCH (real)             | Hex referensi  | Pakai untuk                      |
| ------------------------- | ------------------------ | -------------- | -------------------------------- |
| `bg-primary`              | `oklch(0.77 0.15 86)`    | `#D4AF37` Gold | CTA utama, active state          |
| `bg-primary/10`           | —                        | —              | Soft highlight container         |
| `bg-sidebar`              | `oklch(0.18 0.02 236)`   | `#18181B` Zinc | Sidebar bg                       |
| `bg-background`           | `oklch(0.985 0.005 240)` | `#F8FAFC`      | Main app bg                      |
| `text-foreground`         | `oklch(0.12 0.02 260)`   | `#0F172A`      | Heading + body utama             |
| `text-muted-foreground`   | `oklch(0.45 0.02 240)`   | `#334155`      | Label, secondary text            |
| `border-border`           | `oklch(0.8 0.01 240)`    | —              | Default divider                  |
| `bg-destructive`          | `oklch(0.6 0.18 25)`     | —              | Destructive button/badge         |

**Semantic accent (Tailwind palette, dipakai konsisten di codebase):**

| Aksi / status     | Color family | Contoh class                                        |
| ----------------- | ------------ | --------------------------------------------------- |
| Success / save    | `emerald`    | `bg-emerald-600 hover:bg-emerald-700`, badge `emerald-50/200` |
| Edit / info       | `blue`       | `text-blue-600 hover:bg-blue-50 border-blue-200`    |
| Delete / overdue  | `red`        | `text-red-600 hover:bg-red-50 border-red-200`       |
| Warning / pending | `amber`      | `bg-amber-50 border-amber-200 text-amber-700`       |
| Trash mode toggle | `rose`       | `bg-rose-50 hover:bg-rose-100 text-rose-600`        |
| Neutral / draft   | `slate`      | `text-slate-500 bg-slate-50 border-slate-200`       |
| Reporting / extra | `purple`     | `bg-purple-100 text-purple-700`                     |

---

## 2. Typography

**Font keluarga aktual (jangan tulis Plus Jakarta — itu lama):**

| Token        | Nilai aktual                        | Pakai untuk                         |
| ------------ | ----------------------------------- | ----------------------------------- |
| `font-sans`  | `Poppins, sans-serif` (Next/font)   | Semua teks                          |
| `font-mono`  | `var(--font-geist-mono)`            | SKU, kode, AP/AR number, referensi  |

Loader: `Poppins` di-import dari `next/font/google` di `app/src/app/layout.tsx`.

**Skala ukuran (Tailwind class — wajib pakai ini, jangan custom px):**

| Use case                  | Class                                          |
| ------------------------- | ---------------------------------------------- |
| Heading section utama     | `text-2xl font-bold tracking-tight`            |
| Heading dialog/form       | `text-base font-bold text-slate-800`           |
| Body table cell utama     | `text-sm font-bold text-slate-800`             |
| Secondary cell text       | `text-zinc-500 text-sm`                        |
| Label form (UPPERCASE)    | `uppercase text-[10px] font-extrabold text-muted-foreground` |
| Label kategori KPI        | `text-[10px] font-black uppercase tracking-widest text-{color}-700` |
| Status badge text         | `text-[9px] font-black uppercase tracking-widest` |
| Table header              | `text-[9px] uppercase` (sticky, slate-50 bg)   |
| Helper / timestamp        | `text-[9px] text-slate-400`                    |
| Mono number (besar)       | `font-mono font-bold text-sm`                  |
| Mono number (kecil/code)  | `font-mono text-[9px] text-slate-400`          |

**Heading gradient (premium accent untuk section title):**

```tsx
<h2 className="text-2xl font-bold tracking-tight bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent">
    Accounts Payable
</h2>
```

---

## 3. Radius & Shadow

| Element              | Class                            | Catatan                           |
| -------------------- | -------------------------------- | --------------------------------- |
| Card / panel besar   | `rounded-xl` (≈18px)             | Default semua card                |
| Container highlight  | `rounded-xl` + `bg-{color}-50/200` border | KPI block, dialog header icon |
| Input / select       | radius dari shadcn (`rounded-md`)| Jangan override                   |
| Button standard      | `rounded-xl font-bold`           | Primary + secondary               |
| Button ikon kecil    | `h-8 w-8 p-0 rounded-xl`         | Row action, dropdown trigger      |
| Status badge / pill  | `rounded-full px-2 py-0.5`       | Status, tag, count chip           |
| Card shadow elevasi  | `shadow-[0_10px_20px_rgba(15,23,42,0.06)]` | Card utama          |
| Primary CTA shadow   | `shadow-lg shadow-primary/20`    | Tombol Save/Submit utama          |

---

## 4. Komponen Pattern (canonical)

Semua primitive di `@/components/ui/*` (shadcn). Form WAJIB pakai `@/components/ui/form/main.tsx` (lihat `frontend-dev-flow`).

### 4.1 Sidebar (`Sidebar.tsx`)

- Background `bg-sidebar` (Zinc 950).
- Item nav: `padding: 10px 13px`, `rounded-xl`.
- Active: `bg-gradient-to-r from-[rgba(212,175,55,0.24)] to-[rgba(212,175,55,0.08)] shadow-[inset_2px_0_0_#D4AF37]`.
- Hover: `hover:bg-white/5 hover:translate-x-[2px] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]`.

### 4.2 Card

- Default `<Card>` dari shadcn.
- Border `1px solid border-border`, padding `p-5`/`p-6`.
- Header card list page: `<CardHeader className="space-y-4">` — search + filter + actions.

### 4.3 Data Table

- Pakai `<DataTable>` dari `@/components/ui/table`.
- Header: sticky, `bg-slate-50`, text `text-[9px] uppercase`.
- Cell utama: `text-sm font-bold text-slate-800` (atau `font-mono` untuk kode).
- Sub-cell metadata: `text-[9px] text-slate-400` (timestamp, ref kecil).
- No vertical border. White-space nowrap dengan overflow control.
- Sortable header: komponen `<SortableHeader>`.

### 4.4 KPI Card (financial dashboard)

```tsx
<Card className="rounded-xl">
    <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div className="p-2 bg-emerald-100 rounded-xl"><Icon /></div>
        <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">+12%</span>
    </CardHeader>
    <CardContent>
        <div className="text-[10px] font-black uppercase tracking-widest text-emerald-700 mb-1">AR Outstanding</div>
        <div className="text-2xl font-bold tracking-tight">{formatCurrency(value)}</div>
        <div className="text-[10px] text-slate-500 mt-1">12 invoice belum dibayar</div>
    </CardContent>
</Card>
```

Aturan: ikon container `p-2 bg-{color}-100 rounded-xl`, label `text-[10px] font-black uppercase tracking-widest text-{color}-700`, value `text-2xl font-bold`.

### 4.5 Status Badge

```tsx
<span className={cn(
    "rounded-full px-2 py-0.5 text-[9px] font-black border uppercase tracking-widest",
    status === "PAID" && "bg-emerald-50 text-emerald-700 border-emerald-200",
    status === "OVERDUE" && "bg-red-50 text-red-700 border-red-200",
    status === "PENDING" && "bg-amber-50 text-amber-700 border-amber-200",
    status === "DRAFT" && "bg-slate-50 text-slate-600 border-slate-200",
)}>{status}</span>
```

### 4.6 Dialog Header

```tsx
<DialogHeader className="flex flex-row items-center gap-3">
    <div className="p-2.5 bg-primary/10 rounded-xl"><Icon className="w-5 h-5 text-primary" /></div>
    <div>
        <DialogTitle className="text-base font-bold text-slate-800">Tambah Jurnal</DialogTitle>
        <p className="text-[11px] text-slate-500">Catat transaksi keuangan</p>
    </div>
</DialogHeader>
```

Container ikon WAJIB `p-2.5 bg-{accent}/10 rounded-xl`. Title `text-base font-bold text-slate-800`.

### 4.7 Form Field (lihat `frontend-dev-flow` untuk wiring lengkap)

- Wrapper `<Form methods={form}>` dari `@/components/ui/form/main.tsx`.
- Label: `uppercase text-[10px] font-extrabold text-muted-foreground`.
- Input radius mengikuti shadcn default. Tinggi compact `h-9 text-xs` untuk filter row.
- Submit button:

```tsx
<Button size="sm" type="submit" disabled={isPending}
    className="w-1/2 font-bold shadow-lg shadow-primary/20">
    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
    Simpan
</Button>
```

### 4.8 Row Action (table)

```tsx
<Button variant="outline" size="sm"
    className="h-7 text-[10px] py-0 px-2 font-bold text-blue-600 hover:bg-blue-50 border-blue-200"
    onClick={() => onEdit?.(row.original.id)}>
    <Pencil className="h-3 w-3 mr-1" /> Edit
</Button>
```

Dropdown trigger: `h-8 w-8 p-0 rounded-xl hover:bg-slate-100`. Dropdown label: `text-[10px] font-black uppercase text-slate-400 px-2 py-1.5`.

### 4.9 Filter Row Layout

- Container: `flex flex-col md:flex-row gap-4 justify-between items-center bg-slate-50/50 p-4 rounded-xl border border-slate-100`.
- Filter kiri (search + select), action kanan (bulk bar / trash toggle / create).
- Search input: `<InputGroup>` dengan `h-9 text-xs font-medium`.
- Reset filter button (`variant="ghost"` + icon `FilterX`) — TAMPIL HANYA saat `hasActiveFilters`.

---

## 5. Quick Reference — Class String yang Sering Salah

| Mau buat ini                  | Pakai class persis ini                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| Label kecil uppercase         | `uppercase text-[10px] font-extrabold text-muted-foreground`                           |
| Label KPI berwarna            | `text-[10px] font-black uppercase tracking-widest text-{color}-700`                    |
| Status pill                   | `rounded-full px-2 py-0.5 text-[9px] font-black border uppercase tracking-widest`      |
| Container highlight kecil     | `p-3 bg-{color}-50 border border-{color}-200 rounded-xl`                               |
| Icon container header dialog  | `p-2.5 bg-{accent}/10 rounded-xl`                                                      |
| Mono nomor referensi          | `font-mono font-bold text-sm` (atau `text-[9px] text-slate-400` untuk metadata)        |
| Heading gradient gold         | `bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent`              |
| Submit primary CTA            | `font-bold shadow-lg shadow-primary/20`                                                |
| Action save (emerald)         | `rounded-xl font-bold px-8 bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-200` |
| Cancel ghost                  | `rounded-xl font-bold text-slate-500`                                                  |

---

## 6. Implementation Rules

1. **Tailwind only** — no `.module.css`, no inline `style={{...}}`. Pakai utility class atau extend di `globals.css`.
2. **Shadcn first** — sebelum buat komponen baru, cek `@/components/ui/`. Customisasi via class, jangan fork file.
3. **Token over hex** — gunakan `bg-primary`, `text-foreground`, `border-border`. Hardcode hex hanya untuk shadow/inset gradient yang memang perlu literal (ex: sidebar inset).
4. **Density** — info-dense layout. Default text size 13px (`text-sm`). Padding kompak (`p-3`/`p-4`).
5. **Semantic accent konsisten** — emerald=save, red=delete, blue=edit/info, amber=warning, rose=trash mode, slate=neutral. Jangan mix.
6. **Mono untuk angka & kode** — currency, AP/AR number, SKU, code reference. Body teks tetap sans.
7. **Konsistensi end-to-end** — cek `app/src/components/pages/finance/` dan `app/src/components/pages/inventory-v2/` untuk referensi pola hidup sebelum nulis komponen baru.

---

## 7. Common Mistakes

| Salah                                                   | Benar                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| `style={{ backgroundColor: "#D4AF37" }}`                | `className="bg-primary"`                                             |
| `text-xs uppercase font-bold` untuk label form          | `uppercase text-[10px] font-extrabold text-muted-foreground`         |
| Pakai `<form>` HTML langsung                            | `<Form methods={form}>` dari `@/components/ui/form/main.tsx`         |
| Mix accent (red untuk save, emerald untuk delete)       | Ikut tabel semantic: emerald=save, red=delete                        |
| Hex font Plus Jakarta / IBM Plex                        | Poppins (sans) + Geist Mono (mono) — sudah di `globals.css`          |
| Custom radius `rounded-[18px]`                          | `rounded-xl` (sudah ≈18px via theme)                                 |
| Hardcode `font-family: 'Poppins'`                       | `font-sans` (Tailwind variable sudah Poppins)                        |
| Card tanpa shadow                                       | `shadow-[0_10px_20px_rgba(15,23,42,0.06)]` atau default shadcn `<Card>` |

---

## 8. Cross-References

- **Wiring layer (schema → service → hook → page → form):** lihat `frontend-dev-flow`.
- **Query/mutation pattern:** lihat `frontend-query-mutation`.
- **Refactor komponen besar:** lihat `component-refactoring`.
- **Code review checklist:** lihat `frontend-code-review`.
