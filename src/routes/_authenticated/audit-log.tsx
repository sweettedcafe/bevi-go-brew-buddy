import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { RefreshCw, Search, Eye, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/audit-log")({
  component: AuditLogPage,
});

const db = supabase as any;

type Row = {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  before_data: any;
  after_data: any;
  created_at: string;
};

const PAGE = 50;

function AuditLogPage() {
  const { primaryRole } = useAuth();
  const isAdmin = primaryRole === "admin" || primaryRole === "developer";
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [table, setTable] = useState<string>("all");
  const [op, setOp] = useState<string>("all");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Row | null>(null);

  async function load(p = 0) {
    setLoading(true);
    let qy = db.from("admin_audit_logs").select("*", { count: "exact" })
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59`)
      .order("created_at", { ascending: false })
      .range(p * PAGE, p * PAGE + PAGE - 1);
    if (table !== "all") qy = qy.eq("target_table", table);
    if (op !== "all") qy = qy.ilike("action", `%.${op}`);
    if (q.trim()) qy = qy.or(
      `actor_email.ilike.%${q}%,target_id.ilike.%${q}%,action.ilike.%${q}%`,
    );
    const { data, error } = await qy;
    setLoading(false);
    if (error) return;
    setRows((data ?? []) as Row[]);
    setHasMore((data?.length ?? 0) === PAGE);
    setPage(p);
  }

  useEffect(() => { if (isAdmin) void load(0); /* eslint-disable-next-line */ }, []);

  const tables = useMemo(() => {
    const s = new Set<string>(rows.map((r) => r.target_table || "").filter(Boolean));
    return ["all", ...Array.from(s).sort()];
  }, [rows]);

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-3">
        <ShieldAlert className="h-8 w-8 mx-auto text-muted-foreground" />
        <h1 className="text-xl font-display">Admins only</h1>
        <p className="text-sm text-muted-foreground">You don't have access to the audit log.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-display">Audit Log</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Every create, update, and delete across the system. Immutable history.
        </p>
      </div>

      <Card className="p-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs text-muted-foreground">From</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">To</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
        </div>
        <div className="min-w-[150px]">
          <label className="text-xs text-muted-foreground">Table</label>
          <Select value={table} onValueChange={setTable}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {tables.map((t) => (
                <SelectItem key={t} value={t}>{t === "all" ? "All tables" : t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[130px]">
          <label className="text-xs text-muted-foreground">Action</label>
          <Select value={op} onValueChange={setOp}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="create">Create</SelectItem>
              <SelectItem value="update">Update</SelectItem>
              <SelectItem value="delete">Delete</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-muted-foreground">Search (email, id, action)</label>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-3 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-8" placeholder="e.g. user@bevigo" />
          </div>
        </div>
        <Button onClick={() => load(0)} disabled={loading} size="sm">
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          Apply
        </Button>
      </Card>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No activity in this range.</Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const verb = r.action.split(".").pop() || "";
            const color = verb === "create" ? "bg-emerald-500"
              : verb === "delete" ? "bg-destructive" : "bg-amber-500";
            return (
              <Card key={r.id} className="p-3 flex items-center gap-3">
                <span className={`h-2 w-2 rounded-full ${color}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{r.action}</span>
                    {r.target_table && <Badge variant="secondary">{r.target_table}</Badge>}
                    {r.target_id && (
                      <span className="text-xs text-muted-foreground font-mono truncate max-w-[160px]">
                        #{r.target_id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {r.actor_email || (r.actor_id ? r.actor_id.slice(0, 8) : "system")}
                    {r.actor_role ? ` · ${r.actor_role}` : ""}
                    {" · "}
                    {new Date(r.created_at).toLocaleString()}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                  <Eye className="h-3.5 w-3.5 mr-1" /> View
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex justify-between items-center pt-2">
        <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => load(page - 1)}>
          ← Previous
        </Button>
        <span className="text-xs text-muted-foreground">Page {page + 1}</span>
        <Button variant="outline" size="sm" disabled={!hasMore || loading} onClick={() => load(page + 1)}>
          Next →
        </Button>
      </div>

      {detail && (
        <Dialog open onOpenChange={(o) => !o && setDetail(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-mono text-base">{detail.action}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><span className="text-muted-foreground">Actor:</span> {detail.actor_email ?? "—"}</div>
              <div><span className="text-muted-foreground">Role:</span> {detail.actor_role ?? "—"}</div>
              <div><span className="text-muted-foreground">Table:</span> {detail.target_table ?? "—"}</div>
              <div className="truncate"><span className="text-muted-foreground">Target ID:</span> <span className="font-mono">{detail.target_id ?? "—"}</span></div>
              <div className="col-span-2"><span className="text-muted-foreground">When:</span> {new Date(detail.created_at).toLocaleString()}</div>
            </div>
            <DiffView before={detail.before_data} after={detail.after_data} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function DiffView({ before, after }: { before: any; after: any }) {
  const keys = new Set<string>([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  const changed: Array<{ k: string; b: any; a: any }> = [];
  const noChange: Array<{ k: string; v: any }> = [];
  keys.forEach((k) => {
    const b = before?.[k];
    const a = after?.[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) changed.push({ k, b, a });
    else noChange.push({ k, v: a });
  });

  return (
    <div className="mt-3 space-y-3">
      {changed.length > 0 && (
        <div>
          <div className="text-xs font-medium mb-1">Changes</div>
          <div className="rounded-md border divide-y text-xs">
            {changed.map(({ k, b, a }) => (
              <div key={k} className="grid grid-cols-[120px,1fr,1fr] gap-2 p-2">
                <div className="font-mono text-muted-foreground">{k}</div>
                <div className="bg-destructive/10 rounded px-2 py-1 break-all">
                  {b === undefined || b === null ? <em className="text-muted-foreground">—</em> : String(typeof b === "object" ? JSON.stringify(b) : b)}
                </div>
                <div className="bg-emerald-500/10 rounded px-2 py-1 break-all">
                  {a === undefined || a === null ? <em className="text-muted-foreground">—</em> : String(typeof a === "object" ? JSON.stringify(a) : a)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {(before || after) && noChange.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Unchanged fields ({noChange.length})</summary>
          <pre className="mt-2 p-2 bg-muted rounded overflow-auto text-[11px]">
{JSON.stringify(after ?? before, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
