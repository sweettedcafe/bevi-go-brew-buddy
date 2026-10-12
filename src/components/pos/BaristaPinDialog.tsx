import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type StaffRow = { user_id: string; email: string; full_name: string; role: string | null };
const db = supabase as any;

export function BaristaPinDialog({ open, onOpenChange, staff, activeId, onPick }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  staff: StaffRow[];
  activeId: string | null;
  onPick: (id: string, name: string) => void;
}) {
  const [withPin, setWithPin] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<StaffRow | null>(null);
  const [mode, setMode] = useState<"enter" | "setup">("enter");
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadStatus() {
    const { data } = await db.rpc("pos_pin_status");
    setWithPin(new Set(((data ?? []) as any[]).map((r) => (typeof r === "string" ? r : Object.values(r)[0]) as string)));
  }
  useEffect(() => { if (open) { void loadStatus(); setSel(null); setPin(""); setPassword(""); } }, [open]);

  function choose(s: StaffRow) {
    setSel(s); setPin(""); setPassword("");
    setMode(withPin.has(s.user_id) ? "enter" : "setup");
  }

  async function submit() {
    if (!sel) return;
    if (!/^\d{4}$/.test(pin)) { toast.error("PIN must be 4 digits"); return; }
    setBusy(true);
    try {
      if (mode === "enter") {
        const { data, error } = await db.rpc("pos_verify_pin", { p_user_id: sel.user_id, p_pin: pin });
        if (error) { toast.error(error.message); return; }
        if (!data) { toast.error("Wrong PIN"); setPin(""); return; }
      } else {
        if (!password) { toast.error("Enter your account password"); return; }
        // Confirm identity with the barista's own password, without touching this terminal's login.
        const temp = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, storageKey: "bevi-pin-check" },
        });
        const { error: authErr } = await temp.auth.signInWithPassword({ email: sel.email, password });
        if (authErr) { toast.error("Wrong password"); return; }
        const { error } = await (temp as any).rpc("pos_set_my_pin", { p_pin: pin });
        await temp.auth.signOut().catch(() => {});
        if (error) { toast.error(error.message); return; }
        toast.success("PIN saved");
      }
      onPick(sel.user_id, sel.full_name);
      onOpenChange(false);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Barista on duty</DialogTitle></DialogHeader>
        {!sel ? (
          <>
            <p className="text-xs text-muted-foreground -mt-2">Pick your name and enter your 4-digit PIN. Every sale is credited to you.</p>
            <div className="space-y-1.5 max-h-80 overflow-auto">
              {staff.length === 0 && <div className="text-sm text-muted-foreground py-4 text-center">No baristas found.</div>}
              {staff.map((s) => (
                <button key={s.user_id} type="button" onClick={() => choose(s)}
                  className={`w-full text-left rounded-md border px-3 py-2 hover:bg-accent/40 ${activeId === s.user_id ? "border-primary bg-accent/30" : ""}`}>
                  <div className="font-medium text-sm">{s.full_name}</div>
                  <div className="text-xs text-muted-foreground">{s.email}{withPin.has(s.user_id) ? "" : " · PIN not set up"}</div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="text-sm"><span className="font-medium">{sel.full_name}</span> <span className="text-muted-foreground">· {sel.email}</span></div>
            {mode === "setup" && (
              <>
                <p className="text-xs text-muted-foreground">Set up a new 4-digit PIN. Enter your account password to confirm it's you.</p>
                <Input type="password" placeholder="Account password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
              </>
            )}
            <Input type="password" inputMode="numeric" maxLength={4} placeholder={mode === "setup" ? "New 4-digit PIN" : "4-digit PIN"}
              className="text-center tracking-[0.5em] text-lg" value={pin} autoFocus
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSel(null)} disabled={busy}>Back</Button>
              <Button className="flex-1" onClick={() => void submit()} disabled={busy || pin.length !== 4}>
                {busy ? "Checking…" : mode === "setup" ? "Save PIN & start" : "Start taking orders"}
              </Button>
            </div>
            {mode === "enter" && (
              <button type="button" className="text-xs text-primary underline" onClick={() => { setMode("setup"); setPin(""); }}>
                Forgot PIN? Reset it with your password
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
