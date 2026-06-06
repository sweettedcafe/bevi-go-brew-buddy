import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase, type AppRole } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/staff")({
  component: StaffPage,
});

const db = supabase as any;

type Row = { user_id: string; email: string; role: AppRole; created_at: string };

function StaffPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole("developer") || hasRole("admin");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("barista");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await db.rpc("staff_list_assignments");
    if (error) toast.error(error.message);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const addRole = async () => {
    if (!email.trim()) return;
    setBusy(true);
    const { error } = await db.rpc("assign_role_by_email", {
      p_email: email.trim(), p_role: newRole,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${newRole} assigned to ${email}`);
    setEmail("");
    await load();
  };

  const removeRole = async (user_id: string, role: AppRole) => {
    if (!confirm(`Remove ${role} role from this user?`)) return;
    const { error } = await db.rpc("remove_role_assignment", { p_user_id: user_id, p_role: role });
    if (error) { toast.error(error.message); return; }
    toast.success("Role removed");
    await load();
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground mb-2">
        Foundation
      </p>
      <h1 className="text-4xl font-display mb-6">Staff &amp; Roles</h1>

      {canManage && (
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base">Assign role by email</CardTitle></CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-3">
            <Input
              type="email"
              placeholder="staff@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
              <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="barista">Barista</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                {hasRole("developer") && <SelectItem value="developer">Developer</SelectItem>}
              </SelectContent>
            </Select>
            <Button onClick={addRole} disabled={busy || !email.trim()}>
              Assign
            </Button>
          </CardContent>
          <p className="px-6 pb-4 text-xs text-muted-foreground">
            The person must have already signed up. If not, ask them to register at <code>/login</code> first.
          </p>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Current assignments</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No roles assigned yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((r) => (
                <div key={`${r.user_id}-${r.role}`} className="py-3 flex items-center justify-between text-sm gap-3">
                  <div className="truncate flex-1">{r.email}</div>
                  <Badge variant={r.role === "developer" ? "default" : "secondary"} className="capitalize">
                    {r.role}
                  </Badge>
                  {canManage && (
                    <Button size="icon" variant="ghost" onClick={() => removeRole(r.user_id, r.role)}
                      title="Remove role">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
