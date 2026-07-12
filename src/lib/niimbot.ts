// Niimbot B-series (B1 / B21 / D11) Bluetooth Low Energy printing helper.
//
// Based on the widely-published reverse-engineered protocol (NiimBlue,
// niimprint). Packets are framed as:
//
//   0x55 0x55 <cmd> <len> <data...> <checksum> 0xAA 0xAA
//
// checksum = cmd XOR len XOR each data byte.
//
// This is a best-effort implementation: it renders a monochrome bitmap
// from an HTMLCanvas, then streams the standard start_print / set_dimension
// / row-image / end_print packet sequence. If a specific Niimbot firmware
// rejects a step, the barista can adjust density/size in the Niimbot dialog
// and try again.

const NIIMBOT_SERVICES = [
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
];

export function isLikelyNiimbot(name?: string | null) {
  if (!name) return false;
  return /niimbot|b1\b|b18|b21|b3s|d11|d110|d101/i.test(name);
}

function makePacket(cmd: number, data: number[]): Uint8Array {
  const len = data.length;
  let checksum = cmd ^ len;
  for (const b of data) checksum ^= b;
  return new Uint8Array([0x55, 0x55, cmd, len, ...data, checksum & 0xff, 0xaa, 0xaa]);
}

async function getNiimbotWriteChar(device: any): Promise<any> {
  const server = device.gatt?.connected ? device.gatt : await device.gatt?.connect();
  if (!server) throw new Error("Could not connect to the Niimbot printer.");
  for (const uuid of NIIMBOT_SERVICES) {
    try {
      const svc = await server.getPrimaryService(uuid);
      const chars = await svc.getCharacteristics();
      for (const c of chars) {
        if (c.properties?.write || c.properties?.writeWithoutResponse) return c;
      }
    } catch { /* try next */ }
  }
  throw new Error("Niimbot service not found on this device.");
}

async function writePacket(ch: any, pkt: Uint8Array) {
  const CHUNK = 20;
  for (let i = 0; i < pkt.length; i += CHUNK) {
    const chunk = pkt.slice(i, i + CHUNK);
    if (ch.properties?.writeWithoutResponse) {
      await ch.writeValueWithoutResponse(chunk);
    } else if (ch.writeValueWithResponse) {
      await ch.writeValueWithResponse(chunk);
    } else {
      await ch.writeValue(chunk);
    }
    // Small pacing gap — Niimbot dislikes back-to-back writes.
    await new Promise((r) => setTimeout(r, 8));
  }
}

// Render a plain-text label to a monochrome bitmap. Width/height in mm,
// converted to dots at 8 dots/mm (203dpi).
export function renderLabelBitmap(
  text: string,
  widthMm: number,
  heightMm: number,
  fontPx = 22,
): { width: number; height: number; rows: Uint8Array[] } {
  if (typeof document === "undefined") throw new Error("Canvas not available");
  const DPM = 8; // dots per mm at 203dpi
  const w = Math.round(widthMm * DPM);
  const h = Math.round(heightMm * DPM);
  const wBytes = Math.ceil(w / 8);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;

  // word-wrap
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  const margin = 8;
  const maxW = w - margin * 2;
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const lineH = Math.round(fontPx * 1.25);
  let y = margin;
  for (const l of lines) {
    if (y + lineH > h - margin) break;
    ctx.fillText(l, margin, y);
    y += lineH;
  }

  const img = ctx.getImageData(0, 0, w, h);
  const rows: Uint8Array[] = [];
  for (let row = 0; row < h; row++) {
    const bytes = new Uint8Array(wBytes);
    for (let col = 0; col < w; col++) {
      const idx = (row * w + col) * 4;
      const r = img.data[idx], g = img.data[idx + 1], b = img.data[idx + 2];
      // black if dark enough
      if ((r + g + b) / 3 < 128) {
        bytes[col >> 3] |= 0x80 >> (col & 7);
      }
    }
    rows.push(bytes);
  }
  return { width: w, height: h, rows };
}

export type NiimbotOptions = {
  device: any; // BluetoothDevice
  text: string;
  widthMm: number;
  heightMm: number;
  density: number; // 1..5
  quantity: number;
  fontPx?: number;
};

export async function printNiimbotLabel(opts: NiimbotOptions) {
  const { device, text, widthMm, heightMm, quantity, fontPx } = opts;
  const density = Math.min(5, Math.max(1, Math.round(opts.density)));
  const ch = await getNiimbotWriteChar(device);
  const bmp = renderLabelBitmap(text, widthMm, heightMm, fontPx);

  // 1. density
  await writePacket(ch, makePacket(0x21, [density]));
  // 2. label type (1 = with gap)
  await writePacket(ch, makePacket(0x23, [1]));
  // 3. start print job
  await writePacket(ch, makePacket(0x01, [0x01]));
  // 4. start page
  await writePacket(ch, makePacket(0x03, [0x01]));
  // 5. dimensions (height_hi, height_lo, width_hi, width_lo)
  await writePacket(
    ch,
    makePacket(0x13, [
      (bmp.height >> 8) & 0xff, bmp.height & 0xff,
      (bmp.width >> 8) & 0xff, bmp.width & 0xff,
    ]),
  );
  // 6. quantity
  await writePacket(ch, makePacket(0x15, [(quantity >> 8) & 0xff, quantity & 0xff]));

  // 7. image rows (cmd 0x85) — skip pure-white rows with 0x84
  for (let y = 0; y < bmp.rows.length; y++) {
    const row = bmp.rows[y];
    let any = false;
    for (let i = 0; i < row.length; i++) if (row[i]) { any = true; break; }
    if (!any) {
      await writePacket(ch, makePacket(0x84, [(y >> 8) & 0xff, y & 0xff, 1]));
      continue;
    }
    const header = [(y >> 8) & 0xff, y & 0xff, 0, 0, 1];
    await writePacket(ch, makePacket(0x85, [...header, ...row]));
  }

  // 8. end page + end print
  await writePacket(ch, makePacket(0xe3, [1]));
  await writePacket(ch, makePacket(0xf3, [1]));
}
