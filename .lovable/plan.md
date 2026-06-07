# Unified Customization, Owners, Void/Refund Accounting, Barista Actions & EOS Expenses

Six related changes across POS, Menu, Reports, History (Today's Orders), and End of Shift.

---

## 1. POS — Single unified customize dialog

Today, picking a size closes the variant picker and skips the milk/extras/notes step.

- Merge `variantPick` and `CustomizeDialog` into one dialog opened when an item has **either** variants **or** any customization (`hasAnyCustomization(menu.options)`).
- Layout (one form, one Add-to-cart button):
  1. **Size** section (radio list) — only if `has_variants`. Required when shown. Pre-selects the first active variant; price line updates live.
  2. **Milk** section — if `options.milks?.length`.
  3. **Extras** section (checkboxes) — if `options.extras?.length`.
  4. **Other add-on** (label + price) — if `allow_other`.
  5. **Special instructions** (textarea) — if `allow_notes`.
  6. **Quantity** stepper + live total preview.
- Submit writes one cart line with `variant_id`, `unit_price = variant.price + addonTotal`, `custom`, and `notes`.
- Backward compatible: items with no variants and no options still bypass the dialog.

## 2. Menu & Recipes — Delete + Owner

- **Delete**: visible to `admin` and `developer` only. Confirm dialog → soft delete (`is_active=false`) if the item has historical `order_items`; hard delete otherwise. Same control for variants (inline trash icon).
- **Owner field**: add `menu_items.owner TEXT` (free text, e.g. "Coffee Bar", "Pastry Co."). Editor shows a combobox populated with distinct existing owners + free text. Default null → displayed as "—".
- Migration: `ALTER TABLE menu_items ADD COLUMN owner TEXT;` + index.

## 3. Reports — Owner filter + per-item refund/void

- **Per-item report**: add an **Owner** dropdown filter (distinct owners). Show an `Owner` column and a per-owner subtotal section.
- Add **Refund** and **Void** buttons per item row (admin/developer only) that open the same dialogs used in History — see §4.

## 4. Void / Refund duplication for accounting

Currently void/refund just flips status. Per client: keep the original row, plus insert a **mirror negative transaction** so every event is visible in reports.

- New columns on `orders`: `parent_order_id UUID NULL`, `txn_kind TEXT DEFAULT 'sale'` (`sale | void | refund`).
- New RPCs:
  - `pos_void_order(p_order_id uuid, p_reason text)` — sets original `status='voided'`, then inserts a new order with `txn_kind='void'`, `parent_order_id=original`, negated `subtotal/discount/total`, mirror `order_items` with negative `qty` and negative `line_total`, mirror `order_payments` with negative `amount`. Reverses inventory (re-adds stock based on variant recipe).
  - `pos_refund_order_item(p_order_item_id uuid, p_qty numeric, p_reason text)` — partial-qty refund; inserts a void/refund order containing only the refunded items with negative quantities. Stock re-added.
  - `pos_void_order_item(...)` — same shape but `txn_kind='void'`.
- Reports automatically reflect mirrors because they sum signed `total`/`line_total`. Add a **Transaction kind** column and color-coded badge.

## 5. Barista — Today's Orders per-item void/refund

- In `history.tsx` (Today's Orders), make each row clickable → opens an **Order Detail** sheet showing line items, payments, totals.
- Each line item has **Void** and **Refund** buttons (qty selector defaults to full qty, reason required). Available to `barista`, `admin`, `developer`.
- Header-level **Void entire order** also available.
- All actions call the RPCs from §4 → realtime list refresh.

## 6. End Of Shift — Expense qty × unit price

- Add `quantity NUMERIC DEFAULT 1` and `unit_price NUMERIC` to `eos_expenses` (or current expense table — to confirm during impl).
- Expense form: `Item | Qty | Unit price | Total (computed, read-only) | Notes`. Existing rows backfilled (`quantity=1`, `unit_price=amount`).
- EOS summary and report use computed total = `quantity * unit_price` (keep `amount` synced via trigger for backward compatibility).

---

## Rollout order

1. **Migration** (`supabase_phase16_schema.sql`): `menu_items.owner`, `orders.parent_order_id`, `orders.txn_kind`, expense `quantity`/`unit_price`, new void/refund RPCs.
2. POS unified dialog.
3. Menu owner + delete.
4. History order-detail sheet + per-item void/refund (barista access).
5. Reports owner filter + per-item void/refund (admin).
6. EOS expense qty/unit price form.

Each phase is independently testable; nothing breaks existing data (all new columns are nullable / defaulted, RPCs are additive).

---

## Open questions (please confirm before I start)

1. **Owner list** — free-text field with autocomplete of past owners, or a managed `owners` table with its own admin page? Free text is faster; managed table is cleaner for long-term reporting.
2. **Void/refund permissions on barista** — confirm baristas may void **and** refund (full + partial), or only refund?
3. **Expense backfill** — OK to set existing rows to `quantity=1, unit_price=amount`?

Reply with answers (or "go with defaults: free-text owner, baristas can void+refund, backfill qty=1") and I'll start with the migration.
