# Contract customer details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every contract version snapshots the customer's full details (incl. required driving licence) and the name of the admin who created it; nobody can book without a licence.

**Architecture:** A proposed additive migration in `docs/database/` (applied later by Lovable as 0005) extends `contract_versions`, the contract-writing functions and adds a booking trigger; it is tested on PGlite via the existing harness. The front end always requests the licence, shows the new fields defensively (works before and after the migration), and blocks booking without a licence.

**Tech Stack:** PostgreSQL/Supabase SQL, PGlite (`@electric-sql/pglite`), React + TanStack Start/Query, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-15-contract-customer-details-design.md`

## Global Constraints

- Do not edit `drizzle/`, `supabase/migrations/` or `src/integrations/supabase/types.ts` (AGENTS.md; Lovable owns them).
- SQL is additive only: nullable columns, `create or replace` functions, new trigger. No drop of tables/columns, no update/delete of existing rows.
- Front end must work against today's database (0004) and after the migration.
- Fictional data only in tests and docs.
- Thai UI copy fixed by spec/existing DB: `ลูกค้ายังไม่ได้กรอกเลขใบอนุญาตขับขี่` (existing), `กรุณากรอกเลขใบอนุญาตขับขี่ในโปรไฟล์ก่อนจองรถ` (new booking trigger), summary/terms labels `อีเมล`, `ที่อยู่`, `เลขบัตรประชาชน/พาสปอร์ต`, `เลขที่ใบอนุญาตขับขี่`, `ผู้จัดทำสัญญา`; creator fallback `ผู้ดูแลระบบ`.
- Commit only when the user asks (session rule); "Commit" steps below mean "stage and report", unless the user has said to commit.

## Review Focus

1. Sent version immutability: changing `customer_email`/`customer_address`/`customer_id_card_no`/`created_by_name` on a sent version must raise. → Task 1 test D06.
2. Licence that is whitespace only (`"   "`) counts as missing for both booking and contract. → Task 1 tests D01, D03.
3. Customer profile edited after the contract is sent: the sent version keeps the old address. → Task 1 test D07.
4. Contract viewed before the migration (new keys absent from the row): no crash, no empty rows. → Task 3 test.
5. Profile still loading / failed on the car page: button must not flash enabled-then-disabled into a booking without licence; while loading, treat as not ready. → Task 4 test.

---

### Task 1: Proposed migration + database tests

**Files:**
- Create: `docs/database/contract-customer-details.sql`
- Create: `docs/database/contract-customer-details-rollback.sql`
- Create: `docs/database/contract-customer-details-lovable-prompt.md`
- Modify: `src/test/db/harness.ts` (`CreateOptions`, `createTestDb`)
- Test: `src/test/db/contract-customer-details.db.test.ts`

**Interfaces:**
- Produces (DB): columns `contract_versions.customer_email text`, `customer_address text`, `customer_id_card_no text`, `created_by_name text`; overload `render_contract_terms(<16 existing args>, _customer_email text, _customer_address text, _customer_id_card_no text, _created_by_name text)`; `write_contract_version` (same signature as 0004, `_include_license` ignored); function `require_booking_licence()` + trigger `trg_require_booking_licence before insert on bookings`.
- Produces (harness): `CreateOptions.extraSql?: string[]` — file paths applied, in order, after the proposed migration and later drizzle migrations.

- [ ] **Step 1: Add `extraSql` to the harness** — after the `later` loop in `createTestDb`, `for (const f of options.extraSql ?? []) await pg.exec(readFileSync(f, "utf8"))`. Export `CUSTOMER_DETAILS_SQL = path.join(ROOT, "docs/database/contract-customer-details.sql")`.

- [ ] **Step 2: Write the failing DB tests** (`// @vitest-environment node`, `createTestDb({ extraSql: [CUSTOMER_DETAILS_SQL] })`). Fixtures: `admin = createAdmin(db)` then `update profiles set full_name = 'ทดสอบ แอดมินหนึ่ง'` for admin; `carol = createUser(db, { name: "ทดสอบ ลูกค้าซี", phone: "0800000003", licence: "TEST-0003", email: "carol@example.test" })` with `address = 'ที่อยู่ทดสอบ 1'`, `id_card_no = 'FAKE-ID-0003'`; `dan = createUser(db, { name: "ทดสอบ ลูกค้าดี" })` (no licence). Tests:
  - `D01 booking without licence is refused`: `createBooking(db, dan, …)` rejects `/กรุณากรอกเลขใบอนุญาตขับขี่ในโปรไฟล์ก่อนจองรถ/`; same after `update profiles set license_no = '   '`.
  - `D02 booking with licence works`: `createBooking(db, carol, …)` resolves.
  - `D03 contract always carries the licence even when licence=false is passed`: book for carol, `adminCreate(db, admin, b.id, terms(b, { licence: false }))`; version row has `customer_license_no = 'TEST-0003'`; then blank carol's licence (`'   '`) via superuser and `adminUpdate` the draft rejects `/ลูกค้ายังไม่ได้กรอกเลขใบอนุญาตขับขี่/` (restore licence after).
  - `D04 new columns are filled`: version row `toMatchObject({ customer_email: "carol@example.test", customer_address: "ที่อยู่ทดสอบ 1", customer_id_card_no: "FAKE-ID-0003", created_by_name: "ทดสอบ แอดมินหนึ่ง" })`; blank address/ID in profile → columns `null`.
  - `D05 terms contain the new lines`: `terms` contains `อีเมล: carol@example.test`, `ที่อยู่: ที่อยู่ทดสอบ 1`, `เลขบัตรประชาชน/พาสปอร์ต: FAKE-ID-0003`, `เลขที่ใบอนุญาตขับขี่: TEST-0003`, `ผู้จัดทำสัญญา: ทดสอบ แอดมินหนึ่ง`; with blank address the `ที่อยู่:` line is absent.
  - `D06 sent version's new fields are frozen`: after `send`, superuser `update contract_versions set customer_address = 'x'` (with `set_config('app.contract_workflow','on',true)` in the same statement batch) rejects `/สัญญาฉบับที่ส่งให้ลูกค้าแล้วแก้ไขไม่ได้/`; repeat for `created_by_name`.
  - `D07 profile edit after send does not change the sent version`: change carol's address, re-read v1 → old address.
  - `D08 creator name stays on in-place draft edit by another admin`: `admin2 = createAdmin(db)` named `ทดสอบ แอดมินสอง`; admin2 `adminUpdate` an unsent draft created by admin → `created_by_name` still `ทดสอบ แอดมินหนึ่ง`; after `send` + admin2 `adminUpdate` → version 2 has `ทดสอบ แอดมินสอง`.
  - `D09 creator fallback`: admin whose profile `full_name = ''` → `created_by_name` equals their `admin_members.email`.

