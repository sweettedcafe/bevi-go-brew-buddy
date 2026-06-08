import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Wallet, Download } from "lucide-react";
import { toast } from "sonner";
import { toCsv, downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/expenses-report")({
  component: ExpensesReportPage,
});

const db = supabase as any;
const peso = (n: number) => `₱${Number(n || 0).toFixed(2)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

type Row = {
  id: string;
  shift_id: string | null;
  description: string;
  category: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount: number;
  created_at: string;
  created_by: string | null;
};

function ExpensesReportPage() {
  const [from, setFrom] = useState(daysAgoIso(6));
  const [to, setTo] = useState(todayIso());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const startIso = new Date(`${from}T00:00:00`).toISOString();
    const endIso = new Date(`${to}T23:59:59`).toISOString();
    const { data, error } = await db
      .from("shift_expenses")
      .select("id, shift_id, description, category, quantity, unit_price, amount, created_at, created_by")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  const total = useMemo(() => rows.reduce((s, r) => s + Number(r.amount || 0), 0), [rows]);
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = r.category?.trim() || "Uncategorized";
      m.set(k, (m.get(k) ?? 0) + Number(r.amount || 0));
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const byDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = new Date(r.created_at).toISOString().slice(0, 10);
      m.set(k, (m.get(k) ?? 0) + Number(r.amount || 0));
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  function exportCsv() {
    const cols = ["created_at", "description", "category", "quantity", "unit_price", "amount"];
    const data = rows.map((r) => ({
      created_at: new Date(r.created_at).toLocaleString(),
      description: r.description,
      category: r.category ?? "",
      quantity: r.quantity ?? 1,
      unit_price: Number(r.unit_price ?? r.amount).toFixed(2),
      amount: Number(r.amount).toFixed(2),
    }));
    downloadCsv(`expenses_${from}_to_${to}.csv`, toCsv(data, cols));
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <Wallet className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-display">Expenses report</h1>
        <Button size="sm" variant="outline" className="ml-auto" onClick={exportCsv} disabled={!rows.length}>
          <Download className="h-3 w-3 mr-1" /> CSV
        </Button>
      </header>

      <Card className="p-4 grid sm:grid-cols-[auto,auto,auto,1fr] gap-3 items-end">
        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Apply"}
        </Button>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Total expenses</div>
          <div className="font-display text-2xl text-primary">{peso(total)}</div>
        </div>
      </Card>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card className="p-4">
          <h2 className="font-medium text-sm mb-2">By category</h2>
          {byCategory.length === 0 ? (
            <p className="text-xs text-muted-foreground">No data.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Category</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {byCategory.map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell>{k}</TableCell>
                    <TableCell className="text-right">{peso(v)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="font-medium text-sm mb-2">By day</h2>
          {byDay.length === 0 ? (
            <p className="text-xs text-muted-foreground">No data.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {byDay.map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell>{k}</TableCell>
                    <TableCell className="text-right">{peso(v)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="font-medium text-sm mb-2">All expenses ({rows.length})</h2>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No expenses in this range.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell>{r.description}</TableCell>
                  <TableCell>{r.category ?? "—"}</TableCell>
                  <TableCell className="text-right">{Number(r.quantity ?? 1)}</TableCell>
                  <TableCell className="text-right">{peso(Number(r.unit_price ?? r.amount))}</TableCell>
                  <TableCell className="text-right font-medium">{peso(r.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
