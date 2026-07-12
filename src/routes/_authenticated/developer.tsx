import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PasswordResetCard } from "@/components/PasswordResetCard";


export const Route = createFileRoute("/_authenticated/developer")({
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) throw redirect({ to: "/login" });
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid);
    const isDev = (roleRows ?? []).some((r: any) => r.role === "developer");
    if (!isDev) throw redirect({ to: "/dashboard" });
  },
  component: DeveloperPage,
});

const db = supabase as any;

type DangerCardProps = {
  title: string;
  description: string;
  confirmPhrase: string;
  buttonLabel: string;
  rpc: string;
  successKey: string;
  successLabel: string;
};

function DangerCard({
  title,
  description,
  confirmPhrase,
  buttonLabel,
  rpc,
  successKey,
  successLabel,
}: DangerCardProps) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    if (confirm !== confirmPhrase) {
      toast.error(`Type "${confirmPhrase}" exactly to confirm.`);
      return;
    }
    setBusy(true);
    const { data, error } = await db.rpc(rpc);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const n = (data as any)?.[successKey] ?? 0;
    toast.success(`${successLabel}: ${n}`);
    setConfirm("");
  }

  return (
    <Card className="p-5 border-destructive/40">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
        <div className="flex-1 space-y-3">
          <div>
            <h2 className="font-display text-lg text-destructive">{title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
            <p className="text-xs text-muted-foreground mt-2">
              Use only to clean up after testing. This cannot be undone.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">
              Type <code className="font-mono">{confirmPhrase}</code> to enable the button:
            </label>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={confirmPhrase}
              className="font-mono"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              disabled={busy || confirm !== confirmPhrase}
              onClick={run}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {busy ? "Working…" : buttonLabel}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function DeveloperPage() {
  const { primaryRole } = useAuth();
  const navigate = useNavigate();

  if (primaryRole !== "developer") {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="p-6 text-sm text-muted-foreground">
          This area is restricted to the Developer role.
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl">Developer Tools</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Maintenance utilities visible only to the Developer role.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate({ to: "/dashboard" })}>
          Back to dashboard
        </Button>
      </div>

      <DangerCard
        title="Danger Zone — Wipe all orders"
        description="Hard-deletes every order, order item, and payment. Restocks inventory for each line item and reverses loyalty points (earned subtracted, redeemed re-credited). Order numbering restarts at #001. Voided / refunded orders are also removed but no longer affect stock."
        confirmPhrase="WIPE ALL ORDERS"
        buttonLabel="Wipe all orders now"
        rpc="dev_wipe_all_orders"
        successKey="deleted_orders"
        successLabel="Deleted orders"
      />

      <DangerCard
        title="Danger Zone — Reset inventory"
        description="Hard-deletes every inventory item, all stock movements, and all recipe rows (since recipes reference inventory). Menu items remain but will have no ingredients attached until you re-import recipes."
        confirmPhrase="RESET INVENTORY"
        buttonLabel="Reset inventory now"
        rpc="dev_reset_inventory"
        successKey="deleted_inventory_items"
        successLabel="Deleted inventory items"
      />

      <DangerCard
        title="Danger Zone — Reset menu"
        description="Hard-deletes every menu item, variant, bundle, category, and recipe. Requires orders to be wiped first because order history references menu items."
        confirmPhrase="RESET MENU"
        buttonLabel="Reset menu now"
        rpc="dev_reset_menu"
        successKey="deleted_menu_items"
        successLabel="Deleted menu items"
      />

      <DangerCard
        title="Danger Zone — Reset recipes"
        description="Hard-deletes every recipe row (and variant recipes) linking menu items to inventory. Menu items and inventory items remain untouched."
        confirmPhrase="RESET RECIPES"
        buttonLabel="Reset recipes now"
        rpc="dev_reset_recipes"
        successKey="deleted_recipes"
        successLabel="Deleted recipes"
      />

      <DangerCard
        title="Danger Zone — Reset expenses"
        description="Hard-deletes every shift expense entry. Shifts themselves are kept, but their recorded expenses (with invoice numbers and receipts) are removed. Use before switching from sample data to real operating expenses."
        confirmPhrase="RESET EXPENSES"
        buttonLabel="Reset expenses now"
        rpc="dev_reset_expenses"
        successKey="deleted_expenses"
        successLabel="Deleted expenses"
      />

      <DangerCard
        title="Danger Zone — Reset timeclock"
        description="Hard-deletes every shift, break, and shift expense. Clears the Timeclock Report and End-of-Shift history. Users, roles, and orders are untouched."
        confirmPhrase="RESET TIMECLOCK"
        buttonLabel="Reset timeclock now"
        rpc="dev_reset_timeclock"
        successKey="deleted_shifts"
        successLabel="Deleted shifts"
      />

      <PasswordResetCard />
    </div>
  );
}

function PasswordResetCard() {
  const [users, setUsers] = useState<Array<{ id: string; email: string; name: string | null }>>([]);
  const [userId, setUserId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select("id, email, full_name")
        .order("full_name", { ascending: true, nullsFirst: false });
      if (error) return;
      setUsers(
        (data ?? []).map((r: any) => ({ id: r.id, email: r.email ?? "", name: r.full_name ?? null })),
      );
    })();
  }, []);

  async function run() {
    if (!userId) { toast.error("Select a user."); return; }
    if (newPassword.length < 6) { toast.error("Password must be at least 6 characters."); return; }
    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) { toast.error("Not signed in."); return; }
      const res = await fetch("/api/public/dev-set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: userId, new_password: newPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        toast.error(`Failed: ${body?.error ?? res.status}${body?.detail ? " — " + body.detail : ""}`);
        return;
      }
      toast.success("Password updated. Share it with the user securely.");
      setNewPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 border-amber-500/40">
      <div className="flex items-start gap-3">
        <KeyRound className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1 space-y-3">
          <div>
            <h2 className="font-display text-lg">Reset a user's password</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Set a new temporary password for any staff account when they're locked out.
              Passwords are stored as one-way hashes in the auth system and cannot be viewed —
              you can only overwrite them. Share the new password with the user through a secure
              channel and ask them to change it after signing in.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">User</label>
            <select
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">Select a user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.name || u.email || u.id) + (u.name && u.email ? ` — ${u.email}` : "")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">New password (min 6 characters)</label>
            <Input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="e.g. Temp-1234"
              className="font-mono"
            />
          </div>
          <Button disabled={busy || !userId || newPassword.length < 6} onClick={run}>
            <KeyRound className="h-4 w-4 mr-2" />
            {busy ? "Updating…" : "Set new password"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

