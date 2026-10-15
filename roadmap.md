# Report updates
- [x] Remove the duplicate End of Shift balance card from the page.
- [x] Apply the pictured balance format to Share Summary, copy text, and saved image.
- [x] Include Payment Method and Reason in Expenses Report and exports.
- [x] Display Inventory History times with AM/PM while preserving spreadsheet-compatible CSV times.
- [ ] Verify live shift data after the existing phase 53 database update is applied and authenticated access is available.
# Phase 62
- [x] Sizes always saved on sales (inventory matches Per item report) + one-time fix of past sales
- [x] Managers record expenses without time-in
- [x] Deposit Report sign flipped vs expenses
- [x] Required note on add/deduct stock
- [x] POS Redeem points button, discount line, remaining balance
- [ ] User runs supabase_phase62_schema.sql
# Phase 65
- [x] Allow negative expenses; Starting Balance = yesterday EOD per method
- [ ] User runs supabase_phase65_schema.sql
# Phase 67
- [x] Partner can edit Inventory (menu, page controls, SQL policy + CSV import)
- [x] Access Control: removed Default roles column; ticked boxes = access
- [ ] User runs supabase_phase67_schema.sql
