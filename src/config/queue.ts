import { env } from "./env.js";

export const bullConnection = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    db: env.REDIS_DB,
    maxRetriesPerRequest: null,
};

export const FG_IMPORT_QUEUE_NAME =
    env.NODE_ENV === "test" ? "test-fg-import" : "fg-import";

export const RM_IMPORT_QUEUE_NAME =
    env.NODE_ENV === "test" ? "test-rm-import" : "rm-import";
