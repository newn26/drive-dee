# Lovable request: booking fee after the customer confirms the contract

Status: **draft, not applied.** Apply this before merging the `Max-Branch` UI changes into
`main`; the new pages expect these database functions.

Tested locally against migrations 0000–0004 in PGlite: `src/test/db/booking-fee-flow.db.test.ts`.

## What changes

| Step | Before (0004) | After |
| --- | --- | --- |
| 1. Book | Car held 24 h while the admin prepares the contract | Same |
| 2. Admin | Creates and sends the draft | Same; deposit is always = rent |
| 3. Customer | Accepts or asks for changes | Same (asking for changes → admin sends a new version) |
| 4. After the customer accepts | Waits for admin approval | **Payment opens at once**, no admin approval |
| 5. Online payment | Full rent, 15 min after approval | **Booking fee 1,000 THB**, QR or card, 15 min after the customer confirms |
| At pickup (shown only) | Deposit | Rent + deposit (= rent) − 1,000 |
| Cancellation | Payment kept, not refunded | Same |

`bookings.total_amount` stays the rent. `payments.amount` is the booking fee, so revenue
reports count the 1,000 THB fees only. `admin_approve_contract` stays for contracts already
waiting for approval under 0004.

## Prompt to paste into Lovable

> Please create a new database migration with exactly the SQL in
> `docs/database/booking-fee-flow.sql` from this repository (branch `Max-Branch`). Run it as-is,
> after migration 0004. It replaces the functions `render_contract_terms`,
> `write_contract_version`, `guard_contract_update`, `customer_accept_contract` and
> `pay_booking`, and adds `booking_fee()`. Do not change any table, policy or other function.
> Then regenerate the Supabase types.

## Check after applying

1. Book a car as a customer: the page says it is waiting for the admin; no payment yet.
2. As admin, create and send the contract: deposit shows the rent and cannot be changed.
3. As the customer, ask for a change; as admin, send version 2.
4. As the customer, confirm version 2: the payment card appears at once with 1,000 THB and a 15-minute countdown.
5. Pay with QR or the test card `4242 4242 4242 4242`: the booking is confirmed.
6. Cancel a paid booking: the payment shows "not refunded".

## Rollback

Re-run the definitions of `render_contract_terms`, `write_contract_version`,
`guard_contract_update`, `customer_accept_contract` and `pay_booking` from
`drizzle/migrations/0004_contract_approval_workflow.sql`, then
`drop function public.booking_fee();`.

## Note for the DB tests

Once Lovable adds this as migration 0005, the harness applies it after 0004 for every DB test.
The 0004 tests that expect "accept → pending_admin_review → approve → pay full rent" will then
need updating to "accept → approved → pay 1,000".
