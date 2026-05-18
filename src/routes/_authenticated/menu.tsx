import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/menu")({
  component: MenuPage,
});

type Item = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  is_active: boolean;
  category_id: string | null;
};
type Cat = { id: string; name: string };

function MenuPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: m }, { data: c }] = await Promise.all([
        supabase.from("menu_items").select("*").order("sort_order"),
        supabase.from("categories").select("id,name").order("sort_order"),
      ]);
      setItems((m ?? []) as Item[]);
      setCats((c ?? []) as Cat[]);
      setLoading(false);
    })();
  }, []);

  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-display">Menu &amp; Recipes</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Read-only view for Phase 2. Full CRUD coming next phase.
        </p>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          No menu items yet. Run <code>supabase_phase2_schema.sql</code> to seed sample data.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((it) => (
            <Card key={it.id} className="p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{it.name}</span>
                  <Badge variant="secondary">{catName(it.category_id)}</Badge>
                  {!it.is_active && <Badge variant="outline">inactive</Badge>}
                </div>
                {it.description && (
                  <div className="text-sm text-muted-foreground mt-1">{it.description}</div>
                )}
              </div>
              <div className="font-display text-lg text-primary">
                {Number(it.price).toFixed(2)}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
