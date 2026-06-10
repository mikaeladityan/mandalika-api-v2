// reason: project policy hides real supplier identity from every API response.
// Helper sentralisasi format anonymous code (max 7 char) — ganti format di sini saja
// kalau requirement berubah. Pure function, deterministic by supplier_id.

export const SUPPLIER_OBSCURE_REGEX = /^(SUP-\d{3}|SUP\d{4}|SUP-\?{3})$/;

export function obscureSupplierName(
    supplierId: number | null | undefined,
): string {
    if (supplierId == null) return "SUP-???";
    if (!Number.isInteger(supplierId) || supplierId < 1) {
        throw new Error(
            `Supplier ID ${supplierId} is not a valid positive integer`,
        );
    }
    if (supplierId <= 999) return `SUP-${String(supplierId).padStart(3, "0")}`;
    if (supplierId <= 9999) return `SUP${String(supplierId).padStart(4, "0")}`;
    throw new Error(
        `Supplier ID ${supplierId} exceeds 7-char anonymous code capacity`,
    );
}

// Convenience mapper untuk row dengan field `supplier_name` + `supplier_id` di level atas.
// Mengembalikan record baru dengan supplier_name di-replace; tidak memutasi input.
export function withObscuredSupplierName<
    T extends { supplier_name?: string | null; supplier_id?: number | null },
>(row: T): T {
    if (!("supplier_name" in row)) return row;
    return { ...row, supplier_name: obscureSupplierName(row.supplier_id) };
}

// Convenience mapper untuk row dengan nested relation `supplier: { id, name, ... }`.
// Replace nested supplier.name; supplier itu sendiri tetap di-keep agar id/relasi lain
// tidak hilang dari shape response.
export function withObscuredSupplierRelation<
    T extends { supplier?: { id?: number | null; name?: string | null } | null },
>(row: T): T {
    if (!row.supplier) return row;
    return {
        ...row,
        supplier: {
            ...row.supplier,
            name: obscureSupplierName(row.supplier.id ?? null),
        },
    };
}
