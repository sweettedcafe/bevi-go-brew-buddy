import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { ClipboardList, Plus, Trash2, RefreshCw, Share2, Copy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/end-of-shift")({
  component: EndOfShiftPage,
});

const MANILA_TZ = "Asia/Manila";
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
  expenses: Array<{ id: string; description: string; amount: number; category: string | null; created_at: string }>;
  total_expenses: number;
  breaks: Array<{ id: string; type: "break" | "lunch"; started_at: string; ended_at: string | null }>;
};

function EndOfShiftPage() {
  const [report, setReport] = useState<EOS | null>(null);
  const [loading, setLoading] = useState(true);

  // expense form
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");

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

  const addExpense = async () => {
    const a = Number(amount);
    if (!desc.trim()) { toast.error("Description required"); return; }
    if (Number.isNaN(a) || a < 0) { toast.error("Amount must be a number ≥ 0"); return; }
    const { error } = await supabase.rpc("tc_add_expense", {
      p_description: desc.trim(), p_amount: a, p_category: category.trim() || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Expense saved");
    setDesc(""); setAmount(""); setCategory("");
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
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Shift summary</DialogTitle></DialogHeader>
                <Textarea readOnly value={summaryText} className="font-mono text-xs min-h-[320px]" />
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={copySummary} className="gap-2"><Copy className="h-4 w-4" /> Copy</Button>
                  <Button onClick={shareSummary} className="gap-2"><Share2 className="h-4 w-4" /> Share</Button>
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
                  <div className="md:col-span-5">
                    <Label htmlFor="exp-desc">Description</Label>
                    <Input id="exp-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Milk delivery" />
                  </div>
                  <div className="md:col-span-3">
                    <Label htmlFor="exp-amt">Amount (₱)</Label>
                    <Input id="exp-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div className="md:col-span-3">
                    <Label htmlFor="exp-cat">Category</Label>
                    <Input id="exp-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="optional" />
                  </div>
                  <div className="md:col-span-1">
                    <Button onClick={addExpense} className="w-full gap-1"><Plus className="h-4 w-4" /></Button>
                  </div>
                </div>
              )}

              {report.expenses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No expenses recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.expenses.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs">{fmtTime(e.created_at)}</TableCell>
                        <TableCell>{e.description}</TableCell>
                        <TableCell className="text-muted-foreground">{e.category ?? "—"}</TableCell>
                        <TableCell className="text-right">{peso(e.amount)}</TableCell>
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
                      <TableCell colSpan={3} className="text-right font-semibold">Total expenses</TableCell>
                      <TableCell className="text-right font-semibold">{peso(report.total_expenses)}</TableCell>
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
