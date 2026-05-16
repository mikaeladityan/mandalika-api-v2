import { redisClient } from "../config/redis.js";

const SCAN_BATCH = 500;

async function scanSessionKeys(): Promise<string[]> {
    const all: string[] = [];
    let cursor = "0";
    do {
        const [next, keys] = await redisClient.scan(
            cursor,
            "MATCH",
            "session:*",
            "COUNT",
            SCAN_BATCH
        );
        cursor = next;
        all.push(...keys);
    } while (cursor !== "0");
    return all;
}

export class SessionMetrics {
    static async getSessionStats(): Promise<{
        totalSessions: number;
        activeSessions: number;
        expiringSoon: number;
        byRole: Record<string, number>;
    }> {
        const keys = await scanSessionKeys();

        let activeSessions = 0;
        let expiringSoon = 0;
        const byRole: Record<string, number> = {};

        // Batch fetch values + TTLs via pipeline for fewer round trips
        for (let i = 0; i < keys.length; i += SCAN_BATCH) {
            const batch = keys.slice(i, i + SCAN_BATCH);
            const pipeline = redisClient.pipeline();
            batch.forEach((k) => {
                pipeline.get(k);
                pipeline.ttl(k);
            });
            const results = (await pipeline.exec()) ?? [];

            for (let j = 0; j < batch.length; j++) {
                const dataResult = results[j * 2];
                const ttlResult = results[j * 2 + 1];
                if (!dataResult || !ttlResult) continue;

                const raw = dataResult[1] as string | null;
                const ttl = ttlResult[1] as number;
                if (ttl <= 0 || !raw) continue;

                let sessionData: { role?: string; user?: unknown };
                try {
                    sessionData = JSON.parse(raw);
                } catch {
                    continue;
                }

                activeSessions++;
                if (ttl < 3600) expiringSoon++;

                let role = "unknown";
                if (sessionData.role) {
                    role = sessionData.role;
                } else if (typeof sessionData.user === "string") {
                    try {
                        const user = JSON.parse(sessionData.user);
                        role = user.role || "unknown";
                    } catch {
                        // ignore
                    }
                }

                byRole[role] = (byRole[role] || 0) + 1;
            }
        }

        return {
            totalSessions: keys.length,
            activeSessions,
            expiringSoon,
            byRole,
        };
    }

    static async getSessionActivity(): Promise<{
        sessionsByHour: Record<string, number>;
        sessionsByDay: Record<string, number>;
    }> {
        const keys = await scanSessionKeys();

        const sessionsByHour: Record<string, number> = {};
        const sessionsByDay: Record<string, number> = {};

        for (let i = 0; i < keys.length; i += SCAN_BATCH) {
            const batch = keys.slice(i, i + SCAN_BATCH);
            const values = await redisClient.mget(...batch);

            for (const raw of values) {
                if (!raw) continue;

                let createdAt = 0;
                try {
                    const sessionData = JSON.parse(raw);
                    createdAt = sessionData.createdAt || 0;
                } catch {
                    continue;
                }

                if (!createdAt) continue;

                const date = new Date(createdAt);
                const yyyy = date.getFullYear();
                const mm = (date.getMonth() + 1).toString().padStart(2, "0");
                const dd = date.getDate().toString().padStart(2, "0");
                const hh = date.getHours();

                const hourKey = `${yyyy}-${mm}-${dd} ${hh}:00`;
                const dayKey = `${yyyy}-${mm}-${dd}`;

                sessionsByHour[hourKey] = (sessionsByHour[hourKey] || 0) + 1;
                sessionsByDay[dayKey] = (sessionsByDay[dayKey] || 0) + 1;
            }
        }

        return { sessionsByHour, sessionsByDay };
    }
}
