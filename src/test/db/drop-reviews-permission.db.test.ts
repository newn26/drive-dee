// @vitest-environment node
/**
 * Removing the reviews_moderate permission (docs/database/drop-reviews-permission.sql) on
 * the live stack. Real database (PGlite). Fictional people only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestDb, type TestUser, createAdmin, createOwner, createTestDb } from "./harness";
import { ADMIN_PERMISSIONS } from "@/lib/contract-api";

const sql = (f: string) =>
  readFileSync(path.resolve(__dirname, "../../../docs/database", f), "utf8");

const FOUR = ["contracts_manage", "contracts_approve", "bookings_manage", "fleet_manage"];

let db: TestDb;
let owner: TestUser;
let admin: TestUser;

const perms = (table: string, where: string, arg: string) =>
  db.sql<{ permissions: string[] }>(`select permissions from public.${table} where ${where} = $1`, [
    arg,
  ]);
const invite = (email: string, p: string[]) =>
  db.as(owner).sql("select * from public.owner_create_admin_invitation($1, $2)", [email, p]);

beforeAll(async () => {
  db = await createTestDb({ applyLater: true });
  await db.exec(sql("drop-reviews.sql"));
  // Before the change: admins and invitations hold reviews_moderate, like the live data
  owner = await createOwner(db);
  admin = await createAdmin(db);
  await invite("invitee@example.test", [...FOUR, "reviews_moderate"]);
  expect((await perms("admin_members", "user_id", admin.id))[0]!.permissions).toContain(
    "reviews_moderate",
  );

  await db.exec(sql("drop-reviews-permission.sql"));
  await db.exec(sql("drop-reviews-permission.sql")); // re-runnable
}, 60000);
afterAll(() => db.close());

describe("reviews_moderate is gone", () => {
  it("the known list is the 4 remaining permissions, same as the app", async () => {
    const [r] = await db.sql<{ p: string[] }>("select public.admin_permission_list() as p");
    expect(r!.p).toEqual(FOUR);
    expect([...ADMIN_PERMISSIONS]).toEqual(FOUR);
  });

  it("existing admins and invitations lost it and kept everything else", async () => {
    expect((await perms("admin_members", "user_id", admin.id))[0]!.permissions).toEqual(FOUR);
    expect((await perms("admin_members", "user_id", owner.id))[0]!.permissions).toEqual(FOUR);
    expect(
      (await perms("admin_invitations", "email", "invitee@example.test"))[0]!.permissions.sort(),
    ).toEqual([...FOUR].sort());
  });

  it("the Owner can no longer grant it, but can grant the others", async () => {
    await expect(invite("next@example.test", ["reviews_moderate"])).rejects.toThrow(
      /มีสิทธิ์ที่ไม่รู้จัก/,
    );
    await expect(
      db
        .as(owner)
        .sql("select public.owner_set_admin_permissions($1, $2)", [
          admin.id,
          ["fleet_manage", "reviews_moderate"],
        ]),
    ).rejects.toThrow(/มีสิทธิ์ที่ไม่รู้จัก/);
    await expect(invite("next@example.test", ["fleet_manage"])).resolves.toHaveLength(1);
  });

  it("a newly granted admin gets the 4 permissions by default", async () => {
    const fresh = await createAdmin(db);
    expect((await perms("admin_members", "user_id", fresh.id))[0]!.permissions).toEqual(FOUR);
  });

  it("the table constraints reject it", async () => {
    await expect(
      db.sql("update public.admin_members set permissions = $2 where user_id = $1", [
        admin.id,
        ["reviews_moderate"],
      ]),
    ).rejects.toThrow(/admin_members_permissions_check/);
  });
});
