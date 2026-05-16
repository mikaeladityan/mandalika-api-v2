import { redisClient } from "../config/redis.js";
import { env } from "../config/env.js";
import type { Context } from "hono";
import { setCookie } from "hono/cookie";

export async function setSessionLogin(c: Context, token: string, remember: boolean, data: any) {
    const sessionTTL = remember ? 7 * 86400 : env.SESSION_TTL;

    setCookie(c, env.SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: env.isProduction,
        sameSite: "Lax",
        maxAge: sessionTTL,
        path: "/",
        domain: env.isProduction && env.COOKIE_DOMAIN ? env.COOKIE_DOMAIN : undefined,
    });

    const sessionData: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined || value === null) continue;
        sessionData[key] = value;
    }
    sessionData.createdAt = Date.now();
    sessionData.lastActivity = Date.now();

    const sessionKey = `session:${token}`;
    await redisClient.set(sessionKey, JSON.stringify(sessionData), "EX", sessionTTL);

    // Maintain per-user session index for O(1) active session lookup
    if (data.email) {
        await redisClient.sadd(`sessions:${data.email}`, token);
        await redisClient.expire(`sessions:${data.email}`, sessionTTL);
    }
}
