import { Queue } from "bullmq";
import { bullConnection, RM_IMPORT_QUEUE_NAME } from "../../../../../../config/queue.js";

export type RMImportJobData = {
    import_id: string;
};

export const rmImportQueue = new Queue<RMImportJobData>(RM_IMPORT_QUEUE_NAME, {
    connection: bullConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: false,
    },
});

export async function enqueueRMImport(import_id: string) {
    return rmImportQueue.add("execute", { import_id }, { jobId: import_id });
}
