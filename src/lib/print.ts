// Browser printing via a hidden iframe so we don't disturb the current page.
// The OS print dialog still appears; the user can set Chrome's "Always print
// to" default per printer (one for receipts, one for labels).

export function printHTML(html: string, hintTitle = "Print") {
  if (typeof window === "undefined") return;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${hintTitle}</title></head><body>${html}</body></html>`);
  doc.close();

  const win = iframe.contentWindow!;
  // Wait a tick for images/fonts to lay out before printing.
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } finally {
      setTimeout(() => iframe.remove(), 500);
    }
  }, 100);
}
