// Append rows to the single shared Bevi & Go Google Sheet via the Lovable
// connector gateway. Rows already present are skipped, so exporting repeatedly
// keeps the sheet in sync instead of creating new files.
import { createServerFn } from "@tanstack/react-start";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_sheets/v4";

// The one workbook everything syncs into.
export const MASTER_SPREADSHEET_ID = "1eqhqSz9MQ2xPkwHcWSTBcpvuoCh84peQcxFpCJv3jvQ";
export const MASTER_SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${MASTER_SPREADSHEET_ID}/edit`;

type Sheet = { title: string; headers: string[]; rows: (string | number | null)[][] };
type ExportInput = { title?: string; sheets: Sheet[] };

const norm = (row: (string | number | null)[]) =>
  row.map((c) => String(c ?? "").trim()).join("\u0001");

export const exportToGoogleSheets = createServerFn({ method: "POST" })
  .inputValidator((input: ExportInput) => input)
  .handler(async ({ data }) => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const sheetsKey = process.env.GOOGLE_SHEETS_API_KEY;
    if (!lovableKey || !sheetsKey) {
      throw new Error(
        "Google Sheets is not connected. Open the chat and ask Lovable to connect Google Sheets.",
      );
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": sheetsKey,
    };
    const id = MASTER_SPREADSHEET_ID;

    const call = async (path: string, init?: RequestInit) => {
      const res = await fetch(`${GATEWAY_URL}${path}`, { ...init, headers });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Google Sheets error (${res.status}): ${t}`);
      }
      return res.json() as Promise<any>;
    };

    // Which tabs already exist?
    const meta = await call(`/spreadsheets/${id}?fields=sheets.properties.title`);
    const existingTabs: string[] = (meta.sheets ?? []).map((s: any) => s.properties.title);

    const missing = data.sheets
      .map((s) => s.title.slice(0, 90))
      .filter((t) => !existingTabs.includes(t));
    if (missing.length) {
      await call(`/spreadsheets/${id}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
          requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
        }),
      });
    }

    let appended = 0;
    let skipped = 0;

    for (const sheet of data.sheets) {
      const tab = sheet.title.slice(0, 90);
      const quoted = `'${tab.replace(/'/g, "''")}'`;

      const current = await call(`/spreadsheets/${id}/values/${quoted}!A1:ZZ100000`);
      const values: string[][] = current.values ?? [];

      const toWrite: (string | number | null)[][] = [];
      if (values.length === 0) toWrite.push(sheet.headers);

      const seen = new Set(values.slice(1).map((r) => norm(r)));
      for (const row of sheet.rows) {
        const key = norm(row);
        if (seen.has(key)) { skipped++; continue; }
        seen.add(key);
        toWrite.push(row);
        appended++;
      }

      if (toWrite.length) {
        await call(
          `/spreadsheets/${id}/values/${quoted}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values: toWrite }) },
        );
      }
    }

    return {
      url: MASTER_SPREADSHEET_URL,
      id,
      appended,
      skipped,
      downloadXlsx: `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`,
    };
  });
