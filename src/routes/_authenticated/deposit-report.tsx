import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Landmark, Download } from "lucide-react";
import { toast } from "sonner";
import { toCsv, downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/deposit-report")({
  head: () => ({ meta: [
    { title: "Deposit Report — Bevi & Go" },
    { name: "description", content: "All deposits recorded through expenses, by payment method and user." },
    { property: "og:title", content: "Deposit Report — Bevi & Go" },
    { property: "og:description", content: "All deposits recorded through expenses, by payment method and user." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: DepositReportPage,
});

const db = supabase as any;
const peso = (n: number) => `₱${Number(n || 0).toFixed(2)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
const isDepositCategory = (c?: string | null) => (c ?? "").toLowerCase().includes("deposit");

type Row = {
  id: string; category: string | null; amount: number; created_at: string;
  cashier_email: string | null; payment_method_code?: string | null; description?: string;
};

function DepositReportPage() {
  const [from, setFrom] = useState(daysAgoIso(29));
  const [to, setTo] = useState(todayIso());
  const [rows, setRows] = useState<Row[]>([]);
  const [methods, setMethods] = useState<Array<{ code: string; label: string; kind: string }>>([]);
  const [methodFilter, setMethodFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const label = (code?: string | null) => code
    ? methods.find((m) => m.code === code)?.label ?? code
    : methods.find((m) => m.kind === "cash")?.label ?? "Cash";

  async function load() {
    setLoading(true);
    const startIso = new Date(`${from}T00:00:00`).toISOString();
    const endIso = new Date(`${to}T23:59:59`).toISOString();
    const { data: pm } = await db.from("payment_methods").select("code, label, kind").order("sort_order");
    setMethods(pm ?? []);
    const { data, error } = await db.rpc("admin_list_expenses", { p_from: startIso, p_to: endIso });
    if (error) { toast.error(error.message); setLoading(false); return; }
    const deps = ((data ?? []) as Row[]).filter((r) => isDepositCategory(r.category));
    const details = await db.from("shift_expenses").select("id, payment_method_code")
      .in("id", deps.map((d) => d.id).slice(0, 500).length ? deps.map((d) => d.id) : ["00000000-0000-0000-0000-000000000000"]);
    const byId = new Map<string, string | null>((details.data ?? []).map((d: any) => [d.id, d.payment_method_code]));
    setRows(deps.map((r) => ({ ...r, payment_method_code: byId.get(r.id) ?? null })));
    setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  const shown = useMemo(() => rows.filter((r) => !methodFilter || (r.payment_method_code ?? "") === methodFilter), [rows, methodFilter]);
  const total = shown.reduce((s, r) => s + Number(r.amount || 0), 0);
  const byMethod = useMemo(() => {
    const m = new Map<string, number>();
    shown.forEach((r) => { const k = label(r.payment_method_code); m.set(k, (m.get(k) ?? 0) + Number(r.amount || 0)); });
    return [...m.entries()];
    // eslint-disable-next-line
  }, [shown, methods]);

  function exportCsv() {
    const cols = ["deposit_id", "date", "time", "category", "payment_method", "user", "amount"];
    downloadCsv(`deposits_${from}_to_${to}.csv`, toCsv(shown.map((r) => ({
      deposit_id: r.id.slice(0, 8).toUpperCase(),
      date: fmtDate(r.created_at), time: fmtTime(r.created_at),
      category: r.category ?? "", payment_method: label(r.payment_method_code),
      user: r.cashier_email ?? "", amount: Number(r.amount).toFixed(2),
    })), cols));
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <Landmark className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-display">Deposit report</h1>
        <Button size="sm" variant="outline" className="ml-auto" onClick={exportCsv} disabled={!shown.length}>
          <Download className="h-3 w-3 mr-1" /> CSV
        </Button>
      </header>
      <p className="text-xs text-muted-foreground">
        Deposits come from End of Shift expenses with a "Deposit" category. Each deposit is deducted from the payment
        method chosen (e.g. E-Wallet). To fix a wrong amount, add another Deposit expense with a positive or negative value.
      </p>
      <Card className="p-4 grid gap-3 items-end sm:grid-cols-2 lg:grid-cols-[auto,auto,1fr,auto,auto]">
        <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div>
          <Label className="text-xs">Payment method</Label>
          <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
            <option value="">All</option>
            {methods.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </div>
        <Button size="sm" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Apply"}</Button>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Total deposits</div>
          <div className="font-display text-2xl text-primary">{peso(total)}</div>
        </div>
      </Card>
      {byMethod.length > 0 && (
        <Card className="p-4 flex flex-wrap gap-4">
          {byMethod.map(([k, v]) => (
            <div key={k}><div className="text-xs text-muted-foreground">{k}</div><div className="font-medium">{peso(v)}</div></div>
          ))}
        </Card>
      )}
      <Card className="p-4">
        <h2 className="font-medium text-sm mb-2">Deposits ({shown.length})</h2>
        {shown.length === 0 ? (
          <p className="text-xs text-muted-foreground">No deposits in this range. Record one as an expense with a "Deposit" category.</p>
        ) : (
          <div className="overflow-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Deposit ID</TableHead><TableHead>Date</TableHead><TableHead>Time</TableHead>
                <TableHead>Category</TableHead><TableHead>Payment Method</TableHead><TableHead>User</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.id.slice(0, 8).toUpperCase()}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDate(r.created_at)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmtTime(r.created_at)}</TableCell>
                    <TableCell>{r.category}</TableCell>
                    <TableCell>{label(r.payment_method_code)}</TableCell>
                    <TableCell className="text-xs">{r.cashier_email ?? "—"}</TableCell>
                    <TableCell className={`text-right font-medium ${Number(r.amount) < 0 ? "text-destructive" : ""}`}>{peso(r.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
