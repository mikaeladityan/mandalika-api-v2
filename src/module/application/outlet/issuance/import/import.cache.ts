import { redisClient } from "../../../../../config/redis.js";

const PREFIX = "outlet:issuance:import:";

export class IssuanceImportCacheService {
    static key(importId: string): string {
        return `${PREFIX}${importId}`;
    }

    static async save<T>(importId: string, payload: T, ttl = 900): Promise<void> {
        await redisClient.set(this.key(importId), JSON.stringify(payload), "EX", ttl);
    }

    static async get<T>(importId: string): Promise<T | null> {
        const raw = await redisClient.get(this.key(importId));
        return raw ? (JSON.parse(raw) as T) : null;
    }

    static async remove(importId: string): Promise<void> {
        await redisClient.del(this.key(importId));
    }
}
