import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export type UpsellChoice = {
  id: string;
  name: string;
  price: number;
};

const fmt = (n: number) => Number(n).toFixed(2);

/**
 * Suggests complementary items after an order is added to cart.
 * User can pick any (or none) and Skip / Add.
 */
export function UpsellDialog({
  open, onOpenChange, triggerName, suggestions, onAdd, onSkip,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  triggerName: string;
  suggestions: UpsellChoice[];
  onAdd: (picked: UpsellChoice[]) => void;
  onSkip: () => void;
}) {
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  useEffect(() => { if (open) setPicked({}); }, [open]);

  function toggle(id: string) {
    setPicked((cur) => ({ ...cur, [id]: !cur[id] }));
  }

  const selected = suggestions.filter((s) => picked[s.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Would you like to add anything?
          </DialogTitle>
          <DialogDescription>
            Great pairings with <span className="font-medium">{triggerName}</span>. Tap to add — or skip.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {suggestions.length === 0 ? (
            <div className="text-sm text-muted-foreground">No suggestions.</div>
          ) : (
            suggestions.map((s) => {
              const on = !!picked[s.id];
              return (
                <button key={s.id}
                  onClick={() => toggle(s.id)}
                  className={`w-full flex items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                    on ? "border-primary bg-primary/10" : "hover:bg-accent"
                  }`}>
                  <div className="flex-1">
                    <div className="font-medium leading-tight">{s.name}</div>
                    <div className="text-xs text-muted-foreground">₱{fmt(s.price)}</div>
                  </div>
                  <div className={`h-4 w-4 rounded-full border ${on ? "bg-primary border-primary" : ""}`} />
                </button>
              );
            })
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onSkip}>Skip</Button>
          <Button onClick={() => onAdd(selected)} disabled={selected.length === 0}>
            Add {selected.length > 0 ? `(${selected.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
