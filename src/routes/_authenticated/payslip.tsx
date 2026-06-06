import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Receipt, Printer, RefreshCw } from "lucide-react";
import logo from "@/assets/bevi-logo.jpg";

export const Route = createFileRoute("/_authenticated/payslip")({
  component: PayslipPage,
});

const db = supabase as any;
const SHOP_NAME = "Bevi & Go";
const MANILA_TZ = "Asia/Manila";

type Shift = {
  shift_id: string; user_id: string; user_email: string | null;
  business_date: string; clock_in: string; clock_out: string | null;
  break_seconds: number; worked_seconds: number;
  leave_hours: number; net_worked_hours: number;
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };
const fmtTime = (iso: string | null) => iso
  ? new Intl.DateTimeFormat("en-PH", { timeZone: MANILA_TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
  : "—";
const hrs = (s: number) => (Number(s) / 3600).toFixed(2);

function PayslipPage() {
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayIso);
  const [userId, setUserId] = useState<string>("");
  const [rows, setRows] = useState<Shift[]>([]);
  const [staff, setStaff] = useState<{ id: string; email: string }[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data }, { data: emails }] = await Promise.all([
      db.rpc("tc_admin_shifts", { p_from: from || null, p_to: to || null, p_user_id: userId || null }),
      db.rpc("staff_emails"),
    ]);
    setRows(((data ?? []) as Shift[]).sort((a, b) => a.business_date.localeCompare(b.business_date)));
    if (!staff.length) {
      const list = ((emails ?? []) as any[]).map((e) => ({ id: e.user_id, email: e.email }))
        .sort((a, b) => a.email.localeCompare(b.email));
      setStaff(list);
    }
    setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  const selected = staff.find((s) => s.id === userId);

  const totals = useMemo(() => {
    let worked = 0, brk = 0, leave = 0, net = 0;
    for (const r of rows) {
      worked += Number(r.worked_seconds) + Number(r.break_seconds);
      brk += Number(r.break_seconds);
      leave += Number(r.leave_hours);
      net += Number(r.net_worked_hours);
    }
    return { worked, brk, leave, net, days: rows.length };
  }, [rows]);

  // Group by barista when no specific user selected
  const groups = useMemo(() => {
    const m = new Map<string, Shift[]>();
    rows.forEach((r) => {
      const k = r.user_id;
      const a = m.get(k) ?? []; a.push(r); m.set(k, a);
    });
    return [...m.entries()];
  }, [rows]);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <header className="flex flex-wrap items-center gap-3 print:hidden">
        <Receipt className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-display">Payslip Report</h1>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="h-3 w-3 mr-1" /> {loading ? "Loading…" : "Refresh"}
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="h-3 w-3 mr-1" /> Print
          </Button>
        </div>
      </header>

      <Card className="p-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div><Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div>
            <Label className="text-xs">Barista</Label>
            <select className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">All baristas</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.email}</option>)}
            </select>
          </div>
          <Button size="sm" onClick={load} disabled={loading}>Apply</Button>
        </div>
      </Card>

      <div id="print-area" className="space-y-6">
        {groups.length === 0 && (
          <Card className="p-6 text-center text-muted-foreground">No shifts in this period.</Card>
        )}
        {groups.map(([uid, shifts]) => {
          const email = shifts[0].user_email ?? staff.find((s) => s.id === uid)?.email ?? uid;
          const t = shifts.reduce((acc, r) => ({
            worked: acc.worked + Number(r.worked_seconds) + Number(r.break_seconds),
            brk: acc.brk + Number(r.break_seconds),
            leave: acc.leave + Number(r.leave_hours),
            net: acc.net + Number(r.net_worked_hours),
          }), { worked: 0, brk: 0, leave: 0, net: 0 });
          return (
            <div key={uid} className="bg-white text-black rounded-lg border print:border-0 print:rounded-none print:break-after-page">
              <div className="p-6 sm:p-8 space-y-5">
                <div className="flex items-center justify-between border-b pb-4">
                  <div className="flex items-center gap-3">
                    <img src={logo} alt={SHOP_NAME} className="h-14 w-14 rounded object-cover" />
                    <div>
                      <div className="text-2xl font-display">{SHOP_NAME}</div>
                      <div className="text-sm text-gray-600">Employee Payslip — Hours Worked</div>
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <div>Issued {new Date().toLocaleDateString("en-PH", { timeZone: MANILA_TZ })}</div>
                    <div>Period: {from} → {to}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <Field label="Employee">{email}</Field>
                  <Field label="Pay period">{from} to {to}</Field>
                  <Field label="Total days worked">{shifts.length}</Field>
                  <Field label="Currency / unit">Hours (decimal)</Field>
                </div>

                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-600 mb-2">Daily breakdown</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-600">
                        <th className="py-1.5">Date</th>
                        <th className="py-1.5">In</th>
                        <th className="py-1.5">Out</th>
                        <th className="py-1.5 text-right">Worked</th>
                        <th className="py-1.5 text-right">Break</th>
                        <th className="py-1.5 text-right">Leave</th>
                        <th className="py-1.5 text-right">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shifts.map((r) => (
                        <tr key={r.shift_id} className="border-b last:border-0">
                          <td className="py-1.5">{r.business_date}</td>
                          <td className="py-1.5">{fmtTime(r.clock_in)}</td>
                          <td className="py-1.5">{r.clock_out ? fmtTime(r.clock_out) : "—"}</td>
                          <td className="py-1.5 text-right font-mono">{hrs(r.worked_seconds + r.break_seconds)}</td>
                          <td className="py-1.5 text-right font-mono">{hrs(r.break_seconds)}</td>
                          <td className="py-1.5 text-right font-mono">{Number(r.leave_hours).toFixed(2)}</td>
                          <td className="py-1.5 text-right font-mono font-semibold">{Number(r.net_worked_hours).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Summary label="Gross hours" value={hrs(t.worked)} />
                  <Summary label="Breaks" value={`- ${hrs(t.brk)}`} />
                  <Summary label="Approved leave" value={t.leave.toFixed(2)} />
                  <Summary label="Net hours payable" value={t.net.toFixed(2)} highlight />
                </div>

                <div className="border-t pt-4 grid grid-cols-2 gap-8 text-xs text-gray-600">
                  <div>
                    <div className="h-12 border-b border-gray-400" />
                    <div className="mt-1">Employee signature</div>
                  </div>
                  <div>
                    <div className="h-12 border-b border-gray-400" />
                    <div className="mt-1">Authorized by</div>
                  </div>
                </div>

                <div className="text-center text-[11px] text-gray-500 border-t pt-3">
                  {SHOP_NAME} — This payslip reflects logged hours only. Pay computation is handled separately.
                </div>
              </div>
            </div>
          );
        })}

        {!userId && groups.length > 1 && (
          <Card className="p-4 print:hidden">
            <div className="text-sm">
              <span className="font-semibold">All baristas — combined totals:</span>{" "}
              {totals.days} shift(s), {totals.net.toFixed(2)} net hours
              {selected ? ` for ${selected.email}` : ""}.
            </div>
          </Card>
        )}
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #print-area, #print-area * { visibility: visible !important; }
          #print-area { position: absolute; left: 0; top: 0; width: 100%; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="font-medium">{children}</div>
    </div>
  );
}
function Summary({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`border rounded-md p-3 ${highlight ? "bg-gray-100" : ""}`}>
      <div className="text-[11px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-lg font-semibold ${highlight ? "text-black" : ""}`}>{value}</div>
    </div>
  );
}
