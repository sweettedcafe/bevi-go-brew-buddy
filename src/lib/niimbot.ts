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
  // Prefer the well-known B1/B-series protocol service first. Some devices also
  // expose FF00/FEE7 writable characteristics that accept bytes but do not print.
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
];

const NIIMBOT_WRITE_CHARACTERISTIC = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
      try {
        const preferred = await svc.getCharacteristic(NIIMBOT_WRITE_CHARACTERISTIC);
        if (preferred.properties?.write || preferred.properties?.writeWithoutResponse) return preferred;
      } catch { /* fall back to any writable characteristic */ }
      const chars = await svc.getCharacteristics();
      for (const c of chars) {
        if (c.properties?.write || c.properties?.writeWithoutResponse) return c;
      }
    } catch { /* try next */ }
  }
  throw new Error("Niimbot service not found on this device.");
}

async function writeBytes(ch: any, data: Uint8Array) {
  // Niimbot expects each protocol frame as one BLE write. Splitting into 20-byte
  // chunks can make the printer accept data but never start printing.
  for (let tries = 0; tries < 30; tries++) {
    try {
      if (ch.properties?.writeWithoutResponse) {
        await ch.writeValueWithoutResponse(data);
      } else if (ch.writeValueWithResponse) {
        await ch.writeValueWithResponse(data);
      } else {
        await ch.writeValue(data);
      }
      await sleep(10);
      return;
    } catch (error) {
      if (tries === 29) throw error;
      await sleep(8);
    }
  }
}

async function writePacket(ch: any, pkt: Uint8Array) {
  await writeBytes(ch, pkt);
}

const DPM = 8; // dots per mm at 203dpi
const B1_PRINTHEAD_DOTS = 384; // Niimbot B1 printhead width for 50×30 labels

function labelDots(widthMm: number, heightMm: number) {
  const requestedW = Math.ceil(Math.round(widthMm * DPM) / 8) * 8;
  const w = Math.min(B1_PRINTHEAD_DOTS, requestedW);
  const h = Math.max(1, Math.round(heightMm * DPM));
  return { w, h };
}

// Render a plain-text label to a monochrome bitmap. Width/height in mm,
// converted to dots at 8 dots/mm (203dpi). For the B1, a 50mm label is
// printed through a 384-dot head, so we cap the raster width at 384 dots.
export function renderLabelBitmap(
  text: string,
  widthMm: number,
  heightMm: number,
  fontPx = 22,
): { width: number; height: number; rows: Uint8Array[] } {
  if (typeof document === "undefined") throw new Error("Canvas not available");
  const { w, h } = labelDots(widthMm, heightMm);
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

type ParsedLabel = {
  order: string;
  when: string;
  name: string;
  cup: string;
  customer: string;
  notes: string;
  quote: string;
  brand: string;
};

function canvasToBitmap(canvas: HTMLCanvasElement): NiimbotBitmap {
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const wBytes = Math.ceil(canvas.width / 8);
  const rows: Uint8Array[] = [];
  for (let row = 0; row < canvas.height; row++) {
    const bytes = new Uint8Array(wBytes);
    for (let col = 0; col < canvas.width; col++) {
      const idx = (row * canvas.width + col) * 4;
      const r = img.data[idx], g = img.data[idx + 1], b = img.data[idx + 2], a = img.data[idx + 3];
      if (a > 0 && (r + g + b) / 3 < 150) bytes[col >> 3] |= 0x80 >> (col & 7);
    }
    rows.push(bytes);
  }
  return { width: canvas.width, height: canvas.height, rows };
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 3) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y);
    return;
  }
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  ctx.fillText(`${out}…`, x, y);
}

function parseLabelsFromHtml(html: string): ParsedLabel[] {
  if (typeof document === "undefined" || !html) return [];
  const root = document.createElement("div");
  root.innerHTML = html;
  root.querySelectorAll("style, script, template").forEach((el) => el.remove());
  const sections = Array.from(root.querySelectorAll("section.label"));
  return sections.map((section) => ({
    order: section.querySelector(".ord")?.textContent?.trim() ?? "",
    when: section.querySelector(".when")?.textContent?.trim() ?? "",
    name: section.querySelector(".name")?.textContent?.trim() ?? "",
    cup: section.querySelector(".cup")?.textContent?.trim() ?? "",
    customer: section.querySelector(".cust")?.textContent?.trim() ?? "",
    notes: section.querySelector(".notes")?.textContent?.trim() ?? "",
    quote: section.querySelector(".quote")?.textContent?.trim() ?? "",
    brand: section.querySelector(".brand")?.textContent?.trim() ?? "",
  })).filter((label) => label.order || label.name || label.customer || label.quote);
}

