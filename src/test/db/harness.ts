/**
 * Isolated test database for the contract workflow and admin permission tests.
 *
 * Each call to createTestDb() boots a fresh, in-memory PostgreSQL (PGlite) that lives only
 * for the test file. It never connects to the live Supabase/Lovable project.
 *
 * It stubs the parts of Supabase the migrations rely on (auth.users, auth.uid(), the
 * anon/authenticated/service_role roles and Supabase's default grants), applies
 * drizzle/migrations 0000-0003 in order, then 0004 (the contract-workflow migration).
 * Queries made through `as(user)` really run as the `authenticated` role with a JWT `sub`
 * claim, so grants, RLS policies and security-definer functions are all exercised.
 *
 * All people in these tests are fictional.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS_DIR = path.join(ROOT, "drizzle/migrations");
/** The contract-workflow migration (applied to production as 0004). */
const WORKFLOW_MIGRATION_FILE = "0004_contract_approval_workflow.sql";
/** The migration under test; CONTRACT_MIGRATION_SQL swaps in another file (mutation tests). */
export const PROPOSED_MIGRATION =
  process.env["CONTRACT_MIGRATION_SQL"] ?? path.join(MIGRATIONS_DIR, WORKFLOW_MIGRATION_FILE);

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants everything in public to the API roles; RLS is the guard.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export type Row = Record<string, unknown>;
export type Actor = { id: string } | "anon";

export type TestDb = {
  /** Superuser (like the SQL editor): no auth.uid(), bypasses RLS. Test setup only. */
  sql: <T = Row>(query: string, params?: unknown[]) => Promise<T[]>;
  /** Runs as an API user: role `authenticated` with that JWT sub, or `anon`. */
  as: (actor: Actor) => { sql: <T = Row>(query: string, params?: unknown[]) => Promise<T[]> };
  /** Superuser, multi-statement script (e.g. a rollback file). */
  exec: (script: string) => Promise<void>;
  close: () => Promise<void>;
};

export type CreateOptions = {
  /** Applied after 0000-0003 and before the proposed migration (for legacy-data tests). */
  beforeProposed?: (db: TestDb) => Promise<void>;
  /** Default true. */
  applyProposed?: boolean;
  /** Extra SQL files applied last (e.g. a follow-up migration not yet in drizzle/migrations). */
  after?: string[];
};

/** Follow-up migration: customer accepts the contract, no Admin review (not yet applied live). */
export const SELF_ACCEPT_MIGRATION = path.join(
  ROOT,
  "docs/database/customer-self-accept-contract.sql",
);

export async function createTestDb(options: CreateOptions = {}): Promise<TestDb> {
  const pg = new PGlite();
  await pg.exec(SUPABASE_STUB);

  // Every migration before the workflow one; the workflow migration is applied below,
  // after the optional legacy-data hook (later migrations, if any, would follow it).
  const all = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const files = all.filter((f) => f < WORKFLOW_MIGRATION_FILE);
  const later = all.filter((f) => f > WORKFLOW_MIGRATION_FILE);
  for (const f of files) await pg.exec(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));

  let queue: Promise<unknown> = Promise.resolve();
  // PGlite has one connection: serialise role switches so queries never interleave.
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  const raw = async <T>(query: string, params: unknown[] = []) =>
    (await pg.query<T>(query, params)).rows;

  const db: TestDb = {
    sql: (query, params) =>
      serial(async () => {
        await pg.exec("reset role; select set_config('request.jwt.claims', '', false);");
        return raw(query, params);
      }),
    as: (actor) => ({
      sql: (query, params) =>
        serial(async () => {
          const claims =
            actor === "anon" ? { role: "anon" } : { sub: actor.id, role: "authenticated" };
          await pg.query("select set_config('request.jwt.claims', $1, false)", [
            JSON.stringify(claims),
          ]);
          await pg.exec(actor === "anon" ? "set role anon" : "set role authenticated");
          try {
            return await raw(query, params);
          } finally {
            await pg.exec("reset role; select set_config('request.jwt.claims', '', false);");
          }
        }),
    }),
    exec: (script) =>
      serial(async () => {
        await pg.exec("reset role; select set_config('request.jwt.claims', '', false);");
        await pg.exec(script);
      }),
    close: () => pg.close(),
  };

  if (options.beforeProposed) await options.beforeProposed(db);
  if (options.applyProposed !== false) {
    await pg.exec(readFileSync(PROPOSED_MIGRATION, "utf8"));
    for (const f of later) await pg.exec(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
  }
  for (const f of options.after ?? []) await pg.exec(readFileSync(f, "utf8"));
  return db;
}

