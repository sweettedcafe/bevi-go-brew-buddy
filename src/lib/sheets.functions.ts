// Export tabular data to a brand new Google Sheets spreadsheet via the
// Lovable connector gateway. Returns the spreadsheet URL.
import { createServerFn } from "@tanstack/react-start";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_sheets/v4";

type Sheet = { title: string; headers: string[]; rows: (string | number | null)[][] };
type ExportInput = { title: string; sheets: Sheet[] };

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

    // 1. Create the spreadsheet with one tab per sheet.
    const createBody = {
      properties: { title: data.title },
      sheets: data.sheets.map((s, i) => ({
        properties: { sheetId: i, title: s.title.slice(0, 90) || `Sheet${i + 1}` },
      })),
    };
    const createRes = await fetch(`${GATEWAY_URL}/spreadsheets`, {
      method: "POST",
      headers,
      body: JSON.stringify(createBody),
    });
    if (!createRes.ok) {
      const t = await createRes.text();
      throw new Error(`Sheets create failed (${createRes.status}): ${t}`);
    }
    const created = (await createRes.json()) as {
      spreadsheetId: string;
      spreadsheetUrl: string;
    };

    // 2. Push values into each tab.
    const batchData = data.sheets.map((s) => ({
      range: `${s.title.slice(0, 90) || "Sheet1"}!A1`,
      majorDimension: "ROWS",
      values: [s.headers, ...s.rows],
    }));
    const updateRes = await fetch(
      `${GATEWAY_URL}/spreadsheets/${created.spreadsheetId}/values:batchUpdate`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: batchData }),
      },
    );
    if (!updateRes.ok) {
      const t = await updateRes.text();
      throw new Error(`Sheets write failed (${updateRes.status}): ${t}`);
    }

    return { url: created.spreadsheetUrl, id: created.spreadsheetId };
  });
