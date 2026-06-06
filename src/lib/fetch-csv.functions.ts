// Server-side proxy to fetch a public CSV (e.g. a published Google Sheet)
// without hitting browser CORS restrictions.
import { createServerFn } from "@tanstack/react-start";

export const fetchPublicCsv = createServerFn({ method: "POST" })
  .inputValidator((input: { url: string }) => {
    if (!input?.url || typeof input.url !== "string") throw new Error("url required");
    let u: URL;
    try { u = new URL(input.url); } catch { throw new Error("Invalid URL"); }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Invalid URL");
    return { url: input.url };
  })
  .handler(async ({ data }) => {
    let target = data.url.trim();
    const m = target.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (m && !target.includes("output=csv") && !target.includes("format=csv")) {
      const gidMatch = target.match(/[#&?]gid=(\d+)/);
      const gid = gidMatch ? gidMatch[1] : "0";
      target = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
    }
    const res = await fetch(target, { redirect: "follow" });
    if (!res.ok) {
      throw new Error(
        `Could not fetch sheet (HTTP ${res.status}). Make sure it is shared as "Anyone with the link".`,
      );
    }
    const text = await res.text();
    return { csv: text };
  });
