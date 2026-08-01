import { useState } from "react";
import { StableModal, StableModalFooter } from "@/components/ui/stable-modal";
import { Button } from "@/components/ui/button";
import { Sparkles, Settings2 } from "lucide-react";

export type UpsellChoice = {
  id: string;
  name: string;
  price: number;
  hasCustomization?: boolean;
};

const fmt = (n: number) => Number(n).toFixed(2);

/**
 * Suggests complementary items after an order is added to cart.
 * User can pick any (or none) and Skip / Add.
 *
 * If an item has customization/variants and `onCustomize` is provided, tapping
 * that item opens the item's customization dialog instead of just toggling.
 */
export function UpsellDialog({
  open, onOpenChange, triggerName, suggestions, onAdd, onSkip, onCustomize,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  triggerName: string;
  suggestions: UpsellChoice[];
  onAdd: (picked: UpsellChoice[]) => void;
  onSkip: () => void;
  onCustomize?: (choice: UpsellChoice) => void;
}) {
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  function toggle(id: string) {
    setPicked((cur) => ({ ...cur, [id]: !cur[id] }));
  }

  const selected = suggestions.filter((s) => picked[s.id]);

  return (
    <StableModal
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-md"
      title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Would you like to add anything?</span>}
      description={<>Great pairings with <span className="font-medium">{triggerName}</span>. Tap to add — or skip.</>}
    >

        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {suggestions.length === 0 ? (
            <div className="text-sm text-muted-foreground">No suggestions.</div>
          ) : (
            suggestions.map((s) => {
              const on = !!picked[s.id];
              const customizable = !!s.hasCustomization && !!onCustomize;
              return (
                <button key={s.id}
                  onClick={() => {
                    if (customizable) {
                      onCustomize!(s);
                    } else {
                      toggle(s.id);
                    }
                  }}
                  className={`w-full flex items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                    on ? "border-primary bg-primary/10" : "hover:bg-accent"
                  }`}>
                  <div className="flex-1">
                    <div className="font-medium leading-tight">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      ₱{fmt(s.price)}
                      {customizable && <span className="ml-1">· starts at</span>}
                    </div>
                    {customizable && (
                      <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary">
                        <Settings2 className="h-3 w-3" /> Choose options
                      </div>
                    )}
                  </div>
                  {customizable ? (
                    <span className="text-xs text-primary font-medium">Customize →</span>
                  ) : (
                    <div className={`h-4 w-4 rounded-full border ${on ? "bg-primary border-primary" : ""}`} />
                  )}
                </button>
              );
            })
          )}
        </div>

        <StableModalFooter>
          <Button variant="outline" onClick={onSkip}>Skip</Button>
          <Button onClick={() => onAdd(selected)} disabled={selected.length === 0}>
            Add {selected.length > 0 ? `(${selected.length})` : ""}
          </Button>
        </StableModalFooter>
    </StableModal>
  );
}