// ---------------------------------------------------------------------------
// Fixtures (fictional data only)
// ---------------------------------------------------------------------------

let seq = 0;

export type TestUser = { id: string; email: string };

export async function createUser(
  db: TestDb,
  opts: { name?: string; phone?: string; licence?: string; email?: string; demo?: boolean } = {},
): Promise<TestUser> {
  seq += 1;
  const email = opts.email ?? `test-user-${seq}@example.test`;
  const [u] = await db.sql<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data)
     values ($1, $2::jsonb, $3::jsonb) returning id`,
    [
      email,
      JSON.stringify({
        full_name: opts.name ?? `ทดสอบ ลูกค้า${seq}`,
        phone: opts.phone ?? "000-000-0000",
      }),
      JSON.stringify(opts.demo ? { demo: true } : {}),
    ],
  );
  if (opts.licence)
    await db.sql("update public.profiles set license_no = $2 where id = $1", [u!.id, opts.licence]);
  return { id: u!.id, email };
}

/** Grants admin the way the SQL editor would (the only path besides an invitation). */
export async function createAdmin(
  db: TestDb,
  opts: { permissions?: string[] } = {},
): Promise<TestUser> {
  const u = await createUser(db, { name: "ทดสอบ แอดมิน" });
  await db.sql("insert into public.user_roles (user_id, role) values ($1, 'admin')", [u.id]);
  if (opts.permissions) {
    await db.sql("update public.admin_members set permissions = $2 where user_id = $1", [
      u.id,
      opts.permissions,
    ]);
  }
  return u;
}

export async function createOwner(db: TestDb): Promise<TestUser> {
  const u = await createAdmin(db);
  await db.sql("select public.bootstrap_owner($1)", [u.email]);
  return u;
}

/** Bangkok calendar date `days` from today, as YYYY-MM-DD. */
export async function bkkDate(db: TestDb, days: number): Promise<string> {
  const [r] = await db.sql<{ d: string }>(
    "select ((now() at time zone 'Asia/Bangkok')::date + $1::int)::text as d",
    [days],
  );
  return r!.d;
}

export async function carId(db: TestDb, plate: string): Promise<string> {
  const [r] = await db.sql<{ id: string }>("select id from public.cars where plate_no = $1", [
    plate,
  ]);
  return r!.id;
}

/** Every seeded car, so each test can use a car nobody else in the file has booked. */
export async function allCarIds(db: TestDb): Promise<string[]> {
  return (await db.sql<{ id: string }>("select id from public.cars order by plate_no")).map(
    (r) => r.id,
  );
}

export type Booking = {
  id: string;
  start_date: string;
  end_date: string;
  total_amount: string;
  hold_expires_at: Date | null;
};

export async function createBooking(
  db: TestDb,
  customer: TestUser,
  car: string,
  startOffset = 3,
  nights = 2,
): Promise<Booking> {
  const start = await bkkDate(db, startOffset);
  const end = await bkkDate(db, startOffset + nights);
  const [b] = await db.as(customer).sql<Booking>(
    `insert into public.bookings (user_id, car_id, start_date, end_date, days, total_amount)
     values ($1, $2, $3, $4, 0, 0)
     returning id, start_date::text, end_date::text, total_amount::text`,
    [customer.id, car, start, end],
  );
  // hold_expires_at only exists once the proposed migration is applied (legacy tests run before it)
  const [h] = await db.sql<{ h: Date | null }>(
    "select (to_jsonb(b) ->> 'hold_expires_at')::timestamptz as h from public.bookings b where id = $1",
    [b!.id],
  );
  return { ...b!, hold_expires_at: h!.h };
}

/** Standard contract terms for a booking: pickup 10:00, return 18:00 Bangkok time. */
export function terms(b: Booking, over: Partial<ContractInput> = {}): ContractInput {
  return {
    pickup: `${b.start_date} 10:00:00+07`,
    ret: `${b.end_date} 18:00:00+07`,
    deposit: 5000,
    mileage: "ไม่จำกัดระยะทาง",
    late: "500 บาท / ชั่วโมง",
    extra: "",
    licence: false,
    ...over,
  };
}

export type ContractInput = {
  pickup: string;
  ret: string;
  deposit: number;
  mileage: string;
  late: string;
  extra: string;
  licence: boolean;
};

export async function adminCreate(
  db: TestDb,
  admin: TestUser,
  bookingId: string,
  t: ContractInput,
): Promise<string> {
  const [r] = await db
    .as(admin)
    .sql<{ id: string }>(
      "select public.admin_create_contract($1, $2, $3, $4, $5, $6, $7, $8) as id",
      [bookingId, t.pickup, t.ret, t.deposit, t.mileage, t.late, t.extra, t.licence],
    );
  return r!.id;
}

export async function adminUpdate(
  db: TestDb,
  admin: TestUser,
  contractId: string,
  t: ContractInput,
): Promise<number> {
  const [r] = await db
    .as(admin)
    .sql<{ v: number }>(
      "select public.admin_update_contract($1, $2, $3, $4, $5, $6, $7, $8) as v",
      [contractId, t.pickup, t.ret, t.deposit, t.mileage, t.late, t.extra, t.licence],
    );
  return r!.v;
}

export const send = (db: TestDb, admin: TestUser, contractId: string) =>
  db.as(admin).sql("select public.admin_send_contract($1)", [contractId]);
export const accept = (db: TestDb, customer: Actor, contractId: string, version: number) =>
  db.as(customer).sql("select public.customer_accept_contract($1, $2)", [contractId, version]);
export const approve = (db: TestDb, admin: Actor, contractId: string, version: number) =>
  db.as(admin).sql("select public.admin_approve_contract($1, $2)", [contractId, version]);
export const pay = (
  db: TestDb,
  customer: Actor,
  bookingId: string,
  method: "qr" | "card",
  last4?: string,
) =>
  db
    .as(customer)
    .sql<{ id: string }>("select public.pay_booking($1, $2::payment_method, $3) as id", [
      bookingId,
      method,
      last4 ?? null,
    ]);

/** Booking → contract → sent → accepted → approved. Returns ids. */
export async function approvedContract(
  db: TestDb,
  admin: TestUser,
  customer: TestUser,
  car: string,
  startOffset = 3,
) {
  const booking = await createBooking(db, customer, car, startOffset);
  const contractId = await adminCreate(db, admin, booking.id, terms(booking));
  await send(db, admin, contractId);
  await accept(db, customer, contractId, 1);
  await approve(db, admin, contractId, 1);
  return { booking, contractId };
}

export async function contractRow(db: TestDb, id: string) {
  const [r] = await db.sql<Row>("select * from public.contracts where id = $1", [id]);
  return r!;
}

export async function bookingRow(db: TestDb, id: string) {
  const [r] = await db.sql<Row>("select * from public.bookings where id = $1", [id]);
  return r!;
}

/** Moves a booking's hold into the past (test-only, as superuser through the workflow flag). */
export async function expireHold(db: TestDb, bookingId: string) {
  // One statement: the CTE sets the transaction-local flag before the row is updated.
  await db.sql(
    `with f as (select set_config('app.contract_workflow', 'on', true) as on_)
     update public.bookings set hold_expires_at = now() - interval '1 minute'
     where id = $1 and exists (select 1 from f)`,
    [bookingId],
  );
}
