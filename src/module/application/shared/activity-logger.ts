import prisma from "../../../config/prisma.js";
import { LogActivities } from "../../../generated/prisma/enums.js";
import z from "zod";

export const LoggingActivitySchema = z.object({
    email: z.email(),
    activity: z.enum(LogActivities),
    description: z.string(),
});

export type CreateLoggingActivityDTO = z.infer<typeof LoggingActivitySchema>;

export async function CreateLogger(data: CreateLoggingActivityDTO): Promise<void> {
    await prisma.loggingActivity.create({ data });
}
