import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/inventory")({
  component: () => <ComingSoon title="Inventory" phase="Phase 2" />,
});
