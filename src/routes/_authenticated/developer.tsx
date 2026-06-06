import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/developer")({
  component: DeveloperPage,
});

const db = supabase as any;

function DeveloperPage() {
  const { primaryRole } = useAuth();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  if (primaryRole !== "developer") {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="p-6 text-sm text-muted-foreground">
          This area is restricted to the Developer role.
        </Card>
      </div>
    );
  }

  async function wipe() {
    if (confirm !== "WIPE ALL ORDERS") {
      toast.error('Type "WIPE ALL ORDERS" exactly to confirm.');
      return;
    }
    setBusy(true);
    const { data, error } = await db.rpc("dev_wipe_all_orders");
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Deleted ${(data as any)?.deleted_orders ?? 0} orders. Inventory & loyalty reversed.`);
    setConfirm("");
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl">Developer Tools</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Maintenance utilities visible only to the Developer role.
        </p>
      </div>

      <Card className="p-5 border-destructive/40">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1 space-y-3">
            <div>
              <h2 className="font-display text-lg text-destructive">Danger Zone — Wipe all orders</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Hard-deletes every order, order item, and payment. Restocks inventory
                for each line item and reverses loyalty points (earned subtracted,
                redeemed re-credited). Order numbering restarts at <code>#001</code>.
                Voided / refunded orders are also removed but no longer affect stock.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Use only to clean up after testing. This cannot be undone.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">
                Type <code className="font-mono">WIPE ALL ORDERS</code> to enable the button:
              </label>
              <Input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="WIPE ALL ORDERS"
                className="font-mono"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                disabled={busy || confirm !== "WIPE ALL ORDERS"}
                onClick={wipe}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {busy ? "Wiping…" : "Wipe all orders now"}
              </Button>
              <Button variant="outline" onClick={() => navigate({ to: "/dashboard" })}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
