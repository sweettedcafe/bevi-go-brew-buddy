const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_sheets/v4";
const MASTER_SPREADSHEET_ID = "1eqhqSz9MQ2xPkwHcWSTBcpvuoCh84peQcxFpCJv3jvQ";
const MASTER_SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${MASTER_SPREADSHEET_ID}/edit`;

type Cell = string | number | null;
export type ExportSheet = { title: string; headers: string[]; rows: Cell[][] };
export type ExportInput = { title?: string; sheets: ExportSheet[] };

type SheetMeta = { properties: { sheetId: number; title: string } };

function canonicalCell(value: Cell): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return String(Number(text));
  return text;
}

function rowKey(title: string, row: Cell[]): string {
  // Order ID is immutable and uniquely identifies rows in these two tabs.
  if (title === "Per order" || title === "Discounts") {
    return canonicalCell(row[1] ?? "");
  }

  // Per-item rows do not expose their database line ID, so use the immutable
  // order ID plus the item/configuration fields while ignoring formatted date,
  // time and money cells that Google Sheets may render differently.
  if (title === "Per item") {
    const identityColumns = [1, 5, 6, 7, 8, 9, 10, 17];
    return identityColumns.map((index) => canonicalCell(row[index] ?? "")).join("\u0001");
  }

  return row.map(canonicalCell).join("\u0001");
}

function columnName(count: number): string {
  let result = "";
  let value = Math.max(1, count);
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

export async function syncSheets(
  data: ExportInput,
  lovableKey: string,
  sheetsKey: string,
) {
  const requestHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": sheetsKey,
  };
  const id = MASTER_SPREADSHEET_ID;

  const call = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${GATEWAY_URL}${path}`, {
      ...init,
      headers: requestHeaders,
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Google Sheets error (${response.status}): ${errorBody}`);
    }
    return response.json() as Promise<any>;
  };

  let metadata = await call(
    `/spreadsheets/${id}?fields=sheets.properties(sheetId,title)`,
  );
  let tabs = (metadata.sheets ?? []) as SheetMeta[];
  const existingTitles = new Set(tabs.map((sheet) => sheet.properties.title));
  const missing = data.sheets
    .map((sheet) => sheet.title.slice(0, 90))
    .filter((title) => !existingTitles.has(title));

  if (missing.length > 0) {
    await call(`/spreadsheets/${id}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      }),
    });
    metadata = await call(`/spreadsheets/${id}?fields=sheets.properties(sheetId,title)`);
    tabs = (metadata.sheets ?? []) as SheetMeta[];
  }

  let appended = 0;
  let skipped = 0;

  for (const sheet of data.sheets) {
    const tab = sheet.title.slice(0, 90);
    const quoted = `'${tab.replace(/'/g, "''")}'`;
    const tabMeta = tabs.find((entry) => entry.properties.title === tab);
    if (!tabMeta) throw new Error(`Google Sheets tab was not found: ${tab}`);

    const current = await call(`/spreadsheets/${id}/values/${quoted}!A1:ZZ100000`);
    const values = (current.values ?? []) as Cell[][];
    const existingRows = values.length > 0 ? values.slice(1) : [];
    const seen = new Set(existingRows.map((row) => rowKey(tab, row)).filter(Boolean));
    const newRows: Cell[][] = [];

    for (const row of sheet.rows) {
      const key = rowKey(tab, row);
      if (key && seen.has(key)) {
        skipped += 1;
        continue;
      }
      if (key) seen.add(key);
      newRows.push(row);
      appended += 1;
    }

    const lastColumn = columnName(sheet.headers.length);
    if (values.length === 0) {
      await call(`/spreadsheets/${id}/values/${quoted}!A1:${lastColumn}1?valueInputOption=USER_ENTERED`, {
        method: "PUT",
        body: JSON.stringify({ majorDimension: "ROWS", values: [sheet.headers] }),
      });
    }

    if (newRows.length > 0) {
      // Insert blank rows immediately below the header, then fill them. This
      // keeps the newest synced records at the top instead of the bottom.
      await call(`/spreadsheets/${id}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
          requests: [{
            insertDimension: {
              range: {
                sheetId: tabMeta.properties.sheetId,
                dimension: "ROWS",
                startIndex: 1,
                endIndex: 1 + newRows.length,
              },
              inheritFromBefore: false,
            },
          }],
        }),
      });
      const endRow = newRows.length + 1;
      await call(
        `/spreadsheets/${id}/values/${quoted}!A2:${lastColumn}${endRow}?valueInputOption=USER_ENTERED`,
        {
          method: "PUT",
          body: JSON.stringify({ majorDimension: "ROWS", values: newRows }),
        },
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
}