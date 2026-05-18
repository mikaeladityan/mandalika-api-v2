import { redisClient } from "../../config/redis.js";

export class ImportCacheService {
    static key(PREFIX: string, importId: string) {
        return `${PREFIX}${importId}`;
    }

    static async save<T>(PREFIX: string, importId: string, payload: T, ttl = 300) {
        await redisClient.set(this.key(PREFIX, importId), JSON.stringify(payload), "EX", ttl);
    }

    static async get<T>(PREFIX: string, importId: string): Promise<T | null> {
        const raw = await redisClient.get(this.key(PREFIX, importId));
        return raw ? (JSON.parse(raw) as T) : null;
    }

    static async exists(PREFIX: string, importId: string) {
        return (await redisClient.exists(this.key(PREFIX, importId))) === 1;
    }

    static async remove(PREFIX: string, importId: string) {
        await redisClient.del(this.key(PREFIX, importId));
    }

    static async listActiveKeys(PREFIX: string) {
        return redisClient.keys(this.key(PREFIX, "*"));
    }
}
