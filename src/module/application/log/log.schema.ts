import { LogActivities } from "../../../generated/prisma/enums.js";
import z from "zod";
import { LoggingActivitySchema } from "../shared/activity-logger.js";

export { LoggingActivitySchema } from "../shared/activity-logger.js";
export type { CreateLoggingActivityDTO } from "../shared/activity-logger.js";

export const ResponseLoggingActivitySchema = LoggingActivitySchema.extend({
    id: z.number(),
    created_at: z.date(),
});

export type ResponseLoggingActivityDTO = z.infer<typeof ResponseLoggingActivitySchema>;
