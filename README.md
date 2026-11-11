# Drive Dee — Siam Wheels Rental Hub

**Siam Wheels Rental Hub** is the Car Rental Management System behind **Drive Dee**
(ไดร์ฟดี รถเช่า), a car rental service in Thailand. It provides online booking, fleet
management, digital rental contracts, maintenance tracking and administrative reporting.

- **Drive Dee** is the brand customers see: the website header shows it in Thai as ไดร์ฟดี,
  and browser titles end in "Drive Dee".
- **Siam Wheels Rental Hub** is the name of the system and of this repository's software.

The user interface is in Thai, prices are in Thai Baht (THB) and all dates follow the
Asia/Bangkok time zone.

> **Prototype status.** This system is a working prototype built for client demonstration.
> All payments are **simulated (DEMO)**: no money is charged and no real payment gateway is
> connected. See [Demo payments](#demo-payments).
>
> **Do not use real customer data.** Do not enter real names, ID card numbers, driving
> licence numbers, phone numbers or card details. Every page shows a Thai prototype notice
> saying the same.

---

## Contents

1. [Project overview](#project-overview)
2. [Project objectives](#project-objectives)
3. [Key features](#key-features)
4. [User roles](#user-roles)
5. [Technology stack](#technology-stack)
6. [System architecture](#system-architecture)
7. [Project structure](#project-structure)
8. [Database overview](#database-overview)
9. [Authentication and authorization](#authentication-and-authorization)
10. [Demo payments](#demo-payments)
11. [Installation and setup](#installation-and-setup)
12. [Environment variables](#environment-variables)
13. [Development commands](#development-commands)
14. [Testing](#testing)
15. [Deployment guide](#deployment-guide)
16. [Current limitations](#current-limitations)
17. [Future improvements](#future-improvements)

---

## Project overview

Siam Wheels Rental Hub covers the full rental cycle for Drive Dee, a small car rental
business:

1. A customer searches for cars that are free on the chosen dates and books one.
2. The car is held for 15 minutes while the customer pays by QR code or card (simulated).
3. Payment confirms the booking and generates a digital rental contract, which the customer
   accepts online and can print.
4. Staff manage the fleet, booking status, contract terms and maintenance, and follow
   revenue and utilisation in reports that can be exported to CSV.

Customers and administrators have separate dashboards and navigation.

## Project objectives

- Let customers find an available car and complete a booking online in a few steps.
- Prevent double bookings and unpaid reservations from blocking cars indefinitely.
- Replace paper rental agreements with contracts generated from the booking data.
- Give administrators one place to manage cars, bookings, contracts and maintenance.
- Report revenue from recorded payments, not from bookings, so figures match money received.
- Enforce access rules in the database, not only in the user interface.

## Key features

### Customers

- Registration, sign-in and password reset by email.
- Profile with contact details, driving licence number and ID card number.
- Car search by date range, category and price, showing only cars that are free for the
  selected dates.
- Car detail page with specifications, reviews and booking form, with five pickup points:
  Bangkok (Sukhumvit), Suvarnabhumi Airport, Don Mueang Airport, Chiang Mai and Phuket.
- Booking with a server-generated booking code (for example `BK261111B8D32`) and a price
  calculated by the database.
- 15-minute payment window with a countdown that survives page reloads.
- Simulated payment by QR code or credit/debit card.
- Booking history with status filters and cancellation of pending or confirmed bookings.
- Digital rental contract: view, accept online and print.
- One review (1–5 stars and a comment) per paid booking.
- Demo Customer mode: a one-click account with fictional details for trying the system.

### Administrators

- Overview dashboard: revenue, fleet utilisation, active bookings, customers and
  maintenance cost.
- Car management: add, edit and delete cars; set status (available, rented, maintenance,
  unavailable).
- Booking management: view all bookings and update their status.
- Contract management: view contracts and set additional clauses (deposit, mileage
  allowance, late-return fee).
- Maintenance scheduling and tracking with cost recording.
- Reports with date-range filters (30 days, 90 days, this year, all time), a monthly revenue
  chart, and CSV export of bookings/revenue and maintenance (UTF-8 with BOM, so Thai text
  opens correctly in Excel).
- Review moderation (delete inappropriate reviews).

## User roles

| Role | How it is assigned | Access |
| --- | --- | --- |
| Visitor | Not signed in | Home page, car search and car details |
| Customer | Every new sign-up | Own profile, bookings, payments, contracts and reviews |
| Demo Customer | "Demo Customer" button on the sign-in page | Same as Customer, with fictional data; can never become an administrator |
| Administrator | Granted manually by the project owner (see `docs/database/admin-account-procedure.md`) | Full administration dashboard at `/admin` |
| Demo Administrator | **Not available yet** | Planned restricted dashboard at `/demo-admin`; waiting for a database migration |

## Technology stack

| Area | Technology |
| --- | --- |
| Language | TypeScript 5 |
| UI | React 19, Tailwind CSS 4, shadcn/ui (Radix UI), lucide-react icons |
| Application framework | TanStack Start (server-side rendering) with TanStack Router (file-based routes) |
| Data fetching | TanStack Query 5, Supabase JS client 2 |
| Forms and validation | React Hook Form, Zod |
| Charts and QR codes | Recharts, qrcode.react |
| Backend | Supabase (PostgreSQL, Auth, Row Level Security) provided through Lovable Cloud |
| Build | Vite 8, Nitro (Cloudflare Workers output) |
| Testing | Vitest 4, Testing Library, jsdom |
| Code quality | ESLint, Prettier |

The project was scaffolded with [Lovable](https://lovable.dev) (TanStack Start template) and
is connected to a Lovable Cloud project, which hosts the database and the published site.

## System architecture

```
 Browser (React, TanStack Router/Query)
   │
   │  HTTPS: Supabase JS client with the publishable key
   │  (every query is checked by Row Level Security)
   ▼
 Supabase / Lovable Cloud
   ├── Auth            sign-up, sign-in, password reset, sessions
   ├── PostgreSQL      tables, RLS policies, triggers
   └── SQL functions   pay_booking, booked_car_ids, validate_booking, ...

 TanStack Start server (Cloudflare Worker)
   ├── Server-side rendering of pages
   └── Server function createDemoAccount  (only code that uses the service-role key)
```

Business rules that must not be bypassed live in the database:

- `validate_booking` (trigger) rejects past dates, unavailable cars and overlapping bookings,
  calculates days and price, and prevents customers from changing amounts or dates.
- `pay_booking` (function) records a demo payment and creates the contract in one
  transaction. It locks the booking, accepts only unpaid bookings inside the 15-minute
  window, and stores at most the last four card digits.
- `booked_car_ids` (function) returns cars that are taken for a date range, ignoring
  unpaid bookings older than 15 minutes.
- `handle_new_user` (trigger) creates a profile and gives every new account the customer
  role only.
- `prevent_demo_admin` (trigger) stops Demo Customer accounts from receiving the admin role.

## Project structure

```
├── AGENTS.md                 Rules for working with the Lovable-connected repository
├── docs/database/            Database change proposals and owner procedures
├── drizzle/
│   ├── migrations/           SQL migrations (managed by Lovable; do not edit by hand)
│   └── schema.ts
├── public/                   Favicon, touch icon, robots.txt
├── src/
│   ├── routes/               One file per page (see src/routes/README.md)
│   ├── components/           Shared components; ui/ holds shadcn/ui primitives
│   ├── hooks/                use-auth (session and role), use-mobile
│   ├── lib/                  Domain logic: availability, payment window, demo payment,
│   │                         reports and CSV, roles, contract terms, formatting
│   ├── integrations/supabase Supabase clients and generated types (generated files)
│   ├── test/                 Vitest test suites
│   ├── router.tsx            Router and query client setup
│   ├── routeTree.gen.ts      Generated route tree (do not edit)
│   └── styles.css            Tailwind theme and global styles
├── supabase/config.toml
├── vite.config.ts
└── vitest.config.ts
```

## Database overview

PostgreSQL schema (`public`), created by the migrations in `drizzle/migrations/`:

| Table | Purpose |
| --- | --- |
| `profiles` | Name, phone, address, driving licence and ID card number for each user |
| `user_roles` | Role assignments (`admin`, `customer`) |
| `cars` | Fleet: brand, model, year, plate number, category, seats, transmission, fuel, mileage, daily price, image, status |
| `bookings` | Booking code, customer, car, dates, days, pickup branch, amount, status |
| `payments` | Demo payments: method, amount, status, reference, card last four digits. Only `pay_booking` can create them, once per booking |
| `contracts` | One contract per paid booking: contract number, terms, status, acceptance time |
| `reviews` | One review per booking: rating 1–5 and comment |
| `maintenance` | Maintenance jobs per car: title, description, dates, cost, status |

Enumerations: `app_role`, `car_status`, `booking_status` (`pending`, `confirmed`, `active`,
`completed`, `cancelled`), `payment_method` (`qr`, `card`) and `maintenance_status`.

Row Level Security is enabled on every table. Customers can read and change only their own
records; administrators are identified with `has_role(auth.uid(), 'admin')`.

Schema changes are made through Lovable, which writes the migration files. Do not add or
edit files in `drizzle/migrations/` by hand.

## Authentication and authorization

- Authentication uses Supabase Auth (email and password). Password-reset links return to
  `/auth?reset=true` on the current domain.
- Public sign-up always creates a **customer**. No form or API in the application can grant
  the admin role; the owner grants it with a documented SQL procedure.
- Each page checks the signed-in user's role before showing protected content:
  - `/dashboard`, `/bookings`, `/bookings/:id` and `/profile` require a signed-in user.
  - `/admin` requires the `admin` role and shows an access-denied page otherwise.
  - `/demo-admin` requires the `demo_admin` role, which does not exist yet.
- The database is the security boundary. The interface hides actions a user may not
  perform, and RLS policies and triggers reject them if they are attempted directly.
- Demo Customer accounts use the reserved domain `@demo.siamwheels.invalid` and a
  server-set `app_metadata.demo` flag. The application always treats them as customers, and a
  database trigger rejects the admin role for them.

## Demo payments

**No real payment is ever processed.** Both payment methods are simulations for
demonstration purposes:

- **QR code:** the QR code contains a text marker (`SIAM-WHEELS-DEMO|NOT-A-PAYMENT|…`),
  not a PromptPay or EMVCo payload, so a banking app cannot turn it into a transfer.
  The customer confirms the simulated payment with a button.
- **Credit/debit card:** use test cards only.

  | Card number | Result |
  | --- | --- |
  | `4242 4242 4242 4242` | Payment succeeds |
  | Any number ending in `0002` (for example `4000 0000 0000 0002`) | Card declined; the booking stays unpaid |

  Use any future expiry date (for example `12/30`) and any three-digit CVV. Card details
  never leave the browser except the last four digits, and the form is cleared after every
  attempt.

Every payment is stored with a `DEMO-` reference. A booking can be paid only once, and only
within 15 minutes of being created; after that it is cancelled and the car is released.

## Installation and setup

Requirements: Node.js 20.19 or later (22 LTS recommended) and npm.

```sh
git clone https://github.com/newn26/drive-dee.git
cd drive-dee
npm install
```

Create a `.env` file in the project root (see below), then start the development server:

```sh
npm run dev
```

The application runs at http://localhost:8080.

## Environment variables

The values come from the Lovable Cloud project. Never commit `.env`; it is listed in
`.gitignore`.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Browser | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser | Public (anon) key; access is limited by RLS |
| `VITE_SUPABASE_PROJECT_ID` | Browser | Supabase project reference |
| `SUPABASE_URL` | Server | Supabase project URL for server-side rendering |
| `SUPABASE_PUBLISHABLE_KEY` | Server | Public key for server-side rendering |
| `SUPABASE_PROJECT_ID` | Server | Supabase project reference |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Needed only by the Demo Customer server function. Lovable provides it in hosted environments. Without it, local Demo Customer sign-in fails; everything else works. |

`SUPABASE_SERVICE_ROLE_KEY` bypasses all database security. Keep it out of the repository,
out of browser code and out of chat or issue trackers.

## Development commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server on port 8080 |
| `npm run build` | Production build (output in `.output/`) |
| `npm run build:dev` | Build in development mode |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Run ESLint |
| `npm run format` | Format the code with Prettier |
| `npx tsc --noEmit` | Type-check the project |

`npm run preview` does not serve the Cloudflare Worker build output locally; use
`npm run dev` to try the application.

## Testing

The test suite uses Vitest with Testing Library in a jsdom environment
(`src/test/`, 13 files, 109 tests). It covers:

- role resolution, dashboard permissions and protected-route logic;
- date validation and availability filtering;
- the 15-minute payment window and countdown;
- demo payment helpers (QR content, card expiry, declined test card);
- contract clause editing;
- report calculations, monthly revenue series and CSV export;
- review moderation, password reset and error states.

```sh
npm test
npx tsc --noEmit
npm run build
```

The booking, payment, contract and expiry flows were also rehearsed end to end against the
live database with test bookings.

## Deployment guide

The site is hosted by Lovable Cloud, which builds from the `main` branch of this repository.

1. Merge the release branch into `main` with a pull request. Lovable syncs the commit.
2. In the Lovable editor, confirm the latest commit is loaded and the preview works.
3. In Lovable Cloud → Auth settings, add the published domain to the Site URL and Redirect
   URLs so that confirmation and password-reset emails link back correctly.
4. Keep secrets in Lovable's secret store. Only the publishable key may reach the browser.
5. Run Lovable's security scan and resolve critical findings.
6. Publish from the Lovable editor and test the published URL while signed out
   (home, search, `/admin` access denied) and as an administrator.

The Lovable preview URL (`id-preview--….lovable.app`) is visible only to members of the
Lovable workspace; share the published URL with clients.

## Current limitations

- **Payments are simulated.** There is no payment gateway, refund handling or receipt
  emails.
- **Demo Administrator is not available.** The `demo_admin` role and its policies are
  written (`docs/database/demo-admin-lovable-prompt.md`) but not yet applied; its sign-in
  option is hidden until then.
- **Payment expiry is enforced on use.** Expired unpaid bookings stop blocking cars
  immediately, but their status changes to `cancelled` only when a customer or administrator
  next loads them. There is no scheduled job.
- **Demo Customer accounts** are created without a limit on a public deployment and need the
  service-role key, so they do not work in a local environment without it.
- **Car images** are an image URL or a stock photo for the car's category; there is no
  image upload.
- Only email and password sign-in is supported, in Thai only.

## Future improvements

- Apply the Demo Administrator migration and enable its sign-in.
- Integrate a real payment provider (for example PromptPay QR and card payments through a
  licensed gateway) with refunds and receipts.
- Scheduled cancellation of expired bookings and automatic car status updates.
- Email notifications for booking confirmation, reminders and contract acceptance.
- Car image upload to storage.
- Rate limiting and automatic clean-up of Demo Customer accounts.
- End-to-end browser tests in CI (for example Playwright) alongside the unit tests.
- English interface option.
