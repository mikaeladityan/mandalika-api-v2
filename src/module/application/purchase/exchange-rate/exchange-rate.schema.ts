import { z } from "zod";

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "SGD", "CNY", "JPY", "GBP", "AUD"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const QueryExchangeRateSchema = z.object({
    currency: z.enum(SUPPORTED_CURRENCIES, {
        message: `Mata uang harus salah satu dari: ${SUPPORTED_CURRENCIES.join(", ")}`,
    }),
});

export type QueryExchangeRateDTO = z.infer<typeof QueryExchangeRateSchema>;

export interface ExchangeRateResponse {
    currency: string;
    rate: number;
    date: string;
}
