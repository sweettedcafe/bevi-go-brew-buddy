import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/timeclock")({
  component: () => <ComingSoon title="Timeclock" phase="Phase 2" />,
});
