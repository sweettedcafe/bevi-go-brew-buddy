import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Clock, RefreshCw, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/timeclock-report")({
  component: TimeclockReportPage,
});

const MANILA_TZ = "Asia/Manila";
const fmt = (iso: string | null) => iso
  ? new Intl.DateTimeFormat("en-PH", { timeZone: MANILA_TZ, dateStyle: "short", timeStyle: "short" }).format(new Date(iso))
  : "—";
const hrs = (sec: number) => (Number(sec) / 3600).toFixed(2);

type Row = {
  shift_id: string; user_id: string; user_email: string | null;
  business_date: string; clock_in: string; clock_out: string | null;
  starting_cash: number; break_seconds: number; worked_seconds: number;
  leave_hours: number; net_worked_hours: number; total_expenses: number;
};

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 13);
  return d.toISOString().slice(0, 10);
}
function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}

function TimeclockReportPage() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

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

  const totals = useMemo(() => {
    const m = new Map<string, { email: string; netHours: number; shifts: number }>();
    for (const r of rows) {
      const k = r.user_id;
      const cur = m.get(k) ?? { email: r.user_email ?? "—", netHours: 0, shifts: 0 };
      cur.netHours += Number(r.net_worked_hours);
      cur.shifts += 1;
      m.set(k, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.netHours - a.netHours);
  }, [rows]);

  const exportCsv = () => {
    const header = ["barista","business_date","time_in","time_out","worked_h","break_h","leave_h","net_h","expenses"];
    const lines = [header.join(",")];
    rows.forEach((r) => lines.push([
      r.user_email ?? "", r.business_date, fmt(r.clock_in), fmt(r.clock_out),
      hrs(r.worked_seconds + r.break_seconds), hrs(r.break_seconds),
      r.leave_hours, r.net_worked_hours, Number(r.total_expenses).toFixed(2),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `timeclock_${from}_to_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display flex items-center gap-2">
            <Clock className="h-6 w-6" /> Timeclock Report
          </h1>
          <p className="text-sm text-muted-foreground">Barista hours with auto-computed working time (Manila).</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2"><Download className="h-4 w-4" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={refresh} className="gap-2"><RefreshCw className="h-4 w-4" /> Refresh</Button>
        </div>
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
        <CardHeader><CardTitle>Totals by barista</CardTitle></CardHeader>
        <CardContent>
          {totals.length === 0 ? <p className="text-sm text-muted-foreground">No shifts in range.</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Barista</TableHead>
                <TableHead className="text-right">Shifts</TableHead>
                <TableHead className="text-right">Net hours</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {totals.map((t) => (
                  <TableRow key={t.email}>
                    <TableCell className="font-medium">{t.email}</TableCell>
                    <TableCell className="text-right">{t.shifts}</TableCell>
                    <TableCell className="text-right font-mono">{t.netHours.toFixed(2)} h</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Shifts</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="text-sm text-muted-foreground">Loading…</div>
            : rows.length === 0 ? <p className="text-sm text-muted-foreground">No shifts.</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Barista</TableHead>
                <TableHead>In</TableHead>
                <TableHead>Out</TableHead>
                <TableHead className="text-right">Worked</TableHead>
                <TableHead className="text-right">Break</TableHead>
                <TableHead className="text-right">Leave</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.shift_id}>
                    <TableCell>{r.business_date}</TableCell>
                    <TableCell>{r.user_email ?? "—"}</TableCell>
                    <TableCell className="text-xs">{fmt(r.clock_in)}</TableCell>
                    <TableCell className="text-xs">
                      {r.clock_out ? fmt(r.clock_out) : <Badge variant="secondary">open</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{hrs(r.worked_seconds + r.break_seconds)}</TableCell>
                    <TableCell className="text-right font-mono">{hrs(r.break_seconds)}</TableCell>
                    <TableCell className="text-right font-mono">{Number(r.leave_hours).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{Number(r.net_worked_hours).toFixed(2)}</TableCell>
                    <TableCell className="text-right">₱{Number(r.total_expenses).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
