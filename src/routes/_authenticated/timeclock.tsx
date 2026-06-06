import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Clock, Coffee, Utensils, LogIn, LogOut, CalendarPlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/timeclock")({
  component: TimeclockPage,
});

const MANILA_TZ = "Asia/Manila";
const fmtManila = (iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions) => {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: MANILA_TZ,
    dateStyle: "medium",
    timeStyle: "medium",
    ...opts,
  }).format(new Date(iso));
};
const fmtDuration = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
};

type Shift = {
  id: string; user_id: string; business_date: string;
  clock_in: string; clock_out: string | null;
  starting_cash: number; notes: string | null;
};
type Break = { id: string; shift_id: string; type: "break" | "lunch"; started_at: string; ended_at: string | null };
type Leave = {
  id: string; user_id: string; leave_date: string;
  duration: "full" | "half"; reason: string | null;
  status: "pending" | "approved" | "rejected"; created_at: string;
};

function TimeclockPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [shift, setShift] = useState<Shift | null>(null);
  const [activeBreak, setActiveBreak] = useState<Break | null>(null);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [now, setNow] = useState(Date.now());

  // dialogs
  const [clockInOpen, setClockInOpen] = useState(false);
  const [startingCash, setStartingCash] = useState("0");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveDate, setLeaveDate] = useState("");
  const [leaveDuration, setLeaveDuration] = useState<"full" | "half">("full");
  const [leaveReason, setLeaveReason] = useState("");

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = async () => {
    setLoading(true);
    const [{ data: active }, { data: my }] = await Promise.all([
      supabase.rpc("tc_active"),
      supabase.rpc("tc_my_leaves"),
    ]);
    const a = (active ?? { shift: null, active_break: null }) as { shift: Shift | null; active_break: Break | null };
    setShift(a.shift);
    setActiveBreak(a.active_break);
    setLeaves((my ?? []) as Leave[]);
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  const onClockIn = async () => {
    const v = Number(startingCash || "0");
    if (Number.isNaN(v) || v < 0) { toast.error("Starting cash must be a number ≥ 0"); return; }
    const { error } = await supabase.rpc("tc_clock_in", { p_starting_cash: v });
    if (error) { toast.error(error.message); return; }
    setClockInOpen(false);
    toast.success("Clocked in");
    await refresh();
  };
  const onClockOut = async () => {
    const { error } = await supabase.rpc("tc_clock_out");
    if (error) { toast.error(error.message); return; }
    toast.success("Clocked out");
    await refresh();
  };
  const onBreakStart = async (type: "break" | "lunch") => {
    const { error } = await supabase.rpc("tc_break_start", { p_type: type });
    if (error) { toast.error(error.message); return; }
    await refresh();
  };
  const onBreakEnd = async () => {
    const { error } = await supabase.rpc("tc_break_end");
    if (error) { toast.error(error.message); return; }
    await refresh();
  };
  const onFileLeave = async () => {
    if (!leaveDate) { toast.error("Pick a date"); return; }
    const { error } = await supabase.rpc("tc_file_leave", {
      p_date: leaveDate, p_duration: leaveDuration, p_reason: leaveReason || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Leave filed — pending admin approval");
    setLeaveOpen(false);
    setLeaveReason(""); setLeaveDate(""); setLeaveDuration("full");
    await refresh();
  };

  const shiftElapsed = useMemo(() => {
    if (!shift) return 0;
    const end = shift.clock_out ? new Date(shift.clock_out).getTime() : now;
    return (end - new Date(shift.clock_in).getTime()) / 1000;
  }, [shift, now]);
  const breakElapsed = useMemo(() => {
    if (!activeBreak) return 0;
    return (now - new Date(activeBreak.started_at).getTime()) / 1000;
  }, [activeBreak, now]);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display flex items-center gap-2">
            <Clock className="h-6 w-6" /> Timeclock
          </h1>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Manila time</div>
          <div className="font-mono text-lg">
            {new Intl.DateTimeFormat("en-PH", { timeZone: MANILA_TZ, dateStyle: "medium", timeStyle: "medium" }).format(now)}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current shift</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : !shift ? (
            <>
              <p className="text-sm text-muted-foreground">You're not clocked in.</p>
              <Dialog open={clockInOpen} onOpenChange={setClockInOpen}>
                <DialogTrigger asChild>
                  <Button size="lg" className="gap-2"><LogIn className="h-4 w-4" /> Time in</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Time in</DialogTitle></DialogHeader>
                  <div className="space-y-2">
                    <Label htmlFor="cash">Starting cash (₱)</Label>
                    <Input id="cash" type="number" min="0" step="0.01" value={startingCash}
                      onChange={(e) => setStartingCash(e.target.value)} autoFocus />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setClockInOpen(false)}>Cancel</Button>
                    <Button onClick={onClockIn}>Start shift</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs">Time in</div>
                  <div className="font-medium">{fmtManila(shift.clock_in, { dateStyle: undefined, timeStyle: "medium" })}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Starting cash</div>
                  <div className="font-medium">₱{Number(shift.starting_cash).toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Elapsed</div>
                  <div className="font-mono">{fmtDuration(shiftElapsed)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Status</div>
                  {activeBreak ? (
                    <Badge variant="secondary" className="capitalize">On {activeBreak.type}</Badge>
                  ) : (
                    <Badge>Working</Badge>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                {activeBreak ? (
                  <Button onClick={onBreakEnd} variant="secondary" className="gap-2">
                    End {activeBreak.type} ({fmtDuration(breakElapsed)})
                  </Button>
                ) : (
                  <>
                    <Button onClick={() => onBreakStart("break")} variant="secondary" className="gap-2">
                      <Coffee className="h-4 w-4" /> Start break
                    </Button>
                    <Button onClick={() => onBreakStart("lunch")} variant="secondary" className="gap-2">
                      <Utensils className="h-4 w-4" /> Start lunch
                    </Button>
                  </>
                )}
                <Button onClick={onClockOut} variant="destructive" className="gap-2 ml-auto">
                  <LogOut className="h-4 w-4" /> Time out
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Leaves of absence</CardTitle>
          <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2"><CalendarPlus className="h-4 w-4" /> File leave</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>File a leave of absence</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="leave-date">Date</Label>
                  <Input id="leave-date" type="date" value={leaveDate} onChange={(e) => setLeaveDate(e.target.value)} />
                </div>
                <div>
                  <Label>Duration</Label>
                  <Select value={leaveDuration} onValueChange={(v) => setLeaveDuration(v as "full" | "half")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">Full day (8h)</SelectItem>
                      <SelectItem value="half">Half day (4h)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="leave-reason">Reason (optional)</Label>
                  <Textarea id="leave-reason" value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Pending leaves don't deduct hours. Once an admin approves, the hours are deducted from that day's shift on the End of Shift report.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setLeaveOpen(false)}>Cancel</Button>
                <Button onClick={onFileLeave}>Submit</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {leaves.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leaves on file.</p>
          ) : (
            <div className="divide-y">
              {leaves.map((l) => (
                <div key={l.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">{l.leave_date} · {l.duration === "full" ? "Full day" : "Half day"}</div>
                    {l.reason && <div className="text-muted-foreground text-xs">{l.reason}</div>}
                  </div>
                  <Badge variant={l.status === "approved" ? "default" : l.status === "rejected" ? "destructive" : "secondary"}
                    className="capitalize">{l.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
