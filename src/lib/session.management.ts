import { env } from "../config/env.js";
import { Context } from "hono";
import { getCookie } from "hono/cookie";
import { redisClient } from "../config/redis.js";
import { logger } from "./logger.js";

// In-memory cache of decoded session payloads to reduce Redis hits per request.
export const sessionCache = new Map<string, { data: any; expiry: number }>();

export class SessionManager {
    static getCurrentSessionId(c: Context): string | null {
        try {
            return getCookie(c, env.SESSION_COOKIE_NAME) || null;
        } catch (error) {
            logger.error("Error getting session cookie", { error });
            return null;
        }
    }

    static async getUserActiveSessions(
        email: string,
        c: Context
    ): Promise<
        Array<{
            sessionId: string;
            lastActivity: number;
            createdAt: number;
            userAgent?: string;
            ipAddress?: string;
            isCurrent?: boolean;
        }>
    > {
        const currentSessionId = this.getCurrentSessionId(c);

        // O(1) lookup via per-user index set instead of O(N) KEYS scan
        const sessionIds = await redisClient.smembers(`sessions:${email}`);
        const userSessions: Array<{
            sessionId: string;
            lastActivity: number;
            createdAt: number;
            userAgent?: string;
            ipAddress?: string;
            isCurrent?: boolean;
        }> = [];
        const stale: string[] = [];

        for (const sessionId of sessionIds) {
            try {
                const raw = await redisClient.get(`session:${sessionId}`);
                if (!raw) {
                    stale.push(sessionId);
                    continue;
                }
                const sessionData = JSON.parse(raw);
                userSessions.push({
                    sessionId,
                    lastActivity: sessionData.lastActivity
                        ? parseInt(sessionData.lastActivity)
                        : Date.now(),
                    createdAt: sessionData.createdAt
                        ? parseInt(sessionData.createdAt)
                        : Date.now(),
                    userAgent: sessionData.userAgent,
                    ipAddress: sessionData.ip,
                    isCurrent: sessionId === currentSessionId,
                });
            } catch (error) {
                logger.error(`Error processing session ${sessionId}`, { error });
                stale.push(sessionId);
            }
        }

        // Lazy cleanup of expired/corrupt session references
        if (stale.length > 0) {
            redisClient.srem(`sessions:${email}`, ...stale).catch((err) =>
                logger.error("Failed to remove stale session index entries", { error: err })
            );
        }

        return userSessions.sort((a, b) => b.lastActivity - a.lastActivity);
    }

    static async cleanupInactiveSessions(
        maxInactiveHours = 24,
        batchSize = 500
    ): Promise<number> {
        const pattern = "session:*";
        const cutoffTime = Date.now() - maxInactiveHours * 60 * 60 * 1000;
        let cleanedCount = 0;
        let cursor = "0";

        try {
            do {
                const [nextCursor, keys] = await redisClient.scan(
                    cursor,
                    "MATCH",
                    pattern,
                    "COUNT",
                    batchSize
                );
                cursor = nextCursor;

                if (keys.length === 0) continue;

                const pipeline = redisClient.pipeline();
                const sessionDataList = await redisClient.mget(...keys);

                for (let i = 0; i < sessionDataList.length; i++) {
                    const data = sessionDataList[i];
                    const key = keys[i];

                    if (!data) {
                        pipeline.del(String(key));
                        cleanedCount++;
                        continue;
                    }

                    try {
                        const session = JSON.parse(data);
                        const lastActivity = session.lastActivity || 0;
                        if (lastActivity < cutoffTime) {
                            pipeline.del(String(key));
                            cleanedCount++;
                        }
                    } catch {
                        pipeline.del(String(key));
                        cleanedCount++;
                    }
                }

                if (pipeline.length > 0) {
                    await pipeline.exec();
                }
            } while (cursor !== "0");

            return cleanedCount;
        } catch (error) {
            logger.error("Session cleanup error", { error });
            return 0;
        }
    }
}
