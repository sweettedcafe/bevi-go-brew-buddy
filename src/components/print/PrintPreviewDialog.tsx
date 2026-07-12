import { useEffect, useMemo, useState } from "react";
import { Bluetooth, Download, Printer, Wifi } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { savePdfFromHTML, type PaperSize } from "@/lib/print-pdf";
import {
  findBluetoothPrinter,
  isBluetoothSupported,
  getPairedPrinter,
  printTextToBluetooth,
  htmlToPlainText,
} from "@/lib/bt-printer";
import { isLikelyNiimbot } from "@/lib/niimbot";
import { NiimbotPrintDialog } from "@/components/print/NiimbotPrintDialog";
import { toast } from "sonner";

export type PrintPreviewDocument = {
  id: "receipt" | "labels";
  label: string;
  title: string;
  html: string;
  filename: string;
  widthMm: number;
};

type PaperPreset = {
  id: string;
  label: string;
  paper: PaperSize;
};

const RECEIPT_PRESETS: PaperPreset[] = [
  { id: "80mm", label: "80mm thermal (roll)", paper: { kind: "roll", widthMm: 80 } },
  { id: "58mm", label: "58mm thermal (roll)", paper: { kind: "roll", widthMm: 58 } },
  { id: "72mm", label: "72mm thermal (roll)", paper: { kind: "roll", widthMm: 72 } },
  { id: "a4", label: "A4 sheet (210×297mm)", paper: { kind: "fixed", widthMm: 210, heightMm: 297 } },
  { id: "letter", label: "US Letter (216×279mm)", paper: { kind: "fixed", widthMm: 216, heightMm: 279 } },
];

const LABEL_PRESETS: PaperPreset[] = [
  { id: "58x40", label: "58×40mm label", paper: { kind: "fixed", widthMm: 58, heightMm: 40 } },
  { id: "40x30", label: "40×30mm label", paper: { kind: "fixed", widthMm: 40, heightMm: 30 } },
  { id: "80mm", label: "80mm thermal (roll)", paper: { kind: "roll", widthMm: 80 } },
  { id: "58mm", label: "58mm thermal (roll)", paper: { kind: "roll", widthMm: 58 } },
];

