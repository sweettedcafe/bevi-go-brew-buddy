// Render an HTML fragment to a PDF and trigger the browser save dialog.
// Uses html2canvas + jsPDF. Rendered offscreen so the current page is untouched.
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

export async function savePdfFromHTML(html: string, filename: string, widthMm = 80) {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.background = "#fff";
  // Approximate mm→px at 96dpi so html2canvas gets a reasonable width.
  container.style.width = `${Math.round(widthMm * 3.78)}px`;
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, { scale: 2, useCORS: true, background: "#ffffff" } as any);
    const imgData = canvas.toDataURL("image/png");
    const imgWmm = widthMm;
    const imgHmm = (canvas.height * imgWmm) / canvas.width;
    // Custom page size = content size, so no clipping and no huge margins.
    const pdf = new jsPDF({ unit: "mm", format: [imgWmm, imgHmm], orientation: imgHmm > imgWmm ? "portrait" : "landscape" });
    pdf.addImage(imgData, "PNG", 0, 0, imgWmm, imgHmm);
    pdf.save(filename);
  } finally {
    container.remove();
  }
}
