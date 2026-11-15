# Contract: full customer details, creator name, required driving licence — design

Date: 2026-11-15 · Size: project (database change via Lovable + front end)

## Intent

The rental contract should read like a complete document: every customer detail we hold, and the
name of the admin who drew up that version. A customer with no driving licence number cannot rent
at all, so the licence is required both to book and on every contract.

## Goals

1. **Licence required to book.** On the car page the book button is disabled while the customer's
   profile has no licence number, with a message and a link to `/profile`. The database refuses
   such a booking too (trigger), because bookings are inserted directly into `bookings`.
2. **Licence always on the contract.** The admin "include licence" checkbox
   ([contracts-panel.tsx:205](../../../src/components/admin/contracts-panel.tsx)) is removed;
   every new or edited version includes the licence, and creation fails with the existing message
   `ลูกค้ายังไม่ได้กรอกเลขใบอนุญาตขับขี่` when the profile has none.
3. **Full customer details on the contract**, snapshotted per version like the existing fields:
   name, phone, **email, address, ID card / passport number**, licence number.
4. **Creator name on the contract** (user's choice "ก"): the admin who created *that version*,
   shown as "ผู้จัดทำสัญญา".
5. New details appear both in the summary card (`ContractSummary`) and in the contract text
   (`terms`, which is what is printed and what the customer accepts).

## Non-goals

- No change to the approval workflow (create → send → customer accepts → admin approves → pay).
  The user reported that payment seemed possible before approval; the code forbids it at UI and
  database level. That is a separate investigation, not part of this change.
- No approver name on the contract (user chose creator only).
- No new required profile fields: email, address and ID card stay optional in the profile; they are
  shown when filled in.
- No backfill: versions created before the migration keep what they have (sent versions are
  immutable by trigger anyway).

## Anti-goals

- A signed contract must never change afterwards (no live lookups of profile data in the view).
- Demo accounts must keep working end to end (book → contract → pay) with no real data.

## Constraints

- AGENTS.md: schema changes go through Lovable. We do not touch `drizzle/` or
  `supabase/migrations/`. The SQL goes in `docs/database/`, with a ready-to-paste Lovable prompt,
  following the existing `*-lovable-prompt.md` pattern. Lovable applies it as migration 0005 and
  regenerates `src/integrations/supabase/types.ts`.
- Additive only: new nullable columns, `create or replace` functions, one new trigger. No drops of
  tables/columns, no updates of existing rows.
- The front end must work **before and after** the migration is applied (it may be deployed first).
- Customers cannot read admins' profiles (RLS), so the creator's name must be stored on the version.

## Approaches

1. **Snapshot in the database (chosen).** Add columns to `contract_versions`; the
   `write_contract_version` function fills them from `profiles`, `auth.users` and the creator's
   profile; `render_contract_terms` prints them. Front end displays them. Contracts stay fixed once
   sent and customers can see the creator's name. Cost: waits on Lovable for the new fields.
2. **Live lookup in the front end.** No database work, but a contract would change when the
   customer edits their profile, the printed text would lack the new fields, and customers could
   not see the admin's name. Rejected: contradicts what was asked.

## Design

### Database (proposed migration `docs/database/contract-customer-details.sql`)

- `contract_versions`: add `customer_email text`, `customer_address text`,
  `customer_id_card_no text`, `created_by_name text` (all nullable).
- `write_contract_version`: licence always required (the `_include_license` argument is kept for
  compatibility and ignored). Fill the new columns on insert and on in-place draft rewrite.
  Email from `auth.users.email`; address/ID from `profiles` (blank → null).
  `created_by_name` = creator's `profiles.full_name`, else `admin_members.email`, else
  `ผู้ดูแลระบบ`.
- `render_contract_terms`: new lines — อีเมล, ที่อยู่, เลขบัตรประชาชน/พาสปอร์ต (each only when
  present), licence always, and `ผู้จัดทำสัญญา: <name>` at the end of the header block.
  (Signature changes, so the old function is replaced; builder decides overload vs drop/create.)
- `protect_contract_version` trigger: add the 4 new columns to the list frozen once a version is
  sent (otherwise a sent contract's email/address/ID/creator could still be changed).
- `admin_create_contract` / `admin_update_contract`: unchanged. (Planned default change dropped:
  `write_contract_version` ignores `_include_license`, so its default no longer matters.)
- New `before insert` trigger on `bookings`: refuse when the booker's profile licence is blank,
  message `กรุณากรอกเลขใบอนุญาตขับขี่ในโปรไฟล์ก่อนจองรถ`.
- Rollback SQL alongside, like `contract-approval-workflow-rollback.sql`.

### Front end

- Car page (`cars_.$id.tsx`): load own profile; if licence blank, disable book button and show an
  alert linking to `/profile`. Database error message is shown if it still happens.
- Contract form: remove the checkbox; always send `_include_license: true`. (Before the migration
  this already enforces the licence with today's database.)
- `ContractSummary`: add rows อีเมล, ที่อยู่, เลขบัตรประชาชน/พาสปอร์ต (hidden when empty), and
  ผู้จัดทำสัญญา. Read the new fields defensively so the page works before types are regenerated.
- Demo accounts (`demo.functions.ts`): give demo customers a fake licence (e.g. `DEMO-` + 8
  digits) so the demo flow still books.

### Tests

- DB tests (PGlite harness): apply 0004 + proposed SQL; new tests for booking blocked without
  licence, contract always has licence, new columns + creator name filled, terms contain the lines,
  in-place draft edit keeps creator. Existing DB tests keep passing on 0004 alone.
- UI tests: book button disabled without licence; checkbox gone and `_include_license: true` sent;
  summary shows new rows and creator.

## Claude's calls (check these)

- Creator stays the admin who created the version, even if another admin edits that unsent draft in
  place (`created_by` is protected by trigger).
- ID card number is shown to the customer (their own) and every admin who can see contracts.
- Email/address/ID are optional on the contract; only name and licence are required.
- Demo customers get an auto-generated fake licence.
- Database also blocks bookings without a licence (not only the button).
- Bookings already made without a licence are not cancelled; the admin simply cannot create their
  contract until the customer fills in the licence (existing error message).

## Left to the builder

Exact SQL shape for replacing `render_contract_terms`, Thai wording of the alert, test names.
