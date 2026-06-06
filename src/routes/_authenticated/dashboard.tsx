import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Coffee, Clock, Package, BarChart3, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user, primaryRole, roles, roleError, refreshRoles } = useAuth();
  const noRole = !primaryRole;
  const permissionIssue = roleError?.toLowerCase().includes("permission denied");

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
              {permissionIssue ? "Role table permission blocked" : "Awaiting role assignment"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {permissionIssue ? (
              <>
                Your account is signed in, but the app cannot read the
                <code className="mx-1 px-1.5 py-0.5 rounded bg-muted text-foreground">user_roles</code>
                table yet. Run the permissions fix SQL, then refresh this page.
              </>
            ) : (
              <div className="space-y-3">
                <p>
                  Your account exists but no role row is visible yet for this signed-in user.
                  Assign the role to this exact user ID in
                  <code className="mx-1 px-1.5 py-0.5 rounded bg-muted text-foreground">user_roles</code>
                  then click refresh.
                </p>
                <div className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground break-all">
                  {user?.id}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => void refreshRoles()}>
                    Refresh roles
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
                    Reload page
                  </Button>
                </div>
              </div>
            )}
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
          <Item done label="Connect to Supabase project (ewwtxzoruibaxalffyli)" />
          <Item done label="Email/password auth wired to Supabase Auth" />
          <Item done label="Role-aware sidebar (Developer / Admin / Barista)" />
          <Item done label="RBAC schema, RLS policies, audit log (SQL provided)" />
          <Item label="Run the SQL schema in the current project SQL editor" />
          <Item label="Assign developer/admin to the current signed-in user ID above" />
        </CardContent>
      </Card>

      <div className="mt-6 text-xs text-muted-foreground">
        Active roles on this account: {roles.length ? roles.join(", ") : "none"}
        {roleError ? <span className="block mt-1 text-destructive">Role read error: {roleError}</span> : null}
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
