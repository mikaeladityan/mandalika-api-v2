/**
 * Threshold period (year*12 + month) that separates historical issuance data
 * from projection data. Feb 2026 = 2026*12 + 2 = 24314.
 * Used by: issuance, bom, forecast, recomendation-v2.
 */
export const ISSUANCE_THRESHOLD_PERIOD = 2026 * 12 + 2;
