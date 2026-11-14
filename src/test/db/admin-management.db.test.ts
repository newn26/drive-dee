// @vitest-environment node
/**
 * Owner / admin management (M02-M15): invitations, permissions, suspension, revocation,
 * audit log and privilege-escalation guards. Real database (PGlite). Fictional people only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type TestDb,
  type TestUser,
  accept,
  adminCreate,
  allCarIds,
  approve,
  createAdmin,
  createBooking,
  createOwner,
  createTestDb,
  createUser,
  send,
  terms,
} from "./harness";

let db: TestDb;
let owner: TestUser;
let admin: TestUser;
let cars: string[];
let slot = 0;
const nextOffset = () => 3 + 4 * slot++;

type Invite = { invitation_id: string; invite_token: string; invite_expires_at: Date };
const invite = async (by: TestUser, email: string, perms: string[]) =>
  (
    await db
      .as(by)
      .sql<Invite>("select * from public.owner_create_admin_invitation($1, $2)", [email, perms])
  )[0]!;
const acceptInvite = (who: TestUser, token: string) =>
  db.as(who).sql("select public.accept_admin_invitation($1)", [token]);
const isAdmin = async (u: TestUser) =>
  (await db.sql<{ r: boolean }>("select public.has_role($1, 'admin') as r", [u.id]))[0]!.r;
const member = async (u: TestUser) =>
  (
    await db.sql<Record<string, unknown>>("select * from public.admin_members where user_id = $1", [
      u.id,
    ])
  )[0];
const auditActions = async () =>
  (
    await db.sql<{ action: string }>(
      "select action from public.admin_audit_log order by created_at",
    )
  ).map((r) => r.action);

beforeAll(async () => {
  db = await createTestDb({ laterMigrations: false });
  owner = await createOwner(db);
  admin = await createAdmin(db);
  cars = await allCarIds(db);
}, 60000);
afterAll(() => db.close());

describe("owner bootstrap", () => {
  it("M02 there is exactly one Owner and admins are not Owners", async () => {
    expect(
      (await db.sql("select user_id from public.admin_members where is_owner")).map(
        (r) => r["user_id"],
      ),
    ).toEqual([owner.id]);
    expect((await member(admin))!["is_owner"]).toBe(false);
  });

  it("M03 bootstrap_owner is SQL-editor only and only once", async () => {
    await expect(
      db.as(admin).sql("select public.bootstrap_owner($1)", [admin.email]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.sql("select public.bootstrap_owner($1)", [admin.email])).rejects.toThrow(
      /มีเจ้าของระบบแล้ว/,
    );
  });
});

describe("invitations", () => {
  it("M04 the Owner creates an invitation; only a hash of the token is stored", async () => {
    const inv = await invite(owner, "New.Admin1@Example.test", ["contracts_manage"]);
    expect(inv.invite_token).toMatch(/^[0-9a-f]{64}$/);
    const [row] = await db.sql<{ email: string; token_hash: string }>(
      "select email, token_hash from public.admin_invitations where id = $1",
      [inv.invitation_id],
    );
    expect(row!.email).toBe("new.admin1@example.test");
    expect(row!.token_hash).not.toBe(inv.invite_token);
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    const hours = (new Date(inv.invite_expires_at).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
  });

  it("M05 the invited user accepts and becomes an admin with exactly the invited permissions", async () => {
    const u = await createUser(db, { email: "new.admin2@example.test" });
    const inv = await invite(owner, u.email, ["contracts_manage", "fleet_manage"]);
    await acceptInvite(u, inv.invite_token);
    expect(await isAdmin(u)).toBe(true);
    expect(await member(u)).toMatchObject({
      status: "active",
      is_owner: false,
      permissions: ["contracts_manage", "fleet_manage"],
      invited_by: owner.id,
    });
    expect(await auditActions()).toContain("invite_accepted");
  });

  it("M06 wrong account, reused, revoked or expired tokens are rejected", async () => {
    const u = await createUser(db, { email: "new.admin3@example.test" });
    const other = await createUser(db, { email: "someone.else@example.test" });
    const inv = await invite(owner, u.email, ["fleet_manage"]);
    await expect(acceptInvite(other, inv.invite_token)).rejects.toThrow(/คำเชิญไม่ถูกต้อง/);
    await expect(acceptInvite(u, "0".repeat(64))).rejects.toThrow(/คำเชิญไม่ถูกต้อง/);
    await acceptInvite(u, inv.invite_token);
    await expect(acceptInvite(u, inv.invite_token)).rejects.toThrow(/คำเชิญไม่ถูกต้อง/); // reused

    const v = await createUser(db, { email: "new.admin4@example.test" });
    const revoked = await invite(owner, v.email, ["fleet_manage"]);
    await db
      .as(owner)
      .sql("select public.owner_revoke_admin_invitation($1)", [revoked.invitation_id]);
    await expect(acceptInvite(v, revoked.invite_token)).rejects.toThrow(/คำเชิญไม่ถูกต้อง/);

    const expired = await invite(owner, v.email, ["fleet_manage"]);
    await db.sql(
      "update public.admin_invitations set expires_at = now() - interval '1 minute' where id = $1",
      [expired.invitation_id],
    );
    await expect(acceptInvite(v, expired.invite_token)).rejects.toThrow(/คำเชิญไม่ถูกต้อง/);
    expect(await isAdmin(v)).toBe(false);
  });

  it("M07 demo accounts can neither be invited nor accept", async () => {
    await expect(invite(owner, "x@demo.siamwheels.invalid", ["fleet_manage"])).rejects.toThrow(
      /บัญชีสาธิต/,
    );
    const d = await createUser(db, { email: "demo.flag@example.test", demo: true });
    const inv = await invite(owner, d.email, ["fleet_manage"]);
    await expect(acceptInvite(d, inv.invite_token)).rejects.toThrow(/บัญชีสาธิต/);
    expect(await isAdmin(d)).toBe(false);
  });

  it("M08 a non-Owner admin cannot manage admins", async () => {
    await expect(invite(admin, "sneaky@example.test", ["fleet_manage"])).rejects.toThrow(
      /เฉพาะเจ้าของระบบ/,
    );
    await expect(
      db
        .as(admin)
        .sql("select public.owner_set_admin_permissions($1, $2)", [
          admin.id,
          ["contracts_approve"],
        ]),
    ).rejects.toThrow(/เฉพาะเจ้าของระบบ/);
    await expect(
      db
        .as(admin)
        .sql("select public.owner_set_admin_status($1, 'suspended', 'ทดสอบสิทธิ์')", [owner.id]),
    ).rejects.toThrow(/เฉพาะเจ้าของระบบ/);
    expect(await db.as(admin).sql("select id from public.admin_audit_log")).toHaveLength(0);
    expect(await db.as(admin).sql("select id from public.admin_invitations")).toHaveLength(0);
  });
});

describe("privilege escalation", () => {
  it("M09 nobody can grant themselves admin or edit member rows through the API", async () => {
    const c = await createUser(db);
    await expect(
      db.as(c).sql("insert into public.user_roles (user_id, role) values ($1, 'admin')", [c.id]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db
        .as(admin)
        .sql("update public.admin_members set is_owner = true where user_id = $1", [admin.id]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db
        .as(admin)
        .sql("update public.admin_members set permissions = $2 where user_id = $1", [
          admin.id,
          ["contracts_approve"],
        ]),
    ).rejects.toThrow(/permission denied/);
    expect(await isAdmin(c)).toBe(false);
  });

  it("M09b even a security-definer path cannot insert an admin role for a signed-in user without an invitation", async () => {
    const c = await createUser(db);
    // Simulates a future buggy function: a signed-in context inserting directly
    await expect(
      db.sql(
        `with s as (select set_config('request.jwt.claims', $2, true) as x)
         insert into public.user_roles (user_id, role) select $1, 'admin' from s`,
        [c.id, JSON.stringify({ sub: c.id })],
      ),
    ).rejects.toThrow(/ผ่านคำเชิญจากเจ้าของระบบเท่านั้น/);
  });

  it("M12 the Owner cannot be suspended or modified, and cannot suspend themselves", async () => {
    await expect(
      db
        .as(owner)
        .sql("select public.owner_set_admin_status($1, 'suspended', 'ทดสอบตัวเอง')", [owner.id]),
    ).rejects.toThrow(/ของตนเองไม่ได้/);
    await expect(
      db
        .as(owner)
        .sql("select public.owner_set_admin_permissions($1, $2)", [owner.id, ["fleet_manage"]]),
    ).rejects.toThrow(/เจ้าของระบบเปลี่ยนไม่ได้/);
  });
});

describe("suspension, revocation and permissions", () => {
  it("M10 a suspended admin loses admin access everywhere; reactivation restores it", async () => {
    const a = await createAdmin(db);
    const cust = await createUser(db);
    const b = await createBooking(db, cust, cars[0]!, nextOffset());
    await db
      .as(owner)
      .sql("select public.owner_set_admin_status($1, 'suspended', 'ทดสอบการระงับ')", [a.id]);
    expect(await isAdmin(a)).toBe(false);
    expect(await db.as(a).sql("select id from public.bookings where id = $1", [b.id])).toHaveLength(
      0,
    );
    await expect(adminCreate(db, a, b.id, terms(b))).rejects.toThrow(/ไม่มีสิทธิ์/);
    await expect(
      db.as(a).sql("update public.cars set price_per_day = 1 where plate_no = '1กข 1234'"),
    ).resolves.toEqual([]);
    expect(
      (await db.sql("select price_per_day from public.cars where plate_no = '1กข 1234'"))[0]![
        "price_per_day"
      ],
    ).not.toBe("1.00");

    await db
      .as(owner)
      .sql("select public.owner_set_admin_status($1, 'active', 'คืนสิทธิ์หลังทดสอบ')", [a.id]);
    expect(await isAdmin(a)).toBe(true);
    expect(await db.as(a).sql("select id from public.bookings where id = $1", [b.id])).toHaveLength(
      1,
    );
  });

  it("M11 revocation removes the admin role and cannot be undone by a status change", async () => {
    const a = await createAdmin(db);
    await db
      .as(owner)
      .sql("select public.owner_set_admin_status($1, 'revoked', 'ทดสอบการเพิกถอน')", [a.id]);
    expect(await isAdmin(a)).toBe(false);
    expect(
      await db.sql("select 1 from public.user_roles where user_id = $1 and role = 'admin'", [a.id]),
    ).toHaveLength(0);
    await expect(
      db.as(owner).sql("select public.owner_set_admin_status($1, 'active', 'กลับมาเอง')", [a.id]),
    ).rejects.toThrow(/เปลี่ยนสถานะจาก revoked/);
    // Only a fresh Owner invitation brings them back
    const inv = await invite(owner, a.email, ["fleet_manage"]);
    await acceptInvite(a, inv.invite_token);
    expect(await member(a)).toMatchObject({ status: "active", permissions: ["fleet_manage"] });
  });

  it("M13 each admin permission is enforced by the database", async () => {
    const cust = await createUser(db);
    const contractsOnly = await createAdmin(db, { permissions: ["contracts_manage"] });
    const b = await createBooking(db, cust, cars[0]!, nextOffset());
    const id = await adminCreate(db, contractsOnly, b.id, terms(b));
    await send(db, contractsOnly, id);
    await accept(db, cust, id, 1);
    await expect(approve(db, contractsOnly, id, 1)).rejects.toThrow(/contracts_approve/);
    await approve(db, admin, id, 1);

    // fleet_manage
    await db
      .as(contractsOnly)
      .sql("update public.cars set price_per_day = 1 where plate_no = '1กข 1234'");
    expect(
      (await db.sql("select price_per_day from public.cars where plate_no = '1กข 1234'"))[0]![
        "price_per_day"
      ],
    ).toBe("990.00");
    await expect(
      db
        .as(contractsOnly)
        .sql(
          "insert into public.maintenance (car_id, title, scheduled_date) values ($1, 'x', current_date)",
          [cars[0]],
        ),
    ).rejects.toThrow(/row-level security/);

    // bookings_manage
    const b2 = await createBooking(db, cust, cars[0]!, nextOffset());
    await expect(
      db
        .as(contractsOnly)
        .sql("update public.bookings set status = 'cancelled' where id = $1", [b2.id]),
    ).rejects.toThrow(/ไม่มีสิทธิ์แก้ไขการจองนี้/);

    // reviews_moderate is checked by the delete policy (no review needed to prove the policy denies)
    const [pol] = await db.sql<{ qual: string }>(
      "select qual from pg_policies where tablename = 'reviews' and policyname = 'reviews delete admin'",
    );
    expect(pol!.qual).toContain("reviews_moderate");
  });

  it("M13b the Owner can change an admin's permissions", async () => {
    const a = await createAdmin(db, { permissions: ["fleet_manage"] });
    await db
      .as(owner)
      .sql("select public.owner_set_admin_permissions($1, $2)", [
        a.id,
        ["contracts_approve", "fleet_manage"],
      ]);
    expect((await member(a))!["permissions"]).toEqual(["contracts_approve", "fleet_manage"]);
    await expect(
      db
        .as(owner)
        .sql("select public.owner_set_admin_permissions($1, $2)", [a.id, ["superpowers"]]),
    ).rejects.toThrow(/มีสิทธิ์ที่ไม่รู้จัก/);
  });

  it("M14 every admin-management action is in the Owner-only, append-only audit log", async () => {
    const actions = await auditActions();
    for (const a of [
      "admin_role_granted",
      "owner_bootstrapped",
      "invite_created",
      "invite_revoked",
      "invite_accepted",
      "permissions_changed",
      "admin_suspended",
      "admin_reactivated",
      "admin_revoked",
    ]) {
      expect(actions, a).toContain(a);
    }
    expect((await db.as(owner).sql("select id from public.admin_audit_log")).length).toBe(
      actions.length,
    );
    await expect(
      db.sql("update public.admin_audit_log set action = 'invite_created'"),
    ).rejects.toThrow(/append-only/);
    await expect(db.sql("delete from public.admin_audit_log")).rejects.toThrow(/append-only/);
  });

  it("M15 a member can read only their own member row; the Owner reads all", async () => {
    expect(await db.as(admin).sql("select user_id from public.admin_members")).toEqual([
      { user_id: admin.id },
    ]);
    expect(
      (await db.as(owner).sql("select user_id from public.admin_members")).length,
    ).toBeGreaterThan(2);
  });

  it("M16 a customer cannot use or read Admin Management", async () => {
    const c = await createUser(db);
    await expect(invite(c, "x@example.test", ["fleet_manage"])).rejects.toThrow(/เฉพาะเจ้าของระบบ/);
    await expect(
      db
        .as(c)
        .sql("select public.owner_set_admin_status($1, 'suspended', 'ทดสอบลูกค้า')", [admin.id]),
    ).rejects.toThrow(/เฉพาะเจ้าของระบบ/);
    await expect(
      db
        .as(c)
        .sql("select public.owner_set_admin_permissions($1, $2)", [admin.id, ["fleet_manage"]]),
    ).rejects.toThrow(/เฉพาะเจ้าของระบบ/);
    expect(await db.as(c).sql("select user_id from public.admin_members")).toEqual([]);
    expect(await db.as(c).sql("select id from public.admin_invitations")).toEqual([]);
    expect(await db.as(c).sql("select id from public.admin_audit_log")).toEqual([]);
    await expect(acceptInvite(c, "f".repeat(64))).rejects.toThrow(/คำเชิญไม่ถูกต้อง/);
    expect(await isAdmin(c)).toBe(false);
  });
});
