import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Printer, Save, TestTube } from "lucide-react";
import { toast } from "sonner";
import { loadPrintSettings, savePrintSettings, type PrintSettings } from "@/lib/print-settings";
import { loadPosSettings, savePosSettings, type PosSettings } from "@/lib/pos-settings";
import { printHTML } from "@/lib/print";
import { receiptHTML, labelsHTML } from "@/lib/print-templates";
import { ScanLine } from "lucide-react";

export const Route = createFileRoute("/_authenticated/print-settings")({
  component: PrintSettingsPage,
});

function PrintSettingsPage() {
  const [s, setS] = useState<PrintSettings>(() => loadPrintSettings());
  const [pos, setPos] = useState<PosSettings>(() => loadPosSettings());

  function save() {
    savePrintSettings(s);
    savePosSettings(pos);
    toast.success("Settings saved on this device");
  }
  function update<K extends keyof PrintSettings>(k: K, v: PrintSettings[K]) {
    setS((p) => ({ ...p, [k]: v }));
  }
  function updatePos<K extends keyof PosSettings>(k: K, v: PosSettings[K]) {
    setPos((p) => ({ ...p, [k]: v }));
  }
  function testReceipt() {
    printHTML(receiptHTML({
      orderNo: 1, businessDate: "today", createdAt: new Date().toISOString(),
      cashier: "test@bevi.go", orderType: "takeout", customerName: "Test Customer",
      lines: [
        { name: "Latte", qty: 2, unit_price: 15, line_total: 30 },
        { name: "Croissant", qty: 1, unit_price: 10, line_total: 10 },
      ],
      subtotal: 40, discountLabel: null, discountAmount: 0, total: 40,
      payments: [{ label: "Cash", amount: 50 }], change: 10,
    }, s), "Test Receipt");
  }
  function testLabel() {
    printHTML(labelsHTML([{
      orderNo: 1, drinkName: "Latte", cupIndex: 1, cupTotal: 2,
      customerName: "Test Customer", notes: "extra hot",
      createdAt: new Date().toISOString(),
    }], s), "Test Label");
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <header className="flex items-center gap-3 mb-4">
        <Printer className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-display">Print Settings</h1>
      </header>

      <Card className="p-4 sm:p-6 space-y-5">
        <p className="text-sm text-muted-foreground">
          Lovable opens your browser's print dialog. To make it automatic, open Chrome &gt; Settings &gt; Printers, then in
          the print dialog set <b>Always print to</b> for each printer. Receipts use 80mm thermal paper;
          labels use a 58×40mm label printer.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Receipt printer (display name)</Label>
            <Input value={s.receiptPrinter} onChange={(e) => update("receiptPrinter", e.target.value)} placeholder="e.g. EPSON TM-T20" />
          </div>
          <div>
            <Label className="text-xs">Label printer (display name)</Label>
            <Input value={s.labelPrinter} onChange={(e) => update("labelPrinter", e.target.value)} placeholder="e.g. Brother QL-820" />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Auto-print receipts on charge</div>
            <div className="text-xs text-muted-foreground">Opens the receipt print dialog right after payment.</div>
          </div>
          <Switch checked={s.autoPrintReceipt} onCheckedChange={(v) => update("autoPrintReceipt", v)} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Auto-print drink labels on charge</div>
            <div className="text-xs text-muted-foreground">One label per cup, customer name + order number.</div>
          </div>
          <Switch checked={s.autoPrintLabels} onCheckedChange={(v) => update("autoPrintLabels", v)} />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Shop name (printed)</Label>
            <Input value={s.shopName} onChange={(e) => update("shopName", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Receipt footer</Label>
            <Input value={s.shopFooter} onChange={(e) => update("shopFooter", e.target.value)} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <Button onClick={save}><Save className="h-3 w-3 mr-1" /> Save</Button>
          <Button variant="outline" onClick={testReceipt}><TestTube className="h-3 w-3 mr-1" /> Test receipt</Button>
          <Button variant="outline" onClick={testLabel}><TestTube className="h-3 w-3 mr-1" /> Test label</Button>
        </div>
      </Card>

      <Card className="p-4 sm:p-6 space-y-5 mt-4">
        <div className="flex items-center gap-2">
          <ScanLine className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg">POS Barcode Scanner</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Enable to use a USB or Bluetooth barcode scanner on the POS. Scanning a customer's loyalty
          barcode auto-fills their name, points balance, and recent orders. Most scanners emulate a
          keyboard and send <b>Enter</b> at the end of the code — no driver needed.
        </p>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Enable barcode scanning on POS</div>
            <div className="text-xs text-muted-foreground">Shows the scan input on the POS Current Order panel.</div>
          </div>
          <Switch checked={pos.scanEnabled} onCheckedChange={(v) => updatePos("scanEnabled", v)} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Keep scanner input focused</div>
            <div className="text-xs text-muted-foreground">Auto-refocus so a scan is always captured even after tapping the menu.</div>
          </div>
          <Switch checked={pos.scanAutoFocus} onCheckedChange={(v) => updatePos("scanAutoFocus", v)} />
        </div>

        <div className="pt-2 border-t">
          <Button onClick={save}><Save className="h-3 w-3 mr-1" /> Save</Button>
        </div>
      </Card>
    </div>
  );
}
