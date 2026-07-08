// Render an HTML fragment to a PDF and trigger the browser save dialog.
// Uses html2canvas + jsPDF. Rendered offscreen so the current page is untouched.
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { toast } from "sonner";

export type PaperSize =
  | { kind: "roll"; widthMm: number }        // thermal roll: fixed width, height auto
  | { kind: "fixed"; widthMm: number; heightMm: number }; // full sheet, e.g. A4/label

export async function savePdfFromHTML(
  html: string,
  filename: string,
  paper: PaperSize | number = 80,
) {
  // Backwards-compat: number => roll width in mm.
  const p: PaperSize = typeof paper === "number"
    ? { kind: "roll", widthMm: paper }
    : paper;

  const contentWidthMm = p.widthMm;
  const contentPx = Math.max(240, Math.round(contentWidthMm * 3.78));

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.background = "#ffffff";
  container.style.width = `${contentPx}px`;
  container.style.padding = "0";
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    // Give fonts a tick to lay out.
    if ((document as any).fonts?.ready) {
      try { await (document as any).fonts.ready; } catch { /* ignore */ }
    }
    await new Promise((r) => setTimeout(r, 60));

    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      windowWidth: contentPx,
    } as any);

    const imgData = canvas.toDataURL("image/png");
    const imgWmm = contentWidthMm;
    const imgHmm = (canvas.height * imgWmm) / canvas.width;

    if (p.kind === "roll") {
      // Custom page = content size, so there's no clipping or huge margins.
      const pdf = new jsPDF({
        unit: "mm",
        format: [imgWmm, imgHmm],
        orientation: imgHmm > imgWmm ? "portrait" : "landscape",
      });
      pdf.addImage(imgData, "PNG", 0, 0, imgWmm, imgHmm);
      pdf.save(filename);
      return;
    }

    // Fixed sheet: center content, add extra pages if it overflows.
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
      // Single page — center vertically & horizontally.
      const x = (pageW - drawW) / 2;
      const y = (pageH - drawH) / 2;
      pdf.addImage(imgData, "PNG", x, y, drawW, drawH);
    } else {
      // Multi-page — slice the source canvas into page-height chunks.
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
    // Surface the failure — a silent throw is why "nothing saves".
    console.error("PDF save failed", err);
    toast.error(`Couldn't save PDF: ${err?.message ?? err}`);
    throw err;
  } finally {
    container.remove();
  }
}
