import { Queue } from "bullmq";
import { bullConnection, FG_IMPORT_QUEUE_NAME } from "../../../../../../config/queue.js";

export type FGImportJobData = {
    import_id: string;
};

export const fgImportQueue = new Queue<FGImportJobData>(FG_IMPORT_QUEUE_NAME, {
    connection: bullConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: false,
    },
});

export async function enqueueFGImport(import_id: string) {
    return fgImportQueue.add(
        "execute",
        { import_id },
        { jobId: import_id },
    );
}
