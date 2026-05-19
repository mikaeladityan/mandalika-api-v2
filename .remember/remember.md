# Handoff

## State
Refactored `inventory/rm/category/` & `inventory/rm/unit/` per supplier pattern (ORM-only, fix broken 5-up paths, P2002/P2025 try-catch, status 200/201 SOP). Mounted di `rm.routes.ts` sebagai `/categories` & `/units`. Tambah unit tests (`category.service.test.ts` 16 cases, `unit.service.test.ts` 15 cases). Tambah Prisma indexes: `RawMatCategories(status, name, updated_at)`, `UnitRawMaterial(name)`, `RawMaterial(name, [deleted_at, updated_at])`. `prisma generate` OK, `tsc --noEmit` CLEAN, RM tests 112/112 PASS. Belum commit. Branch `dev`.

## Next
1. Jalankan `npx prisma migrate dev --name add_rm_category_unit_indexes` saat siap deploy ke staging (3 model: RawMatCategories +3, UnitRawMaterial +1, RawMaterial +2 indexes).
2. Integration test routes `/api/app/inventory/rm/categories` & `/units` (mirror `rm.routes.test.ts`).
3. Update Postman collection + `docs/modules/inventory/rm/` README untuk dua scope baru.
4. Triage pre-existing failures `inventory-v2/{return,gr,tg}.service.test.ts` (3 fail — bukan dari perubahan ini).

## Context
- File tersentuh: `category/{schema,service,controller,routes}.ts`, `unit/{schema,service,controller,routes}.ts`, `rm.routes.ts`, `prisma/schema.prisma`, `tests/inventory/rm/{category,unit}/*.test.ts`.
- STATUS enum tidak punya `INACTIVE` — value valid: `DELETE | PENDING | ACTIVE | FAVOURITE | BLOCK`.
- Legacy `src/module/application/rawmat/{category,unit}/` masih ada — biarkan (scope split per `rm_module_scope_split.md`).
- Migration belum dijalankan — schema diubah, client di-regenerate, tapi DB belum sync (test pakai mock prisma jadi tidak terpengaruh).
