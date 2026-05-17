import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/menu")({
  component: () => <ComingSoon title="Menu & Recipes" phase="Phase 2" />,
});
