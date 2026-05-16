import { env } from "../config/env.js";
import { redisClient } from "../config/redis.js";
import { ROLE } from "../generated/prisma/client.js";
import { ApiError } from "../lib/errors/api.error.js";
import { logger } from "../lib/logger.js";
import { sessionCache } from "../lib/session.management.js";
import type { Context, Next } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { ContentfulStatusCode } from "hono/utils/http-status";

const CACHE_TTL = 300; // 5 menit

interface SessionData {
    email?: string;
    role?: ROLE;
    user?: Record<string, unknown>;
    employee?: { permissions?: string[] };
    ip?: string;
    userAgent?: string;
    createdAt?: number;
    lastActivity?: number;
    [key: string]: unknown;
}

export const authMiddleware = async (c: Context, next: Next) => {
    try {
        // Headless support: allow Authorization header as fallback for non-browser clients
        const sessionId =
            getCookie(c, env.SESSION_COOKIE_NAME) ||
            c.req.header("Authorization")?.replace("Bearer ", "");

        if (!sessionId) {
            throw new ApiError(401, "Unauthorized, please login to access our system");
        }

        let sessionData: SessionData | null = null;
        const now = Date.now();
        const sessionKey = `session:${sessionId}`;

        const cached = sessionCache.get(sessionId);
        if (cached && cached.expiry > now) {
            sessionData = cached.data as SessionData;
        } else {
            const raw = await redisClient.get(sessionKey);
            if (!raw) {
                sessionCache.delete(sessionId);
                deleteCookie(c, env.SESSION_COOKIE_NAME);
                throw new ApiError(401, "Unauthorized, please login to access our system");
            }

            try {
                sessionData = JSON.parse(raw) as SessionData;
            } catch {
                await redisClient.del(sessionKey);
                sessionCache.delete(sessionId);
                throw new ApiError(401, "Unauthorized: invalid session");
            }

            if (!sessionData || Object.keys(sessionData).length === 0) {
                sessionCache.delete(sessionId);
                throw new ApiError(401, "Unauthorized: invalid or expired session");
            }

            sessionCache.set(sessionId, {
                data: sessionData,
                expiry: now + CACHE_TTL * 1000,
            });
        }

        c.set("user", sessionData?.user);
        c.set("session", sessionData);
        c.set("role", sessionData?.role || "STAFF");
        c.set("permissions", sessionData?.employee?.permissions || []);
        c.set("sessionId", sessionId);

        // Sliding session: extend TTL in background (non-blocking)
        extendSessionTTL(sessionKey).catch((err) =>
            logger.error("Failed to extend session TTL", { error: (err as Error).message })
        );

        await next();
    } catch (err) {
        if (err instanceof ApiError) {
            return c.json(
                { success: false, message: err.message },
                err.statusCode as ContentfulStatusCode
            );
        }
        // Mask internal error details; log original server-side for diagnostics
        logger.error("authMiddleware unexpected error", { error: (err as Error).message });
        return c.json({ success: false, message: "Unauthorized" }, 401);
    }
};

async function extendSessionTTL(sessionKey: string) {
    try {
        const ttl = env.SESSION_TTL;
        if (ttl > 0) {
            await redisClient.expire(sessionKey, ttl);
        }
    } catch (error) {
        logger.error("Failed to extend session TTL", {
            sessionKey,
            error: (error as Error).message,
        });
    }
}

// Periodic cleanup of expired in-memory cache entries
setInterval(() => {
    const now = Date.now();
    sessionCache.forEach((value, key) => {
        if (value.expiry <= now) {
            sessionCache.delete(key);
        }
    });
}, 60000);

export const roleMiddleware = (allowedRoles?: ROLE[]) => {
    return async (c: Context, next: Next) => {
        const userRole = c.get("role") as ROLE;
        if (!userRole) throw new ApiError(401, "Unauthorized");

        if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
            throw new ApiError(403, "Forbidden: insufficient role");
        }

        await next();
    };
};