export function PrintPreviewDialog({
  open,
  onOpenChange,
  documents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documents: PrintPreviewDocument[];
}) {
  const firstId = documents[0]?.id ?? "receipt";
  const [activeId, setActiveId] = useState<string>(firstId);
  const [paperId, setPaperId] = useState<string>("");
  const [customW, setCustomW] = useState<string>("80");
  const [customH, setCustomH] = useState<string>("");
  const [niimbotOpen, setNiimbotOpen] = useState(false);

  useEffect(() => {
    if (open) setActiveId(firstId);
  }, [open, firstId]);

  const active = useMemo(
    () => documents.find((doc) => doc.id === activeId) ?? documents[0] ?? null,
    [activeId, documents],
  );

  const presets = active?.id === "labels" ? LABEL_PRESETS : RECEIPT_PRESETS;

  // Pick a sensible default when the active doc changes.
  useEffect(() => {
    if (!active) return;
    const match =
      presets.find((p) => p.paper.kind === "roll" && p.paper.widthMm === active.widthMm) ??
      presets[0];
    setPaperId(match.id);
    setCustomW(String(active.widthMm));
    setCustomH("");
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPaper: PaperSize = useMemo(() => {
    if (paperId === "custom") {
      const w = Math.max(20, Number(customW) || 80);
      const h = Number(customH);
      if (h && h > 0) return { kind: "fixed", widthMm: w, heightMm: h };
      return { kind: "roll", widthMm: w };
    }
    return (
      presets.find((p) => p.id === paperId)?.paper ??
      { kind: "roll", widthMm: active?.widthMm ?? 80 }
    );
  }, [paperId, customW, customH, presets, active?.widthMm]);

  // Preview width in mm for the iframe container.
  const previewWmm = selectedPaper.widthMm;
  const previewHmm =
    selectedPaper.kind === "fixed" ? selectedPaper.heightMm : undefined;

  async function savePdf() {
    if (!active) return;
    try {
      await savePdfFromHTML(active.html, active.filename, selectedPaper);
      toast.success("PDF saved");
    } catch {
      /* toast already shown */
    }
  }

  function printActive() {
    if (!active || typeof window === "undefined") return;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(wrapPrintHtml(active.html, active.title, selectedPaper));
    doc.close();

    const win = iframe.contentWindow;
    setTimeout(() => {
      try {
        win?.focus();
        win?.print();
      } finally {
        setTimeout(() => iframe.remove(), 500);
      }
    }, 150);
  }

  async function findBluetooth() {
    try {
      const already = getPairedPrinter();
      const printer = already ?? (await findBluetoothPrinter());
      if (!printer) return;
      if (!already) toast.success(`Bluetooth printer paired: ${printer.name}`);
      if (!active) return;
      // Niimbot B-series uses a proprietary format — open the dedicated
      // adjustment dialog instead of sending ESC/POS bytes.
      if (isLikelyNiimbot(printer.name)) {
        setNiimbotOpen(true);
        return;
      }
      const text = htmlToPlainText(active.html);
      toast.message(`Sending ${active.label.toLowerCase()} to ${printer.name}…`);
      await printTextToBluetooth(text);
      toast.success(`Sent to ${printer.name}`);
    } catch (error: any) {
      toast.error(error?.message ?? "Bluetooth print failed");
    }
  }

  if (!active) return null;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[92vh] p-0 overflow-hidden grid grid-rows-[auto,auto,1fr,auto]">
        <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 border-b">
          <DialogTitle>{active.title}</DialogTitle>
        </DialogHeader>

        {/* Paper size row */}
        <div className="px-4 sm:px-6 py-3 border-b bg-muted/30 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]">
            <Label className="text-xs">Paper size</Label>
            <Select value={paperId} onValueChange={setPaperId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Choose paper…" /></SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
                <SelectItem value="custom">Custom size…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {paperId === "custom" && (
            <>
              <div>
                <Label className="text-xs">Width (mm)</Label>
                <Input className="h-9 w-24" value={customW}
                  onChange={(e) => setCustomW(e.target.value)}
                  inputMode="decimal" placeholder="80" />
              </div>
              <div>
                <Label className="text-xs">Height (mm, blank = auto)</Label>
                <Input className="h-9 w-32" value={customH}
                  onChange={(e) => setCustomH(e.target.value)}
                  inputMode="decimal" placeholder="auto" />
              </div>
            </>
          )}
          <div className="text-xs text-muted-foreground ml-auto">
            {previewHmm
              ? `${previewWmm}mm × ${previewHmm}mm`
              : `${previewWmm}mm × auto`}
          </div>
        </div>

        <Tabs value={active.id} onValueChange={setActiveId} className="min-h-0 flex flex-col">
          {documents.length > 1 && (
            <div className="px-4 sm:px-6 pt-3">
              <TabsList>
                {documents.map((doc) => (
                  <TabsTrigger key={doc.id} value={doc.id}>{doc.label}</TabsTrigger>
                ))}
              </TabsList>
            </div>
          )}
          {documents.map((doc) => (
            <TabsContent key={doc.id} value={doc.id} className="m-0 min-h-0 flex-1 p-4 sm:p-6">
              <div className="h-full rounded-lg border bg-muted/30 overflow-auto p-4 flex items-start justify-center">
                <iframe
                  title={doc.title}
                  className="bg-background shadow-sm"
                  style={{
                    width: `${previewWmm}mm`,
                    height: previewHmm ? `${previewHmm}mm` : "100%",
                    minHeight: previewHmm ? undefined : "100%",
                    maxWidth: "100%",
                    display: "block",
                  }}
                  srcDoc={wrapPrintHtml(doc.html, doc.title, selectedPaper)}
                />
              </div>
            </TabsContent>
          ))}
        </Tabs>

        <div className="border-t px-4 sm:px-6 py-3 flex flex-wrap items-center gap-2">
          <Button onClick={printActive}>
            <Printer className="h-4 w-4 mr-2" /> Print
          </Button>
          <Button variant="outline" onClick={savePdf}>
            <Download className="h-4 w-4 mr-2" /> Save PDF
          </Button>
          <Button variant="outline" onClick={findBluetooth} disabled={!isBluetoothSupported()}>
            <Bluetooth className="h-4 w-4 mr-2" /> Bluetooth printer
          </Button>
          <Button
            variant="outline"
            onClick={() => toast.message("Add the WiFi printer in your device's Printers & Scanners settings, then tap Print here and choose it as the destination.")}
          >
            <Wifi className="h-4 w-4 mr-2" /> WiFi printer
          </Button>
          {active.id === "receipt" && documents.some((d) => d.id === "labels") && (
            <Button variant="secondary" onClick={() => setActiveId("labels")}>
              Go to Labels →
            </Button>
          )}
          <Button variant="ghost" className="ml-auto" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    <NiimbotPrintDialog
      open={niimbotOpen}
      onOpenChange={setNiimbotOpen}
      initialText={active ? htmlToPlainText(active.html) : ""}
      initialHtml={active?.html ?? ""}
      initialWidthMm={active?.id === "labels" ? selectedPaper.widthMm : 50}
      initialHeightMm={active?.id === "labels" && selectedPaper.kind === "fixed" ? selectedPaper.heightMm : 40}
    />
    </>
  );
}

function wrapPrintHtml(html: string, title: string, paper: PaperSize) {
  // Override the template's @page rule so the chosen paper wins, and center
  // the receipt block on wider sheets. We DO NOT set display:flex on body —
  // that turns receipt rows into flex items and breaks the layout.
  const pageRule =
    paper.kind === "roll"
      ? `@page { size: ${paper.widthMm}mm auto; margin: 3mm; }`
      : `@page { size: ${paper.widthMm}mm ${paper.heightMm}mm; margin: 4mm; }`;
  // Center the receipt block horizontally so the left and right margins
  // match. html becomes a flex row; the receipt template's <body>-scoped
  // width (e.g. 72mm) then sits centered inside the chosen paper width.
  const centerCss = `
    html { display: flex; justify-content: center; margin: 0; padding: 0; background: #fff; }
    body { margin: 0 auto !important; padding: 0; background: #fff; color: #000; }
  `;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${pageRule}${centerCss}</style></head><body>${html}</body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
