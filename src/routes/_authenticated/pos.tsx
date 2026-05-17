import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/pos")({
  component: () => <ComingSoon title="Point of Sale" phase="Phase 2" />,
});
