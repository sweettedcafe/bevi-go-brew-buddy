import { createFileRoute } from "@tanstack/react-router";
import { forwardRef, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ClipboardList, Plus, Trash2, RefreshCw, Share2, Copy, Camera } from "lucide-react";
import { toPng } from "html-to-image";

export const Route = createFileRoute("/_authenticated/end-of-shift")({
  head: () => ({ meta: [
    { title: "End of Shift — Bevi & Go" },
    { name: "description", content: "Shift expenses, payment balances, and shareable daily summaries." },
    { property: "og:title", content: "End of Shift — Bevi & Go" },
    { property: "og:description", content: "Shift expenses, payment balances, and shareable daily summaries." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: EndOfShiftPage,
});

const MANILA_TZ = "Asia/Manila";
const fmtDate = (iso: string | null) => iso
  ? new Intl.DateTimeFormat("en-PH", { timeZone: MANILA_TZ, dateStyle: "medium" }).format(new Date(iso))
  : "—";
const fmtClock = (iso: string | null) => iso
  ? new Intl.DateTimeFormat("en-PH", { timeZone: MANILA_TZ, timeStyle: "short" }).format(new Date(iso))
  : "—";
const fmtTime = (iso: string | null) => iso
  ? new Intl.DateTimeFormat("en-PH", { timeZone: MANILA_TZ, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
  : "—";
const peso = (n: number | string | null | undefined) => `₱${Number(n ?? 0).toFixed(2)}`;

type EOS = {
  shift: {
    id: string; user_id: string; business_date: string;
    clock_in: string; clock_out: string | null; starting_cash: number; notes: string | null;
  };
  user_email: string | null;
  break_seconds: number;
  worked_seconds: number;
  leave_hours_deducted: number;
  net_worked_hours: number;
  payments: Array<{ method: string; gross: number; change: number; net: number; count: number }>;
  expenses: Array<{ id: string; description: string; amount: number; quantity?: number | null; unit_price?: number | null; category: string | null; created_at: string; invoice_number?: string | null; receipt_url?: string | null; payment_method_code?: string | null; reason?: string | null }>;
  total_expenses: number;
  breaks: Array<{ id: string; type: "break" | "lunch"; started_at: string; ended_at: string | null }>;
};

type Balance = { code: string; label: string; kind: string; starting: number; sales: number; expenses: number };
type PMOpt = { code: string; label: string; kind: string; is_active: boolean; owner_only?: boolean };
const sumBy = (rows: Balance[], k: "starting" | "sales" | "expenses") => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);

// Back-tracking: a past business date's summary comes from tc_eos_day_report.
type DayShift = { user_email: string | null; clock_in: string; clock_out: string | null };
type DayReport = { business_date: string; shifts: DayShift[]; balances: Balance[] };
type Summary = {
  date: string;        // business date (YYYY-MM-DD)
  suffix: string;      // "Current day" for the live shift, the date for a past day
  baristas: string;
  time_in: string;
  time_out: string;
  balances: Balance[];
};
const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: MANILA_TZ }).format(new Date());
const fmtDay = (d: string) => new Intl.DateTimeFormat("en-PH", { timeZone: MANILA_TZ, dateStyle: "medium" })
  .format(new Date(`${d}T12:00:00Z`));

type ExpenseCategory = { id: string; name: string; sort_order: number; is_active: boolean };

type ReqKey = "description" | "invoice_number" | "quantity" | "unit_price" | "category" | "payment_method" | "reason" | "receipt";
type ReqFields = Record<ReqKey, boolean>;
const LOCKED_REQ: Partial<ReqFields> = { description: true, quantity: true, unit_price: true };
const DEFAULT_REQ: ReqFields = {
  description: true, invoice_number: false, quantity: true, unit_price: true,
  category: false, payment_method: true, reason: false, receipt: false,
};
const REQ_LABELS: Array<[ReqKey, string]> = [
  ["description", "Item / description"], ["invoice_number", "Invoice #"], ["quantity", "Quantity"],
  ["unit_price", "Unit price"], ["category", "Category"], ["payment_method", "Payment method"],
  ["reason", "Reason"], ["receipt", "Receipt photo"],
];

// Keep only digits plus one decimal point, with an optional leading minus.
const decimalText = (raw: string) => {
  const neg = raw.trim().startsWith("-");
  let out = raw.replace(/[^0-9.]/g, "");
  const dot = out.indexOf(".");
  if (dot >= 0) out = out.slice(0, dot + 1) + out.slice(dot + 1).replace(/\./g, "");
  return (neg ? "-" : "") + out;
};

const toggleSign = (v: string) => {
  const t = v.trim();
  if (!t || t === "-") return "-";
  return t.startsWith("-") ? t.slice(1) : `-${t}`;
};

function SignToggle({ value, onToggle, label }: { value: string; onToggle: () => void; label: string }) {
  return (
    <Button type="button" size="sm"
      variant={value.trim().startsWith("-") ? "destructive" : "outline"}
      className="h-9 min-w-10 shrink-0 px-0 text-base font-semibold leading-none"
      title="Make negative / positive" aria-label={label} onClick={onToggle}>
      ±
    </Button>
  );
}

function EndOfShiftPage() {
  const { primaryRole } = useAuth();
  const isAdmin = primaryRole === "admin" || primaryRole === "developer";
  const [report, setReport] = useState<EOS | null>(null);
  const [loading, setLoading] = useState(true);
  const [upsellStats, setUpsellStats] = useState<{ offers: number; added: number; skipped: number } | null>(null);

  // expense form
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [category, setCategory] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [expMethod, setExpMethod] = useState("");
  const [reason, setReason] = useState("");
  const [pms, setPms] = useState<PMOpt[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

  // starting cash — declared once a day by the FIRST shifter only
  const [cashInput, setCashInput] = useState("");
  const [prevClosing, setPrevClosing] = useState<number | null>(null);
  const [savingCash, setSavingCash] = useState(false);
  const [canSetCash, setCanSetCash] = useState(false);


  // admin-managed expense categories
  const [expCats, setExpCats] = useState<ExpenseCategory[]>([]);
  const [catDialog, setCatDialog] = useState(false);
  // admin-chosen required expense fields
  const [reqFields, setReqFields] = useState<ReqFields>(DEFAULT_REQ);
  const [reqDialog, setReqDialog] = useState(false);
  const loadReq = async () => {
    const { data } = await (supabase as any).from("app_settings").select("value").eq("key", "expense_required_fields").maybeSingle();
    if (data?.value) setReqFields({ ...DEFAULT_REQ, ...data.value, ...LOCKED_REQ });
  };
  useEffect(() => { void loadReq(); }, []);
  const saveReq = async (next: ReqFields) => {
    setReqFields(next);
    const { error } = await (supabase as any).from("app_settings")
      .upsert({ key: "expense_required_fields", value: next, updated_at: new Date().toISOString() });
    if (error) toast.error(/app_settings/.test(error.message) ? "Please run supabase_phase56_schema.sql first." : error.message);
  };
  const [newCat, setNewCat] = useState("");

  const loadCats = async () => {
    const { data } = await (supabase as any)
      .from("expense_categories").select("*").eq("is_active", true).order("sort_order");
    setExpCats((data ?? []) as ExpenseCategory[]);
  };
  useEffect(() => { void loadCats(); }, []);

  const addCategory = async () => {
    const name = newCat.trim();
    if (!name) return;
    const { error } = await (supabase as any).from("expense_categories")
      .insert({ name, sort_order: expCats.length + 1 });
    if (error) { toast.error(error.message); return; }
    setNewCat(""); await loadCats();
  };
  const renameCategory = async (id: string, name: string) => {
    const v = name.trim();
    if (!v) return;
    const { error } = await (supabase as any).from("expense_categories").update({ name: v }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    await loadCats();
  };
  const deleteCategory = async (id: string) => {
    if (!confirm("Delete this category?")) return;
    const { error } = await (supabase as any).from("expense_categories").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    await loadCats();
  };

  const saveStartingCash = async () => {
    const v = Number(cashInput);
    if (!Number.isFinite(v) || v < 0) { toast.error("Enter a valid amount"); return; }
    setSavingCash(true);
    const { error } = await (supabase as any).rpc("tc_set_starting_cash", { p_amount: v });
    setSavingCash(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Starting cash saved");
    setCashInput("");
    await refresh();
  };

  const editStartingCash = async () => {
    const v = Number(cashInput);
    if (!Number.isFinite(v) || v < 0) { toast.error("Enter a valid amount"); return; }
    setSavingCash(true);
    const { error } = await (supabase as any).rpc("tc_edit_starting_cash", {
      p_amount: v, p_shift_id: report?.shift.id ?? null,
    });
    setSavingCash(false);
    if (error) {
      toast.error(/function|does not exist|schema cache/i.test(error.message)
        ? "Run supabase_phase51_schema.sql to enable editing starting cash."
        : error.message);
      return;
    }
    toast.success("Starting cash updated");
    setCashInput("");
    await refresh();
  };
  // Auto-apply yesterday's closing as today's starting cash (first shift, not yet declared).
  const autoAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    const s = report?.shift;
    if (!s || !canSetCash || s.clock_out || prevClosing == null) return;
    if (Number(s.starting_cash) !== 0 || autoAppliedRef.current === s.id) return;
    autoAppliedRef.current = s.id;
    (async () => {
      const { error } = await (supabase as any).rpc("tc_set_starting_cash", { p_amount: prevClosing });
      if (!error) await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.shift?.id, report?.shift?.starting_cash, canSetCash, prevClosing]);


  const refresh = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("tc_eos_report", { p_shift_id: null });
    if (error) {
      toast.error(error.message);
      setReport(null);
      setUpsellStats(null);
    } else {
      setReport(data as EOS);
      const shiftId = (data as EOS | null)?.shift?.id ?? null;
      const { data: us } = await (supabase as any).rpc("shift_upsell_stats", { p_shift_id: shiftId });
      const { data: prev } = await (supabase as any).rpc("tc_prev_closing_cash");
      setPrevClosing(prev == null ? null : Number(prev));
      const { data: st } = await (supabase as any).rpc("tc_starting_cash_state");
      setCanSetCash(Boolean(st?.can_set));
      const { data: pmData } = await (supabase as any).from("payment_methods").select("*").order("sort_order");
      const pmRows = ((pmData ?? []) as any[]).map((m) => ({ code: m.code, label: m.label, kind: m.kind, is_active: m.is_active, owner_only: !!m.owner_only }));
      setPms(pmRows);
      setExpMethod((cur) => cur || (pmRows.find((m) => m.kind === "cash" && !m.owner_only)?.code ?? ""));
      const { data: bal, error: balErr } = await (supabase as any).rpc("tc_eos_balances", { p_shift_id: shiftId });
      if (balErr) console.warn("[eos] balances unavailable — run supabase_phase53_schema.sql", balErr.message);
      setBalances(((bal ?? []) as Balance[]));

      if (us) setUpsellStats({
        offers: Number(us.offers ?? 0),
        added: Number(us.added ?? 0),
        skipped: Number(us.skipped ?? 0),
      });
    }
    setLoading(false);
  };
  useEffect(() => { void refresh(); }, []);

  // Shift summary date filter: browse a past business date's summary.
  const [viewDate, setViewDate] = useState("");
  const [dayReport, setDayReport] = useState<DayReport | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);
  const bizDate = report?.shift.business_date ?? "";
  const picked = !report
    ? (viewDate || manilaToday())
    : (viewDate && viewDate !== bizDate ? viewDate : "");

  useEffect(() => {
    if (!picked) { setDayReport(null); setDayError(null); setDayLoading(false); return; }
    let alive = true;
    setDayLoading(true); setDayError(null);
    (async () => {
      const { data, error } = await (supabase as any).rpc("tc_eos_day_report", { p_date: picked });
      if (!alive) return;
      setDayLoading(false);
      if (error) {
        setDayReport(null);
        setDayError(/does not exist|schema cache|tc_eos_day_report/i.test(error.message)
          ? "Please run supabase_phase60_schema.sql to enable viewing past days."
          : error.message);
        return;
      }
      setDayReport((data ?? { business_date: picked, shifts: [], balances: [] }) as DayReport);
    })();
    return () => { alive = false; };
  }, [picked]);

  async function uploadReceipt(file: File): Promise<string | null> {
    setUploadingReceipt(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `receipts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await (supabase.storage.from("expense-receipts") as any).upload(path, file, {
        upsert: false, contentType: file.type || undefined,
      });
      if (upErr) throw upErr;
      const { data: pub } = (supabase.storage.from("expense-receipts") as any).getPublicUrl(path);
      return pub?.publicUrl ?? null;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/bucket/i.test(msg) && /not found/i.test(msg)) {
        toast.error("Receipt bucket missing. Run supabase_phase25_schema.sql to create the 'expense-receipts' bucket. Saving expense without image.");
      } else {
        toast.error(`Upload failed: ${msg}. You can still save the expense without the image.`);
      }
      return null;
    } finally {
      setUploadingReceipt(false);
    }
  }

  const addExpense = async () => {
    const q = Number(qty);
    const up = Number(unitPrice);
    if (!desc.trim()) { toast.error("Description required"); return; }
    if (!Number.isFinite(q) || q === 0) { toast.error("Quantity cannot be 0"); return; }
    if (!Number.isFinite(up)) { toast.error("Enter a unit price"); return; }
    const missing: string[] = [];
    if (reqFields.invoice_number && !invoiceNo.trim()) missing.push("Invoice #");
    if (reqFields.category && !category.trim()) missing.push("Category");
    if (reqFields.payment_method && !expMethod) missing.push("Payment method");
    if (reqFields.reason && !reason.trim()) missing.push("Reason");
    if (reqFields.receipt && !receiptFile) missing.push("Receipt");
    if (missing.length) { toast.error(`Please fill in: ${missing.join(", ")}`); return; }
    if (q * up < 0 && !reason.trim()) { toast.error("Reason is required for a negative entry"); return; }
    let receiptUrl: string | null = null;
    if (receiptFile) {
      receiptUrl = await uploadReceipt(receiptFile);
    }
    const { error } = await (supabase as any).rpc("tc_add_expense_v4", {
      p_description: desc.trim(),
      p_quantity: q,
      p_unit_price: up,
      p_category: category.trim() || null,
      p_invoice_number: invoiceNo.trim() || null,
      p_receipt_url: receiptUrl,
      p_payment_method_code: expMethod,
      p_reason: reason.trim() || null,
    });
    if (error) {
      toast.error(/tc_add_expense_v4/.test(error.message)
        ? "Please run supabase_phase53_schema.sql on your database first."
        : error.message);
      return;
    }
    toast.success("Expense saved");
    setDesc(""); setQty("1"); setUnitPrice(""); setCategory("");
    setInvoiceNo(""); setReceiptFile(null); setReason("");
    await refresh();
  };
  const deleteExpense = async (id: string) => {
    const { error } = await supabase.rpc("tc_delete_expense", { p_id: id });
    if (error) { toast.error(error.message); return; }
    await refresh();
  };

  const pmLabel = (code?: string | null) =>
    code ? (pms.find((m) => m.code === code)?.label ?? code) : (pms.find((m) => m.kind === "cash")?.label ?? "Cash");
  const expenseMethodOptions = pms.filter((m) =>
    m.is_active && (m.owner_only ? isAdmin : (m.kind === "cash" || m.kind === "transfer")));
  // Owner-only (bank account) expenses never appear on the End of Shift report.
  const ownerOnlyCodes = new Set(pms.filter((m) => m.owner_only).map((m) => m.code));
  const visibleExpenses = (report?.expenses ?? []).filter((e) =>
    !e.payment_method_code || (!ownerOnlyCodes.has(e.payment_method_code) && (isAdmin || pms.some((m) => m.code === e.payment_method_code))));
  const visibleExpenseTotal = visibleExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const canExpenseWithoutShift = isAdmin || primaryRole === "partner";
  const shiftClosed = !!report?.shift.clock_out;

  const summary: Summary | null = picked
    ? (dayReport ? summaryFromDay(dayReport) : null)
    : (report ? summaryFromShift(report, balances) : null);
  const summaryText = summary ? buildSummary(summary) : "";
  const receiptRef = useRef<HTMLDivElement>(null);

  const copySummary = async () => {
    try { await navigator.clipboard.writeText(summaryText); toast.success("Summary copied"); }
    catch { toast.error("Copy failed"); }
  };
  const shareSummary = async () => {
    if (typeof navigator !== "undefined" && (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }).share) {
      try { await navigator.share({ title: "End of Shift Report", text: summaryText }); }
      catch { /* user cancelled */ }
    } else {
      void copySummary();
    }
  };
  const saveAsImage = async () => {
    if (!receiptRef.current) return;
    try {
      const dataUrl = await toPng(receiptRef.current, {
        pixelRatio: 2,

        cacheBust: true,
      });
      const a = document.createElement("a");
      const date = summary?.date ?? "shift";
      a.href = dataUrl;
      a.download = `shift-summary-${date}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success("Saved to your device");
    } catch (e) {
      toast.error("Could not save image");
    }
  };

  const expensesCard = (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Expenses</CardTitle>
              {isAdmin && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setReqDialog(true)}>
                    Required fields
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setCatDialog(true)}>
                    Manage categories
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {shiftClosed ? (
                <p className="text-xs text-muted-foreground">Shift is closed — expenses are read-only.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2 items-end">
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Label htmlFor="exp-desc">Item / description{reqFields.description && <span className="text-destructive"> *</span>}</Label>
                    <Input id="exp-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Whole milk 1L" />
                  </div>
                  <div className="lg:col-span-2">
                    <Label htmlFor="exp-inv">Invoice #{reqFields.invoice_number && <span className="text-destructive"> *</span>}</Label>
                    <Input id="exp-inv" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="OR / SI #" />
                  </div>
                  <div className="lg:col-span-2">
                    <Label htmlFor="exp-qty">Qty{reqFields.quantity && <span className="text-destructive"> *</span>}</Label>
                    <div className="flex gap-1">
                      <SignToggle value={qty} label="Toggle negative quantity" onToggle={() => setQty((v) => toggleSign(v))} />
                      <Input id="exp-qty" type="text" inputMode="decimal" autoComplete="off" className="min-w-0" value={qty} onChange={(e) => setQty(decimalText(e.target.value))} />
                    </div>
                  </div>
                  <div className="lg:col-span-2">
                    <Label htmlFor="exp-unit">Unit price (₱){reqFields.unit_price && <span className="text-destructive"> *</span>}</Label>
                    <div className="flex gap-1">
                      <SignToggle value={unitPrice} label="Toggle negative unit price" onToggle={() => setUnitPrice((v) => toggleSign(v))} />
                      <Input id="exp-unit" type="text" inputMode="decimal" autoComplete="off" className="min-w-0" placeholder="0.00" value={unitPrice} onChange={(e) => setUnitPrice(decimalText(e.target.value))} />
                    </div>
                  </div>
                  <div className="lg:col-span-1">
                    <Label>Total</Label>
                    <div className="h-9 flex items-center px-3 rounded-md border bg-muted/30 text-sm font-medium">
                      {peso((Number(qty) || 0) * (Number(unitPrice) || 0))}
                    </div>
                  </div>
                  <div className="lg:col-span-2">
                    <Label htmlFor="exp-cat">Category{reqFields.category && <span className="text-destructive"> *</span>}</Label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger id="exp-cat"><SelectValue placeholder="Pick" /></SelectTrigger>
                      <SelectContent>
                        {expCats.map((c) => (
                          <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="lg:col-span-2">
                    <Label htmlFor="exp-pm">Payment method{reqFields.payment_method && <span className="text-destructive"> *</span>}</Label>
                    <Select value={expMethod} onValueChange={setExpMethod}>
                      <SelectTrigger id="exp-pm"><SelectValue placeholder="Pick" /></SelectTrigger>
                      <SelectContent>
                        {expenseMethodOptions.map((m) => (
                          <SelectItem key={m.code} value={m.code}>
                            {m.label}{m.owner_only ? " (owner only)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-4">
                    <Label htmlFor="exp-reason">Reason{reqFields.reason && <span className="text-destructive"> *</span>}</Label>
                    <Input id="exp-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                      placeholder="Required for negative / correction entries" />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Label htmlFor="exp-img" className="text-xs">Receipt{reqFields.receipt && <span className="text-destructive"> *</span>}</Label>
                    <Input id="exp-img" type="file" accept="image/*"
                      onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />
                  </div>
                  <p className="sm:col-span-2 lg:col-span-12 text-xs text-muted-foreground">
                    To cancel a wrong entry, tap ± beside Qty or Unit price to make it negative, then write the reason.
                  </p>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Button onClick={addExpense} disabled={uploadingReceipt} className="w-full gap-1">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {visibleExpenses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No expenses recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Receipt</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleExpenses.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs">{fmtDate(e.created_at)}</TableCell>
                        <TableCell className="text-xs">{fmtClock(e.created_at)}</TableCell>
                        <TableCell className="text-xs">{e.invoice_number ?? "—"}</TableCell>
                        <TableCell>{e.description}</TableCell>
                        <TableCell className="text-muted-foreground">{e.category ?? "—"}</TableCell>
                        <TableCell className="text-xs">{pmLabel(e.payment_method_code)}</TableCell>
                        <TableCell className="text-right">{Number(e.quantity ?? 1)}</TableCell>
                        <TableCell className="text-right">{peso(e.unit_price ?? e.amount)}</TableCell>
                        <TableCell className={`text-right font-medium ${Number(e.amount) < 0 ? "text-destructive" : ""}`}>{peso(e.amount)}</TableCell>
                        <TableCell className="text-xs">{e.reason ?? "—"}</TableCell>
                        <TableCell>
                          {e.receipt_url ? (
                            <div className="flex items-center gap-2">
                              <a href={e.receipt_url} target="_blank" rel="noreferrer" className="text-xs underline">view</a>
                              <a href={e.receipt_url} download className="text-xs underline">download</a>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {!shiftClosed && (
                            <Button size="icon" variant="ghost" onClick={() => deleteExpense(e.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={8} className="text-right font-semibold">Total expenses</TableCell>
                      <TableCell className="text-right font-semibold">{peso(visibleExpenseTotal)}</TableCell>
                      <TableCell colSpan={3} />
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display flex items-center gap-2">
            <ClipboardList className="h-6 w-6" /> End of Shift Report
          </h1>
          <p className="text-sm text-muted-foreground">Latest shift summary in Manila time.</p>
        </div>
        <div className="flex gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2"><Share2 className="h-4 w-4" /> Share summary</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Shift summary</DialogTitle></DialogHeader>
                <div className="flex items-end gap-2 border-b pb-3">
                  <div className="flex-1">
                    <Label htmlFor="summary-date">Show summary for</Label>
                    <Input id="summary-date" type="date" max={manilaToday()}
                      value={viewDate || bizDate || manilaToday()}
                      onChange={(e) => setViewDate(e.target.value)} />
                  </div>
                  <Button size="sm" variant="outline" disabled={!picked || !report}
                    onClick={() => setViewDate("")}>Latest shift</Button>
                </div>
                <div className="max-h-[70vh] overflow-y-auto -mx-2 px-2">
                  {dayLoading ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
                  ) : dayError ? (
                    <p className="py-10 text-center text-sm text-destructive">{dayError}</p>
                  ) : summary ? (
                    <ShiftReceipt ref={receiptRef} summary={summary} />
                  ) : null}
                </div>
                <DialogFooter className="gap-2 flex-wrap">
                  <Button variant="outline" onClick={copySummary} disabled={!summary} className="gap-2"><Copy className="h-4 w-4" /> Copy text</Button>
                  <Button variant="outline" onClick={shareSummary} disabled={!summary} className="gap-2"><Share2 className="h-4 w-4" /> Share</Button>
                  <Button onClick={saveAsImage} disabled={!summary} className="gap-2"><Camera className="h-4 w-4" /> Save image</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          <Button variant="outline" size="sm" onClick={refresh} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : !report ? (
        <>
          <Card><CardContent className="py-8 text-sm text-muted-foreground">
            {canExpenseWithoutShift
              ? "You haven't timed in — you can still record expenses below. They're added to today's business day."
              : "No shift found. Time in from the Timeclock page to start one."}
          </CardContent></Card>
          {canExpenseWithoutShift && expensesCard}
        </>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>Shift details</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <Field label="Barista" value={report.user_email ?? "—"} />
                <Field label="Business date" value={report.shift.business_date} />
                <Field label="Time in" value={fmtTime(report.shift.clock_in)} />
                <Field label="Time out" value={report.shift.clock_out ? fmtTime(report.shift.clock_out) : <Badge variant="secondary">In progress</Badge>} />
                <Field label="Starting balance (total)" value={peso(balances.reduce((s, b) => s + Number(b.starting || 0), 0))} />
                <Field label="Breaks (total)" value={`${(report.break_seconds / 60).toFixed(0)} min`} />
                <Field label="Approved leave deduction" value={`${report.leave_hours_deducted} h`} />
                <Field label="Net worked hours" value={`${report.net_worked_hours} h`} />
                <Field
                  label="Upsell rate"
                  value={
                    upsellStats && upsellStats.offers > 0
                      ? `${((upsellStats.added / upsellStats.offers) * 100).toFixed(1)}% (${upsellStats.added}/${upsellStats.offers})`
                      : "—"
                  }
                />
                <Field
                  label="Skip rate"
                  value={
                    upsellStats && upsellStats.offers > 0
                      ? `${((upsellStats.skipped / upsellStats.offers) * 100).toFixed(1)}%`
                      : "—"
                  }
                />
              </div>
              {isAdmin ? (
                <div className="mt-4 rounded-md border p-3 space-y-2">
                  <Label htmlFor="edit-start-cash">
                    Edit starting cash for {report.shift.business_date} (currently {peso(report.shift.starting_cash)})
                  </Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input id="edit-start-cash" type="number" min="0" step="0.01" className="w-40"
                      placeholder={Number(report.shift.starting_cash).toFixed(2)}
                      value={cashInput} onChange={(e) => setCashInput(e.target.value)} />
                    {prevClosing != null && (
                      <Button size="sm" variant="outline" onClick={() => setCashInput(prevClosing.toFixed(2))}>
                        Use yesterday's closing ({peso(prevClosing)})
                      </Button>
                    )}
                    <Button size="sm" onClick={editStartingCash} disabled={savingCash}>Update</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Starting cash is filled in automatically from yesterday's closing. Only admins and developers
                    can correct it here if there's an issue.
                  </p>
                </div>
              ) : (
                <p className="mt-4 text-xs text-muted-foreground">
                  Starting cash is set automatically from yesterday's closing
                  {prevClosing != null ? ` (${peso(prevClosing)})` : ""}. Ask an admin if it needs correcting.
                </p>
              )}



              {report.breaks.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs text-muted-foreground mb-1">Breaks</div>
                  <div className="flex flex-wrap gap-2">
                    {report.breaks.map((b) => (
                      <Badge key={b.id} variant="outline" className="capitalize">
                        {b.type}: {fmtTime(b.started_at)} → {b.ended_at ? fmtTime(b.ended_at) : "ongoing"}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Net by payment method · {report.shift.business_date}</CardTitle>
            </CardHeader>
            <CardContent>
              {balances.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payment methods set up yet (Settings → Payment Methods).</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead className="text-right">Expenses</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balances.map((b) => (
                      <TableRow key={b.code}>
                        <TableCell className="font-medium">{b.label}</TableCell>
                        <TableCell className="text-right">{peso(b.sales)}</TableCell>
                        <TableCell className="text-right">{peso(b.expenses)}</TableCell>
                        <TableCell className="text-right font-semibold">{peso(Number(b.sales) - Number(b.expenses))}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="text-right font-semibold">Total</TableCell>
                      <TableCell className="text-right font-semibold">{peso(sumBy(balances, "sales"))}</TableCell>
                      <TableCell className="text-right font-semibold">{peso(sumBy(balances, "expenses"))}</TableCell>
                      <TableCell className="text-right font-semibold">{peso(sumBy(balances, "sales") - sumBy(balances, "expenses"))}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>


        </>
      )}

      <Dialog open={reqDialog} onOpenChange={setReqDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Required expense fields</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Ticked fields must be filled in before anyone can save an expense.</p>
          <div className="space-y-2">
            {REQ_LABELS.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={!!reqFields[k]}
                  disabled={k in LOCKED_REQ}
                  onChange={(e) => void saveReq({ ...reqFields, [k]: e.target.checked })} />
                {label}{k in LOCKED_REQ && <span className="text-xs text-muted-foreground">(always required)</span>}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReqDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={catDialog} onOpenChange={setCatDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Expense categories</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {expCats.length === 0 && (
              <p className="text-sm text-muted-foreground">No categories yet.</p>
            )}
            {expCats.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <Input defaultValue={c.name}
                  onBlur={(e) => { if (e.target.value.trim() !== c.name) void renameCategory(c.id, e.target.value); }} />
                <Button size="icon" variant="ghost" onClick={() => deleteCategory(c.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 border-t pt-3">
            <Input placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
            <Button onClick={addCategory} className="gap-1"><Plus className="h-4 w-4" /> Add</Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialog(false)}>Close</Button>
          </DialogFooter>
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

const balanceSections = (suffix: string): Array<{ title: string; totalLabel: string; value: (b: Balance) => number }> => [
  { title: "Starting Balance", totalLabel: "Total Starting Balance", value: (b) => Number(b.starting) },
  { title: `Sales - ${suffix}`, totalLabel: "Total Sales", value: (b) => Number(b.sales) },
  { title: `Expenses - ${suffix}`, totalLabel: "Total Expenses", value: (b) => Number(b.expenses) },
  { title: `Net Sales - ${suffix}`, totalLabel: `Total Net Sales - ${suffix}`, value: (b) => Number(b.sales) - Number(b.expenses) },
  { title: "EOD Balance", totalLabel: "Total EOD balance", value: (b) => Number(b.starting) + Number(b.sales) - Number(b.expenses) },
];

function buildSummary(s: Summary): string {
  const lines = ["END OF SHIFT REPORT", `Date: ${fmtDay(s.date)}`, `Barista: ${s.baristas}`,
    `Time in: ${s.time_in}`, `Time out: ${s.time_out}`];
  if (!s.balances.length) lines.push("", "Balances are not available yet.");
  else balanceSections(s.suffix).forEach(({ title, totalLabel, value }) => {
    lines.push("", title);
    s.balances.forEach((b) => lines.push(`${b.label}: ${peso(value(b))}`));
    lines.push(`${totalLabel}: ${peso(s.balances.reduce((sum, b) => sum + value(b), 0))}`);
  });
  return lines.join("\n");
}

function summaryFromShift(r: EOS, balances: Balance[]): Summary {
  return {
    date: r.shift.business_date,
    suffix: "Current day",
    baristas: r.user_email ?? "—",
    time_in: fmtTime(r.shift.clock_in),
    time_out: r.shift.clock_out ? fmtTime(r.shift.clock_out) : "In progress",
    balances,
  };
}

function summaryFromDay(d: DayReport): Summary {
  const inTimes = d.shifts.map((s) => s.clock_in).filter(Boolean).sort();
  const outTimes = d.shifts.map((s) => s.clock_out).filter(Boolean).sort();
  const open = d.shifts.some((s) => !s.clock_out);
  const emails = Array.from(new Set(d.shifts.map((s) => s.user_email).filter(Boolean) as string[]));
  return {
    date: d.business_date,
    suffix: fmtDay(d.business_date),
    baristas: (emails.join(", ") || "—") + (d.shifts.length > 1 ? ` (${d.shifts.length} shifts)` : ""),
    time_in: inTimes.length ? fmtTime(inTimes[0]) : "—",
    time_out: open ? "In progress" : outTimes.length ? fmtTime(outTimes[outTimes.length - 1]) : "—",
    balances: d.balances,
  };
}

const ShiftReceipt = forwardRef<HTMLDivElement, { summary: Summary }>(function ShiftReceipt(
  { summary }, ref,
) {
  const sections = balanceSections(summary.suffix);
  const total = (value: (b: Balance) => number) =>
    peso(summary.balances.reduce((sum, b) => sum + value(b), 0));
  return (
    <div ref={ref} className="bg-card text-card-foreground p-4 sm:p-6 w-full max-w-lg mx-auto text-sm font-sans">
      <h2 className="text-center text-base font-semibold mb-6">END OF SHIFT REPORT</h2>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 mb-4">
        <span>Date</span><span className="text-right">{fmtDay(summary.date)}</span>
        <span>Barista</span><span className="text-right break-words">{summary.baristas}</span>
        <span>Time in</span><span className="text-right">{summary.time_in}</span>
        <span>Time out</span><span className="text-right">{summary.time_out}</span>
      </div>
      {!summary.balances.length ? <p className="text-muted-foreground">Balances are not available yet.</p> :
        sections.map(({ title, totalLabel, value }) => (
          <section key={title} className="border border-dashed border-border rounded-sm p-2 mb-3">
            <h3 className="font-sans font-semibold mb-1">{title}</h3>
            {summary.balances.map((b) => (
              <div key={b.code} className="flex justify-between gap-3">
                <span className="min-w-0 break-words">{b.label}</span>
                <span className="tabular-nums shrink-0">{peso(value(b))}</span>
              </div>
            ))}
            <div className="flex justify-between gap-3 font-semibold border-t border-foreground mt-1 pt-1">
              <span className="min-w-0">{totalLabel}</span>
              <span className="tabular-nums shrink-0">{total(value)}</span>
            </div>
          </section>
        ))}
    </div>
  );
});
