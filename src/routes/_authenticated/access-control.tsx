import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase, type AppRole } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { GROUPS } from "@/routes/_authenticated";
import { PasswordResetCard } from "@/components/PasswordResetCard";

export const Route = createFileRoute("/_authenticated/access-control")({
  component: AccessControlPage,
});

const db = supabase as any;

// Non-developer roles that can receive extra grants.
const GRANTABLE_ROLES: AppRole[] = ["barista", "accountant", "partner", "admin"];

type Grant = { role: AppRole; path: string; allowed: boolean };

function AccessControlPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole("developer") || hasRole("admin");
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await db.from("role_access_grants").select("*");
    if (error) toast.error(error.message);
    setGrants(((data ?? []) as any[]).map((r) => ({ role: r.role, path: r.path, allowed: r.allowed !== false })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const grantMap = useMemo(
    () => new Map(grants.map((g) => [`${g.role}:${g.path}`, g.allowed])),
    [grants],
  );

  // Every menu item except developer-only items.
  const rows = useMemo(() => {
    const out: Array<{ groupLabel: string; label: string; path: string; defaults: AppRole[] }> = [];
    for (const g of GROUPS) {
      for (const it of g.items) {
        const isDevOnly = it.roles.length === 1 && it.roles[0] === "developer";
        if (isDevOnly) continue;
        out.push({ groupLabel: g.label, label: it.label, path: it.to, defaults: it.roles });
      }
    }
    return out;
  }, []);

  const toggle = async (role: AppRole, path: string, next: boolean) => {
    if (!canManage) return;
    const key = `${role}:${path}`;
    setBusyKey(key);
    const isDefault = rows.find((r) => r.path === path)?.defaults.includes(role) ?? false;
    // Default ON + unchecked → store an "off" row. Extra ON → store an "on" row. Otherwise remove the row.
    const needsRow = isDefault ? !next : next;
    const without = (prev: Grant[]) => prev.filter((g) => !(g.role === role && g.path === path));
    if (needsRow) {
      const { error } = await db.from("role_access_grants")
        .upsert({ role, path, allowed: next }, { onConflict: "role,path" });
      if (error) toast.error(/allowed/.test(error.message) ? "Run supabase_phase53_schema.sql first." : error.message);
      else setGrants((prev) => [...without(prev), { role, path, allowed: next }]);
    } else {
      const { error } = await db.from("role_access_grants").delete().eq("role", role).eq("path", path);
      if (error) toast.error(error.message);
      else setGrants(without);
    }
    setBusyKey(null);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground mb-2">Settings</p>
      <h1 className="text-4xl font-display mb-2">Access Control</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Grant additional menu access to non-developer roles. Developer Tools cannot be shared.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Menu access grants</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b">
                    <th className="py-2 pr-4">Menu item</th>
                    <th className="py-2 pr-4">Default roles</th>
                    {GRANTABLE_ROLES.map((r) => (
                      <th key={r} className="py-2 px-3 capitalize text-center">{r}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.path} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{row.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.groupLabel} · <code>{row.path}</code>
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap gap-1">
                          {row.defaults.map((r) => (
                            <Badge key={r} variant="secondary" className="capitalize text-[10px]">{r}</Badge>
                          ))}
                        </div>
                      </td>
                      {GRANTABLE_ROLES.map((r) => {
                        const isDefault = row.defaults.includes(r);
                        const stored = grantMap.get(`${r}:${row.path}`);
                        const checked = stored === undefined ? isDefault : stored;
                        const key = `${r}:${row.path}`;
                        return (
                          <td key={r} className="py-2 px-3 text-center">
                            <Checkbox
                              checked={checked}
                              disabled={!canManage || busyKey === key}
                              onCheckedChange={(v) => toggle(r, row.path, !!v)}
                              aria-label={`Grant ${row.label} to ${r}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-4">
                Every box can be switched on or off, including default access. Changes take effect the next time
                that user reloads the app. Admins always keep access to this page.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && <PasswordResetCard />}
    </div>
  );
}
