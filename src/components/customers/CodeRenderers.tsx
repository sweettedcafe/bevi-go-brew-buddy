import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";

export function QrCanvas({ value, size = 200 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && value) {
      QRCode.toCanvas(ref.current, value, { width: size, margin: 1 }).catch(() => {});
    }
  }, [value, size]);
  return <canvas ref={ref} className="rounded bg-white p-2" />;
}

// Kept for backwards compatibility — now renders the value as a QR code
// so it's scannable by any phone camera (Google Lens, iOS camera, etc.).
export function BarcodeSvg({ value, size = 180 }: { value: string; height?: number; size?: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <QrCanvas value={value} size={size} />
      <div className="font-mono text-xs tracking-widest">{value}</div>
    </div>
  );
}

// Suppress unused-import warning for JsBarcode kept for potential future use.
void JsBarcode;