- [ ] **Step 3: Run to confirm failure** — `npx vitest run src/test/db/contract-customer-details.db.test.ts` → FAIL (SQL file missing).

- [ ] **Step 4: Write `contract-customer-details.sql`.** Header comment: purpose, additive, apply after 0004. Contents:
  - `alter table public.contract_versions add column if not exists …` ×4.
  - New `render_contract_terms` overload: same lines as 0004, but after the `ผู้เช่า:` line add `'อีเมล: ' || nullif(_customer_email,'')`, `'ที่อยู่: ' || nullif(_customer_address,'')`, `'เลขบัตรประชาชน/พาสปอร์ต: ' || nullif(_customer_id_card_no,'')` (concat_ws skips nulls), keep the licence line, and after `ค่าปรับส่งคืนรถล่าช้า` add `'ผู้จัดทำสัญญา: ' || _created_by_name`. Leave the 0004 16-arg function in place (rollback simplicity).
  - `write_contract_version` (copy 0004, then): `lic` always required (`nullif(btrim(coalesce(pr.license_no,'')),'')`, raise existing message when null); `em` from `auth.users.email` of `_b.user_id`; `addr`/`idc` = `nullif(btrim(...),'')` from profile; on insert compute `creator` = `nullif(btrim(profiles.full_name),'')` of `auth.uid()`, else `admin_members.email`, else `'ผู้ดูแลระบบ'`, store in `created_by_name`; on in-place update keep the row's existing `created_by_name` (read it first) and pass it to the renderer. Write all new columns on both branches except `created_by_name` on update.
  - `protect_contract_version` (copy 0004) with the four new columns appended to both tuples of the sent-version check.
  - `require_booking_licence()` `security definer`, `set search_path = public`: if `nullif(btrim(coalesce(license_no,'')),'')` of `new.user_id` is null → `raise exception 'กรุณากรอกเลขใบอนุญาตขับขี่ในโปรไฟล์ก่อนจองรถ'`; `drop trigger if exists` + `create trigger … before insert on public.bookings for each row`.
  - Grants matching 0004 for any new function (`revoke all … from public, anon`).

