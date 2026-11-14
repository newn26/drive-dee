# Security fixes B and H – Lovable prompt

> **SUPERSEDED (2026-11-12)** by `contract-approval-workflow.sql`, which contains fix B (contract
> writes only through workflow functions) and fix H (one paid payment per booking). Do not apply this file.

Status: **NOT APPLIED.** Prepared 2026-11-11 from the final pull-request audit
(issues B and H in `phase-4-lovable-db-changes.md`). Needs one Lovable message (credits).

| # | Problem today | Fix | App change needed |
|---|---|---|---|
| B | `contracts update` policy + `grant update on contracts to authenticated` let a customer change **any column** of their own contract through the API, including `terms` | `BEFORE UPDATE` trigger: customers may only accept an `active` contract once; admins keep editing `terms` | None |
| H | No database rule stops two successful payments for one booking (only `pay_booking`'s lock and status check do) | Partial unique index: one `paid` payment per booking | None |

Both fixes are additive: no table, column, policy or row is changed or deleted, and no
existing function is replaced. `pay_booking`, `validate_booking`, the Demo Admin prompt
and the app keep working unchanged.

## Step 0 – Read-only pre-checks (run first in Cloud → SQL editor)

```sql
-- H: must return NO rows, otherwise the unique index cannot be created
select booking_id, count(*) as payments, count(*) filter (where status = 'paid') as paid
from public.payments group by booking_id
having count(*) filter (where status = 'paid') > 1;

-- H: what payment statuses exist (expected today: only 'paid')
select status, count(*) from public.payments group by status;

-- B: current contracts (expected today: 3, none changed by this migration)
select contract_no, status, customer_accepted_at is not null as accepted from public.contracts;

-- Nothing with these names exists yet
select indexname from pg_indexes where indexname = 'payments_one_paid_per_booking';
select tgname from pg_trigger where tgname = 'trg_protect_contract';
```

## Prompt to paste into Lovable

> Please apply this small security migration for the Siam Wheels prototype. It only adds one
> trigger function, one trigger on `public.contracts` and one partial unique index on
> `public.payments`. Do not change or drop any table, column, policy, existing function or
> row. Use exactly this SQL:

```sql
-- B: customers may only accept their contract; only admins edit contract text.
create or replace function public.protect_contract()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Real admins and owner tools (SQL editor / service role, no auth.uid()):
  -- may edit terms and status, but the contract's identity never changes.
  if auth.uid() is null or public.has_role(auth.uid(), 'admin') then
    new.id := old.id;
    new.contract_no := old.contract_no;
    new.booking_id := old.booking_id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    return new;
  end if;

  -- Everyone else: no change to the contract itself.
  if new.id is distinct from old.id
     or new.contract_no is distinct from old.contract_no
     or new.booking_id is distinct from old.booking_id
     or new.user_id is distinct from old.user_id
     or new.terms is distinct from old.terms
     or new.created_at is distinct from old.created_at then
    raise exception 'ไม่สามารถแก้ไขสัญญาเช่าได้';
  end if;

  -- The only allowed change: accepting an active contract once, stamped with server time.
  if new.status is distinct from old.status
     or new.customer_accepted_at is distinct from old.customer_accepted_at then
    if old.status = 'active' and old.customer_accepted_at is null and new.status = 'accepted' then
      new.customer_accepted_at := now();
    else
      raise exception 'ไม่สามารถเปลี่ยนสถานะสัญญาได้';
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists trg_protect_contract on public.contracts;
create trigger trg_protect_contract
  before update on public.contracts
  for each row execute function public.protect_contract();

-- H: at most one successful payment per booking. Rows with another status
-- (for example a future 'failed' record) are not limited.
create unique index if not exists payments_one_paid_per_booking
  on public.payments (booking_id)
  where status = 'paid';
```

## After the migration – checks

```sql
-- Objects exist
select tgname from pg_trigger where tgname = 'trg_protect_contract';                     -- 1 row
select indexdef from pg_indexes where indexname = 'payments_one_paid_per_booking';       -- 1 row

-- Data unchanged
select count(*) from public.contracts;   -- same as Step 0
select count(*) from public.payments;    -- same as Step 0
```

Behaviour tests. Each runs inside a transaction that is **rolled back**, so nothing is saved.
Run them one block at a time.

```sql
-- B1: a customer cannot change contract text (expected: ERROR ไม่สามารถแก้ไขสัญญาเช่าได้)
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', c.user_id::text, 'role', 'authenticated')::text, true)
from public.contracts c
where not exists (select 1 from public.user_roles r where r.user_id = c.user_id and r.role = 'admin')
limit 1;
set local role authenticated;
update public.contracts set terms = 'tampered'
where user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid;
rollback;

-- H1: a second paid payment for the same booking is refused
-- (expected: ERROR duplicate key value violates unique constraint "payments_one_paid_per_booking")
begin;
insert into public.payments (booking_id, user_id, method, amount, status, reference)
select booking_id, user_id, method, amount, 'paid', 'DEMO-DUPLICATE-TEST'
from public.payments where status = 'paid' limit 1;
rollback;
```

B1 needs a contract owned by a non-admin account (today: the Demo Customer's Yaris
contract). If it returns "UPDATE 0" instead of an error, no such contract exists; test in the
app instead.

In the app (as a customer with a paid booking): open the booking, tick the agreement box and
accept the contract → it shows "signed". As admin: edit contract clauses → saved.

## Rollback (only if needed)

```sql
drop trigger if exists trg_protect_contract on public.contracts;
drop function if exists public.protect_contract();
drop index if exists public.payments_one_paid_per_booking;
```
