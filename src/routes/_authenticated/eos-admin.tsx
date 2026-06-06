import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ClipboardList, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/eos-admin")({
  component: AdminEosPage,
});

const MANILA_TZ = "Asia/Manila";
const fmt = (iso: string | null) => iso
  ? new Intl.DateTimeFormat("en-PH", { timeZone: MANILA_TZ, dateStyle: "short", timeStyle: "short" }).format(new Date(iso))
  : "—";
const peso = (n: number | string | null | undefined) => `₱${Number(n ?? 0).toFixed(2)}`;

type Row = {
  shift_id: string; user_id: string; user_email: string | null;
  business_date: string; clock_in: string; clock_out: string | null;
  starting_cash: number; break_seconds: number; worked_seconds: number;
  leave_hours: number; net_worked_hours: number; total_expenses: number;
};
type EOS = {
  shift: { id: string; user_id: string; business_date: string; clock_in: string; clock_out: string | null; starting_cash: number; notes: string | null };
  user_email: string | null; break_seconds: number; worked_seconds: number;
  leave_hours_deducted: number; net_worked_hours: number;
  payments: Array<{ method: string; gross: number; change: number; net: number; count: number }>;
  expenses: Array<{ id: string; description: string; amount: number; category: string | null; created_at: string }>;
  total_expenses: number;
  breaks: Array<{ id: string; type: "break" | "lunch"; started_at: string; ended_at: string | null }>;
};

function defaultFrom() { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0,10); }
function defaultTo()   { return new Date().toISOString().slice(0,10); }

function AdminEosPage() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<EOS | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("tc_admin_shifts", {
      p_from: from || null, p_to: to || null, p_user_id: null,
    });
    if (error) toast.error(error.message);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, []);

  const openDetail = async (shift_id: string) => {
    setDetailOpen(true); setDetail(null);
    const { data, error } = await supabase.rpc("tc_eos_report", { p_shift_id: shift_id });
    if (error) { toast.error(error.message); setDetailOpen(false); return; }
    setDetail(data as EOS);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display flex items-center gap-2">
            <ClipboardList className="h-6 w-6" /> End of Shift — Admin
          </h1>
          <p className="text-sm text-muted-foreground">Click a row to view the full shift report.</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} className="gap-2"><RefreshCw className="h-4 w-4" /> Refresh</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <Button onClick={refresh}>Apply</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Shifts</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="text-sm text-muted-foreground">Loading…</div>
            : rows.length === 0 ? <p className="text-sm text-muted-foreground">No shifts in range.</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Barista</TableHead>
                <TableHead>In</TableHead>
                <TableHead>Out</TableHead>
                <TableHead className="text-right">Net hours</TableHead>
                <TableHead className="text-right">Starting cash</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.shift_id} className="cursor-pointer hover:bg-muted/40" onClick={() => openDetail(r.shift_id)}>
                    <TableCell>{r.business_date}</TableCell>
                    <TableCell>{r.user_email ?? "—"}</TableCell>
                    <TableCell className="text-xs">{fmt(r.clock_in)}</TableCell>
                    <TableCell className="text-xs">
                      {r.clock_out ? fmt(r.clock_out) : <Badge variant="secondary">open</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{Number(r.net_worked_hours).toFixed(2)}</TableCell>
                    <TableCell className="text-right">{peso(r.starting_cash)}</TableCell>
                    <TableCell className="text-right">{peso(r.total_expenses)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Shift detail</DialogTitle></DialogHeader>
          {!detail ? <div className="text-sm text-muted-foreground">Loading…</div> : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Barista" value={detail.user_email ?? "—"} />
                <Field label="Date" value={detail.shift.business_date} />
                <Field label="Time in" value={fmt(detail.shift.clock_in)} />
                <Field label="Time out" value={detail.shift.clock_out ? fmt(detail.shift.clock_out) : "in progress"} />
                <Field label="Starting cash" value={peso(detail.shift.starting_cash)} />
                <Field label="Breaks" value={`${(detail.break_seconds / 60).toFixed(0)} min`} />
                <Field label="Leave" value={`${detail.leave_hours_deducted} h`} />
                <Field label="Net worked" value={`${detail.net_worked_hours} h`} />
              </div>

              <div>
                <div className="font-semibold mb-1">Net by payment method</div>
                {detail.payments.length === 0 ? <p className="text-muted-foreground text-xs">No paid orders.</p> : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Method</TableHead><TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {detail.payments.map((p) => (
                        <TableRow key={p.method}>
                          <TableCell className="capitalize">{p.method}</TableCell>
                          <TableCell className="text-right">{p.count}</TableCell>
                          <TableCell className="text-right font-semibold">{peso(p.net)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div>
                <div className="font-semibold mb-1">Expenses ({peso(detail.total_expenses)})</div>
                {detail.expenses.length === 0 ? <p className="text-muted-foreground text-xs">None.</p> : (
                  <ul className="text-xs space-y-1">
                    {detail.expenses.map((e) => (
                      <li key={e.id}>• {e.description}{e.category ? ` [${e.category}]` : ""} — {peso(e.amount)}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
