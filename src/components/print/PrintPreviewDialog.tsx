import { useEffect, useMemo, useState } from "react";
import { Bluetooth, Download, Printer, Wifi } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { savePdfFromHTML } from "@/lib/print-pdf";
import { findBluetoothPrinter, isBluetoothSupported } from "@/lib/bt-printer";
import { toast } from "sonner";

export type PrintPreviewDocument = {
  id: "receipt" | "labels";
  label: string;
  title: string;
  html: string;
  filename: string;
  widthMm: number;
};

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

  useEffect(() => {
    if (open) setActiveId(firstId);
  }, [open, firstId]);

  const active = useMemo(
    () => documents.find((doc) => doc.id === activeId) ?? documents[0] ?? null,
    [activeId, documents],
  );

  async function savePdf() {
    if (!active) return;
    await savePdfFromHTML(active.html, active.filename, active.widthMm);
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
    doc.write(wrapPrintHtml(active.html, active.title));
    doc.close();

    const win = iframe.contentWindow;
    setTimeout(() => {
      try {
        win?.focus();
        win?.print();
      } finally {
        setTimeout(() => iframe.remove(), 500);
      }
    }, 100);
  }

  async function findBluetooth() {
    try {
      const printer = await findBluetoothPrinter();
      if (printer) toast.success(`Bluetooth printer found: ${printer.name}`);
    } catch (error: any) {
      toast.error(error?.message ?? "Bluetooth search failed");
    }
  }

  if (!active) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[92vh] p-0 overflow-hidden grid grid-rows-[auto,1fr,auto]">
        <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 border-b">
          <DialogTitle>{active.title}</DialogTitle>
        </DialogHeader>

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
              <div className="h-full rounded-lg border bg-muted/30 overflow-auto p-4">
                <iframe
                  title={doc.title}
                  className="mx-auto min-h-full bg-background shadow-sm"
                  style={{ width: `${doc.widthMm + 18}mm`, maxWidth: "100%" }}
                  srcDoc={wrapPrintHtml(doc.html, doc.title)}
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
          <Button variant="ghost" className="ml-auto" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function wrapPrintHtml(html: string, title: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${html}</body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}