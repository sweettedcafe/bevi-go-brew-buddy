import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase, type AppRole } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/staff")({
  component: StaffPage,
});

type Row = {
  id: string;
  user_id: string;
  role: AppRole;
  created_at: string;
};

function StaffPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole("developer") || hasRole("admin");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState<AppRole>("barista");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("user_roles")
      .select("id,user_id,role,created_at")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const addRole = async () => {
    if (!newUserId.trim()) return;
    setBusy(true);
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: newUserId.trim(), role: newRole });
    if (error) toast.error(error.message);
    else { toast.success("Role assigned"); setNewUserId(""); await load(); }
    setBusy(false);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground mb-2">
        Foundation
      </p>
      <h1 className="text-4xl font-display mb-6">Staff &amp; Roles</h1>

      {canManage && (
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base">Assign role</CardTitle></CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="auth.users.id (UUID)"
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              className="font-mono text-xs"
            />
            <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
              <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="barista">Barista</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                {hasRole("developer") && <SelectItem value="developer">Developer</SelectItem>}
              </SelectContent>
            </Select>
            <Button onClick={addRole} disabled={busy || !newUserId.trim()}>
              Assign
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Current assignments</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No roles assigned yet. Add the first developer via SQL editor
              (see <code>supabase_schema.sql</code>).
            </p>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((r) => (
                <div key={r.id} className="py-3 flex items-center justify-between text-sm">
                  <div className="font-mono text-xs truncate">{r.user_id}</div>
                  <Badge variant={r.role === "developer" ? "default" : "secondary"} className="capitalize">
                    {r.role}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 text-xs text-muted-foreground">
        User IDs come from <code>auth.users</code> in the Supabase dashboard
        (Authentication → Users).
      </p>
    </div>
  );
}
