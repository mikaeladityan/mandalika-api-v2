import { ApiError } from "../../../../lib/errors/api.error.js";
import { ExchangeRateResponse, QueryExchangeRateDTO } from "./exchange-rate.schema.js";

interface CacheEntry {
    rate: number;
    date: string;
    fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 jam

export class ExchangeRateService {
    static async getRate(query: QueryExchangeRateDTO): Promise<ExchangeRateResponse> {
        const { currency } = query;

        const cached = cache.get(currency);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
            return { currency, rate: cached.rate, date: cached.date };
        }

        let data: any;
        try {
            const res = await fetch(`https://open.er-api.com/v6/latest/${currency}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            data = await res.json();
        } catch (err: any) {
            throw new ApiError(502, `Gagal menghubungi layanan kurs: ${err.message}`);
        }

        const rate: number | undefined = data?.rates?.IDR;
        if (!rate || rate <= 0) {
            throw new ApiError(502, `Kurs IDR tidak tersedia untuk ${currency}.`);
        }

        cache.set(currency, { rate, date: data.date ?? new Date().toISOString().split("T")[0], fetchedAt: Date.now() });
        return { currency, rate, date: data.date };
    }
}
