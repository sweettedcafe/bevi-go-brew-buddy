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
import { ClipboardList, Plus, Trash2, RefreshCw, Share2, Copy, Camera } from "lucide-react";
import { toPng } from "html-to-image";

export const Route = createFileRoute("/_authenticated/end-of-shift")({
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
  expenses: Array<{ id: string; description: string; amount: number; quantity?: number | null; unit_price?: number | null; category: string | null; created_at: string; invoice_number?: string | null; receipt_url?: string | null }>;
  total_expenses: number;
  breaks: Array<{ id: string; type: "break" | "lunch"; started_at: string; ended_at: string | null }>;
};

function EndOfShiftPage() {
  const [report, setReport] = useState<EOS | null>(null);
  const [loading, setLoading] = useState(true);

  // expense form
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [category, setCategory] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("tc_eos_report", { p_shift_id: null });
    if (error) {
      toast.error(error.message);
      setReport(null);
    } else {
      setReport(data as EOS);
    }
    setLoading(false);
  };
  useEffect(() => { void refresh(); }, []);

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
      toast.error(`Upload failed: ${e?.message ?? e}. You can still save the expense without the image.`);
      return null;
    } finally {
      setUploadingReceipt(false);
    }
  }

  const addExpense = async () => {
    const q = Number(qty);
    const up = Number(unitPrice);
    if (!desc.trim()) { toast.error("Description required"); return; }
    if (!Number.isFinite(q) || q <= 0) { toast.error("Quantity must be > 0"); return; }
    if (!Number.isFinite(up) || up < 0) { toast.error("Unit price must be ≥ 0"); return; }
    let receiptUrl: string | null = null;
    if (receiptFile) {
      receiptUrl = await uploadReceipt(receiptFile);
    }
    const { error } = await (supabase as any).rpc("tc_add_expense_v3", {
      p_description: desc.trim(),
      p_quantity: q,
      p_unit_price: up,
      p_category: category.trim() || null,
      p_invoice_number: invoiceNo.trim() || null,
      p_receipt_url: receiptUrl,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Expense saved");
    setDesc(""); setQty("1"); setUnitPrice(""); setCategory("");
    setInvoiceNo(""); setReceiptFile(null);
    await refresh();
  };
  const deleteExpense = async (id: string) => {
    const { error } = await supabase.rpc("tc_delete_expense", { p_id: id });
    if (error) { toast.error(error.message); return; }
    await refresh();
  };

  const totalPayments = (report?.payments ?? []).reduce((s, p) => s + Number(p.net), 0);
  const cashNet = Number(report?.payments.find((p) => p.method === "cash")?.net ?? 0);
  const expectedCash = report ? Number(report.shift.starting_cash) + cashNet - Number(report.total_expenses) : 0;

  const summaryText = report ? buildSummary(report, totalPayments, cashNet, expectedCash) : "";
  const receiptRef = useRef<HTMLDivElement>(null);

  const copySummary = async () => {
    try { await navigator.clipboard.writeText(summaryText); toast.success("Summary copied"); }
    catch { toast.error("Copy failed"); }
  };
  const shareSummary = async () => {
    if (typeof navigator !== "undefined" && (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }).share) {
      try { await navigator.share!({ title: "End of Shift Report", text: summaryText }); }
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
        backgroundColor: "#ffffff",
        cacheBust: true,
      });
      const a = document.createElement("a");
      const date = report?.shift.clock_in ? new Date(report.shift.clock_in).toISOString().slice(0, 10) : "shift";
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
          {report && (
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2"><Share2 className="h-4 w-4" /> Share summary</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>Shift summary</DialogTitle></DialogHeader>
                <div className="max-h-[70vh] overflow-y-auto -mx-2 px-2">
                  <ShiftReceipt
                    ref={receiptRef}
                    report={report!}
                    totalNet={totalPayments}
                    cashNet={cashNet}
                    expectedCash={expectedCash}
                  />
                </div>
                <DialogFooter className="gap-2 flex-wrap">
                  <Button variant="outline" onClick={copySummary} className="gap-2"><Copy className="h-4 w-4" /> Copy text</Button>
                  <Button variant="outline" onClick={shareSummary} className="gap-2"><Share2 className="h-4 w-4" /> Share</Button>
                  <Button onClick={saveAsImage} className="gap-2"><Camera className="h-4 w-4" /> Save image</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          <Button variant="outline" size="sm" onClick={refresh} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : !report ? (
        <Card><CardContent className="py-8 text-sm text-muted-foreground">No shift found. Time in from the Timeclock page to start one.</CardContent></Card>
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
                <Field label="Starting cash" value={peso(report.shift.starting_cash)} />
                <Field label="Breaks (total)" value={`${(report.break_seconds / 60).toFixed(0)} min`} />
                <Field label="Approved leave deduction" value={`${report.leave_hours_deducted} h`} />
                <Field label="Net worked hours" value={`${report.net_worked_hours} h`} />
              </div>
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
              {report.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No paid orders for this business date yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.payments.map((p) => (
                      <TableRow key={p.method}>
                        <TableCell className="capitalize font-medium">{p.method}</TableCell>
                        <TableCell className="text-right">{p.count}</TableCell>
                        <TableCell className="text-right">{peso(p.gross)}</TableCell>
                        <TableCell className="text-right">{peso(p.change)}</TableCell>
                        <TableCell className="text-right font-semibold">{peso(p.net)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={4} className="text-right font-semibold">Total net</TableCell>
                      <TableCell className="text-right font-semibold">{peso(totalPayments)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Expenses</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {report.shift.clock_out ? (
                <p className="text-xs text-muted-foreground">Shift is closed — expenses are read-only.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                  <div className="md:col-span-3">
                    <Label htmlFor="exp-desc">Item / description</Label>
                    <Input id="exp-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Whole milk 1L" />
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor="exp-inv">Invoice #</Label>
                    <Input id="exp-inv" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="OR / SI #" />
                  </div>
                  <div className="md:col-span-1">
                    <Label htmlFor="exp-qty">Qty</Label>
                    <Input id="exp-qty" type="number" min="0.01" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} />
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor="exp-unit">Unit price (₱)</Label>
                    <Input id="exp-unit" type="number" min="0" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
                  </div>
                  <div className="md:col-span-1">
                    <Label>Total</Label>
                    <div className="h-9 flex items-center px-3 rounded-md border bg-muted/30 text-sm font-medium">
                      {peso((Number(qty) || 0) * (Number(unitPrice) || 0))}
                    </div>
                  </div>
                  <div className="md:col-span-1">
                    <Label htmlFor="exp-cat">Category</Label>
                    <Input id="exp-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="optional" />
                  </div>
                  <div className="md:col-span-1">
                    <Label htmlFor="exp-img" className="text-xs">Receipt</Label>
                    <Input id="exp-img" type="file" accept="image/*"
                      onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />
                  </div>
                  <div className="md:col-span-1">
                    <Button onClick={addExpense} disabled={uploadingReceipt} className="w-full gap-1">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {report.expenses.length === 0 ? (
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
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Receipt</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.expenses.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs">{fmtDate(e.created_at)}</TableCell>
                        <TableCell className="text-xs">{fmtClock(e.created_at)}</TableCell>
                        <TableCell className="text-xs">{e.invoice_number ?? "—"}</TableCell>
                        <TableCell>{e.description}</TableCell>
                        <TableCell className="text-muted-foreground">{e.category ?? "—"}</TableCell>
                        <TableCell className="text-right">{Number(e.quantity ?? 1)}</TableCell>
                        <TableCell className="text-right">{peso(e.unit_price ?? e.amount)}</TableCell>
                        <TableCell className="text-right font-medium">{peso(e.amount)}</TableCell>
                        <TableCell>
                          {e.receipt_url
                            ? <a href={e.receipt_url} target="_blank" rel="noreferrer" className="text-xs underline">view</a>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          {!report.shift.clock_out && (
                            <Button size="icon" variant="ghost" onClick={() => deleteExpense(e.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={7} className="text-right font-semibold">Total expenses</TableCell>
                      <TableCell className="text-right font-semibold">{peso(report.total_expenses)}</TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Cash summary</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <Field label="Starting cash" value={peso(report.shift.starting_cash)} />
                <Field label="Cash sales (net)" value={peso(report.payments.find((p) => p.method === "cash")?.net ?? 0)} />
                <Field label="Expenses paid" value={peso(report.total_expenses)} />
                <Field
                  label="Expected cash on hand"
                  value={peso(
                    Number(report.shift.starting_cash) +
                    Number(report.payments.find((p) => p.method === "cash")?.net ?? 0) -
                    Number(report.total_expenses)
                  )}
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}
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

function buildSummary(r: EOS, totalNet: number, cashNet: number, expectedCash: number): string {
  const peso = (n: number | string) => `PHP ${Number(n).toFixed(2)}`;
  const fmt = (iso: string | null) => iso
    ? new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
    : "—";
  const lines: string[] = [];
  lines.push("=== END OF SHIFT REPORT ===");
  lines.push(`Barista: ${r.user_email ?? "—"}`);
  lines.push(`Date: ${r.shift.business_date} (Manila)`);
  lines.push(`Time in:  ${fmt(r.shift.clock_in)}`);
  lines.push(`Time out: ${r.shift.clock_out ? fmt(r.shift.clock_out) : "in progress"}`);
  lines.push(`Breaks:   ${(r.break_seconds / 60).toFixed(0)} min`);
  lines.push(`Leave:    ${r.leave_hours_deducted} h (approved)`);
  lines.push(`Worked:   ${r.net_worked_hours} h (net)`);
  lines.push("");
  lines.push("--- Net by payment method ---");
  if (r.payments.length === 0) lines.push("(no paid orders)");
  else r.payments.forEach((p) => lines.push(`${p.method.padEnd(10)} ${String(p.count).padStart(3)} orders   ${peso(p.net)}`));
  lines.push(`TOTAL NET                 ${peso(totalNet)}`);
  lines.push("");
  lines.push("--- Cash drawer ---");
  lines.push(`Starting cash:     ${peso(r.shift.starting_cash)}`);
  lines.push(`Cash sales (net):  ${peso(cashNet)}`);
  lines.push(`Expenses paid:     ${peso(r.total_expenses)}`);
  lines.push(`Expected on hand:  ${peso(expectedCash)}`);
  lines.push("");
  lines.push("--- Expenses ---");
  if (r.expenses.length === 0) lines.push("(none)");
  else r.expenses.forEach((e) => lines.push(`- ${e.description}${e.category ? ` [${e.category}]` : ""}: ${peso(e.amount)}`));
  return lines.join("\n");
}

type ReceiptProps = { report: EOS; totalNet: number; cashNet: number; expectedCash: number };

const ShiftReceipt = forwardRef<HTMLDivElement, ReceiptProps>(function ShiftReceipt(
  { report: r, totalNet, cashNet, expectedCash }, ref,
) {
  const peso = (n: number | string) => `₱${Number(n).toFixed(2)}`;
  const fmt = (iso: string | null) => iso
    ? new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
    : "—";
  return (
    <div
      ref={ref}
      style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}
      className="bg-white text-zinc-900 rounded-lg border border-zinc-200 shadow-sm p-6 w-full max-w-[420px] mx-auto"
    >
      <div className="text-center border-b border-dashed border-zinc-300 pb-3 mb-3">
        <div className="text-base font-bold tracking-wide">BEVI &amp; GO</div>
        <div className="text-xs text-zinc-500 mt-0.5">End of Shift Report</div>
        <div className="text-[11px] text-zinc-500">{r.shift.business_date} · Manila</div>
      </div>

      <div className="text-[12px] space-y-1">
        <Row label="Barista" value={r.user_email ?? "—"} />
        <Row label="Time in" value={fmt(r.shift.clock_in)} />
        <Row label="Time out" value={r.shift.clock_out ? fmt(r.shift.clock_out) : "in progress"} />
        <Row label="Breaks" value={`${(r.break_seconds / 60).toFixed(0)} min`} />
        <Row label="Leave" value={`${r.leave_hours_deducted} h (approved)`} />
        <Row label="Worked" value={`${r.net_worked_hours} h (net)`} />
      </div>

      <SectionTitle>Net by payment method</SectionTitle>
      <div className="text-[12px] space-y-1">
        {r.payments.length === 0 ? (
          <div className="text-zinc-500 italic">(no paid orders)</div>
        ) : r.payments.map((p) => (
          <div key={p.method} className="flex justify-between">
            <span className="capitalize">{p.method} · {p.count} {p.count === 1 ? "order" : "orders"}</span>
            <span className="tabular-nums">{peso(p.net)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-dashed border-zinc-300 pt-1 mt-1 font-semibold">
          <span>TOTAL NET</span>
          <span className="tabular-nums">{peso(totalNet)}</span>
        </div>
      </div>

      <SectionTitle>Cash drawer</SectionTitle>
      <div className="text-[12px] space-y-1">
        <Row label="Starting cash" value={peso(r.shift.starting_cash)} mono />
        <Row label="Cash sales (net)" value={peso(cashNet)} mono />
        <Row label="Expenses paid" value={peso(r.total_expenses)} mono />
        <div className="flex justify-between font-semibold border-t border-dashed border-zinc-300 pt-1 mt-1">
          <span>Expected on hand</span>
          <span className="tabular-nums">{peso(expectedCash)}</span>
        </div>
      </div>

      <SectionTitle>Expenses</SectionTitle>
      <div className="text-[12px] space-y-1">
        {r.expenses.length === 0 ? (
          <div className="text-zinc-500 italic">(none)</div>
        ) : r.expenses.map((e) => (
          <div key={e.id} className="flex justify-between gap-2">
            <span className="truncate">
              {e.description}{e.category ? ` · ${e.category}` : ""}
            </span>
            <span className="tabular-nums">{peso(e.amount)}</span>
          </div>
        ))}
      </div>

      <div className="text-center text-[10px] text-zinc-400 mt-4 pt-3 border-t border-dashed border-zinc-300">
        Generated {new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date())}
      </div>
    </div>
  );
});

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className={mono ? "tabular-nums" : ""}>{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wider text-zinc-500 mt-4 mb-1 border-b border-dashed border-zinc-300 pb-1">
      {children}
    </div>
  );
}
