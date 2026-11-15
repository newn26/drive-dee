# Contract customer details – Lovable prompt

Status: **NOT APPLIED.** Prepared 2026-11-15. Apply after `0004_contract_approval_workflow.sql`
(becomes migration 0005). Needs one Lovable message (credits).

Design: `docs/superpowers/specs/2026-11-15-contract-customer-details-design.md`.
SQL: `docs/database/contract-customer-details.sql` (tested on PGlite:
`src/test/db/contract-customer-details.db.test.ts`). Rollback:
`docs/database/contract-customer-details-rollback.sql`.

| Change | Effect |
|---|---|
| 4 nullable columns on `contract_versions` | Each version snapshots the customer's email, address, ID card / passport number and the name of the admin who created it |
| `write_contract_version` replaced | Driving licence is **always** on the contract; a customer without one gets no contract (`ลูกค้ายังไม่ได้กรอกเลขใบอนุญาตขับขี่`) |
| New `render_contract_terms` overload | Contract text prints อีเมล, ที่อยู่, เลขบัตรประชาชน/พาสปอร์ต (when filled in) and ผู้จัดทำสัญญา |
| `protect_contract_version` replaced | The new columns are frozen once a version is sent, like the existing ones |
| New trigger on `bookings` | A booking is refused when the customer's profile has no licence (`กรุณากรอกเลขใบอนุญาตขับขี่ในโปรไฟล์ก่อนจองรถ`) |

Additive only: no table, column, policy or row is dropped, deleted or updated. Existing
versions keep NULL in the new columns. The app already works before and after this migration.

## Step 0 – Read-only pre-checks (Cloud → SQL editor)

```sql
-- 0004 is applied (must return 1 row)
select 1 from information_schema.tables where table_name = 'contract_versions';

-- Pending bookings whose customer has no licence: after the migration the admin cannot create
-- their contract until the customer fills in the licence (nothing is cancelled)
select count(*) from public.bookings b join public.profiles p on p.id = b.user_id
where b.status = 'pending' and btrim(coalesce(p.license_no, '')) = '';

-- Nothing with these names exists yet (must return no rows)
select column_name from information_schema.columns
where table_name = 'contract_versions'
  and column_name in ('customer_email', 'customer_address', 'customer_id_card_no', 'created_by_name');
select tgname from pg_trigger where tgname = 'trg_require_booking_licence';
```

## Prompt to paste into Lovable

> Please create ONE database migration for the Drive Dee prototype, applied after the
> contract approval workflow migration. It adds 4 nullable columns to
> `public.contract_versions`, replaces the functions `write_contract_version` and
> `protect_contract_version`, adds a new overload of `render_contract_terms` and adds one
> trigger `trg_require_booking_licence` on `public.bookings`. Do not drop or delete any table,
> column, policy or row, and do not change any other function. Apply exactly the SQL in the
> attached file `docs/database/contract-customer-details.sql` (paste its full contents below
> this message), then regenerate the Supabase types (`src/integrations/supabase/types.ts`).

Paste the full contents of `docs/database/contract-customer-details.sql` after the message.

## After the migration – checks

```sql
-- 4 new columns exist
select column_name from information_schema.columns
where table_name = 'contract_versions'
  and column_name in ('customer_email', 'customer_address', 'customer_id_card_no', 'created_by_name');

-- Booking trigger exists
select tgname from pg_trigger where tgname = 'trg_require_booking_licence';
```

In the app: as a demo customer without a licence, the book button is disabled; after creating a
contract as admin, the contract shows อีเมล and ผู้จัดทำสัญญา.

## Rollback (only if needed)

Run `docs/database/contract-customer-details-rollback.sql` in the SQL editor. It restores the
0004 functions and removes the booking trigger; the new columns are kept (an optional, commented
block drops them and their data).
