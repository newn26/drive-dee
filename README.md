<img width="190" height="183" src="https://github.com/user-attachments/assets/73f3958b-973c-42a4-b950-6d4d92ed66ea" />

# Drive Dee — Siam Wheels Rental Hub

**Siam Wheels Rental Hub** is the car rental management system behind **Drive Dee**
(ไดร์ฟดี รถเช่า), a car rental service in Thailand. It covers online booking, a digital
contract approval workflow, demo payments, fleet and maintenance management, administrator
management and reporting.

- **Drive Dee** is the customer-facing brand (page titles end in "— Drive Dee").
- **Siam Wheels Rental Hub** is the name of the software and this repository.

The interface is in Thai, prices are in Thai Baht (THB) and all dates and times use the
Asia/Bangkok time zone.

> [!WARNING]
> **Prototype — payments are DEMO only.** No payment gateway is connected and **no real money
> is ever transferred**. See [Booking and payment workflow](#8-booking-and-payment-workflow).
> Do not enter real personal data (names, ID card or driving licence numbers, phone numbers,
> card details). Every page shows a Thai prototype notice saying the same.

---

## Contents

1. [Project overview](#1-project-overview)
2. [Main features](#2-main-features)
3. [Technology stack](#3-technology-stack)
4. [User roles and permissions](#4-user-roles-and-permissions)
5. [Contract approval workflow](#5-contract-approval-workflow)
6. [Contract versioning and revision requests](#6-contract-versioning-and-revision-requests)
7. [Admin management](#7-admin-management)
8. [Booking and payment workflow](#8-booking-and-payment-workflow)
9. [Database architecture](#9-database-architecture)
10. [Security and access control](#10-security-and-access-control)
11. [Installation and local development](#11-installation-and-local-development)
12. [Environment variables](#12-environment-variables)
13. [Testing and quality checks](#13-testing-and-quality-checks)
14. [Deployment guide](#14-deployment-guide)
15. [Current prototype limitations](#15-current-prototype-limitations)
16. [Future improvements](#16-future-improvements)

---

## 1. Project overview

A customer books a car online. The booking holds the car while an administrator prepares a
rental contract, the customer reviews and accepts it, and an administrator approves it. Only
then can the customer pay (DEMO), which confirms the booking.

```mermaid
flowchart LR
  A[Customer books a car] --> B[Admin creates and sends contract]
  B --> C[Customer accepts]
  C --> D[Admin approves]
  D --> E[Customer pays — DEMO]
  E --> F[Booking confirmed]
```

Every rule in this flow is enforced in PostgreSQL (functions, triggers and Row Level
Security), not only in the user interface. The main implementation lives in
[`drizzle/migrations/0004_contract_approval_workflow.sql`](drizzle/migrations/0004_contract_approval_workflow.sql).

## 2. Main features

### Customers

- Sign-up, sign-in and password reset by email (Supabase Auth).
- Profile with contact details, driving licence number and ID card number.
- Car search by date range, category and price; only cars free for the chosen dates are shown.
- Car detail page with specifications, reviews and a booking form with five pickup points
  (Bangkok Sukhumvit, Suvarnabhumi Airport, Don Mueang Airport, Chiang Mai, Phuket).
- Booking with a server-generated booking code and a price calculated by the database.
- Contract review: read the contract sent by the administrator, **accept** it or **request a
  revision** with a reason; see the version history and contract timeline; print the contract.
- DEMO payment by QR code or test card once the contract is approved, with a countdown.
- Booking history with stage filters, and cancellation of pending or confirmed bookings.
- One review (1–5 stars and a comment) per confirmed, active or completed booking.
- **Demo Customer** mode: a one-click account with fictional details.

### Administrators (`/admin`)

- **Overview** with a contract **work queue** (bookings waiting for a contract, drafts, waiting
  for customer, waiting for approval, revision requested, approved, paid, cancelled) and key
  metrics (revenue, fleet utilisation, active bookings, customers, maintenance cost).
- **Contracts**: create, edit, send, approve or request revision; view versions and events.
- **Bookings**: view all bookings and move them through `confirmed → active → completed` or
  cancel them. `pending → confirmed` is never offered by hand.
- **Cars**: add, edit, delete, set status. Car status is recomputed from maintenance and
  active bookings.
- **Maintenance**: schedule and track jobs with costs.
- **Reviews**: delete inappropriate reviews.
- **Reports**: date-range filters (30 days, 90 days, this year, all time), monthly revenue
  chart, CSV export (UTF-8 with BOM so Thai text opens in Excel). Revenue comes from recorded
  payments, not bookings.

### Owner only

- **Admin management** tab: invite administrators, set fine-grained permissions, suspend,
  reactivate or revoke them, revoke open invitations, read the audit log.
- **Manual booking confirmation**: confirm a pending booking without the contract/payment
  workflow, with a required reason. Logged in both the contract timeline and the audit log.

## 3. Technology stack

| Area                  | Technology                                                                   |
| --------------------- | ---------------------------------------------------------------------------- |
| Language              | TypeScript 5                                                                 |
| UI                    | React 19, Tailwind CSS 4, shadcn/ui (Radix UI), lucide-react                 |
| Application framework | TanStack Start (SSR) with TanStack Router (file-based routes)                |
| Data fetching         | TanStack Query 5, Supabase JS client 2                                       |
| Forms and validation  | React Hook Form, Zod                                                         |
| Charts and QR codes   | Recharts, qrcode.react                                                       |
| Backend               | Supabase (PostgreSQL, Auth, Row Level Security) provided by Lovable Cloud    |
| Schema tooling        | Drizzle Kit (migration files in `drizzle/migrations/`, managed by Lovable)   |
| Build                 | Vite 8, Nitro (Cloudflare Workers output)                                    |
| Testing               | Vitest 4, Testing Library, jsdom, PGlite (in-memory PostgreSQL for DB tests) |
| Code quality          | ESLint, Prettier, TypeScript                                                 |

The project is connected to [Lovable](https://lovable.dev), which hosts the database and the
published site. See [`AGENTS.md`](AGENTS.md) for what Lovable manages.

## 4. User roles and permissions

Roles are stored in `user_roles` (`app_role` enum: `admin`, `customer`). Administrator details
(Owner flag, status, permissions) are stored in `admin_members`.

| Role                    | How it is assigned                                                     | Access                                                                    |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Visitor                 | Not signed in                                                          | Home page, car search, car details                                        |
| **Customer**            | Every new sign-up (trigger `handle_new_user`)                          | Own profile, bookings, contracts, payments and reviews                    |
| Demo Customer           | "Demo Customer" button on `/auth`                                      | Same as Customer with fictional data; can never become an administrator   |
| **Admin**               | Accepting an Owner's invitation (or the one-time SQL setup, see below) | `/admin`, limited to the permissions in their `admin_members` row         |
| **Owner / Super Admin** | One-time `bootstrap_owner` SQL step on an existing admin               | Everything an admin can do, plus admin management and manual confirmation |
| Demo Admin              | **Disabled**                                                           | None. See [limitations](#15-current-prototype-limitations)                |

### Admin permissions

Each non-Owner admin has a subset of these permissions. The Owner implicitly has all of them.

| Permission          | Allows                                                        |
| ------------------- | ------------------------------------------------------------- |
| `contracts_manage`  | Create, edit and send contracts                               |
| `contracts_approve` | Approve contracts or request a revision after customer review |
| `bookings_manage`   | Change booking status                                         |
| `fleet_manage`      | Add, edit, delete cars; create, edit, delete maintenance jobs |
| `reviews_moderate`  | Delete reviews                                                |

All active admins can read the dashboard, contracts, bookings, maintenance and reports.
A **suspended** or **revoked** admin is not treated as an admin anywhere: `has_role()` returns
false for them, so every RLS policy and workflow function rejects them.

### Owner bootstrap (one-time privileged setup)

There is at most one Owner (enforced by a unique index). No application screen or API can
create one. The Owner is set **once**, by the project owner, in the Lovable Cloud SQL editor:

1. Make sure the target account is a verified, active admin. The full procedure (first admin,
   Owner bootstrap, invitations, permissions, suspension, revocation, audit) is in
   [`docs/database/admin-account-procedure.md`](docs/database/admin-account-procedure.md).
2. Run, replacing the placeholder:

   ```sql
   select public.bootstrap_owner('<OWNER_EMAIL>');
   ```

`bootstrap_owner` refuses to run when called by a signed-in user (it works only from the SQL
editor or service role), when an Owner already exists, or when the account is not an active
admin. It writes an `owner_bootstrapped` audit entry. Never run it from application code,
a migration or an automated agent.

## 5. Contract approval workflow

Contracts can only be changed through `security definer` database functions. Direct table
writes are revoked, and the trigger `guard_contract_update` rejects any status change outside
the allowed transitions.

```mermaid
sequenceDiagram
  autonumber
  actor C as Customer
  participant DB as Database
  actor A as Admin
  C->>DB: Insert booking (status pending, 24 h hold)
  A->>DB: admin_create_contract (contracts_manage) → draft v1
  A->>DB: admin_update_contract (optional edits while unsent)
  A->>DB: admin_send_contract → pending_customer
  C->>DB: customer_accept_contract(version) → pending_admin_review
  A->>DB: admin_approve_contract(version) (contracts_approve) → approved, 15 min payment window
  C->>DB: pay_booking (DEMO) → payment paid, contract paid
  DB-->>C: Booking confirmed
```

| Step                        | Function                   | Who                 | Result                                                                                                        |
| --------------------------- | -------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1. Admin creates contract   | `admin_create_contract`    | `contracts_manage`  | Contract `draft`, version 1. Pickup/return dates must match the booking; price and days come from the booking |
| 2. Admin sends contract     | `admin_send_contract`      | `contracts_manage`  | Version stamped `sent_at` (now immutable); contract `pending_customer`                                        |
| 3. Customer reviews/accepts | `customer_accept_contract` | Booking owner       | Version stamped `accepted_at`; contract `pending_admin_review`                                                |
| 4. Admin reviews/approves   | `admin_approve_contract`   | `contracts_approve` | Version stamped `approved_at`; contract `approved`; 15-minute payment window starts                           |
| 5. Customer pays (DEMO)     | `pay_booking`              | Booking owner       | `payments` row (`paid`, `DEMO-…` reference); contract `paid`                                                  |
| 6. Booking confirmed        | (inside `pay_booking`)     | —                   | Booking `pending → confirmed`                                                                                 |

Contract snapshot fields: customer full name and phone, driving licence number **only** if
the admin ticks "include licence", car, plate, pickup location, pickup/return time, rental
days and price, deposit, mileage allowance, late-return penalty and optional additional
conditions. The national ID number is never copied into contracts. The deposit is shown in the
contract as payable at pickup; it is **not** part of the online (DEMO) payment.

Customers never see unsent drafts: RLS shows a customer their contract only once it has been
sent, only sent versions, and only customer-facing events.

### Contract statuses

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> pending_customer: send
  pending_customer --> pending_admin_review: customer accepts
  pending_customer --> revision_requested: customer requests revision
  pending_admin_review --> approved: admin approves
  pending_admin_review --> revision_requested: admin requests revision
  pending_customer --> draft: admin edits (new version)
  pending_admin_review --> draft: admin edits (new version)
  revision_requested --> draft: admin edits (new version)
  approved --> draft: admin edits (new version)
  approved --> paid: DEMO payment
  draft --> cancelled
  pending_customer --> cancelled
  pending_admin_review --> cancelled
  revision_requested --> cancelled
  approved --> cancelled
  paid --> cancelled
  cancelled --> [*]
```

A contract is cancelled automatically when its booking is cancelled or its hold expires
(trigger `cancel_contract_with_booking`).

## 6. Contract versioning and revision requests

Each contract has one or more rows in `contract_versions`. A version is a frozen snapshot.

- **Unsent draft:** `admin_update_contract` edits the draft in place.
- **Sent version:** never overwritten. `admin_update_contract` marks it `superseded_at` and
  creates version _n + 1_ as a new draft. The contract goes back to `draft` and acceptance and
  approval are cleared, so the new version needs a new send, acceptance and approval.
- Only one live (non-superseded) version per contract (unique index).
- Trigger `protect_contract_version` makes sent versions immutable, makes the
  sent/accepted/approved/superseded stamps write-once, and blocks deleting sent versions.
- Customers accept, and admins approve, a **specific version number**. A stale page
  (wrong version) is rejected.
- Payment requires the current version to be sent, accepted by the booking's customer,
  approved and not superseded. The amount charged is that version's `rental_price`.

### Revision requests

| Who      | Function                    | When allowed           | Permission          |
| -------- | --------------------------- | ---------------------- | ------------------- |
| Customer | `customer_request_revision` | `pending_customer`     | Booking owner       |
| Admin    | `admin_request_revision`    | `pending_admin_review` | `contracts_approve` |

Both require a reason of at least 5 characters, stored in `contracts.revision_reason` with
`revision_requested_by` (`customer` or `admin`) and logged as a `revision_requested` event.
The admin then edits the contract, which creates a new version, and sends it again.

### Contract events

`contract_events` is an append-only timeline (updates and deletes are rejected by trigger).
Actions: `legacy_import`, `created`, `edited`, `sent`, `accepted`, `revision_requested`,
`approved`, `paid`, `cancelled`, `expired`, `manual_confirm`. Each event records the version,
actor and actor role (`owner`, `admin`, `customer`, `system`). Customers see every action
except `created` and `edited`.

## 7. Admin management

All admin management functions require the Owner (`require_owner()`), except accepting an
invitation. The Owner uses the **ผู้ดูแลระบบ (Owner)** tab in `/admin`.

```mermaid
flowchart LR
  O[Owner] -->|owner_create_admin_invitation| I[Invitation<br/>72 h, single use]
  I -->|link /admin-invite?token=…| U[Invited user signs in<br/>with the invited email]
  U -->|accept_admin_invitation| M[admin_members: active]
  M -->|owner_set_admin_status| S[suspended]
  S -->|owner_set_admin_status| M
  M -->|owner_set_admin_status| R[revoked<br/>admin role removed]
  S -->|owner_set_admin_status| R
```

### Admin invitations

- The Owner enters an email and at least one permission. The database generates a random
  token, stores **only its SHA-256 hash**, and returns the token **once**.
- The UI shows a link `/admin-invite?token=…` that the Owner copies and sends to the invitee
  through their own channel. The app does not send email.
- Invitations cannot target `@demo.siamwheels.invalid` addresses or someone who is already an
  active or suspended admin.

### Expiration and single-use rules

- An invitation expires **72 hours** after creation.
- It can be accepted **once**; `accepted_at` / `accepted_by` are then set.
- It is valid only for a signed-in account whose email equals the invited email
  (case-insensitive), and never for a Demo Customer account.
- Only one open invitation per email: creating a new one revokes the previous open one.
- The Owner can revoke an open invitation (`owner_revoke_admin_invitation`).
- Expired, accepted, revoked, wrong-account and unknown tokens all fail with the same message.

### Permission management

`owner_set_admin_permissions` replaces a non-Owner admin's permission set. The list is
validated against the five known permissions and must not be empty. The Owner's own
permissions cannot be changed.

### Suspension and revocation

`owner_set_admin_status` requires a reason (at least 5 characters). Allowed moves:

| From                   | To          | Effect                                                   |
| ---------------------- | ----------- | -------------------------------------------------------- |
| `active`               | `suspended` | All admin access stops immediately (`has_role` is false) |
| `suspended`            | `active`    | Access restored with the existing permissions            |
| `active` / `suspended` | `revoked`   | `admin` role deleted from `user_roles`; access ends      |

The Owner cannot change their own status, and the Owner's status cannot be changed. A revoked
admin can be invited again.

### Audit logs

`admin_audit_log` is append-only and readable only by the Owner (latest 100 entries are shown
in the UI). Actions: `admin_role_granted`, `owner_bootstrapped`, `invite_created`,
`invite_revoked`, `invite_accepted`, `permissions_changed`, `admin_suspended`,
`admin_reactivated`, `admin_revoked`, `booking_manual_confirm`. Each entry stores the actor,
target user and email, and a JSON `details` object (for example old and new permissions or the
reason). Invitation tokens are never logged.

## 8. Booking and payment workflow

### Booking hold

A pending booking holds its car only while `bookings.hold_expires_at` is in the future
(`booking_blocks_car`). The hold is reset at every hand-off:

| Stage                                             | Hold                                                     |
| ------------------------------------------------- | -------------------------------------------------------- |
| Booking created, waiting for the admin's contract | 24 h, capped at midnight after the pickup date (Bangkok) |
| Sent, waiting for the customer                    | 24 h (same cap)                                          |
| Accepted, waiting for admin approval              | 24 h (same cap)                                          |
| Revision requested / new version                  | 24 h (same cap)                                          |
| Approved, waiting for payment                     | **15 minutes** (not capped)                              |

When a hold runs out the car is released at once for availability checks, and every workflow
step on that booking is refused. `expire_stale_bookings()` (called by the app when lists load)
moves such bookings to `cancelled` and logs an `expired` contract event.

`validate_booking` (trigger) also rejects past dates, unavailable cars and overlapping
bookings, computes days and price, prevents customers from changing amount, dates or car,
and locks those fields for admins once a contract exists.

### Booking statuses

```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> confirmed: DEMO payment or Owner manual confirm
  pending --> cancelled: customer, bookings_manage, or expiry
  confirmed --> active: bookings_manage
  confirmed --> completed: bookings_manage
  confirmed --> cancelled
  active --> completed: bookings_manage
  active --> cancelled: bookings_manage
```

### DEMO payments

> [!IMPORTANT]
> **DEMO payments do not transfer real money.** There is no payment gateway, no card
> processing, no bank transfer and no refund system.

- **QR code:** contains a text marker (`SIAM-WHEELS-DEMO|NOT-A-PAYMENT|…`), deliberately not
  a PromptPay/EMVCo payload, so a banking app cannot turn it into a transfer. The customer
  confirms the simulated payment with a button.
- **Card:** test cards only. `4242 4242 4242 4242` succeeds; any number ending in `0002`
  (for example `4000 0000 0000 0002`) is declined in the browser and the database is not
  called. Use any future expiry and any 3-digit CVV. Only the last four digits are stored.
- `pay_booking` locks the booking, checks the hold and the approved contract version, records
  one `paid` payment with a `DEMO-` reference (a unique index allows only one per booking),
  confirms the booking and marks the contract `paid`.
- **Cancellation is not a refund.** Cancelling a paid booking keeps the payment as `paid` and
  sets `refund_status = 'not_refunded'`. The `refund_status` column also accepts `refunded`,
  but the application does **not** implement refunds yet: no function or screen sets it.

## 9. Database architecture

Schema `public`, created by `drizzle/migrations/0000`–`0004`. **All five migrations, including
`0004_contract_approval_workflow`, are applied to production.** Other tables: `profiles`,
`cars`, `reviews`, `maintenance`.

```mermaid
erDiagram
  bookings ||--o| contracts : "has (0..1)"
  bookings ||--o{ payments : "paid by"
  bookings ||--o{ contract_events : "timeline"
  contracts ||--|{ contract_versions : "versions"
  contracts ||--o{ contract_events : "timeline"
  user_roles }o--|| admin_members : "admin role ↔ member row (user_id)"
  admin_members ||--o{ admin_invitations : "invited_by"
  admin_members ||--o{ admin_audit_log : "actor_id / target_user_id"
```

| Table               | Purpose and key rules                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts`         | One per booking. `contract_no`, `status` (7 values), `current_version`, `sent_version`, `terms` (text of the sent version), `customer_accepted_at`, `approved_at/by`, `paid_at`, `cancelled_at`, `revision_reason`, `revision_requested_by`. Read-only for clients; changed only by workflow functions. |
| `contract_versions` | Immutable snapshots per version (customer, car, times, price, deposit, mileage, penalty, conditions, rendered `terms`) with `sent_at`, `accepted_at/by`, `approved_at/by`, `superseded_at`. `is_legacy` marks contracts imported from before migration 0004.                                            |
| `contract_events`   | Append-only timeline per booking/contract: action, version, actor, actor role, note.                                                                                                                                                                                                                    |
| `admin_members`     | One row per admin: `is_owner` (at most one), `status` (`active`/`suspended`/`revoked`), `permissions`, `status_reason`, `invited_by`. Created automatically when the admin role is granted. Updated by Owner functions (not append-only).                                                               |
| `admin_invitations` | `email`, `token_hash` (SHA-256, never the token), `permissions`, `expires_at`, `accepted_at/by`, `revoked_at/by`. One open invitation per email. Acceptance and revocation update the row (not append-only).                                                                                            |
| `admin_audit_log`   | Append-only log of admin-management actions and manual confirmations. Owner-readable only.                                                                                                                                                                                                              |
| `bookings`          | `booking_code`, customer, car, dates, `days`, `pickup_location`, `total_amount`, `status`, `hold_expires_at`.                                                                                                                                                                                           |
| `payments`          | DEMO payments: `method` (`qr`/`card`), `amount`, `status`, `reference`, `card_last4`, `refund_status` (`none`/`not_refunded`/`refunded`). Client writes revoked; at most one `paid` row per booking.                                                                                                    |
| `user_roles`        | `(user_id, role)` with `app_role` = `admin` or `customer`. Client writes revoked; `admin` can only be granted by an accepted invitation or from the SQL editor.                                                                                                                                         |

Key database functions:

| Group             | Functions                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract workflow | `admin_create_contract`, `admin_update_contract`, `admin_send_contract`, `customer_accept_contract`, `customer_request_revision`, `admin_approve_contract`, `admin_request_revision`                            |
| Booking / payment | `pay_booking`, `owner_manual_confirm_booking`, `expire_stale_bookings`, `booked_car_ids`                                                                                                                        |
| Admin management  | `owner_create_admin_invitation`, `owner_revoke_admin_invitation`, `accept_admin_invitation`, `owner_set_admin_permissions`, `owner_set_admin_status`, `bootstrap_owner` (SQL editor only)                       |
| Authorisation     | `has_role`, `is_owner`, `has_admin_permission`                                                                                                                                                                  |
| Triggers          | `validate_booking`, `cancel_contract_with_booking`, `guard_contract_update`, `protect_contract_version`, `append_only`, `guard_admin_role_grant`, `track_admin_member`, `prevent_demo_admin`, `handle_new_user` |

Migration 0004 is additive: existing contracts were kept as legacy version 1 and mapped to
`paid` or `cancelled`, existing admins became active members with all permissions (none was
made Owner), and existing pending bookings kept a 15-minute hold. A rollback script is kept in
[`docs/database/contract-approval-workflow-rollback.sql`](docs/database/contract-approval-workflow-rollback.sql).

> Schema changes are made through Lovable. Do not add or edit files in `drizzle/` by hand.

## 10. Security and access control

- **The database is the security boundary.** The UI hides actions a user cannot perform
  (`src/lib/roles.ts`), but RLS policies, grants, triggers and function checks reject them if
  attempted directly through the API.
- **Row Level Security** is enabled on every table. Customers read only their own bookings,
  payments, contracts (once sent), sent versions and customer-facing events.
- **No direct writes** for clients on `contracts`, `contract_versions`, `contract_events`,
  `payments`, `user_roles`, `admin_members`, `admin_invitations` or `admin_audit_log`. Writes
  go through `security definer` functions that check identity and permissions themselves.
- **Fine-grained admin permissions** are enforced in RLS (`has_admin_permission`) for cars,
  maintenance and reviews, and in each workflow function for contracts and bookings.
- **Admin role grants** are blocked for signed-in users unless they come from
  `accept_admin_invitation` (`guard_admin_role_grant`). Demo accounts can never be admins
  (`prevent_demo_admin` and checks in invitation functions).
- **Owner-only actions** call `require_owner()`. `bootstrap_owner` cannot be executed by any
  API role.
- **Append-only history:** `contract_events` and `admin_audit_log` reject every update and
  delete (trigger `append_only`). Sent contract versions are immutable and their
  sent/accepted/approved/superseded stamps are write-once. `admin_members` and
  `admin_invitations` are **not** append-only: the Owner functions update status, permissions
  and acceptance/revocation columns, and those changes are recorded in `admin_audit_log`.
  (Grant comments in migration 0004 call these two tables "append-only history"; that only
  means `service_role` has no `UPDATE`/`DELETE`/`TRUNCATE` grant on them.)
- **Internal helpers** (rendering, logging, permission checks) have `EXECUTE` revoked from
  API roles.
- **Invitation tokens** are 64 hex characters from the database's cryptographic random
  source; only the hash is stored and the token is never logged.
- **Demo Customer accounts** use the reserved domain `@demo.siamwheels.invalid` and a
  server-set `app_metadata.demo` flag; the app always treats them as customers.
- **Service-role key** is used only in the `createDemoAccount` server function
  (`src/lib/demo.functions.ts`) through `src/integrations/supabase/client.server.ts`. It must
  never reach browser code.

## 11. Installation and local development

Requirements: Node.js 20.19 or later (22 LTS recommended) and npm.

```sh
git clone https://github.com/newn26/drive-dee.git
cd drive-dee
npm install
npm run dev
```

The app runs at http://localhost:8080. The committed `.env` contains only public values (see
below), so the app connects to the Lovable Cloud backend without further setup. Demo Customer
sign-in needs the service-role key and does not work locally without it.

| Command              | Description                             |
| -------------------- | --------------------------------------- |
| `npm run dev`        | Development server on port 8080         |
| `npm run build`      | Production build (output in `.output/`) |
| `npm run build:dev`  | Build in development mode               |
| `npm test`           | Run all tests once                      |
| `npm run test:watch` | Tests in watch mode                     |
| `npm run lint`       | ESLint                                  |
| `npm run format`     | Prettier                                |
| `npx tsc --noEmit`   | Type-check                              |

`npm run preview` does not serve the Cloudflare Worker output; use `npm run dev`.

Project layout:

```
drizzle/migrations/       SQL migrations (managed by Lovable; do not edit)
docs/database/            Workflow plan, rollback script, owner procedures
src/routes/               One file per page (see src/routes/README.md)
src/components/admin/     Contracts panel, admin management panel, reviews panel
src/components/contract/  Contract view (versions, events, print)
src/lib/                  Domain logic: contract workflow/API, roles, payment window,
                          demo payment, availability, reports, formatting
src/integrations/supabase Supabase clients and generated types (generated; do not edit)
src/test/                 Unit/UI tests; src/test/db/ holds database tests (PGlite)
```

## 12. Environment variables

### Used by the application

| Variable                        | Where                                                    | Used by                                                                     | Purpose                                           |
| ------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| `VITE_SUPABASE_URL`             | `.env` (committed, public)                               | Browser build (`client.ts`)                                                 | Supabase project URL                              |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env` (committed, public)                               | Browser build (`client.ts`)                                                 | Publishable key; access limited by RLS            |
| `SUPABASE_URL`                  | `.env` / runtime                                         | Server (`client.ts` SSR fallback, `auth-middleware.ts`, `client.server.ts`) | Supabase URL for server-side requests             |
| `SUPABASE_PUBLISHABLE_KEY`      | `.env` / runtime                                         | Server (`client.ts` SSR fallback, `auth-middleware.ts`)                     | Publishable key for server-side requests          |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Runtime secret only** (Lovable secrets / `.env.local`) | Server only (`client.server.ts`, used by `createDemoAccount`)               | Creates Demo Customer accounts. Bypasses all RLS. |

### Tooling and tests

| Variable                   | Used by                  | Purpose                                                                        |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| `LOVABLE_DB_MIGRATION_URL` | `drizzle.config.ts`      | Database URL for Drizzle Kit. Provided and used by Lovable; not needed locally |
| `CONTRACT_MIGRATION_SQL`   | `src/test/db/harness.ts` | Optional: path to an alternative migration file for the database tests         |

### Present but currently unused

| Variable                                              | Status                                                                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_PROJECT_ID`, `SUPABASE_PROJECT_ID`     | In the committed `.env` (written by Lovable). Not read by application code. Vite still embeds `VITE_SUPABASE_PROJECT_ID` in the browser bundle; the value is public. |
| `LOVABLE_CRON_SECRET`, `LOVABLE_CRON_SECRET_PREVIOUS` | Read only by the generated helper `src/integrations/supabase/cron-auth.ts`, which nothing imports. There are no cron routes or scheduled jobs.                       |

> [!CAUTION]
> **Never commit `SUPABASE_SERVICE_ROLE_KEY` or any other secret.** It bypasses all database
> security. Keep it in Lovable's secret store or a git-ignored `.env.local`, out of browser code,
> chats and issue trackers. Only `VITE_*` values may reach the browser.

## 13. Testing and quality checks

24 test files, 252 tests (Vitest).

- **Unit and UI tests** (`src/test/*.test.ts(x)`, jsdom): roles and dashboard permissions,
  protected routes, contract status rules and UI, contract terms, payment window and countdown,
  DEMO payment helpers, availability and dates, car status, reports and CSV, review moderation,
  password reset, prototype notice, error states.
- **Database tests** (`src/test/db/*.db.test.ts`): boot an **in-memory PostgreSQL (PGlite)**
  with Supabase stubs, apply migrations 0000–0004, and run queries as real `authenticated`
  users so RLS, grants, triggers and functions are exercised. They cover contract creation and
  review, versioning and revisions, payment, hold and booking rules, admin management and
  invitations, legacy data migration (including re-running 0004), and the rollback script.
  They never connect to the live database.

```sh
npm test            # all tests
npx tsc --noEmit    # type-check
npm run lint        # lint
npm run build       # production build
```

## 14. Deployment guide

The site is hosted by Lovable Cloud, which syncs the `main` branch of this repository.

1. Open a pull request into `main` and make sure `npm test`, `npx tsc --noEmit` and
   `npm run build` pass. Do not force-push or rewrite pushed history (see `AGENTS.md`).
2. Merge. Lovable syncs the commit; confirm in the Lovable editor that the preview works.
3. Database changes are applied by Lovable, not by hand. New migrations should be tested with
   the PGlite database tests first.
4. In Lovable Cloud → Auth settings, include the published domain in Site URL and Redirect URLs
   so confirmation and password-reset emails return to the site.
5. Keep secrets in Lovable's secret store. Only the publishable key may reach the browser.
6. Run Lovable's security scan and resolve critical findings.
7. Publish from the Lovable editor and test the published URL signed out (home, search,
   `/admin` access denied), as a customer (booking → contract → DEMO payment) and as an admin.
8. First deployment of the admin model only: run the one-time
   [Owner bootstrap](#owner-bootstrap-one-time-privileged-setup).

The Lovable preview URL is visible only to workspace members; share the published URL with
clients.

## 15. Current prototype limitations

- **Payments are DEMO only.** No gateway, no real money, no receipts.
- **No refunds.** `payments.refund_status` supports `refunded`, but no refund function or screen
  exists; cancelled paid bookings are marked `not_refunded`.
- **No email notifications.** Invitation links must be copied and delivered by the Owner;
  customers and admins are not notified of contract steps.
- **Expiry is enforced on use.** Expired holds stop blocking cars immediately, but booking
  status changes to `cancelled` only when `expire_stale_bookings()` runs (when lists load).
  There is no scheduled job.
- **Single Owner, no transfer.** There is no function to transfer or remove the Owner role
  from the app.
- **Demo Administrator is not available.** `/demo-admin` exists, but the `demo_admin` role is
  not in the database and its sign-in is disabled (`DEMO_ADMIN_SIGN_IN_ENABLED = false`).
- **Demo Customer accounts** are created without rate limiting and need the service-role key.
- Car images are URLs or category stock photos; no upload.
- Email and password sign-in only; Thai interface only.

## 16. Future improvements

- Real payment provider (for example PromptPay and cards through a licensed gateway) with
  refunds and receipts.
- Email notifications for invitations, contract sends, approvals and payment reminders.
- Scheduled job for expiring holds and updating car status.
- Owner transfer procedure.
- Apply the Demo Administrator migration and enable its sign-in.
- Rate limiting and clean-up for Demo Customer accounts.
- End-to-end browser tests (for example Playwright) in CI.
- Car image upload to storage; English interface option.
