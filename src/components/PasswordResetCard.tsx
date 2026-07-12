import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

type StaffUser = { id: string; email: string; name: string | null; roles: string[] };

export function PasswordResetCard() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [userId, setUserId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) { setLoadError("Not signed in."); return; }
        const res = await fetch("/api/public/dev-list-users", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) {
          setLoadError(`Failed to load users: ${body?.error ?? res.status}`);
          return;
        }
        setUsers(body.users as StaffUser[]);
      } catch (e: any) {
        setLoadError(e?.message ?? "Failed to load users");
      }
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
              Passwords are stored as one-way hashes and cannot be viewed — you can only
              overwrite them. Share the new password securely and ask them to change it after
              signing in.
            </p>
          </div>
          {loadError && (
            <p className="text-xs text-destructive">{loadError}</p>
          )}
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">User ({users.length} accounts)</label>
            <select
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">Select a user…</option>
              {users.map((u) => {
                const label = u.name || u.email || u.id;
                const suffix = u.name && u.email ? ` — ${u.email}` : "";
                const roleTag = u.roles.length ? ` [${u.roles.join(", ")}]` : "";
                return (
                  <option key={u.id} value={u.id}>
                    {label}{suffix}{roleTag}
                  </option>
                );
              })}
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
