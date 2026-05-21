import { redisClient } from "../../../../../config/redis.js";

const PREFIX = "stock:import:";

export class StockImportCacheService {
    static key(importId: string) {
        return `${PREFIX}${importId}`;
    }

    static async save<T>(importId: string, payload: T, ttl = 300) {
        await redisClient.set(this.key(importId), JSON.stringify(payload), "EX", ttl);
    }

    static async get<T = unknown>(importId: string): Promise<T | null> {
        const raw = await redisClient.get(this.key(importId));
        return raw ? (JSON.parse(raw) as T) : null;
    }

    static async exists(importId: string) {
        return (await redisClient.exists(this.key(importId))) === 1;
    }

    static async remove(importId: string) {
        await redisClient.del(this.key(importId));
    }

    static async listActiveKeys() {
        return redisClient.keys(`${PREFIX}*`);
    }
}
