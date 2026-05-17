import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/discounts")({
  component: () => <ComingSoon title="Discount Management" phase="Phase 2" />,
});
