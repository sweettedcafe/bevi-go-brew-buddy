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
  // Strip currency/thousand separators so "1,234.50" and "1234.5" match.
  const numeric = text.replace(/[^\d.\-]/g, "");
  if (text && /^[^a-z]+$/.test(text) && /^-?\d+(?:\.\d+)?$/.test(numeric)) {
    return String(Number(numeric));
  }
  return text;
}

function canonicalIdentityCell(value: Cell, label: string): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (label === "time") {
    const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (match) {
      let hour = Number(match[1]);
      const meridiem = match[4];
      if (meridiem === "am" && hour === 12) hour = 0;
      if (meridiem === "pm" && hour < 12) hour += 12;
      return `${String(hour).padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
    }
  }
  return canonicalCell(value);
}

// Identity fields per tab, expressed as header labels so the key stays correct
// even if the sheet's columns are reordered or the app's column set changes.
const IDENTITY_HEADERS: Record<string, string[]> = {
  "Per order": ["Order ID"],
  Discounts: ["Order ID"],
  "Per item": [
    "Order ID",
    "Item",
    "Variant",
    "Extras",
    "Flavors",
    "Other",
    "Special instructions",
    "Qty",
  ],
};

// Secondary identity that never relies on the raw Order ID. Google Sheets can
// coerce ID-looking text (e.g. "139e300…") into scientific notation, which
// would make an already-synced row look brand new on the next read.
const FALLBACK_HEADERS: Record<string, string[]> = {
  "Per order": ["Order #", "Date", "Time", "Type", "Total"],
  Discounts: ["Order #", "Date", "Time", "Promotion / discount", "Amount"],
  "Per item": ["Order #", "Date", "Time", "Type", "Item", "Variant", "Qty"],
};

type KeyBuilder = (row: Cell[]) => string;

function buildKey(labels: string[], wanted: string[] | undefined): KeyBuilder | null {
  if (!wanted) return null;
  const fields = wanted
    .map((label) => ({ index: labels.indexOf(label.toLowerCase()), label: label.toLowerCase() }))
    .filter((field) => field.index >= 0);
  if (fields.length === 0) return null;
  return (row) => fields
    .map((field) => canonicalIdentityCell(row[field.index] ?? "", field.label))
    .join("\u0001");
}

function makeKeyBuilder(tab: string, headerRow: Cell[]): KeyBuilder {
  const labels = headerRow.map((cell) => String(cell ?? "").trim().toLowerCase());
  return buildKey(labels, IDENTITY_HEADERS[tab]) ?? ((row) => row.map(canonicalCell).join("\u0001"));
}

function makeFallbackBuilder(tab: string, headerRow: Cell[]): KeyBuilder | null {
  const labels = headerRow.map((cell) => String(cell ?? "").trim().toLowerCase());
  return buildKey(labels, FALLBACK_HEADERS[tab]);
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
    const oldHeader = values.length > 0 ? values[0]! : [];
    let existingRows = values.length > 0 ? values.slice(1) : [];
    const lastColumn = columnName(sheet.headers.length);

    const norm = (cell: Cell) => String(cell ?? "").trim().toLowerCase();
    const headerMatches =
      oldHeader.length === sheet.headers.length &&
      sheet.headers.every((label, i) => norm(oldHeader[i] ?? "") === norm(label));

    // The report gained columns: rewrite the sheet's header row and re-map every
    // existing row into the new column order so nothing lands under a wrong label.
    if (values.length > 0 && !headerMatches) {
      const oldLabels = oldHeader.map(norm);
      existingRows = existingRows.map((row) =>
        sheet.headers.map((label) => {
          const from = oldLabels.indexOf(norm(label));
          return from >= 0 ? (row[from] ?? "") : "";
        }),
      );
      if (oldHeader.length > sheet.headers.length) {
        await call(`/spreadsheets/${id}/values/${quoted}!${columnName(sheet.headers.length + 1)}1:ZZ100000:clear`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      }
      const endRow = existingRows.length + 1;
      await call(
        `/spreadsheets/${id}/values/${quoted}!A1:${lastColumn}${endRow}?valueInputOption=RAW`,
        {
          method: "PUT",
          body: JSON.stringify({
            majorDimension: "ROWS",
            values: [sheet.headers as Cell[], ...existingRows],
          }),
        },
      );
    } else if (values.length === 0) {
      await call(`/spreadsheets/${id}/values/${quoted}!A1:${lastColumn}1?valueInputOption=USER_ENTERED`, {
        method: "PUT",
        body: JSON.stringify({ majorDimension: "ROWS", values: [sheet.headers] }),
      });
    }

    // From here on both sides share the payload header.
    const keyOf = makeKeyBuilder(tab, sheet.headers);
    const altOf = makeFallbackBuilder(tab, sheet.headers);

    // key -> sheet row numbers (1-based, header is row 1) so matched rows can be
    // refreshed in place, filling the newly added columns for old records.
    const seen = new Map<string, number[]>();
    const seenAlt = new Map<string, number[]>();
    existingRows.forEach((row, index) => {
      if (row.every((cell) => String(cell ?? "").trim() === "")) return;
      const rowNumber = index + 2;
      const key = keyOf(row);
      if (key) seen.set(key, [...(seen.get(key) ?? []), rowNumber]);
      const alt = altOf?.(row);
      if (alt) seenAlt.set(alt, [...(seenAlt.get(alt) ?? []), rowNumber]);
    });

    const newRows: Cell[][] = [];
    const queuedKeys = new Set<string>();
    const queuedAlts = new Set<string>();
    const updates: { range: string; values: Cell[][] }[] = [];
    for (const row of sheet.rows) {
      const key = keyOf(row);
      const alt = altOf?.(row);
      const byKey = key ? (seen.get(key) ?? []) : [];
      const byAlt = alt ? (seenAlt.get(alt) ?? []) : [];
      const matchRow = byKey[0] ?? byAlt[0];
      const queued = (key && queuedKeys.has(key)) || (alt && queuedAlts.has(alt));
      if (matchRow !== undefined || queued) {
        if (key) seen.set(key, byKey.slice(1));
        if (alt) seenAlt.set(alt, byAlt.slice(1));
        if (matchRow !== undefined) {
          const existing = existingRows[matchRow - 2] ?? [];
          const differs = sheet.headers.some(
            (_, i) => String(existing[i] ?? "").trim() !== String(row[i] ?? "").trim(),
          );
          if (differs) {
            updates.push({
              range: `${quoted}!A${matchRow}:${lastColumn}${matchRow}`,
              values: [row],
            });
          }
        }
        skipped += 1;
        continue;
      }
      if (key) queuedKeys.add(key);
      if (alt) queuedAlts.add(alt);
      newRows.push(row);
      appended += 1;
    }

    // Backfill matched rows so the new columns are populated for older records.
    for (let i = 0; i < updates.length; i += 100) {
      await call(`/spreadsheets/${id}/values:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "RAW", data: updates.slice(i, i + 100) }),
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
      // RAW keeps ID-like text (e.g. "139e300…") as text instead of letting
      // Sheets coerce it into scientific notation, which broke deduplication.
      await call(
        `/spreadsheets/${id}/values/${quoted}!A2:${lastColumn}${endRow}?valueInputOption=RAW`,
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