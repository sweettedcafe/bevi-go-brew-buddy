import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, History } from "lucide-react";
import { toast } from "sonner";
import { toCsv, downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/inventory-history")({
  head: () => ({
    meta: [
      { title: "Inventory Historical Report — Bevi & Go" },
      { name: "description", content: "Every stock addition, deduction and sale-based inventory change." },
      { property: "og:title", content: "Inventory Historical Report — Bevi & Go" },
      { property: "og:description", content: "Every stock addition, deduction and sale-based inventory change." },
    ],
  }),
  component: InventoryHistoryPage,
});

const db = supabase as any;
const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

type Row = {
  id: number; created_at: string; inventory_item_id: string; item_name: string | null;
  unit: string | null; delta: number; reason: string; user_name: string | null;
  user_email: string | null; entry_type: "Manual entry" | "Automatic entry";
};

function InventoryHistoryPage() {
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 7 * 86400000)));
  const [to, setTo] = useState(isoDay(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState("");
  const [user, setUser] = useState("");
  const [type, setType] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await db.rpc("inventory_history", {
      p_from: new Date(`${from}T00:00:00`).toISOString(),
      p_to: new Date(`${to}T23:59:59`).toISOString(),
    });
    if (error) toast.error(error.message.includes("inventory_history")
      ? "Run supabase_phase52_schema.sql to enable this report" : error.message);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  const userOf = (r: Row) => r.user_name || r.user_email || (r.entry_type === "Automatic entry" ? "System" : "—");
  const items = useMemo(() => [...new Set(rows.map((r) => r.item_name ?? ""))].filter(Boolean).sort(), [rows]);
  const users = useMemo(() => [...new Set(rows.map(userOf))].sort(), [rows]);
  const filtered = useMemo(() => rows.filter((r) =>
    (!item || r.item_name === item) && (!user || userOf(r) === user) && (!type || r.entry_type === type),
  ), [rows, item, user, type]);

  function exportCsv() {
    const cols = ["Date", "Time", "Quantity", "Unit", "Name of Item", "User", "Type", "Reason"];
    const data = filtered.map((r) => {
      const d = new Date(r.created_at);
      return {
        Date: isoDay(d), Time: isoTime(d), Quantity: Number(r.delta), Unit: r.unit ?? "",
        "Name of Item": r.item_name ?? "", User: userOf(r), Type: r.entry_type, Reason: r.reason,
      };
    });
    downloadCsv(`inventory-history_${from}_to_${to}.csv`, toCsv(data, cols));
    toast.success(`Exported ${data.length} row(s)`);
  }

  const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <History className="h-6 w-6" />
        <h1 className="text-2xl sm:text-3xl font-display flex-1">Inventory Historical Report</h1>
        <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-3 w-3 mr-1" /> Export CSV</Button>
      </div>
      <Card className="p-4 flex flex-wrap gap-3 items-end">
        <div><label className="text-xs text-muted-foreground block">From</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="text-xs text-muted-foreground block">To</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button size="sm" onClick={load}>Apply dates</Button>
        <div><label className="text-xs text-muted-foreground block">Item</label>
          <select className={sel} value={item} onChange={(e) => setItem(e.target.value)}>
            <option value="">All items</option>{items.map((i) => <option key={i}>{i}</option>)}
          </select></div>
        <div><label className="text-xs text-muted-foreground block">User</label>
          <select className={sel} value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">All users</option>{users.map((u) => <option key={u}>{u}</option>)}
          </select></div>
        <div><label className="text-xs text-muted-foreground block">Type of entry</label>
          <select className={sel} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option><option>Manual entry</option><option>Automatic entry</option>
          </select></div>
      </Card>
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Time</TableHead>
            <TableHead className="text-right">Quantity</TableHead><TableHead>Name of Item</TableHead>
            <TableHead>User</TableHead><TableHead>Type</TableHead><TableHead>Reason</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={7} className="text-muted-foreground">Loading…</TableCell></TableRow>
            : filtered.length === 0 ? <TableRow><TableCell colSpan={7} className="text-muted-foreground">No activity.</TableCell></TableRow>
            : filtered.map((r) => {
              const d = new Date(r.created_at); const q = Number(r.delta);
              return (
                <TableRow key={r.id}>
                  <TableCell>{isoDay(d)}</TableCell><TableCell>{isoTime(d)}</TableCell>
                  <TableCell className={`text-right font-medium ${q < 0 ? "text-destructive" : "text-primary"}`}>
                    {q > 0 ? "+" : ""}{q.toLocaleString()} {r.unit}
                  </TableCell>
                  <TableCell>{r.item_name ?? "(deleted item)"}</TableCell>
                  <TableCell>{userOf(r)}</TableCell>
                  <TableCell><Badge variant={r.entry_type === "Manual entry" ? "secondary" : "outline"}>{r.entry_type}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{r.reason}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
