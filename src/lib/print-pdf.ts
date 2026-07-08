// Render an HTML fragment to a PDF and trigger the browser save dialog.
// The HTML is rendered inside a sandboxed <iframe> so it never inherits the
// app's CSS (which uses oklch/lab tokens that html2canvas cannot parse).
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { toast } from "sonner";

export type PaperSize =
  | { kind: "roll"; widthMm: number }
  | { kind: "fixed"; widthMm: number; heightMm: number };

async function renderInIsolatedFrame(html: string, contentPx: number): Promise<HTMLCanvasElement> {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = `${contentPx}px`;
  iframe.style.height = "10px";
  iframe.style.border = "0";
  iframe.style.background = "#ffffff";
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument!;
    doc.open();
    // A minimal document — no app CSS reaches this frame, so no oklch/lab
    // tokens leak into html2canvas.
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:#fff;color:#000;}
      body{width:${contentPx}px;font-family:ui-monospace,Menlo,Consolas,monospace;}
    </style></head><body>${html}</body></html>`);
    doc.close();

    // Give fonts + layout a tick.
    try { await (doc as any).fonts?.ready; } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 80));

    const body = doc.body as HTMLElement;
    iframe.style.height = `${body.scrollHeight}px`;

    const canvas = await html2canvas(body, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      width: contentPx,
      windowWidth: contentPx,
      height: body.scrollHeight,
      windowHeight: body.scrollHeight,
    } as any);
    return canvas;
  } finally {
    iframe.remove();
  }
}

export async function savePdfFromHTML(
  html: string,
  filename: string,
  paper: PaperSize | number = 80,
) {
  const p: PaperSize = typeof paper === "number" ? { kind: "roll", widthMm: paper } : paper;
  const contentWidthMm = p.widthMm;
  const contentPx = Math.max(240, Math.round(contentWidthMm * 3.78));

  try {
    const canvas = await renderInIsolatedFrame(html, contentPx);
    const imgData = canvas.toDataURL("image/png");
    const imgWmm = contentWidthMm;
    const imgHmm = (canvas.height * imgWmm) / canvas.width;

    if (p.kind === "roll") {
      const pdf = new jsPDF({
        unit: "mm",
        format: [imgWmm, imgHmm],
        orientation: imgHmm > imgWmm ? "portrait" : "landscape",
      });
      pdf.addImage(imgData, "PNG", 0, 0, imgWmm, imgHmm);
      pdf.save(filename);
      return;
    }

    const pageW = p.widthMm;
    const pageH = p.heightMm;
    const marginMm = 5;
    const drawW = Math.min(pageW - marginMm * 2, imgWmm);
    const drawH = (canvas.height * drawW) / canvas.width;
    const pdf = new jsPDF({
      unit: "mm",
      format: [pageW, pageH],
      orientation: pageH > pageW ? "portrait" : "landscape",
    });
    if (drawH <= pageH - marginMm * 2) {
      const x = (pageW - drawW) / 2;
      const y = (pageH - drawH) / 2;
      pdf.addImage(imgData, "PNG", x, y, drawW, drawH);
    } else {
      const sliceHpx = Math.floor((pageH - marginMm * 2) * (canvas.width / drawW));
      let y = 0;
      const x = (pageW - drawW) / 2;
      while (y < canvas.height) {
        const h = Math.min(sliceHpx, canvas.height - y);
        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = h;
        const sctx = slice.getContext("2d")!;
        sctx.fillStyle = "#ffffff";
        sctx.fillRect(0, 0, slice.width, slice.height);
        sctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
        const chunkData = slice.toDataURL("image/png");
        const chunkH = (h * drawW) / canvas.width;
        if (y > 0) pdf.addPage([pageW, pageH]);
        pdf.addImage(chunkData, "PNG", x, marginMm, drawW, chunkH);
        y += h;
      }
    }
    pdf.save(filename);
  } catch (err: any) {
    console.error("PDF save failed", err);
    toast.error(`Couldn't save PDF: ${err?.message ?? err}`);
    throw err;
  }
}
