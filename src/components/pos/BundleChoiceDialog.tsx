import { useState } from "react";
import { StableModal, StableModalFooter } from "@/components/ui/stable-modal";
import { Button } from "@/components/ui/button";

export type BundleVariant = { id: string; menu_item_id: string; name: string; price: number; sort_order?: number };

export type BundleChoiceRow = {
  bundle_item_id: string;         // bundle_items.id
  item_name: string;
  qty: number;
  choices: BundleVariant[];       // allowed variants (>1 means the guest picks)
};

const fmt = (n: number) => Number(n).toFixed(2);

/**
 * Shown when a bundle component allows multiple variants
 * (e.g. "any classic cookie" + "any refresher"). One pick per component.
 */
export function BundleChoiceDialog({
  open, onOpenChange, bundleName, rows, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bundleName: string;
  rows: BundleChoiceRow[];
  onConfirm: (picked: Record<string, string>) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const r of rows) if (r.choices.length === 1) init[r.bundle_item_id] = r.choices[0].id;
    return init;
  });

  const missing = rows.some((r) => !picked[r.bundle_item_id]);

  return (
    <StableModal open={open} onOpenChange={onOpenChange} title={bundleName}
      className="max-w-lg max-h-[90vh] overflow-y-auto">
      <div className="space-y-4 text-sm">
        <p className="text-xs text-muted-foreground">
          Pick one option for each part of this bundle.
        </p>
        {rows.map((r) => (
          <section key={r.bundle_item_id}>
            <div className="text-xs font-medium text-muted-foreground mb-2">
              {r.item_name}{r.qty > 1 ? ` × ${r.qty}` : ""} <span className="text-destructive">*</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {r.choices.map((v) => (
                <button key={v.id} type="button"
                  onClick={() => setPicked((c) => ({ ...c, [r.bundle_item_id]: v.id }))}
                  className={`rounded-md border p-2 text-left transition-colors ${
                    picked[r.bundle_item_id] === v.id ? "border-primary bg-primary/10" : "hover:bg-accent"
                  }`}>
                  <div className="font-medium leading-tight">{v.name}</div>
                  <div className="text-xs text-muted-foreground">{fmt(v.price)}</div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <StableModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button disabled={missing} onClick={() => onConfirm(picked)}>Add bundle</Button>
      </StableModalFooter>
    </StableModal>
  );
}
