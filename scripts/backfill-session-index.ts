/**
 * MAINTENANCE SCRIPT: Backfill per-user session index sets.
 *
 * Existing session:* keys created before the index refactor have no entry in
 * sessions:{email} sets. Without backfill, MAX_DEVICES enforcement skips those
 * users until their old sessions expire and they re-login.
 *
 * CARA PAKAI:
 *   npx tsx scripts/backfill-session-index.ts
 *   DRY_RUN=1 npx tsx scripts/backfill-session-index.ts   # preview only
 *
 * YANG DILAKUKAN:
 *   - SCAN session:* keys (non-blocking, cursor-based)
 *   - Parse each session payload to extract email
 *   - SADD sessionId into sessions:{email}
 *   - Set TTL on each user's index set to match max session TTL
 *
 * IDEMPOTENT: safe to re-run; SADD is no-op for existing members.
 */

import { config } from "dotenv";
config();

import { redisClient } from "../src/config/redis.js";
import { env } from "../src/config/env.js";

const DRY_RUN = process.env.DRY_RUN === "1";
const BATCH_SIZE = 500;

async function backfill() {
    let cursor = "0";
    let totalScanned = 0;
    let totalBackfilled = 0;
    let totalSkipped = 0;
    const seenEmails = new Set<string>();

    console.log(`[backfill-session-index] starting (dry-run=${DRY_RUN})`);

    do {
        const [nextCursor, keys] = await redisClient.scan(
            cursor,
            "MATCH",
            "session:*",
            "COUNT",
            BATCH_SIZE
        );
        cursor = nextCursor;

        if (keys.length === 0) continue;

        const values = await redisClient.mget(...keys);

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const raw = values[i];
            totalScanned++;

            if (!raw) {
                totalSkipped++;
                continue;
            }

            let email: string | undefined;
            try {
                const data = JSON.parse(raw);
                email = data.email;
            } catch {
                console.warn(`  skip corrupt session: ${key}`);
                totalSkipped++;
                continue;
            }

            if (!email) {
                totalSkipped++;
                continue;
            }

            const sessionId = key.replace("session:", "");
            const indexKey = `sessions:${email}`;

            if (!DRY_RUN) {
                await redisClient.sadd(indexKey, sessionId);
                if (!seenEmails.has(email)) {
                    // Long TTL (7d) to cover "remember me" sessions; lazy cleanup handles rest
                    await redisClient.expire(indexKey, 7 * 86400);
                    seenEmails.add(email);
                }
            }
            totalBackfilled++;
        }
    } while (cursor !== "0");

    console.log("[backfill-session-index] done");
    console.log(`  scanned:    ${totalScanned}`);
    console.log(`  backfilled: ${totalBackfilled}`);
    console.log(`  skipped:    ${totalSkipped}`);
    console.log(`  users:      ${seenEmails.size}`);
}

backfill()
    .catch((err) => {
        console.error("[backfill-session-index] failed", err);
        process.exit(1);
    })
    .finally(async () => {
        await redisClient.quit();
    });
