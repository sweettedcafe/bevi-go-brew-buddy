import { Construction } from "lucide-react";

export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="p-8 max-w-3xl mx-auto">
      <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground mb-2">
        {phase}
      </p>
      <h1 className="text-4xl font-display mb-4">{title}</h1>
      <div className="mt-8 border border-dashed border-border rounded-lg p-12 text-center bg-card">
        <Construction className="h-10 w-10 text-primary mx-auto mb-4" />
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          This module ships in a follow-up phase. The foundation (auth, RBAC,
          audit log) is ready — let me know when to start building it.
        </p>
      </div>
    </div>
  );
}
