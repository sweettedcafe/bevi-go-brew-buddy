// Web Bluetooth printer pairing. Real ESC/POS driving is device-specific;
// this helper lets the user pair a nearby BT printer so the OS lists it in
// the browser print dialog on the next print. For WiFi/AirPrint printers,
// pairing happens in the OS — the OS print dialog picks them up.

export type BtPrinter = { id: string; name: string };

export async function findBluetoothPrinter(): Promise<BtPrinter | null> {
  const nav = navigator as any;
  if (!nav.bluetooth) {
    throw new Error("Web Bluetooth is not available in this browser. Try Chrome or Edge on desktop/Android.");
  }
  const device = await nav.bluetooth.requestDevice({
    // Common thermal-printer services (ESC/POS over BLE / SPP)
    filters: [
      { services: ["000018f0-0000-1000-8000-00805f9b34fb"] },
      { namePrefix: "Printer" },
      { namePrefix: "POS" },
      { namePrefix: "MTP" },
      { namePrefix: "BT" },
    ],
    optionalServices: ["000018f0-0000-1000-8000-00805f9b34fb", "battery_service"],
  });
  if (!device) return null;
  try { await device.gatt?.connect(); } catch { /* pairing prompt already succeeded */ }
  return { id: device.id ?? "", name: device.name ?? "Unknown printer" };
}

export function isBluetoothSupported() {
  return typeof navigator !== "undefined" && !!(navigator as any).bluetooth;
}
