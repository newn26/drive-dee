// @vitest-environment node
/**
 * Proposed migration docs/database/contract-customer-details.sql (D01-D10):
 * licence required to book and on every contract, full customer details and the creator's
 * name snapshotted per contract version. Real database (PGlite), real roles and RLS.
 * Fictional people only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CUSTOMER_DETAILS_SQL,
  type Row,
  type TestDb,
  type TestUser,
  adminCreate,
  adminUpdate,
  allCarIds,
  createAdmin,
  createBooking,
  createTestDb,
  createUser,
  send,
  terms,
} from "./harness";

const ROLLBACK_SQL = path.resolve(
  __dirname,
  "../../../docs/database/contract-customer-details-rollback.sql",
);

let db: TestDb;
let admin: TestUser;
let carol: TestUser;
let dan: TestUser;
let cars: string[];
let slot = 0;
const book = (who: TestUser, d: TestDb = db, carList = cars) =>
  createBooking(
    d,
    who,
    carList[slot % carList.length]!,
    3 + 4 * Math.floor(slot++ / carList.length),
    2,
  );

const setProfile = (id: string, col: string, value: string) =>
  db.sql(`update public.profiles set ${col} = $2 where id = $1`, [id, value]);

async function versionRow(contractId: string, version = 1): Promise<Row> {
  const [v] = await db.sql(
    "select * from public.contract_versions where contract_id = $1 and version = $2",
    [contractId, version],
  );
  return v!;
}

beforeAll(async () => {
  db = await createTestDb({ extraSql: [CUSTOMER_DETAILS_SQL] });
  admin = await createAdmin(db);
  await setProfile(admin.id, "full_name", "ทดสอบ แอดมินหนึ่ง");
  carol = await createUser(db, {
    name: "ทดสอบ ลูกค้าซี",
    phone: "0800000003",
    licence: "TEST-0003",
    email: "carol@example.test",
  });
  await setProfile(carol.id, "address", "ที่อยู่ทดสอบ 1");
  await setProfile(carol.id, "id_card_no", "FAKE-ID-0003");
  dan = await createUser(db, { name: "ทดสอบ ลูกค้าดี" });
  cars = await allCarIds(db);
}, 60000);
afterAll(() => db.close());

describe("licence required to book", () => {
  it("D01 a booking without a licence is refused, also when it is only spaces", async () => {
    await expect(book(dan)).rejects.toThrow(/กรุณากรอกเลขใบอนุญาตขับขี่ในโปรไฟล์ก่อนจองรถ/);
    await setProfile(dan.id, "license_no", "   ");
    await expect(book(dan)).rejects.toThrow(/กรุณากรอกเลขใบอนุญาตขับขี่ในโปรไฟล์ก่อนจองรถ/);
  });

  it("D02 a booking with a licence works", async () => {
    await expect(book(carol)).resolves.toMatchObject({ id: expect.any(String) });
  });
});

describe("contract snapshot", () => {
  it("D03 the licence is always on the contract, even when licence=false is passed", async () => {
    const b = await book(carol);
    const id = await adminCreate(db, admin, b.id, terms(b, { licence: false }));
    expect(await versionRow(id)).toMatchObject({ customer_license_no: "TEST-0003" });

    await setProfile(carol.id, "license_no", "   ");
    try {
      await expect(adminUpdate(db, admin, id, terms(b))).rejects.toThrow(
        /ลูกค้ายังไม่ได้กรอกเลขใบอนุญาตขับขี่/,
      );
    } finally {
      await setProfile(carol.id, "license_no", "TEST-0003");
    }
  });

  it("D04 email, address, ID and the creator's name are stored; blanks become null", async () => {
    const b = await book(carol);
    const id = await adminCreate(db, admin, b.id, terms(b));
    expect(await versionRow(id)).toMatchObject({
      customer_email: "carol@example.test",
      customer_address: "ที่อยู่ทดสอบ 1",
      customer_id_card_no: "FAKE-ID-0003",
      created_by_name: "ทดสอบ แอดมินหนึ่ง",
    });

    await setProfile(carol.id, "address", "  ");
    await setProfile(carol.id, "id_card_no", "");
    try {
      const b2 = await book(carol);
      const id2 = await adminCreate(db, admin, b2.id, terms(b2));
      expect(await versionRow(id2)).toMatchObject({
        customer_address: null,
        customer_id_card_no: null,
      });
    } finally {
      await setProfile(carol.id, "address", "ที่อยู่ทดสอบ 1");
      await setProfile(carol.id, "id_card_no", "FAKE-ID-0003");
    }
  });

  it("D05 the contract text has the new lines, and leaves out empty ones", async () => {
    const b = await book(carol);
    const id = await adminCreate(db, admin, b.id, terms(b));
    const text = String((await versionRow(id))["terms"]);
    for (const line of [
      "อีเมล: carol@example.test",
      "ที่อยู่: ที่อยู่ทดสอบ 1",
      "เลขบัตรประชาชน/พาสปอร์ต: FAKE-ID-0003",
      "เลขที่ใบอนุญาตขับขี่: TEST-0003",
      "ผู้จัดทำสัญญา: ทดสอบ แอดมินหนึ่ง",
    ])
      expect(text).toContain(line);

    await setProfile(carol.id, "address", "");
    try {
      const b2 = await book(carol);
      const id2 = await adminCreate(db, admin, b2.id, terms(b2));
      expect(String((await versionRow(id2))["terms"])).not.toContain("ที่อยู่:");
    } finally {
      await setProfile(carol.id, "address", "ที่อยู่ทดสอบ 1");
    }
  });

  it("D06 the new fields of a sent version cannot be changed", async () => {
    const b = await book(carol);
    const id = await adminCreate(db, admin, b.id, terms(b));
    await send(db, admin, id);
    for (const col of [
      "customer_email",
      "customer_address",
      "customer_id_card_no",
      "created_by_name",
    ]) {
      await expect(
        db.sql(
          `update public.contract_versions set ${col} = 'แก้ไข' where contract_id = $1 and version = 1`,
          [id],
        ),
      ).rejects.toThrow(/สัญญาฉบับที่ส่งให้ลูกค้าแล้วแก้ไขไม่ได้/);
    }
  });

  it("D07 editing the profile after sending does not change the sent version", async () => {
    const b = await book(carol);
    const id = await adminCreate(db, admin, b.id, terms(b));
    await send(db, admin, id);
    await setProfile(carol.id, "address", "ที่อยู่ใหม่ 2");
    try {
      expect(await versionRow(id)).toMatchObject({ customer_address: "ที่อยู่ทดสอบ 1" });
    } finally {
      await setProfile(carol.id, "address", "ที่อยู่ทดสอบ 1");
    }
  });

  it("D08 the creator stays on an in-place draft edit; a new version gets its own creator", async () => {
    const admin2 = await createAdmin(db);
    await setProfile(admin2.id, "full_name", "ทดสอบ แอดมินสอง");
    const b = await book(carol);
    const id = await adminCreate(db, admin, b.id, terms(b));

    await adminUpdate(db, admin2, id, terms(b, { extra: "แก้ไขฉบับร่าง" }));
    const v1 = await versionRow(id);
    expect(v1).toMatchObject({ created_by_name: "ทดสอบ แอดมินหนึ่ง" });
    expect(String(v1["terms"])).toContain("ผู้จัดทำสัญญา: ทดสอบ แอดมินหนึ่ง");

    await send(db, admin, id);
    expect(await adminUpdate(db, admin2, id, terms(b, { extra: "ฉบับใหม่" }))).toBe(2);
    expect(await versionRow(id, 2)).toMatchObject({ created_by_name: "ทดสอบ แอดมินสอง" });
  });

  it("D09 an admin without a profile name is shown by their admin email", async () => {
    const admin3 = await createAdmin(db);
    await setProfile(admin3.id, "full_name", "");
    const b = await book(carol);
    const id = await adminCreate(db, admin3, b.id, terms(b));
    expect(await versionRow(id)).toMatchObject({ created_by_name: admin3.email });
  });
});

describe("rollback", () => {
  it("D10 the rollback script restores the 0004 behaviour", async () => {
    const rdb = await createTestDb({ extraSql: [CUSTOMER_DETAILS_SQL] });
    try {
      await rdb.exec(readFileSync(ROLLBACK_SQL, "utf8"));
      const radmin = await createAdmin(rdb);
      const noLicence = await createUser(rdb, { name: "ทดสอบ ลูกค้าอี" });
      const rcars = await allCarIds(rdb);
      const b = await createBooking(rdb, noLicence, rcars[0]!, 3, 2);
      const id = await adminCreate(rdb, radmin, b.id, terms(b, { licence: false }));
      const [v] = await rdb.sql("select * from public.contract_versions where contract_id = $1", [
        id,
      ]);
      expect(v).toMatchObject({ customer_license_no: null });
      expect(String(v!["terms"])).not.toContain("ผู้จัดทำสัญญา");
    } finally {
      await rdb.close();
    }
  }, 60000);
});
