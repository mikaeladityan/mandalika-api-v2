import { Hono } from "hono";
import FinanceAPRoutes from "./ap/ap.routes.js";
import FinanceARRoutes from "./ar/ar.routes.js";
import FinanceCashRoutes from "./cash/cash.routes.js";
import FinanceJournalRoutes from "./journal/journal.routes.js";
import FinanceKpiRoutes from "./kpi/kpi.routes.js";

const FinanceRoutes = new Hono();

FinanceRoutes.route("/ap", FinanceAPRoutes);
FinanceRoutes.route("/ar", FinanceARRoutes);
FinanceRoutes.route("/cash", FinanceCashRoutes);
FinanceRoutes.route("/journal", FinanceJournalRoutes);
FinanceRoutes.route("/kpi", FinanceKpiRoutes);

export default FinanceRoutes;
