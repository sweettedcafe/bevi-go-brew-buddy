import { createServerFn } from "@tanstack/react-start";
import type { ExportInput } from "./sheets.server";

export const exportToGoogleSheets = createServerFn({ method: "POST" })
  .inputValidator((input: ExportInput) => input)
  .handler(async ({ data }) => {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const sheetsKey = process.env["GOOGLE_SHEETS_API_KEY"];
    if (!lovableKey || !sheetsKey) {
      throw new Error(
        "Google Sheets is not connected. Open the chat and ask Lovable to connect Google Sheets.",
      );
    }
    const { syncSheets } = await import("./sheets.server");
    return syncSheets(data, lovableKey, sheetsKey);
  });
