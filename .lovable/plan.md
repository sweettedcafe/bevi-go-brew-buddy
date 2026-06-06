
## 1. Fixes (small, fast)

**Customers page — `customer_self_register` missing**
The current RPC in `supabase_phase8_schema.sql` is defined as `(p_name, p_phone, p_email)` but PostgREST is being called as `(p_email, p_name, p_phone)` and reporting the function is missing. Migration will:
- Drop and recreate `public.customer_self_register(p_name text, p_phone text, p_email text)` with `SECURITY DEFINER`, default-null params, and explicit grants to `anon` + `authenticated`.
- Ensure `customers`, `loyalty_settings` tables + grants exist (idempotent guards on phase 8).
- Confirm loyalty editor already exists in `customers.tsx` — no code change needed there.

## 2. Staff & Roles — assign by email

- New server fn `src/lib/staff.functions.ts`:
  - `listStaffAssignments()` → joins `user_roles` with `auth.users` via `supabaseAdmin` and returns `{ user_id, email, role }[]`.
  - `assignRoleByEmail({ email, role })` → looks up user_id in `auth.users`, errors with "no account found, ask them to register first" if missing, otherwise inserts into `user_roles` (idempotent).
  - `removeRole({ user_id, role })`.
  - All `.middleware([requireSupabaseAuth])` + server-side check that caller has `developer` or `admin`.
- `src/routes/_authenticated/staff.tsx`: replace UUID input with **email** input. Table shows email + role badge + remove button. Developer-only can assign `developer`.

## 3. Reports module — full build

New routes under `src/routes/_authenticated/reports.tsx` (replace ComingSoon) with three tabs:

### Tab A — Per-order
Columns (toggleable): order #, date/time, customer, cashier, items count, subtotal, discount, payment method, payment fee, total, status, refund/void buttons.
- Filters: date range, customer (search), order ID, cashier.
- Row click → drawer with full order details (line items, customizations, special instructions, totals breakdown).
- **Refund** button (status=paid) → confirm dialog → calls `pos_refund_order(order_id)` RPC: sets `status='refunded'`, restores inventory via `pos_restock_order`, reverses `points_earned` / re-credits `points_redeemed` on the customer.
- **Void** button (status in paid/held) → calls `pos_void_order(order_id)`: same effect, sets `status='voided'`.

### Tab B — Per-item
Aggregated by menu item across the filter range: item name, category, qty sold, gross revenue (no discount/fees columns). Same filters minus payment-specific ones.

### Tab C — Discounts & Promotions
List of every order that had `discount_amount > 0` or applied promo, with discount type/code, amount, order #, customer, total.

### Customizable columns
- Per-tab column visibility stored in `localStorage` under `bevi.reports.cols.<tab>`.
- Settings popover with checkbox list.

### Exports
- Per-tab **Export CSV** (instant, no auth needed).
- **Export to Google Sheets** → opens connector-link prompt if not linked; calls server fn `exportReportToSheet` which creates a new spreadsheet via Sheets API gateway and writes the filtered rows.

## 4. Google Sheets auto-sync on every order

- Add `google_sheets` settings row to a new `integration_settings` table: `{ id=1, sheets_spreadsheet_id text, sheets_enabled bool, sheets_sheet_name text }`. Admin-editable from Reports → Settings.
- New server fn `appendOrderToSheet(orderId)` (admin-elevated, uses connector gateway `https://connector-gateway.lovable.dev/google_sheets/v4`).
- Wire it to fire after order creation: extend `pos_create_order` flow on the client (in `pos.tsx` after success) to call `appendOrderToSheet({ data: { orderId } })` if `sheets_enabled`. Best-effort, errors toast but don't fail order.
- Requires user to link **Google Sheets** connector via `standard_connectors--connect` — I'll trigger that flow when they enable auto-sync.

## Files

**New**
- `supabase_phase9_schema.sql`
- `src/lib/staff.functions.ts`
- `src/lib/reports.functions.ts` (per-order/per-item/discounts data + refund/void + sheets sync)
- `src/components/reports/OrderDetailDrawer.tsx`
- `src/components/reports/ColumnsPicker.tsx`

**Edited**
- `src/routes/_authenticated/staff.tsx` (email assign)
- `src/routes/_authenticated/reports.tsx` (full module)
- `src/routes/_authenticated/pos.tsx` (post-order hook to sheets)
- `src/start.ts` (verify `attachSupabaseAuth` is in `functionMiddleware`)

## Order of operations
1. Write `supabase_phase9_schema.sql` (you run it in SQL editor) — includes the `customer_self_register` fix so the Customers add dialog stops erroring immediately.
2. Build Staff-by-email + Reports module + refund/void.
3. Trigger Google Sheets connector prompt; finish auto-sync wiring after you link it.

Ready to implement on your go-ahead.
