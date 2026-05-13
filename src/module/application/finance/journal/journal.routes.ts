import { Hono } from "hono";
import { FinanceJournalController } from "./journal.controller.js";
import { validateBody } from "../../../../middleware/validation.js";
import { CreateJournalSchema } from "./journal.schema.js";

const FinanceJournalRoutes = new Hono();

FinanceJournalRoutes.get("/", FinanceJournalController.list);
FinanceJournalRoutes.post("/", validateBody(CreateJournalSchema), FinanceJournalController.create);
FinanceJournalRoutes.get("/:id", FinanceJournalController.detail);
FinanceJournalRoutes.patch("/:id/post", FinanceJournalController.post);

export default FinanceJournalRoutes;
