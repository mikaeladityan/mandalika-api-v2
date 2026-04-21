# Manufacturing Module – Frontend Integration Guide

## 1. Service Definition

```ts
import { api } from "@/lib/axios";

export const ManufacturingService = {
  list: (params) => api.get("/manufacturing", { params }),
  detail: (id) => api.get(`/manufacturing/${id}`),
  create: (body) => api.post("/manufacturing", body),
  update: (id, body) => api.patch(`/manufacturing/${id}`, body),
  changeStatus: (id, body) => api.patch(`/manufacturing/${id}/status`, body),
  submitResult: (id, body) => api.post(`/manufacturing/${id}/result`, body),
  qcAction: (id, body) => api.post(`/manufacturing/${id}/qc`, body),
  delete: (id) => api.delete(`/manufacturing/${id}`),
  listWastes: (params) => api.get("/manufacturing/wastes", { params }),
};
```

---

## 2. TanStack Query Hooks

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ManufacturingService } from "./manufacturing.service";

export const useManufacturingList = (params) =>
  useQuery({
    queryKey: ["manufacturing", "list", params],
    queryFn: () => ManufacturingService.list(params),
  });

export const useSubmitProductionResult = (id) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => ManufacturingService.submitResult(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["manufacturing", "detail", id] });
    }
  });
};
```

---

## 3. UI Implementation Details

### Status Transitions
Gunakan flow berikut untuk mengontrol UI tombol aksi:
1. `PLANNING` → Tampil tombol **Release**.
2. `RELEASED` → Tampil tombol **Start Processing**.
3. `PROCESSING` → Tampil tombol **Submit Result** (Membuka modal input aktual).
4. `COMPLETED` → Menunggu QC.
5. `QC_REVIEW` → Tampil tombol **QC Review** (Membuka modal input accepted/rejected).
6. `FINISHED` → Selesai.

### Automated RM Transfer Info
Saat detail order dibuka, periksa field `items[].inventory_stock`. 
Tampilkan informasi stok di `Gudang Produksi (PRD)` dan `Gudang Kandang (KDG)` agar user tahu jika ada transfer otomatis yang sedang berjalan.

### Yield Loss Visualization
Di bagian akhir (Finished/Completed), tampilkan `wastes` (selisih planned vs actual) sebagai komponen "Yield Loss" untuk memberikan insight efisiensi produksi kepada user.

---

## 4. Error Handling

- **400 Insufficient Stock**: Terjadi jika total stok PRD + KDG tidak mencukupi saat Create/Release. Tampilkan pesan error detail barang mana yang kurang.
- **400 Invalid Transition**: Terjadi jika mencoba merubah status tidak sesuai urutan.
