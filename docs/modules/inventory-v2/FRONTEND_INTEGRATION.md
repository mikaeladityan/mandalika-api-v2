# Inventory V2 Module – Frontend Integration Guide

## 1. Service Definition

Gunakan pola service terpusat di `web/src/services/` untuk berinteraksi dengan API Inventory V2.

```ts
import { api } from "@/lib/axios";

export const InventoryV2Service = {
  // Delivery Order
  do: {
    list: (params) => api.get("/inventory-v2/do", { params }),
    detail: (id) => api.get(`/inventory-v2/do/${id}`),
    create: (body) => api.post("/inventory-v2/do", body),
    updateStatus: (id, body) => api.patch(`/inventory-v2/do/${id}/status`, body),
  },
  
  // Goods Receipt
  gr: {
    list: (params) => api.get("/inventory-v2/gr", { params }),
    post: (id) => api.post(`/inventory-v2/gr/${id}/post`),
    cancel: (id) => api.patch(`/inventory-v2/gr/${id}/cancel`),
  },
  
  // Monitoring
  monitoring: {
    stockCard: (params) => api.get("/inventory-v2/monitoring/stock-card", { params }),
    stockLocation: (params) => api.get("/inventory-v2/monitoring/stock-location", { params }),
    stockTotal: (params) => api.get("/inventory-v2/monitoring/stock-total", { params }),
  }
};
```

---

## 2. TanStack Query Hooks

Implementasikan hooks untuk abstracting state management dan caching.

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { InventoryV2Service } from "./inventory-v2.service";

export const useDOList = (params) => 
  useQuery({
    queryKey: ["inventory", "do", "list", params],
    queryFn: () => InventoryV2Service.do.list(params),
  });

export const useApproveDO = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }) => 
      InventoryV2Service.do.updateStatus(id, { status: "APPROVED", notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", "do"] });
    }
  });
};
```

---

## 3. UI Patterns

### Stepper Status (DO & TG)
Tampilkan lifecycle status dengan indikator visual:
- `PENDING` (Orange)
- `APPROVED` (Blue)
- `SHIPMENT` (Indigo)
- `RECEIVED` (Purple)
- `FULFILLMENT` (Teal)
- `COMPLETED` (Green)
- `CANCELLED` (Red)

### Form Validation
Gunakan Zod schema yang sama dengan backend untuk validasi client-side:
- Pastikan `quantity_requested` tidak melebihi stok yang tersedia (gunakan endpoint `/stock`).
- Pastikan `from_warehouse` dan `to_outlet/warehouse` tidak sama.

---

## 4. Common Troubleshooting

| Masalah | Solusi |
|---|---|
| Stok tidak muncul saat create DO | Pastikan `warehouse_id` yang dipilih memiliki stok barang tersebut di monitoring. |
| Status tidak bisa diupdate | Cek `ApiError` dari backend; beberapa transisi status dilarang (misal: CANCELLED ke APPROVED). |
| Gagal POST GR | Pastikan user memiliki role yang sesuai (Staff Warehouse) dan barang benar-benar sudah diterima secara fisik. |