export function hasNiimbotLabelHtml(html: string) {
  return parseLabelsFromHtml(html).length > 0;
}

export function renderFormattedLabelBitmap(
  label: ParsedLabel,
  widthMm: number,
  heightMm: number,
): NiimbotBitmap {
  if (typeof document === "undefined") throw new Error("Canvas not available");
  const { w, h } = labelDots(widthMm, heightMm);
  const scale = Math.max(0.72, Math.min(1.18, Math.min(widthMm / 58, heightMm / 40)));
  const margin = Math.max(10, Math.round(16 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  const contentW = w - margin * 2;
  ctx.font = `${Math.round(18 * scale)}px system-ui, sans-serif`;
  fitText(ctx, label.order, margin, margin, Math.round(contentW * 0.68));
  const whenW = Math.round(contentW * 0.3);
  fitText(ctx, label.when, w - margin - whenW, margin, whenW);

  let y = margin + Math.round(24 * scale);
  ctx.font = `700 ${Math.round(30 * scale)}px system-ui, sans-serif`;
  const nameLines = wrapText(ctx, label.name, contentW, 2);
  for (const line of nameLines) {
    ctx.fillText(line, margin, y);
    y += Math.round(34 * scale);
  }

  ctx.font = `${Math.round(20 * scale)}px system-ui, sans-serif`;
  if (label.cup) {
    fitText(ctx, label.cup, margin, y, contentW);
    y += Math.round(23 * scale);
  }

  ctx.font = `700 ${Math.round(24 * scale)}px system-ui, sans-serif`;
  if (label.customer) {
    fitText(ctx, label.customer, margin, y, contentW);
    y += Math.round(28 * scale);
  }

  ctx.font = `italic ${Math.round(18 * scale)}px system-ui, sans-serif`;
  for (const line of wrapText(ctx, label.notes, contentW, 2)) {
    ctx.fillText(line, margin, y);
    y += Math.round(21 * scale);
  }

  const brandH = Math.round(18 * scale);
  ctx.font = `italic ${Math.round(16 * scale)}px system-ui, sans-serif`;
  const quoteLines = wrapText(ctx, label.quote, contentW, 2);
  let quoteY = h - margin - brandH - quoteLines.length * Math.round(19 * scale);
  quoteY = Math.max(y + Math.round(4 * scale), quoteY);
  for (const line of quoteLines) {
    if (quoteY > h - margin - brandH) break;
    ctx.fillText(line, margin, quoteY);
    quoteY += Math.round(19 * scale);
  }

  ctx.font = `${Math.round(14 * scale)}px system-ui, sans-serif`;
  const brandWidth = ctx.measureText(label.brand).width;
  ctx.fillText(label.brand, Math.max(margin, w - margin - brandWidth), h - margin - brandH);

  return canvasToBitmap(canvas);
}

export function renderLabelHtmlBitmaps(
  html: string,
  widthMm: number,
  heightMm: number,
): NiimbotBitmap[] {
  return parseLabelsFromHtml(html).map((label) => renderFormattedLabelBitmap(label, widthMm, heightMm));
}

export function bitmapToDataUrl(bmp: NiimbotBitmap): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(bmp.width, bmp.height);
  for (let y = 0; y < bmp.height; y++) {
    const row = bmp.rows[y];
    for (let x = 0; x < bmp.width; x++) {
      const bit = row[Math.floor(x / 8)] & (0x80 >> (x & 7));
      const idx = (y * bmp.width + x) * 4;
      const v = bit ? 0 : 255;
      img.data[idx] = v; img.data[idx + 1] = v; img.data[idx + 2] = v; img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
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

export type NiimbotBitmap = { width: number; height: number; rows: Uint8Array[] };

function u16(n: number): [number, number] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function countBlackPixelsTotal(row: Uint8Array, width: number): [number, number, number] {
  // B1 expects total mode for 0x85 rows: [0x00, total_lo, total_hi].
  // Split-third counts can make the printer feed/eject but produce a blank label.
  let count = 0;
  for (let x = 0; x < width; x++) {
    const bit = row[x >> 3] & (0x80 >> (x & 7));
    if (bit) count++;
  }
  return [0x00, count & 0xff, (count >> 8) & 0xff];
}

function isBlankRow(row: Uint8Array) {
  for (let i = 0; i < row.length; i++) if (row[i] !== 0) return false;
  return true;
}

function sameRow(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function printBitmapPage(ch: any, bmp: NiimbotBitmap, copies: number) {
  // B1 is more reliable with the 6-byte page-size payload: rows, cols, copies.
  await writePacket(ch, makePacket(0x03, [0x01])); // page start
  await writePacket(ch, makePacket(0x13, [...u16(bmp.height), ...u16(bmp.width), ...u16(copies)]));

  for (let y = 0; y < bmp.rows.length;) {
    const row = bmp.rows[y];
    let repeat = 1;
    while (y + repeat < bmp.rows.length && repeat < 255 && sameRow(row, bmp.rows[y + repeat])) repeat++;
    if (isBlankRow(row)) {
      await writePacket(ch, makePacket(0x84, [...u16(y), repeat]));
      y += repeat;
      continue;
    }
    await writePacket(ch, makePacket(0x85, [...u16(y), ...countBlackPixelsTotal(row, bmp.width), repeat, ...row]));
    y += repeat;
  }

  await writePacket(ch, makePacket(0xe3, [0x01])); // page end
  for (let i = 0; i < 6; i++) {
    await sleep(90);
    await writePacket(ch, makePacket(0xa3, [0x01])); // print status/keepalive for B1
  }
}

export async function printNiimbotBitmaps(opts: {
  device: any;
  bitmaps: NiimbotBitmap[];
  density: number;
  copies?: number;
}) {
  const density = Math.min(5, Math.max(1, Math.round(opts.density)));
  const copies = Math.min(50, Math.max(1, Math.round(opts.copies ?? 1)));
  const ch = await getNiimbotWriteChar(opts.device);
  const sourceBitmaps = opts.bitmaps.filter((bmp) => bmp.width > 0 && bmp.height > 0 && bmp.rows.length > 0);
  const bitmaps = Array.from({ length: copies }).flatMap(() => sourceBitmaps);
  if (bitmaps.length === 0) throw new Error("No label content to print.");

  // B1-compatible wake/handshake. The leading 0x03 packet mirrors Niimbot's
  // browser driver and helps protocol-3 B1 units arm before print jobs.
  await writeBytes(ch, new Uint8Array([0x03, ...makePacket(0xc1, [0x01])]));
  await sleep(200);
  await writePacket(ch, makePacket(0xa5, [0x01])); // status data
  for (const sub of [0x08, 0x0b, 0x0d, 0x0a, 0x07, 0x03, 0x0c, 0x09]) {
    await writePacket(ch, makePacket(0x40, [sub])); // printer info keepalive sequence
  }
  await writePacket(ch, makePacket(0xdc, [0x04])); // heartbeat

  await writePacket(ch, makePacket(0x21, [density]));
  await writePacket(ch, makePacket(0x23, [0x01])); // label with gap
  await writePacket(ch, makePacket(0x01, [...u16(bitmaps.length), 0, 0, 0, 0, 0])); // B1 print start, total pages
  await writePacket(ch, makePacket(0xa3, [0x01])); // status packet also absorbs B1's first-packet drop

  for (const bmp of bitmaps) {
    await printBitmapPage(ch, bmp, 1);
  }

  await writePacket(ch, makePacket(0xf3, [0x01])); // end print
  await writePacket(ch, makePacket(0xdc, [0x01])); // harmless trailing packet for B1 firmwares that drop one after PrintEnd
}

export async function printNiimbotLabel(opts: NiimbotOptions) {
  const { device, text, widthMm, heightMm, quantity, fontPx, density } = opts;
  const bmp = renderLabelBitmap(text, widthMm, heightMm, fontPx);
  await printNiimbotBitmaps({ device, bitmaps: [bmp], density, copies: quantity });
}
