import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, Coffee, Clock, Package, BarChart3, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user, primaryRole, roles } = useAuth();
  const noRole = !primaryRole;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground mb-2">
          Welcome back
        </p>
        <h1 className="text-4xl font-display">
          {user?.email?.split("@")[0]}
        </h1>
        <p className="text-muted-foreground mt-2">
          {primaryRole
            ? <>You're signed in as <span className="capitalize text-foreground font-medium">{primaryRole}</span>.</>
            : "You don't have a role assigned yet."}
        </p>
      </div>

      {noRole && (
        <Card className="mb-8 border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5 text-destructive" />
              Awaiting role assignment
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Your account exists but has no role yet. Ask an Admin (or run the
            seed SQL provided with this project) to assign you a role in the
            <code className="mx-1 px-1.5 py-0.5 rounded bg-muted text-foreground">user_roles</code>
            table. Without a role, the side navigation will be empty.
          </CardContent>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatusCard title="POS" status="Phase 2" icon={Coffee} />
        <StatusCard title="Timeclock" status="Phase 2" icon={Clock} />
        <StatusCard title="Inventory & Recipes" status="Phase 2" icon={Package} />
        <StatusCard title="Reports" status="Phase 3" icon={BarChart3} />
        <StatusCard title="Customers & Loyalty" status="Phase 3" icon={Users} />
        <StatusCard title="Roles & Audit" status="Foundation ✓" icon={ShieldCheck} />
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Foundation checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Item done label="Connect to Supabase project (pwixzaejussrgxanxeyf)" />
          <Item done label="Email/password auth wired to Supabase Auth" />
          <Item done label="Role-aware sidebar (Developer / Admin / Barista)" />
          <Item done label="RBAC schema, RLS policies, audit log (SQL provided)" />
          <Item label="Run the provided supabase_schema.sql in your Supabase SQL editor" />
          <Item label="Assign yourself a role in user_roles to unlock navigation" />
        </CardContent>
      </Card>

      <div className="mt-6 text-xs text-muted-foreground">
        Active roles on this account: {roles.length ? roles.join(", ") : "none"}
      </div>
    </div>
  );
}

function StatusCard({
  title, status, icon: Icon,
}: { title: string; status: string; icon: typeof Coffee }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground mt-1">{status}</p>
          </div>
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </CardContent>
    </Card>
  );
}

function Item({ label, done }: { label: string; done?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={[
          "mt-0.5 h-4 w-4 rounded-full flex items-center justify-center text-[10px]",
          done ? "bg-primary text-primary-foreground" : "border border-border bg-background",
        ].join(" ")}
      >
        {done ? "✓" : ""}
      </div>
      <span className={done ? "text-muted-foreground line-through" : ""}>{label}</span>
    </div>
  );
}
