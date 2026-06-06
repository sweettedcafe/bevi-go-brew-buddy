import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";

type Inv = {
  id: string;
  name: string;
  unit: string;
  stock_qty: number;
  low_threshold: number;
  is_active: boolean;
};

const db = supabase as any;
const POLL_MS = 60_000;
const DISMISS_KEY = "lowstock-dismissed-v1";

function playBeep() {
  try {
    const Ctx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const beep = (freq: number, start: number, dur: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + dur + 0.02);
    };
    beep(880, 0, 0.25);
    beep(660, 0.28, 0.25);
    beep(880, 0.56, 0.3);
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch {
    /* ignore */
  }
}

function getDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISS_KEY) || "[]");
  } catch {
    return [];
  }
}
function setDismissed(ids: string[]) {
  try {
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export function LowStockAlert() {
  const { primaryRole, user } = useAuth();
  const enabled =
    !!user &&
    (primaryRole === "admin" ||
      primaryRole === "barista" ||
      primaryRole === "developer");

  const [low, setLow] = useState<Inv[]>([]);
  const [open, setOpen] = useState(false);
  const playedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function check() {
      const { data, error } = await db
        .from("inventory_items")
        .select("id,name,unit,stock_qty,low_threshold,is_active")
        .eq("is_active", true);
      if (cancelled || error) return;
      const items = (data ?? []) as Inv[];
      const lowItems = items.filter(
        (i) => Number(i.stock_qty) <= Number(i.low_threshold),
      );
      setLow(lowItems);

      const dismissed = getDismissed();
      const signature = lowItems
        .map((i) => i.id)
        .sort()
        .join(",");
      const fresh = lowItems.some((i) => !dismissed.includes(i.id));
      if (lowItems.length > 0 && fresh) {
        setOpen(true);
        if (!playedRef.current) {
          playBeep();
          playedRef.current = true;
        }
        // Keep signature so we know what's currently open
        (window as any).__lowStockSig = signature;
      }
    }

    void check();
    const t = window.setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [enabled]);

  function handleOk() {
    setDismissed(low.map((i) => i.id));
    setOpen(false);
    playedRef.current = false;
  }

  if (!enabled || low.length === 0) return null;

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && handleOk()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Low stock — restock needed
          </AlertDialogTitle>
          <AlertDialogDescription>
            {low.length} item{low.length === 1 ? "" : "s"} reached the low-stock
            threshold and need restocking.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-72 overflow-y-auto rounded-md border divide-y text-sm">
          {low.map((i) => (
            <div key={i.id} className="flex justify-between gap-3 px-3 py-2">
              <span className="truncate font-medium">{i.name}</span>
              <span className="text-muted-foreground whitespace-nowrap">
                {Number(i.stock_qty).toLocaleString()} {i.unit}{" "}
                <span className="opacity-60">
                  (≤ {Number(i.low_threshold).toLocaleString()})
                </span>
              </span>
            </div>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogAction onClick={handleOk}>Okay</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
