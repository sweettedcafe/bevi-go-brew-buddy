// Web Bluetooth printer helper.
//
// After pairing we keep the device in-memory so subsequent prints can go
// straight to it. Printing sends ESC/POS-style text bytes to the first
// writable characteristic we can find on the device. This works for the
// large family of generic BT thermal printers that expose the standard
// 000018f0 serial-over-GATT service. Niimbot's B-series (B1/B21) uses a
// proprietary packet format — we still try their FF00 service so the
// device receives *something*, but full raster printing for those models
// requires their SDK protocol and is not implemented here.

export type BtPrinter = { id: string; name: string };

const KNOWN_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb", // Generic ESC/POS serial-over-GATT
  "0000ff00-0000-1000-8000-00805f9b34fb", // Niimbot
  "0000fee7-0000-1000-8000-00805f9b34fb", // Niimbot alt
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2", // Some label printers
];

let pairedDevice: any = null;

export function isBluetoothSupported() {
  return typeof navigator !== "undefined" && !!(navigator as any).bluetooth;
}

export function getPairedPrinter(): BtPrinter | null {
  if (!pairedDevice) return null;
  return { id: pairedDevice.id ?? "", name: pairedDevice.name ?? "Bluetooth printer" };
}

export async function findBluetoothPrinter(): Promise<BtPrinter | null> {
  const nav = navigator as any;
  if (!nav.bluetooth) {
    throw new Error("Web Bluetooth is not available in this browser. Try Chrome or Edge on desktop/Android.");
  }
  const device = await nav.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [
      ...KNOWN_SERVICES,
      "battery_service",
      "device_information",
      "generic_access",
    ],
  });
  if (!device) return null;
  pairedDevice = device;
  try { await device.gatt?.connect(); } catch { /* pairing prompt already succeeded */ }
  return { id: device.id ?? "", name: device.name ?? "Unknown printer" };
}

async function findWritableCharacteristic(server: any): Promise<any | null> {
  // Try known services first
  for (const uuid of KNOWN_SERVICES) {
    try {
      const svc = await server.getPrimaryService(uuid);
      const chars = await svc.getCharacteristics();
      for (const c of chars) {
        if (c.properties?.write || c.properties?.writeWithoutResponse) return c;
      }
    } catch { /* service not present, try next */ }
  }
  // Fallback: enumerate all primary services (Chrome exposes only those we
  // declared in optionalServices, so this is best-effort).
  try {
    const services = await server.getPrimaryServices();
    for (const svc of services) {
      const chars = await svc.getCharacteristics();
      for (const c of chars) {
        if (c.properties?.write || c.properties?.writeWithoutResponse) return c;
      }
    }
  } catch { /* ignore */ }
  return null;
}

async function writeChunks(characteristic: any, data: Uint8Array) {
  const CHUNK = 180;
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK);
    if (characteristic.properties?.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk);
    } else {
      await characteristic.writeValueWithResponse
        ? await characteristic.writeValueWithResponse(chunk)
        : await characteristic.writeValue(chunk);
    }
  }
}

// Build a simple ESC/POS byte payload from plain text.
function buildEscPos(text: string): Uint8Array {
  const enc = new TextEncoder();
  const ESC = 0x1b, GS = 0x1d, LF = 0x0a;
  const parts: number[] = [];
  parts.push(ESC, 0x40); // init
  parts.push(ESC, 0x61, 0x01); // center align
  for (const line of text.split(/\r?\n/)) {
    for (const b of enc.encode(line)) parts.push(b);
    parts.push(LF);
  }
  parts.push(LF, LF, LF);
  parts.push(GS, 0x56, 0x00); // cut
  return new Uint8Array(parts);
}

export async function printTextToBluetooth(text: string): Promise<void> {
  if (!pairedDevice) throw new Error("No Bluetooth printer paired. Tap Bluetooth printer first.");
  const server = pairedDevice.gatt?.connected
    ? pairedDevice.gatt
    : await pairedDevice.gatt?.connect();
  if (!server) throw new Error("Could not connect to the Bluetooth printer.");
  const characteristic = await findWritableCharacteristic(server);
  if (!characteristic) {
    throw new Error(
      "Paired, but this printer doesn't expose a writable text channel over Web Bluetooth. Niimbot B-series needs its official app; try a generic ESC/POS BT printer for direct printing here."
    );
  }
  const payload = buildEscPos(text);
  await writeChunks(characteristic, payload);
}

// Strip HTML tags and collapse whitespace for a printable text version.
export function htmlToPlainText(html: string): string {
  if (typeof document === "undefined") return html.replace(/<[^>]+>/g, " ");
  const div = document.createElement("div");
  div.innerHTML = html;
  const text = div.innerText || div.textContent || "";
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
