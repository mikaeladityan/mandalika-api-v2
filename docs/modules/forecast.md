# 📈 Module: Forecast

**Path**: `/api/app/forecasts`
**Source**: `src/module/application/forecast/`

Prediksi kebutuhan produk berdasarkan tren historis (`ProductIssuance`).

---

## Endpoint

| Method | Path                                | Catatan                                      |
| :----- | :---------------------------------- | :------------------------------------------- |
| GET    | `/`                                 | List                                          |
| POST   | `/`                                 | Alias `run` (`RunForecastSchema`)             |
| POST   | `/run`                              | Trigger forecast engine                       |
| PATCH  | `/finalize`                         | Finalize hasil (`FinalizeForecastSchema`)     |
| PATCH  | `/manual-update`                    | Manual override (`UpdateManualForecastSchema`)|
| DELETE | `/period`                           | Hapus periode (`DeleteForecastByPeriodSchema`)|
| DELETE | `/reset/:product_id`                | Reset per produk                              |
| GET    | `/:product_id`                      | Detail per produk                             |
| DELETE | `/:id`                              | Hapus 1 record                                |
| GET    | `/export`                           | Export Excel                                  |

## Sub-modul

| Sub                       | Path                                       |
| :------------------------ | :----------------------------------------- |
| Forecast Percentages      | `/forecasts/forecast-percentages`          |

---

## Schema (`forecast.schema.ts`)

- `RunForecastSchema` → input untuk trigger (range periode, opsi metode).
- `FinalizeForecastSchema` → lock hasil.
- `UpdateManualForecastSchema` → override qty manual.
- `DeleteForecastByPeriodSchema` → hapus per periode.

---

## Cron Job

`src/job/forcast.job.ts` (note: filename typo `forcast`) bisa di-aktifkan via `startForecastJob()` di `server.ts`. Saat ini di-comment — perlu di-enable manual jika ingin scheduled run.

---

## Integrasi Google Sheet

ENV `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`, `SHEET_FORECAST` dipakai untuk sync hasil forecast ke Google Sheet (lihat `forecast.service.ts`).

---

## Model

- `Forecast` — record per produk + periode.
- `ForecastPercentage` — bobot historical kontribusi periode.
- `SafetyStock`, `Trend` (enum) — input model.
