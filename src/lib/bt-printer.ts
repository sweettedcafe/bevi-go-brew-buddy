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
  // Niimbot (B1, B21, D11, D110), thermal ESC/POS and generic printers all
  // advertise different services/names. Rather than filter tightly (which
  // hides devices like the Niimbot B1), show every nearby BLE device and
  // let the user pick. We still declare common optional services so we can
  // access them once connected.
  const device = await nav.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [
      "000018f0-0000-1000-8000-00805f9b34fb", // Common thermal / ESC-POS
      "0000ff00-0000-1000-8000-00805f9b34fb", // Niimbot service
      "0000fee7-0000-1000-8000-00805f9b34fb", // Niimbot alt
      "e7810a71-73ae-499d-8c15-faa9aef0c3f2", // Some label printers
      "battery_service",
      "device_information",
      "generic_access",
    ],
  });
  if (!device) return null;
  try { await device.gatt?.connect(); } catch { /* pairing prompt already succeeded */ }
  return { id: device.id ?? "", name: device.name ?? "Unknown printer" };
}

export function isBluetoothSupported() {
  return typeof navigator !== "undefined" && !!(navigator as any).bluetooth;
}
