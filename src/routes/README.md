# Routes

Pages use TanStack Router file-based routing: each `.tsx` file in this folder is one route.
`__root.tsx` is the only root layout (document shell, header, error and not-found pages)
and must keep its `<Outlet />`. `routeTree.gen.ts` is generated from these files; do not
edit it by hand.

## Application routes

| File | URL | Access |
| --- | --- | --- |
| `index.tsx` | `/` | Public: home page and date search |
| `cars.tsx` | `/cars` | Public: search by dates, category and price |
| `cars_.$id.tsx` | `/cars/:id` | Public: car details and reviews; booking requires sign-in |
| `auth.tsx` | `/auth` | Sign-in, registration, password reset, Demo Customer |
| `dashboard.tsx` | `/dashboard` | Signed-in user |
| `bookings.tsx` | `/bookings` | Signed-in user: booking history, cancellation, reviews |
| `bookings_.$id.tsx` | `/bookings/:id` | Signed-in owner: payment, contract, printing |
| `profile.tsx` | `/profile` | Signed-in user |
| `admin.tsx` | `/admin` | `admin` role only |
| `demo-admin.tsx` | `/demo-admin` | `demo_admin` role only (role not yet created in the database) |

A trailing underscore (`cars_`, `bookings_`) makes the detail page a sibling of the list page
instead of a nested child, so it renders without the list page's layout.

## Conventions

- Dynamic segments use a bare `$`, for example `$id.tsx` → `:id`.
- Every page sets its own `head()` title, ending in `— Drive Dee` (the brand). The home page
  title also names the system, Siam Wheels Rental Hub.
- Do not add `src/pages/` or `app/layout.tsx`; those belong to other frameworks.
