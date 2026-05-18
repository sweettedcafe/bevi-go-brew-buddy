import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/inventory")({
  component: InventoryPage,
});

type Inv = {
  id: string;
  name: string;
  unit: string;
  stock_qty: number;
  low_threshold: number;
};

function InventoryPage() {
  const [rows, setRows] = useState<Inv[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("inventory_items")
        .select("id,name,unit,stock_qty,low_threshold")
        .order("name");
      setRows((data ?? []) as Inv[]);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-display">Inventory</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Stock decreases automatically when POS orders are completed.
        </p>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          No inventory items. Run <code>supabase_phase2_schema.sql</code> to seed.
        </div>
      ) : (
        <div className="grid gap-2">
          {rows.map((r) => {
            const low = Number(r.stock_qty) <= Number(r.low_threshold);
            return (
              <Card key={r.id} className="p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    threshold {r.low_threshold} {r.unit}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-lg">
                    {Number(r.stock_qty).toLocaleString()} <span className="text-sm text-muted-foreground">{r.unit}</span>
                  </div>
                  {low && <Badge variant="destructive" className="mt-1">Low stock</Badge>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