- [ ] **Step 5: Run the new tests** → PASS. Then `npx vitest run src/test/db` → all existing DB tests still PASS (they do not apply the extra SQL).

- [ ] **Step 6: Write the rollback SQL** (re-create 0004's `write_contract_version` and `protect_contract_version` verbatim, drop the booking trigger + function and the new `render_contract_terms` overload; columns kept, with a commented-out optional `drop column`). Add test `D10 rollback restores 0004 behaviour`: fresh db with extra SQL, `db.exec(rollback)`, then `createBooking` for dan succeeds and `adminCreate` with `licence:false` leaves `customer_license_no` null.

- [ ] **Step 7: Write the Lovable prompt** following `docs/database/security-fixes-lovable-prompt.md`'s shape: status line, what is preserved, one read-only pre-check (`select count(*) from public.bookings b join public.profiles p on p.id = b.user_id where b.status = 'pending' and btrim(coalesce(p.license_no,'')) = ''` — pending bookings that will not get a contract), the SQL to paste, "regenerate Supabase types", and how to roll back.

- [ ] **Step 8: Commit** — `docs/database/contract-customer-details*.{sql,md}`, harness, new test: "Proposed migration: full customer details and creator on contracts, licence required".

---

### Task 2: Contract form always includes the licence

**Files:**
- Modify: `src/lib/contract-workflow.ts:201-219` (remove `includeLicence` from `ContractForm` and `DEFAULT_CONTRACT_FORM`)
- Modify: `src/lib/contract-api.ts:150` (`_include_license: true`)
- Modify: `src/components/admin/contracts-panel.tsx:101,204-213` (drop field mapping and the checkbox block; drop `Checkbox` import if unused)
- Test: `src/test/contract-ui.test.tsx` (D08 describe)

**Interfaces:**
- Produces: `ContractForm` without `includeLicence`; RPCs `admin_create_contract`/`admin_update_contract` always get `_include_license: true`.

- [ ] **Step 1: Failing test** `"creating a contract always includes the licence and shows no licence checkbox"`: render panel with pending `panelBooking`, open create tab, click `สร้างสัญญา` button, assert `screen.queryByLabelText(/ระบุเลขใบอนุญาตขับขี่/)` is null, click create in the dialog, `expect(mocks.rpc).toHaveBeenCalledWith("admin_create_contract", expect.objectContaining({ _include_license: true }))`.
- [ ] **Step 2: Run** `npx vitest run src/test/contract-ui.test.tsx` → FAIL.
- [ ] **Step 3: Implement** the four modifications above.
- [ ] **Step 4: Run** `npx vitest run src/test/contract-ui.test.tsx src/test/contract-workflow.test.ts` and `npx tsc --noEmit -p .` → PASS / no errors.
- [ ] **Step 5: Commit** "Contracts: always include the customer's driving licence".

---

### Task 3: Show new details in the contract summary

**Files:**
- Modify: `src/lib/contract-api.ts` (new type)
- Modify: `src/components/contract/contract-view.tsx:19-33` (`ContractSummary` rows)
- Test: `src/test/contract-ui.test.tsx` (G04 describe)

**Interfaces:**
- Produces: `export type ContractVersionDetails = ContractVersionRow & Partial<Record<"customer_email" | "customer_address" | "customer_id_card_no" | "created_by_name", string | null>>;` in `contract-api.ts`. `ContractSummary({ v }: { v: ContractVersionRow })` keeps its prop type and reads `v as ContractVersionDetails` (remove the cast once Lovable regenerates types).

- [ ] **Step 1: Failing tests**:
  - `"summary shows email, address, ID, licence and creator"`: `versionRow({ customer_license_no: "TEST-0001", ...{ customer_email: "a@example.test", customer_address: "ที่อยู่ทดสอบ", customer_id_card_no: "FAKE-ID-0001", created_by_name: "ทดสอบ แอดมิน" } as object })` in `ContractView` → each label (`อีเมล`, `ที่อยู่`, `เลขบัตรประชาชน/พาสปอร์ต`, `เลขที่ใบอนุญาตขับขี่`, `ผู้จัดทำสัญญา`) and value is in the document.
  - `"summary of a pre-migration version shows no empty new rows"`: plain `versionRow()` → `queryByText("อีเมล")`, `queryByText("ผู้จัดทำสัญญา")` are null; render does not throw.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**: after the ผู้เช่า row add `อีเมล`, `ที่อยู่`, `เลขบัตรประชาชน/พาสปอร์ต` rows, each only when non-empty; keep the licence row; append `ผู้จัดทำสัญญา` last when present. Use the existing conditional-row pattern.
- [ ] **Step 4: Run** `npx vitest run src/test/contract-ui.test.tsx` → PASS.
- [ ] **Step 5: Commit** "Contract view: show full customer details and creator".

---

### Task 4: Licence required to book (car page + demo accounts)

**Files:**
- Modify: `src/routes/cars_.$id.tsx` (profile query near the other hooks; `book()` guard; button `disabled`; alert)
- Modify: `src/lib/demo.functions.ts` (after `createUser`, set a fake licence)
- Test: Create `src/test/car-booking-licence.test.tsx`

**Interfaces:**
- Consumes: `profiles` row (`license_no`) of `user.id` via `supabase.from("profiles").select("license_no").eq("id", user.id).maybeSingle()`, query key `["profile", user.id]` (same key the profile page invalidates, so saving the licence re-enables booking).
- Produces: `licenceReady = !!profile?.license_no?.trim()` (false while loading or on error).

- [ ] **Step 1: Failing tests** (mock router with `useParams: () => ({ id: "car-1" })`, auth, Supabase tables `cars`, `reviews`, `profiles`, `bookings`; render `Route.component` like `profile-validation.test.tsx`; use a stable auth object):
  - `"logged-in customer without licence cannot book and is pointed to the profile"`: profile `license_no: ""` → book button (`/จองรถ/` or the actual label at `cars_.$id.tsx:188`) is disabled; text `/กรอกเลขใบอนุญาตขับขี่/` and a link to the profile are shown; no `bookings` insert.
  - `"customer with licence can book"`: `license_no: "TEST-0001"` → button enabled (dates valid).
  - `"while the profile is loading the button stays disabled"`: profile query never resolves → disabled.
  - `"logged-out visitor still sees an enabled button that leads to sign-in"`: `user: null` → button not disabled by the licence rule.
- [ ] **Step 2: Run** `npx vitest run src/test/car-booking-licence.test.tsx` → FAIL.
- [ ] **Step 3: Implement**: query enabled only when `user`; add `(!!user && !licenceReady)` to the button's `disabled`; `book()` returns `toast.error("กรุณากรอกเลขใบอนุญาตขับขี่ในโปรไฟล์ก่อนจองรถ")` when not ready; small alert above the button with `<Link to="/profile">`. Hooks stay above the early returns.
- [ ] **Step 4: Demo licence**: in `createDemoAccount`, read `data.user.id` from `createUser`, then `supabaseAdmin.from("profiles").update({ license_no: \`DEMO-${8 random digits from bytes}\` }).eq("id", data.user.id)`; on error throw the same Thai error as today.
- [ ] **Step 5: Run** `npx vitest run` (whole suite) and `npx tsc --noEmit -p .` → all PASS, no type errors.
- [ ] **Step 6: Commit** "Booking: require a driving licence; demo customers get a fake one".

---

### Task 5: Hand-off

- [ ] Update `README.md` contract section in one or two lines (licence required; new contract fields pending migration) if it describes contract contents.
- [ ] Final `npx vitest run` → all pass; report to the user which parts work now (Tasks 2, 4) and which need Lovable to apply `docs/database/contract-customer-details.sql` (Tasks 1, 3 data).
