import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Wallet, Download, FileSpreadsheet, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { toCsv, downloadCsv } from "@/lib/csv";
import { useServerFn } from "@tanstack/react-start";
import { exportToGoogleSheets } from "@/lib/sheets.functions";

export const Route = createFileRoute("/_authenticated/expenses-report")({
  component: ExpensesReportPage,
});

const db = supabase as any;
const peso = (n: number) => `₱${Number(n || 0).toFixed(2)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString();

type Row = {
  id: string;
  shift_id: string | null;
  description: string;
  category: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount: number;
  invoice_number: string | null;
  receipt_url: string | null;
  created_at: string;
  cashier_user_id: string | null;
  cashier_email: string | null;
};

function ExpensesReportPage() {
  const { hasRole } = useAuth();
  const isDeveloper = hasRole("developer");
  const [from, setFrom] = useState(daysAgoIso(29));
  const [to, setTo] = useState(todayIso());
  const [cashierQuery, setCashierQuery] = useState("");
  const [invoiceQuery, setInvoiceQuery] = useState("");
  const [rowsAll, setRowsAll] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [sheetsBusy, setSheetsBusy] = useState(false);
  const exportSheets = useServerFn(exportToGoogleSheets);

  async function load() {
    setLoading(true);
    const startIso = new Date(`${from}T00:00:00`).toISOString();
    const endIso = new Date(`${to}T23:59:59`).toISOString();
    const { data, error } = await db.rpc("admin_list_expenses", {
      p_from: startIso, p_to: endIso,
    });
    if (error) {
      // Fallback: direct table read
      const fb = await db
        .from("shift_expenses")
        .select("id, shift_id, description, category, quantity, unit_price, amount, invoice_number, receipt_url, created_at")
        .gte("created_at", startIso).lte("created_at", endIso)
        .order("created_at", { ascending: false });
      if (fb.error) toast.error(fb.error.message);
      setRows(((fb.data ?? []) as any[]).map((r) => ({
        ...r, cashier_user_id: null, cashier_email: null,
      })) as Row[]);
    } else {
      setRows((data ?? []) as Row[]);
    }
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

  async function devDelete(id: string) {
    if (!confirm("Delete this expense permanently? (developer only)")) return;
    const { error } = await db.rpc("dev_delete_expense", { p_id: id });
    if (error) { toast.error(error.message); return; }
    toast.success("Expense deleted");
    await load();
  }

  function exportCsv() {
    const cols = ["date", "time", "invoice_number", "description", "category", "quantity", "unit_price", "amount", "cashier_email", "receipt_url"];
    const data = rows.map((r) => ({
      date: fmtDate(r.created_at),
      time: fmtTime(r.created_at),
      invoice_number: r.invoice_number ?? "",
      description: r.description,
      category: r.category ?? "",
      quantity: r.quantity ?? 1,
      unit_price: Number(r.unit_price ?? r.amount).toFixed(2),
      amount: Number(r.amount).toFixed(2),
      cashier_email: r.cashier_email ?? "",
      receipt_url: r.receipt_url ?? "",
    }));
    downloadCsv(`expenses_${from}_to_${to}.csv`, toCsv(data, cols));
  }

  async function exportSheetsBtn() {
    setSheetsBusy(true);
    try {
      const headers = ["Date", "Time", "Invoice #", "Description", "Category", "Qty", "Unit price", "Total", "Cashier", "Receipt URL"];
      const rowsArr = rows.map((r) => [
        fmtDate(r.created_at),
        fmtTime(r.created_at),
        r.invoice_number ?? "",
        r.description,
        r.category ?? "",
        String(Number(r.quantity ?? 1)),
        Number(r.unit_price ?? r.amount).toFixed(2),
        Number(r.amount).toFixed(2),
        r.cashier_email ?? "",
        r.receipt_url ?? "",
      ]);
      const res = await exportSheets({
        data: {
          title: `Bevi & Go Expenses ${from} to ${to}`,
          sheets: [{ title: "Expenses", headers, rows: rowsArr }],
        },
      });
      toast.success("Exported to Google Sheets", {
        action: { label: "Open", onClick: () => window.open(res.url, "_blank") },
        duration: 10000,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Google Sheets export failed");
    } finally {
      setSheetsBusy(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <Wallet className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-display">Expenses report</h1>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-3 w-3 mr-1" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={exportSheetsBtn} disabled={sheetsBusy || !rows.length}>
            <FileSpreadsheet className="h-3 w-3 mr-1" /> {sheetsBusy ? "Exporting…" : "Google Sheets"}
          </Button>
        </div>
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
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Item / description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Receipt</TableHead>
                  {isDeveloper && <TableHead></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDate(r.created_at)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{fmtTime(r.created_at)}</TableCell>
                    <TableCell className="text-xs">{r.invoice_number ?? "—"}</TableCell>
                    <TableCell>{r.description}</TableCell>
                    <TableCell className="text-muted-foreground">{r.category ?? "—"}</TableCell>
                    <TableCell className="text-right">{Number(r.quantity ?? 1)}</TableCell>
                    <TableCell className="text-right">{peso(Number(r.unit_price ?? r.amount))}</TableCell>
                    <TableCell className="text-right font-medium">{peso(r.amount)}</TableCell>
                    <TableCell className="text-xs">{r.cashier_email ?? "—"}</TableCell>
                    <TableCell>
                      {r.receipt_url ? (
                        <div className="flex items-center gap-2">
                          <a href={r.receipt_url} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs underline">
                            <ExternalLink className="h-3 w-3" /> view
                          </a>
                          <a href={r.receipt_url} download
                            className="inline-flex items-center gap-1 text-xs underline">
                            <Download className="h-3 w-3" /> save
                          </a>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {isDeveloper && (
                      <TableCell className="text-right">
                        <Button size="icon" variant="ghost" onClick={() => devDelete(r.id)} title="Developer delete">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
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
