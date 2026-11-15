// @vitest-environment node
/**
 * docs/database/0008-backfill-migration.sql is the 9 directly applied docs/database files,
 * verbatim and in order. Running it on a database that already has them (production)
 * must change nothing, and running it instead of them must give the same schema.
 * Real database (PGlite).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestDb, createTestDb } from "./harness";

const dir = path.resolve(__dirname, "../../../docs/database");
const read = (f: string) => readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");

const BACKFILL_FILES = [
  "revision-limits.sql",
  "pickup-day-status.sql",
  "pickup-payment.sql",
  "pickup-refund.sql",
  "pickup-at-handover.sql",
  "input-validation.sql",
  "booking-documents.sql",
  "drop-reviews.sql",
  "drop-reviews-permission.sql",
];
const BACKFILL = "0008-backfill-migration.sql";

/** Everything in schema public that a migration can change, as comparable text. */
const FINGERPRINT_SQL = `
select 'fn ' || p.oid::regprocedure::text || ' ' || md5(replace(p.prosrc, chr(13), ''))
       || ' secdef=' || p.prosecdef || ' cfg=' || coalesce(array_to_string(p.proconfig, ','), '')
       || ' acl=' || coalesce(array_to_string(p.proacl, ','), '') as x
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
union all
select 'con ' || conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid)
  from pg_constraint where connamespace = 'public'::regnamespace
union all
select 'idx ' || indexname || ' ' || indexdef from pg_indexes where schemaname = 'public'
union all
select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' null=' || is_nullable
       || ' def=' || coalesce(column_default, '')
  from information_schema.columns where table_schema = 'public'
union all
select 'pol ' || tablename || '.' || policyname || ' ' || cmd || ' ' || coalesce(qual, '')
       || ' ' || coalesce(with_check, '')
  from pg_policies where schemaname = 'public'
union all
select 'trg ' || c.relname || '.' || t.tgname || ' ' || pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
union all
select 'tbl ' || c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
order by 1`;

const fingerprint = async (db: TestDb) =>
  (await db.sql<{ x: string }>(FINGERPRINT_SQL)).map((r) => r.x);

let sequential: TestDb;
let backfilled: TestDb;

beforeAll(async () => {
  // Production: 0000-0007, then the 9 files one by one, then the new migration on top
  sequential = await createTestDb({ applyLater: true });
  for (const f of BACKFILL_FILES) await sequential.exec(read(f));
  // A database built from migrations only: 0000-0007, then 0008
  backfilled = await createTestDb({ applyLater: true });
  await backfilled.exec(read(BACKFILL));
}, 120000);
afterAll(async () => {
  await sequential.close();
  await backfilled.close();
});

describe("0008 backfill migration", () => {
  it("is exactly the 9 files, in the order they were applied", () => {
    const text = read(BACKFILL);
    let at = 0;
    for (const f of BACKFILL_FILES) {
      const body = read(f).replace(/\n+$/, "");
      const i = text.indexOf(body, at);
      expect(i, f).toBeGreaterThanOrEqual(at);
      at = i + body.length;
    }
  });

  it("gives the same schema as applying the 9 files one by one", async () => {
    expect(await fingerprint(backfilled)).toEqual(await fingerprint(sequential));
  });

  it("changes nothing on production (where the files already ran)", async () => {
    const before = await fingerprint(sequential);
    await sequential.exec(read(BACKFILL));
    expect(await fingerprint(sequential)).toEqual(before);
  });
});
