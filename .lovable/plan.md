## Goal

Rename every user-facing "Barista" label to "Cashier" in the Upsell Performance reports (Analytics page and End-of-Shift report). Keep the underlying data model unchanged — the DB source values stay `'barista'` / `'customer'` and existing Add/Skip tracking is already correct.

## Confirmation of data flow (no code change needed here)

Current logging already matches the requested scheme:
- Add button click → `log_upsell_event(source, suggestions_count, added_count>0)` → action `added` (drives Upsell rate)
- Skip button click → `log_upsell_event(source, suggestions_count, 0)` → action `skipped` (drives Skip rate)
- POS (`_authenticated/pos.tsx`) logs with `p_source: 'barista'`
- Customer page (`o.$token.tsx`) logs with `p_source: 'customer'`

## Changes

### 1. `src/routes/_authenticated/analytics.tsx` — Upsell Performance section
- Section heading: "Upsell Performance" stays; scorecards retitled:
  - "Barista upsell rate" → "Cashier upsell rate"
  - "Barista skip rate" → "Cashier skip rate"
  - Customer cards unchanged.
- Detailed drill-down blocks:
  - "Detailed view — Barista upsell rate" → "Detailed view — Cashier upsell rate"
  - "Detailed view — Barista skip rate" → "Detailed view — Cashier skip rate"
  - Table column header currently reading "Barista" → "Cashier"
  - Empty-state text "No barista upsell events in range." → "No cashier upsell events in range."

### 2. `src/routes/_authenticated/end-of-shift.tsx` — per-shift upsell block
- Any "Barista" wording in the shift Upsell/Skip rate card → "Cashier".
- Keep metric values, layout, and RPC calls (`shift_upsell_stats`) as-is.

### 3. Not changed
- DB schema, RPCs (`analytics_upsell`, `log_upsell_event`, `shift_upsell_stats`), and the `upsell_events.source` enum values (`'barista'` / `'customer'`) stay identical — this is a labels-only rename so historical data continues to aggregate correctly.
- POS "Today's orders" Badge that reads "Barista" / "Customer" is a separate feature (order origin, not upsell) and stays as-is unless you also want it renamed — say the word and I'll include it.
