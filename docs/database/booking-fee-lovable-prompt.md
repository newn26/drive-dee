# Lovable request: booking fee after the customer confirms the contract

Status: **draft, not applied.** Apply this before merging the `Max-Branch` UI changes into
`main`; the new pages expect these database functions.

Tested locally against migrations 0000–0005 in PGlite: `src/test/db/booking-fee-flow.db.test.ts`.

## What changes

| Step                          | Before (0004)                                                | After                                                                            |
| ----------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 1. Book                       | 0005: contract created and sent automatically, no admin step | **Waits for the admin** (0005's auto-contract trigger is removed); car held 24 h |
| 2. Admin                      | Creates and sends the draft                                  | Same; deposit is always = rent                                                   |
| 3. Customer                   | Accepts or asks for changes                                  | Same (asking for changes → admin sends a new version)                            |
| 4. After the customer accepts | Waits for admin approval                                     | **Payment opens at once**, no admin approval                                     |
| 5. Online payment             | Full rent, 15 min after approval                             | **Booking fee 1,000 THB**, QR or card, 15 min after the customer confirms        |
| At pickup (shown only)        | Deposit                                                      | Rent + deposit (= rent) − 1,000                                                  |
| Cancellation                  | Payment kept, not refunded                                   | Same                                                                             |

`bookings.total_amount` stays the rent. `payments.amount` is the booking fee, so revenue
reports count the 1,000 THB fees only. `admin_approve_contract` stays for contracts already
waiting for approval under 0004.

## Prompt to paste into Lovable

> Please create a new database migration with exactly the SQL below (from
> `docs/database/booking-fee-flow.sql`, branch `Max-Branch`). Run it as-is, after migration 0005.
> It removes 0005's trigger `trg_create_contract_on_booking`, revokes `customer_prepare_contract`,
> replaces the functions `render_contract_terms`,
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
`drizzle/migrations/0005_customer_self_accept_contract.sql` (and `render_contract_terms`,
`write_contract_version` from 0004), then `drop function public.booking_fee();`.

## Note for the DB tests

The 0004 suites run on 0000–0004 only (`createTestDb()`); `booking-fee-flow.db.test.ts` runs on
the live stack (`createTestDb({ applyLater: true })`, i.e. 0000–0005) plus this SQL. Once Lovable
adds this as migration 0006, drop the `db.exec(FLOW_SQL)` from that test.
