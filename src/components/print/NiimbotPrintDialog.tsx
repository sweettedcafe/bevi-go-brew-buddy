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
import { printNiimbotLabel, renderLabelBitmap } from "@/lib/niimbot";

function toPlain(s: string): string {
  if (!s) return "";
  // strip if it looks like HTML
  return /<[a-z!/]/i.test(s) ? htmlToPlainText(s) : s;
}

export function NiimbotPrintDialog({
  open,
  onOpenChange,
  initialText,
  initialWidthMm = 50,
  initialHeightMm = 30,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialText: string;
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

  useEffect(() => {
    if (open) {
      setText(toPlain(initialText));
      setWidthMm(initialWidthMm);
      setHeightMm(initialHeightMm);
    }
  }, [open, initialText, initialWidthMm, initialHeightMm]);

  // Regenerate a canvas preview whenever inputs change.
  useEffect(() => {
    if (!open) return;
    try {
      const bmp = renderLabelBitmap(text, widthMm, heightMm, fontPx);
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext("2d")!;
      const img = ctx.createImageData(bmp.width, bmp.height);
      const wBytes = Math.ceil(bmp.width / 8);
      for (let y = 0; y < bmp.height; y++) {
        const row = bmp.rows[y];
        for (let x = 0; x < bmp.width; x++) {
          const bit = row[Math.floor(x / 8) < wBytes ? Math.floor(x / 8) : 0] & (0x80 >> (x & 7));
          const idx = (y * bmp.width + x) * 4;
          const v = bit ? 0 : 255;
          img.data[idx] = v; img.data[idx + 1] = v; img.data[idx + 2] = v; img.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      setPreviewUrl(canvas.toDataURL("image/png"));
    } catch {
      setPreviewUrl("");
    }
  }, [open, text, widthMm, heightMm, fontPx]);

  const dots = useMemo(() => ({ w: Math.round(widthMm * 8), h: Math.round(heightMm * 8) }), [widthMm, heightMm]);

  async function doPrint() {
    const device = getPairedDevice();
    if (!device) {
      toast.error("Pair a Niimbot printer first.");
      return;
    }
    setSending(true);
    try {
      await printNiimbotLabel({
        device, text, widthMm, heightMm, density, quantity, fontPx,
      });
      toast.success(`Sent ${quantity} label${quantity > 1 ? "s" : ""} to ${paired?.name ?? "Niimbot"}`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Niimbot print failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bluetooth className="h-5 w-5 text-primary" />
            Niimbot label — {paired?.name ?? "not paired"}
          </DialogTitle>
          <DialogDescription>
            This printer uses Niimbot's proprietary format. Adjust the label size,
            density, and text below, then tap Print to send it to the device.
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Label text</Label>
              <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
            </div>
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
                <Label className="text-xs">Quantity</Label>
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

        <div className="flex items-center justify-end gap-2 pt-2 border-t">
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
