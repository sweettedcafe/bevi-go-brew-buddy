import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/payments")({
  component: () => <ComingSoon title="Payment Methods & Fees" phase="Phase 2" />,
});
