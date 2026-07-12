import { useEffect, useMemo, useState } from "react";
import { Bluetooth, Printer } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { getPairedDevice, getPairedPrinter, htmlToPlainText } from "@/lib/bt-printer";
import {
  bitmapToDataUrl,
  hasNiimbotLabelHtml,
  printNiimbotBitmaps,
  renderLabelBitmap,
  renderLabelHtmlBitmaps,
  type NiimbotBitmap,
} from "@/lib/niimbot";

function toPlain(s: string): string {
  if (!s) return "";
  // strip if it looks like HTML
  return /<[a-z!/]/i.test(s) ? htmlToPlainText(s) : s;
}

export function NiimbotPrintDialog({
  open,
  onOpenChange,
  initialText,
  initialHtml = "",
  initialWidthMm = 50,
  initialHeightMm = 30,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialText: string;
  initialHtml?: string;
  initialWidthMm?: number;
  initialHeightMm?: number;
}) {
  const paired = getPairedPrinter();
  const [text, setText] = useState(() => toPlain(initialText));
  const [widthMm, setWidthMm] = useState(initialWidthMm);
  const [heightMm, setHeightMm] = useState(initialHeightMm);
  const [density, setDensity] = useState(3);
  const [quantity, setQuantity] = useState(1);
  const [fontPx, setFontPx] = useState(22);
  const [sending, setSending] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [labelCount, setLabelCount] = useState(1);
  const hasFormattedLabels = hasNiimbotLabelHtml(initialHtml);

  useEffect(() => {
    if (open) {
      setText(toPlain(initialText));
      setWidthMm(initialWidthMm);
      setHeightMm(initialHeightMm);
    }
  }, [open, initialText, initialWidthMm, initialHeightMm]);

  function buildBitmaps(): NiimbotBitmap[] {
    if (hasNiimbotLabelHtml(initialHtml)) {
      const bitmaps = renderLabelHtmlBitmaps(initialHtml, widthMm, heightMm);
      if (bitmaps.length > 0) return bitmaps;
    }
    return [renderLabelBitmap(text, widthMm, heightMm, fontPx)];
  }

  // Regenerate a canvas preview whenever inputs change.
  useEffect(() => {
    if (!open) return;
    try {
      const bitmaps = buildBitmaps();
      setLabelCount(bitmaps.length);
      setPreviewUrl(bitmaps[0] ? bitmapToDataUrl(bitmaps[0]) : "");
    } catch {
      setPreviewUrl("");
      setLabelCount(1);
    }
  }, [open, text, initialHtml, widthMm, heightMm, fontPx]);

  const dots = useMemo(() => ({ w: Math.round(widthMm * 8), h: Math.round(heightMm * 8) }), [widthMm, heightMm]);

  async function doPrint() {
    const device = getPairedDevice();
    if (!device) {
      toast.error("Pair a Niimbot printer first.");
      return;
    }
    setSending(true);
    try {
      const bitmaps = buildBitmaps();
      await printNiimbotBitmaps({ device, bitmaps, density, copies: quantity });
      const total = bitmaps.length * quantity;
      toast.success(`Sent ${total} label${total > 1 ? "s" : ""} to ${paired?.name ?? "Niimbot"}`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Niimbot print failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bluetooth className="h-5 w-5 text-primary" />
            Niimbot label — {paired?.name ?? "not paired"}
          </DialogTitle>
          <DialogDescription>
            Adjust the label size and density, then tap Print to send the formatted label to the device.
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            {!hasFormattedLabels && (
              <div>
                <Label className="text-xs">Label text</Label>
                <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
              </div>
            )}
            {hasFormattedLabels && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                Printing the formatted order label{labelCount > 1 ? `s (${labelCount})` : ""} with order number, drink, customer, notes, quote, and shop name.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Width (mm)</Label>
                <Input type="number" min={10} max={100} value={widthMm}
                  onChange={(e) => setWidthMm(Math.max(10, Number(e.target.value) || 0))} />
              </div>
              <div>
                <Label className="text-xs">Height (mm)</Label>
                <Input type="number" min={10} max={100} value={heightMm}
                  onChange={(e) => setHeightMm(Math.max(10, Number(e.target.value) || 0))} />
              </div>
              <div>
                <Label className="text-xs">Font size (px)</Label>
                <Input type="number" min={10} max={80} value={fontPx}
                  onChange={(e) => setFontPx(Math.max(10, Number(e.target.value) || 22))} />
              </div>
              <div>
                <Label className="text-xs">Copies per label</Label>
                <Input type="number" min={1} max={50} value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Density ({density})</Label>
              <Slider min={1} max={5} step={1} value={[density]}
                onValueChange={(v) => setDensity(v[0] ?? 3)} />
              <div className="text-xs text-muted-foreground mt-1">
                1 = lightest, 5 = darkest. Niimbot B1 recommends 3.
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Bitmap size: {dots.w} × {dots.h} dots (8 dots/mm)
              {labelCount > 1 ? ` • ${labelCount} labels` : ""}
            </div>
          </div>

          <div className="border rounded-lg p-3 bg-muted/30 flex items-center justify-center min-h-[240px]">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Label preview"
                style={{ width: `${widthMm * 3}px`, height: `${heightMm * 3}px`, imageRendering: "pixelated" }}
                className="bg-white border shadow-sm"
              />
            ) : (
              <span className="text-xs text-muted-foreground">Preview unavailable</span>
            )}
          </div>
        </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t bg-background">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={doPrint} disabled={sending || !paired}>
            <Printer className="h-4 w-4 mr-2" />
            {sending ? "Printing…" : `Print ${quantity > 1 ? `× ${quantity}` : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
