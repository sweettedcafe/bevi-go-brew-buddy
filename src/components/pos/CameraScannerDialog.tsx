import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, X } from "lucide-react";
import { toast } from "sonner";

export function CameraScannerDialog({
  open, onOpenChange, onDetected,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDetected: (code: string) => void;
}) {
  const elementId = "bevi-qr-region";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onDetectedRef = useRef(onDetected);
  const onOpenChangeRef = useRef(onOpenChange);
  const [starting, setStarting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => { onDetectedRef.current = onDetected; }, [onDetected]);
  useEffect(() => { onOpenChangeRef.current = onOpenChange; }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStarting(true);
    setErrorMsg(null);

    const start = async () => {
      // Wait a tick so the dialog content (and #bevi-qr-region) is mounted.
      await new Promise((r) => setTimeout(r, 50));
      if (cancelled) return;

      const host = document.getElementById(elementId);
      if (!host) {
        setErrorMsg("Scanner area not ready. Please try again.");
        setStarting(false);
        return;
      }

      // Preflight: secure context + API availability
      if (typeof window !== "undefined" && !window.isSecureContext) {
        const msg = "Camera requires HTTPS. Open the app over https:// (or localhost).";
        setErrorMsg(msg);
        toast.error(msg);
        setStarting(false);
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        const msg = "This browser doesn't support camera access.";
        setErrorMsg(msg);
        toast.error(msg);
        setStarting(false);
        return;
      }

      // Prime permission with a direct getUserMedia call so we get a real
      // error name (NotAllowedError / NotFoundError / NotReadableError).
      try {
        const probe = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        // Stop the probe stream — Html5Qrcode will open its own.
        probe.getTracks().forEach((t) => t.stop());
      } catch (e: any) {
        const name = e?.name ?? "";
        let msg = e?.message || "Camera unavailable";
        if (name === "NotAllowedError" || name === "SecurityError") {
          msg = "Camera permission denied. Allow camera access in your browser settings and try again.";
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          msg = "No camera found on this device.";
        } else if (name === "NotReadableError") {
          msg = "Camera is in use by another app. Close it and try again.";
        }
        setErrorMsg(msg);
        toast.error(msg);
        setStarting(false);
        return;
      }

      try {
        const scanner = new Html5Qrcode(elementId, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
          ],
          verbose: false,
        });
        scannerRef.current = scanner;

        // Try back camera first; if that fails, fall back to any available camera.
        const config = { fps: 10, qrbox: { width: 260, height: 180 }, aspectRatio: 1.4 };
        const onDecode = (decoded: string) => {
          if (cancelled) return;
          onDetectedRef.current(decoded.trim());
        };

        try {
          await scanner.start(
            { facingMode: { ideal: "environment" } },
            config,
            onDecode,
            () => {},
          );
        } catch {
          // Fallback: enumerate and pick the first camera
          const cams = await Html5Qrcode.getCameras().catch(() => []);
          if (!cams || cams.length === 0) throw new Error("No camera found");
          const back = cams.find((c) => /back|rear|environment/i.test(c.label)) ?? cams[0];
          await scanner.start(back.id, config, onDecode, () => {});
        }
      } catch (e: any) {
        const msg = e?.message ?? "Camera unavailable";
        setErrorMsg(msg);
        toast.error(msg);
      } finally {
        if (!cancelled) setStarting(false);
      }
    };

    start();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        s.stop().catch(() => {}).finally(() => { try { s.clear(); } catch {} });
      }
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4" /> Scan barcode / QR
          </DialogTitle>
          <DialogDescription>
            Point the camera at a customer's QR or a product barcode.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md overflow-hidden border bg-black min-h-[240px]">
          <div id={elementId} className="w-full" />
        </div>
        {errorMsg ? (
          <p className="text-xs text-destructive text-center">{errorMsg}</p>
        ) : (
          <p className="text-xs text-muted-foreground text-center">
            {starting ? "Starting camera…" : "Hold the code steady inside the frame."}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            <X className="h-3 w-3 mr-1" /> Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
