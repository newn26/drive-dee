/**
 * In-browser sandbox for the public Demo Admin page.
 *
 * A tiny stand-in for the Supabase client (from().select/insert/update/delete and the admin
 * RPCs) over fictional sample data held in memory. Nothing here reads or writes the real
 * database; a page reload starts a fresh sandbox. The rules mirror the database loosely
 * (enough for a demo), the real rules stay in the database for real accounts.
 */
import { BOOKING_FEE } from "@/lib/booking-fee";
import { todayBkk } from "@/lib/format";
import { tr } from "@/lib/i18n";

// Sample rows are loosely typed on purpose: this is a demo stand-in, not the real schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
const TABLE_NAMES = [
  "cars",
  "profiles",
  "user_roles",
  "bookings",
  "payments",
  "contracts",
  "contract_versions",
  "contract_events",
  "maintenance",
  "admin_members",
  "admin_invitations",
  "admin_audit_log",
] as const;
type TableName = (typeof TABLE_NAMES)[number];
type Tables = Record<TableName, Row[]>;
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number };

export const SANDBOX_OWNER_ID = "demo-owner-0000";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Bangkok date `days` from today (YYYY-MM-DD). */
const day = (days: number) => todayBkk(days);
const at = (date: string, time: string) => `${date}T${time}:00+07:00`;
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY) + 1;

// ----------------------------------------------------------------- sample data

function sampleData(): Tables {
  const cars: Row[] = [
    ["Toyota", "Yaris Ativ", 2024, "eco", 990, "1กข 1001", "เบนซิน"],
    ["Honda", "City e:HEV", 2024, "eco", 1290, "1กข 1002", "ไฮบริด"],
    ["BYD", "Atto 3", 2024, "ev", 1890, "1กข 1003", "ไฟฟ้า"],
    ["Mazda", "CX-5", 2023, "suv", 2190, "1กข 1004", "เบนซิน"],
    ["Honda", "Accord", 2023, "sedan", 2290, "1กข 1005", "ไฮบริด"],
    ["Toyota", "Camry HEV", 2023, "sedan", 2490, "1กข 1006", "ไฮบริด"],
    ["Toyota", "Fortuner", 2023, "suv", 2890, "1กข 1007", "ดีเซล"],
    ["Toyota", "Commuter", 2022, "van", 3490, "1กข 1008", "ดีเซล"],
  ].map(([brand, model, year, category, price, plate, fuel], i) => ({
    id: `car-${i + 1}`,
    brand,
    model,
    year,
    category,
    price_per_day: price,
    plate_no: `[DEMO] ${plate}`,
    seats: category === "van" ? 12 : category === "suv" ? 7 : 5,
    transmission: "อัตโนมัติ",
    fuel,
    mileage: 12000 + i * 3500,
    status: i === 6 ? "maintenance" : "available",
    image_url: null,
    description: "รถตัวอย่างสำหรับโหมดสาธิต",
    created_at: iso(-60 * DAY + i * DAY),
  }));

  const people = [
    ["cust-1", "[ตัวอย่าง] สมชาย ใจดี", "0810000001"],
    ["cust-2", "[ตัวอย่าง] สมหญิง รักรถ", "0810000002"],
    ["cust-3", "[ตัวอย่าง] วิชัย เดินทาง", "0810000003"],
    ["cust-4", "[ตัวอย่าง] มาลี สบายดี", "0810000004"],
    ["cust-5", "[ตัวอย่าง] John Sample", "0810000005"],
    ["cust-6", "[ตัวอย่าง] อารีย์ ทดลอง", "0810000006"],
  ];
  const profiles: Row[] = people.map(([id, name, phone], i) => ({
    id,
    full_name: name,
    phone,
    address: `${10 + i} ถนนตัวอย่าง เขตสาธิต กรุงเทพฯ 10000`,
    id_card_no: `DEMO1000${i}`,
    license_no: `DEMO20000${i}`,
    created_at: iso(-50 * DAY + i * 3 * DAY),
    updated_at: iso(-50 * DAY + i * 3 * DAY),
  }));
  profiles.push(
    {
      id: SANDBOX_OWNER_ID,
      full_name: "[ตัวอย่าง] เจ้าของระบบ",
      phone: "0820000000",
      address: "",
      id_card_no: "",
      license_no: "",
      created_at: iso(-90 * DAY),
      updated_at: iso(-90 * DAY),
    },
    {
      id: "demo-admin-2",
      full_name: "[ตัวอย่าง] พนักงานสาขา",
      phone: "0820000001",
      address: "",
      id_card_no: "",
      license_no: "",
      created_at: iso(-80 * DAY),
      updated_at: iso(-80 * DAY),
    },
    {
      id: "demo-admin-3",
      full_name: "[ตัวอย่าง] พนักงานพักงาน",
      phone: "0820000002",
      address: "",
      id_card_no: "",
      license_no: "",
      created_at: iso(-70 * DAY),
      updated_at: iso(-70 * DAY),
    },
  );
  const user_roles: Row[] = [
    ...people.map(([id]) => ({ id: uid(), user_id: id, role: "customer" })),
    ...[SANDBOX_OWNER_ID, "demo-admin-2", "demo-admin-3"].flatMap((id) => [
      { id: uid(), user_id: id, role: "customer" },
      { id: uid(), user_id: id, role: "admin" },
    ]),
  ];

  const tables: Tables = {
    cars,
    profiles,
    user_roles,
    bookings: [],
    payments: [],
    contracts: [],
    contract_versions: [],
    contract_events: [],
    maintenance: [
      {
        id: uid(),
        car_id: "car-7",
        title: "เปลี่ยนยางและตั้งศูนย์",
        description: "ตัวอย่าง",
        scheduled_date: day(-1),
        completed_date: null,
        cost: 8500,
        status: "in_progress",
        created_at: iso(-3 * DAY),
      },
      {
        id: uid(),
        car_id: "car-1",
        title: "เปลี่ยนถ่ายน้ำมันเครื่อง 20,000 กม.",
        description: "",
        scheduled_date: day(7),
        completed_date: null,
        cost: 1800,
        status: "scheduled",
        created_at: iso(-1 * DAY),
      },
      {
        id: uid(),
        car_id: "car-4",
        title: "ตรวจเช็คเบรก",
        description: "",
        scheduled_date: day(-20),
        completed_date: day(-20),
        cost: 2500,
        status: "completed",
        created_at: iso(-25 * DAY),
      },
    ],
    admin_members: [
      {
        user_id: SANDBOX_OWNER_ID,
        email: "owner@demo.siamwheels.invalid",
        is_owner: true,
        status: "active",
        permissions: ["contracts_manage", "contracts_approve", "bookings_manage", "fleet_manage"],
        status_reason: null,
        invited_by: null,
        created_at: iso(-90 * DAY),
        updated_at: iso(-90 * DAY),
      },
      {
        user_id: "demo-admin-2",
        email: "staff@demo.siamwheels.invalid",
        is_owner: false,
        status: "active",
        permissions: ["contracts_manage", "bookings_manage"],
        status_reason: null,
        invited_by: SANDBOX_OWNER_ID,
        created_at: iso(-80 * DAY),
        updated_at: iso(-80 * DAY),
      },
      {
        user_id: "demo-admin-3",
        email: "paused@demo.siamwheels.invalid",
        is_owner: false,
        status: "suspended",
        permissions: ["fleet_manage"],
        status_reason: "ตัวอย่าง: พักงานชั่วคราว",
        invited_by: SANDBOX_OWNER_ID,
        created_at: iso(-70 * DAY),
        updated_at: iso(-5 * DAY),
      },
    ],
    admin_invitations: [
      {
        id: uid(),
        email: "new.staff@demo.siamwheels.invalid",
        permissions: ["bookings_manage"],
        invited_by: SANDBOX_OWNER_ID,
        token_hash: "demo",
        created_at: iso(-2 * HOUR),
        expires_at: iso(70 * HOUR),
        accepted_at: null,
        accepted_by: null,
        revoked_at: null,
        revoked_by: null,
      },
    ],
    admin_audit_log: [
      {
        id: uid(),
        action: "owner_bootstrapped",
        actor_id: null,
        target_user_id: SANDBOX_OWNER_ID,
        target_email: "owner@demo.siamwheels.invalid",
        details: {},
        created_at: iso(-90 * DAY),
      },
      {
        id: uid(),
        action: "invite_accepted",
        actor_id: "demo-admin-2",
        target_user_id: "demo-admin-2",
        target_email: "staff@demo.siamwheels.invalid",
        details: {},
        created_at: iso(-80 * DAY),
      },
      {
        id: uid(),
        action: "admin_suspended",
        actor_id: SANDBOX_OWNER_ID,
        target_user_id: "demo-admin-3",
        target_email: "paused@demo.siamwheels.invalid",
        details: { reason: "ตัวอย่าง: พักงานชั่วคราว" },
        created_at: iso(-5 * DAY),
      },
    ],
  };

  // Bookings across every stage of the workflow
  type Plan = {
    cust: string;
    car: string;
    start: number;
    nights: number;
    status: string;
    contract?: "pending_customer" | "revision_requested" | "approved" | "paid" | "cancelled";
    fee?: boolean;
    pickup?: boolean;
    hold?: number;
    created: number;
  };
  const plans: Plan[] = [
    {
      cust: "cust-1",
      car: "car-2",
      start: 3,
      nights: 2,
      status: "pending",
      hold: 20 * HOUR,
      created: -1 * HOUR,
    },
    {
      cust: "cust-2",
      car: "car-3",
      start: 5,
      nights: 3,
      status: "pending",
      contract: "pending_customer",
      hold: 22 * HOUR,
      created: -5 * HOUR,
    },
    {
      cust: "cust-3",
      car: "car-5",
      start: 6,
      nights: 1,
      status: "pending",
      contract: "revision_requested",
      hold: 18 * HOUR,
      created: -8 * HOUR,
    },
    {
      cust: "cust-4",
      car: "car-6",
      start: 2,
      nights: 2,
      status: "pending",
      contract: "approved",
      hold: 12 * MIN,
      created: -3 * HOUR,
    },
    {
      cust: "cust-5",
      car: "car-1",
      start: 0,
      nights: 1,
      status: "confirmed",
      contract: "paid",
      fee: true,
      created: -3 * DAY,
    },
    {
      cust: "cust-6",
      car: "car-4",
      start: -2,
      nights: 3,
      status: "active",
      contract: "paid",
      fee: true,
      pickup: true,
      created: -6 * DAY,
    },
    {
      cust: "cust-1",
      car: "car-8",
      start: -5,
      nights: 3,
      status: "active",
      contract: "paid",
      fee: true,
      pickup: true,
      created: -9 * DAY,
    },
    {
      cust: "cust-2",
      car: "car-2",
      start: -12,
      nights: 2,
      status: "completed",
      contract: "paid",
      fee: true,
      pickup: true,
      created: -15 * DAY,
    },
    {
      cust: "cust-3",
      car: "car-6",
      start: -40,
      nights: 4,
      status: "completed",
      contract: "paid",
      fee: true,
      pickup: true,
      created: -45 * DAY,
    },
    {
      cust: "cust-4",
      car: "car-5",
      start: -70,
      nights: 2,
      status: "completed",
      contract: "paid",
      fee: true,
      pickup: true,
      created: -75 * DAY,
    },
    {
      cust: "cust-5",
      car: "car-3",
      start: -3,
      nights: 1,
      status: "cancelled",
      contract: "cancelled",
      fee: true,
      created: -8 * DAY,
    },
  ];
  plans.forEach((p, i) => {
    const car = cars.find((c) => c.id === p.car)!;
    const start = day(p.start);
    const end = day(p.start + p.nights);
    const days = daysBetween(start, end);
    const rent = Number(car.price_per_day) * days;
    const bookingId = `booking-${i + 1}`;
    const created = iso(p.created);
    tables.bookings.push({
      id: bookingId,
      booking_code: `BKDEMO${String(i + 1).padStart(3, "0")}`,
      user_id: p.cust,
      car_id: p.car,
      start_date: start,
      end_date: end,
      days,
      pickup_location: i % 2 ? "สนามบินสุวรรณภูมิ" : "สาขากรุงเทพฯ (สุขุมวิท)",
      total_amount: rent,
      status: p.status,
      hold_expires_at: p.hold ? iso(p.hold) : null,
      notes: null,
      created_at: created,
    });
    if (p.fee) {
      tables.payments.push({
        id: uid(),
        booking_id: bookingId,
        user_id: p.cust,
        kind: "booking_fee",
        method: i % 2 ? "card" : "qr",
        card_last4: i % 2 ? "4242" : null,
        amount: BOOKING_FEE,
        deposit: 0,
        status: "paid",
        reference: `DEMO-FEE${i + 1}`,
        refund_status: p.status === "cancelled" ? "not_refunded" : "none",
        paid_at: iso(p.created + 20 * MIN),
      });
    }
    if (p.pickup) {
      tables.payments.push({
        id: uid(),
        booking_id: bookingId,
        user_id: p.cust,
        kind: "pickup",
        method: "qr",
        card_last4: null,
        amount: rent * 2 - BOOKING_FEE,
        deposit: rent,
        status: "paid",
        reference: `DEMO-PICK${i + 1}`,
        refund_status: "none",
        paid_at: at(start, "10:30"),
      });
    }
    if (p.contract) {
      const contractId = `contract-${i + 1}`;
      tables.contracts.push({
        id: contractId,
        booking_id: bookingId,
        user_id: p.cust,
        contract_no: `CTDEMO${String(i + 1).padStart(3, "0")}`,
        status: p.contract,
        current_version: 1,
        sent_version: 1,
        terms: "",
        customer_accepted_at: ["approved", "paid"].includes(p.contract)
          ? iso(p.created + 10 * MIN)
          : null,
        approved_at: ["approved", "paid"].includes(p.contract) ? iso(p.created + 10 * MIN) : null,
        approved_by: null,
        paid_at: p.contract === "paid" ? iso(p.created + 20 * MIN) : null,
        cancelled_at: p.contract === "cancelled" ? iso(p.created + 2 * DAY) : null,
        revision_reason:
          p.contract === "revision_requested"
            ? `ชื่อลูกค้า: [ตัวอย่าง] วิชัย เดินทางไกล\nเวลารับรถ: 11:00 น.\nเวลาคืนรถ: 17:00 น.`
            : null,
        revision_requested_by: p.contract === "revision_requested" ? "customer" : null,
        created_at: iso(p.created + 2 * MIN),
        updated_at: iso(p.created + 20 * MIN),
      });
      const v = writeVersion(
        tables,
        contractId,
        1,
        {
          pickup_at: at(start, "10:00"),
          return_at: at(end, "18:00"),
          deposit: rent,
          mileage_allowance: "ไม่จำกัดระยะทาง",
          late_penalty: "500 บาท / ชั่วโมง",
          additional_conditions: "",
          include_license: false,
        },
        SANDBOX_OWNER_ID,
      );
      v.sent_at = iso(p.created + 3 * MIN);
      if (["approved", "paid"].includes(p.contract)) {
        v.accepted_at = iso(p.created + 10 * MIN);
        v.accepted_by = p.cust;
      }
      tables.contracts.at(-1)!.terms = v.terms;
      const log = (action: string, role: string, at: number, note: string | null = null) =>
        tables.contract_events.push({
          id: uid(),
          contract_id: contractId,
          booking_id: bookingId,
          version: 1,
          actor_id: role === "customer" ? p.cust : SANDBOX_OWNER_ID,
          actor_role: role,
          action,
          note,
          created_at: iso(p.created + at),
        });
      log("created", "owner", 2 * MIN);
      log("sent", "owner", 3 * MIN);
      if (p.contract === "revision_requested")
        log(
          "revision_requested",
          "customer",
          30 * MIN,
          String(tables.contracts.at(-1)!.revision_reason),
        );
      if (["approved", "paid"].includes(p.contract)) log("accepted", "customer", 10 * MIN);
      if (p.fee) log("paid", "customer", 20 * MIN);
      if (p.contract === "cancelled")
        log(
          "cancelled",
          "customer",
          2 * DAY,
          "ยกเลิกหลังชำระเงิน: เก็บประวัติการชำระไว้ ยังไม่มีการคืนเงิน (DEMO)",
        );
    }
  });
  return tables;
}

type Terms = {
  pickup_at: string;
  return_at: string;
  deposit: number;
  mileage_allowance: string;
  late_penalty: string;
  additional_conditions: string;
  include_license: boolean;
};

/** Contract text, like render_contract_terms() in the database (Thai: it is the document). */
function renderTerms(t: Tables, contract: Row, version: number, f: Terms) {
  const b = t.bookings.find((x) => x.id === contract.booking_id)!;
  const car = t.cars.find((c) => c.id === b.car_id)!;
  const p = t.profiles.find((x) => x.id === b.user_id);
  const rent = Number(b.total_amount);
  const time = (s: string) =>
    new Intl.DateTimeFormat("th-TH", {
      timeZone: "Asia/Bangkok",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(s));
  const lines = [
    `สัญญาเช่ารถยนต์ เลขที่ ${String(contract.contract_no)} (ฉบับที่ ${version})`,
    `ผู้เช่า: ${String(p?.full_name ?? "-")} โทร ${String(p?.phone ?? "-")}`,
    f.include_license ? `เลขที่ใบอนุญาตขับขี่: ${String(p?.license_no ?? "-")}` : null,
    `รถยนต์: ${String(car.brand)} ${String(car.model)} (${String(car.year)}) ทะเบียน ${String(car.plate_no)}`,
    `สถานที่รับรถ: ${String(b.pickup_location)}`,
    `รับรถ: ${time(f.pickup_at)} น.`,
    `คืนรถ: ${time(f.return_at)} น. (${String(b.days)} วัน)`,
    `ค่าเช่ารวม: ${rent.toLocaleString("th-TH")} บาท`,
    `เงินประกันความเสียหาย: ${rent.toLocaleString("th-TH")} บาท (เท่ากับค่าเช่า ได้รับคืนเมื่อนำรถมาคืนตามสภาพเดิม)`,
    `ค่าจอง (ชำระออนไลน์หลังยืนยันสัญญา): ${BOOKING_FEE.toLocaleString("th-TH")} บาท (ไม่คืนเมื่อยกเลิกการจอง)`,
    `ยอดชำระ ณ วันรับรถ (ค่าเช่า + เงินประกัน - ค่าจอง): ${(rent * 2 - BOOKING_FEE).toLocaleString("th-TH")} บาท`,
    `ข้อกำหนดระยะทาง: ${f.mileage_allowance}`,
    `ค่าปรับส่งคืนรถล่าช้า: ${f.late_penalty}`,
    "",
    "1. ผู้เช่าต้องมีใบอนุญาตขับขี่ที่ยังไม่หมดอายุ",
    "2. ผู้เช่าต้องคืนรถตามวันและเวลาที่กำหนด หากคืนล่าช้าจะคิดค่าปรับตามที่ระบุข้างต้น",
    "(สัญญาตัวอย่างในโหมดสาธิต ไม่มีผลทางกฎหมาย)",
    f.additional_conditions.trim()
      ? `\nเงื่อนไขเพิ่มเติม:\n${f.additional_conditions.trim()}`
      : null,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

function writeVersion(t: Tables, contractId: string, version: number, f: Terms, by: string): Row {
  const contract = t.contracts.find((c) => c.id === contractId)!;
  const b = t.bookings.find((x) => x.id === contract.booking_id)!;
  const car = t.cars.find((c) => c.id === b.car_id)!;
  const p = t.profiles.find((x) => x.id === b.user_id);
  const row: Row = {
    id: uid(),
    contract_id: contractId,
    version,
    is_legacy: false,
    customer_name: p?.full_name ?? "-",
    customer_phone: p?.phone ?? "",
    customer_license_no: f.include_license ? (p?.license_no ?? null) : null,
    car_label: `${String(car.brand)} ${String(car.model)} (${String(car.year)})`,
    car_plate_no: car.plate_no,
    pickup_location: b.pickup_location,
    pickup_at: f.pickup_at,
    return_at: f.return_at,
    rental_days: b.days,
    rental_price: b.total_amount,
    deposit: b.total_amount,
    mileage_allowance: f.mileage_allowance,
    late_penalty: f.late_penalty,
    additional_conditions: f.additional_conditions,
    terms: renderTerms(t, contract, version, f),
    created_by: by,
    created_at: new Date().toISOString(),
    sent_at: null,
    accepted_at: null,
    accepted_by: null,
    approved_at: null,
    approved_by: null,
    superseded_at: null,
  };
  const old = t.contract_versions.findIndex(
    (v) => v.contract_id === contractId && v.version === version,
  );
  if (old >= 0) t.contract_versions[old] = { ...row, id: t.contract_versions[old]!.id };
  else t.contract_versions.push(row);
  return old >= 0 ? t.contract_versions[old]! : row;
}

// ----------------------------------------------------------------- query builder

type Filter = (r: Row) => boolean;

class SandboxQuery implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "delete" = "select";
  private spec = "*";
  private returning = false;
  private orderBy: { col: string; asc: boolean }[] = [];
  private max: number | null = null;
  private singleMode: "one" | "maybe" | null = null;
  private payload: Row | Row[] | null = null;

  constructor(
    private sb: Sandbox,
    private table: string,
  ) {}

  select(spec = "*") {
    if (this.op === "select") this.spec = spec;
    else this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = rows;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  gte(col: string, v: string | number) {
    this.filters.push((r) => (r[col] as string | number) >= v);
    return this;
  }
  lte(col: string, v: string | number) {
    this.filters.push((r) => (r[col] as string | number) <= v);
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy.push({ col, asc: opts.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }
  singleRow() {
    this.singleMode = "one";
    return this;
  }

  then<A = Result, B = never>(
    ok?: ((v: Result) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(ok, fail);
  }

  private run(): Result {
    const t = this.sb.tables;
    if (!(TABLE_NAMES as readonly string[]).includes(this.table))
      return { data: null, error: { message: `demo: unknown table ${this.table}` } };
    const name = this.table as TableName;
    const rows = t[name];
    const match = (r: Row) => this.filters.every((f) => f(r));
    let out: Row[];
    if (this.op === "insert") {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      out = list.map((r) => ({ id: uid(), created_at: new Date().toISOString(), ...r }));
      rows.push(...out);
      if (!this.returning) return { data: null, error: null };
    } else if (this.op === "update") {
      out = [];
      for (const r of rows.filter(match)) {
        const err = this.sb.beforeUpdate(this.table, r, this.payload as Row);
        if (err) return { data: null, error: err };
        Object.assign(r, this.payload, { updated_at: new Date().toISOString() });
        out.push(r);
      }
      if (!this.returning) return { data: null, error: null };
    } else if (this.op === "delete") {
      const doomed = rows.filter(match);
      for (const r of doomed) {
        const err = this.sb.beforeDelete(this.table, r);
        if (err) return { data: null, error: err };
      }
      t[name] = rows.filter((r) => !doomed.includes(r));
      // Like the real foreign key (on delete cascade): a car's maintenance jobs go with it
      if (name === "cars")
        t.maintenance = t.maintenance.filter((m) => !doomed.some((c) => c.id === m.car_id));
      return { data: null, error: null };
    } else {
      out = rows.filter(match);
    }
    for (const { col, asc } of [...this.orderBy].reverse()) {
      out = [...out].sort((a, b) => {
        const x = a[col] as string | number | null;
        const y = b[col] as string | number | null;
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (x < y ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    if (this.max !== null) out = out.slice(0, this.max);
    const data = out.map((r) => this.sb.embed(this.table, { ...r }, this.spec));
    if (this.singleMode) {
      if (data.length === 0 && this.singleMode === "one")
        return { data: null, error: { message: "not found" } };
      return { data: data[0] ?? null, error: null };
    }
    return { data, error: null, count: data.length };
  }
}

// ----------------------------------------------------------------- the sandbox

export class Sandbox {
  tables: Tables = sampleData();

  from(table: string) {
    const q = new SandboxQuery(this, table);
    // PostgREST's single() is a method name clash with our field; expose it as single()
    return Object.assign(q, { single: () => q.singleRow() });
  }

  async rpc(fn: string, args: Row = {}): Promise<Result> {
    try {
      return { data: this.call(fn, args), error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }

  embed(table: string, row: Row, spec: string): Row {
    const t = this.tables;
    if (table === "bookings" || table === "maintenance") {
      if (spec.includes("cars(")) row.cars = t.cars.find((c) => c.id === row.car_id) ?? null;
      if (table === "bookings") {
        if (spec.includes("contracts("))
          row.contracts = t.contracts.filter((c) => c.booking_id === row.id);
        if (spec.includes("payments("))
          row.payments = t.payments.filter((p) => p.booking_id === row.id);
      }
    }
    if (table === "contracts" && spec.includes("bookings(")) {
      const b = t.bookings.find((x) => x.id === row.booking_id);
      row.bookings = b
        ? this.embed("bookings", { ...b }, spec.includes("cars(") ? "cars(*)" : "")
        : null;
    }
    return row;
  }

  beforeUpdate(table: string, row: Row, patch: Row): { message: string } | null {
    if (table === "bookings" && patch.status && patch.status !== row.status) {
      const move = `${String(row.status)}>${String(patch.status)}`;
      if (move === "pending>confirmed")
        return {
          message: tr(
            "ยืนยันการจองได้หลังลูกค้ายืนยันสัญญาและชำระค่าจองแล้วเท่านั้น",
            "A booking is confirmed only after the customer confirms the contract and pays.",
          ),
        };
      if (
        ["confirmed>active", "confirmed>completed", "active>completed"].includes(move) &&
        todayBkk() < String(row.start_date)
      )
        return {
          message: tr(
            "ส่งมอบรถหรือรับรถคืนได้ตั้งแต่วันรับรถเป็นต้นไป",
            "Hand-over and return are possible from the pickup day onwards.",
          ),
        };
      if (patch.status === "cancelled") this.cancelContract(String(row.id));
      if (patch.status !== "pending") patch.hold_expires_at = null;
    }
    return null;
  }

  beforeDelete(table: string, row: Row): { message: string; code: string } | null {
    if (table === "cars" && this.tables.bookings.some((b) => b.car_id === row.id))
      return { code: "23503", message: "violates foreign key constraint" };
    return null;
  }

  private cancelContract(bookingId: string) {
    for (const p of this.tables.payments)
      if (p.booking_id === bookingId && p.status === "paid" && p.refund_status === "none")
        p.refund_status = "not_refunded";
    const c = this.tables.contracts.find((x) => x.booking_id === bookingId);
    if (c && c.status !== "cancelled") {
      Object.assign(c, { status: "cancelled", cancelled_at: new Date().toISOString() });
      this.event(c, "cancelled", "owner");
    }
  }

  private event(c: Row, action: string, role: string, note: string | null = null) {
    c.updated_at = new Date().toISOString();
    this.tables.contract_events.push({
      id: uid(),
      contract_id: c.id,
      booking_id: c.booking_id,
      version: c.current_version,
      actor_id: role === "customer" ? c.user_id : SANDBOX_OWNER_ID,
      actor_role: role,
      action,
      note,
      created_at: new Date().toISOString(),
    });
  }

  private audit(action: string, target: Row | undefined, details: Row = {}) {
    this.tables.admin_audit_log.push({
      id: uid(),
      action,
      actor_id: SANDBOX_OWNER_ID,
      target_user_id: target?.user_id ?? null,
      target_email: target?.email ?? null,
      details,
      created_at: new Date().toISOString(),
    });
  }

  private contract(id: unknown) {
    const c = this.tables.contracts.find((x) => x.id === id);
    if (!c) throw new Error(tr("ไม่พบสัญญา", "Contract not found."));
    return c;
  }

  private terms(a: Row): Terms {
    return {
      pickup_at: String(a._pickup_at),
      return_at: String(a._return_at),
      deposit: Number(a._deposit ?? 0),
      mileage_allowance: String(a._mileage_allowance ?? ""),
      late_penalty: String(a._late_penalty ?? ""),
      additional_conditions: String(a._additional_conditions ?? ""),
      include_license: !!a._include_license,
    };
  }

  private call(fn: string, a: Row): unknown {
    const t = this.tables;
    switch (fn) {
      case "expire_stale_bookings": {
        let n = 0;
        for (const b of t.bookings)
          if (
            b.status === "pending" &&
            b.hold_expires_at &&
            new Date(String(b.hold_expires_at)).getTime() < Date.now()
          ) {
            b.status = "cancelled";
            b.hold_expires_at = null;
            this.cancelContract(String(b.id));
            n++;
          }
        return n;
      }
      case "admin_create_contract": {
        const b = t.bookings.find((x) => x.id === a._booking_id);
        if (!b) throw new Error(tr("ไม่พบการจอง", "Booking not found."));
        if (t.contracts.some((c) => c.booking_id === b.id))
          throw new Error(tr("การจองนี้มีสัญญาอยู่แล้ว", "This booking already has a contract."));
        const id = uid();
        t.contracts.push({
          id,
          booking_id: b.id,
          user_id: b.user_id,
          contract_no: `CTDEMO${String(t.contracts.length + 101)}`,
          status: "draft",
          current_version: 1,
          sent_version: null,
          terms: "",
          customer_accepted_at: null,
          approved_at: null,
          approved_by: null,
          paid_at: null,
          cancelled_at: null,
          revision_reason: null,
          revision_requested_by: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        const v = writeVersion(t, id, 1, this.terms(a), SANDBOX_OWNER_ID);
        this.contract(id).terms = v.terms;
        this.event(this.contract(id), "created", "owner");
        return id;
      }
      case "admin_update_contract": {
        const c = this.contract(a._contract_id);
        if (["paid", "cancelled"].includes(String(c.status)))
          throw new Error(
            tr(
              "สัญญาที่ชำระเงินแล้วหรือยกเลิกแล้วแก้ไขไม่ได้",
              "A paid or cancelled contract cannot be edited.",
            ),
          );
        const current = t.contract_versions.find(
          (v) => v.contract_id === c.id && v.version === c.current_version,
        );
        let version = Number(c.current_version);
        if (current?.sent_at) {
          current.superseded_at = new Date().toISOString();
          version += 1;
        }
        const v = writeVersion(t, String(c.id), version, this.terms(a), SANDBOX_OWNER_ID);
        Object.assign(c, {
          current_version: version,
          status: "draft",
          terms: v.terms,
          customer_accepted_at: null,
          approved_at: null,
        });
        this.event(c, "edited", "owner");
        return null;
      }
      case "admin_send_contract": {
        const c = this.contract(a._contract_id);
        if (c.status !== "draft")
          throw new Error(tr("ส่งได้เฉพาะสัญญาฉบับร่าง", "Only a draft contract can be sent."));
        const v = t.contract_versions.find(
          (x) => x.contract_id === c.id && x.version === c.current_version,
        )!;
        v.sent_at = new Date().toISOString();
        Object.assign(c, {
          status: "pending_customer",
          sent_version: c.current_version,
          terms: v.terms,
          revision_reason: null,
          revision_requested_by: null,
        });
        const b = t.bookings.find((x) => x.id === c.booking_id);
        if (b) b.hold_expires_at = new Date(Date.now() + DAY).toISOString();
        this.event(c, "sent", "owner");
        return null;
      }
      case "admin_apply_requested_name": {
        const c = this.contract(a._contract_id);
        const p = t.profiles.find((x) => x.id === c.user_id);
        if (p) p.full_name = String(a._name).trim();
        this.event(c, "edited", "owner", `เปลี่ยนชื่อผู้เช่าตามคำขอของลูกค้า: ${String(a._name)}`);
        return null;
      }
      case "admin_approve_contract": {
        const c = this.contract(a._contract_id);
        Object.assign(c, {
          status: "approved",
          approved_at: new Date().toISOString(),
          approved_by: SANDBOX_OWNER_ID,
        });
        this.event(c, "approved", "owner");
        return null;
      }
      case "admin_request_revision": {
        const c = this.contract(a._contract_id);
        Object.assign(c, {
          status: "revision_requested",
          revision_reason: String(a._reason),
          revision_requested_by: "admin",
        });
        this.event(c, "revision_requested", "owner", String(a._reason));
        return null;
      }
      case "owner_manual_confirm_booking": {
        const b = t.bookings.find((x) => x.id === a._booking_id);
        if (!b || b.status !== "pending")
          throw new Error(
            tr(
              "ยืนยันด้วยตนเองได้เฉพาะการจองที่รอดำเนินการ",
              "Only a pending booking can be confirmed manually.",
            ),
          );
        Object.assign(b, { status: "confirmed", hold_expires_at: null });
        const c = t.contracts.find((x) => x.booking_id === b.id);
        if (c) this.event(c, "manual_confirm", "owner", String(a._reason));
        this.audit("booking_manual_confirm", undefined, { booking_id: b.id, reason: a._reason });
        return null;
      }
      case "owner_create_admin_invitation": {
        const email = String(a._email).toLowerCase();
        const row = {
          id: uid(),
          email,
          permissions: a._permissions,
          invited_by: SANDBOX_OWNER_ID,
          token_hash: "demo",
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 72 * HOUR).toISOString(),
          accepted_at: null,
          accepted_by: null,
          revoked_at: null,
          revoked_by: null,
        };
        t.admin_invitations.push(row);
        this.audit("invite_created", { email }, { permissions: a._permissions });
        return [
          {
            invitation_id: row.id,
            invite_token: "DEMO-INVITE-LINK-NOT-USABLE",
            invite_expires_at: row.expires_at,
          },
        ];
      }
      case "owner_revoke_admin_invitation": {
        const i = t.admin_invitations.find((x) => x.id === a._invitation_id);
        if (i)
          Object.assign(i, { revoked_at: new Date().toISOString(), revoked_by: SANDBOX_OWNER_ID });
        this.audit("invite_revoked", i);
        return null;
      }
      case "owner_set_admin_permissions": {
        const m = t.admin_members.find((x) => x.user_id === a._user_id);
        if (m) {
          this.audit("permissions_changed", m, { old: m.permissions, new: a._permissions });
          m.permissions = a._permissions;
        }
        return null;
      }
      case "owner_set_admin_status": {
        const m = t.admin_members.find((x) => x.user_id === a._user_id);
        if (m) {
          Object.assign(m, { status: a._status, status_reason: a._reason });
          this.audit(
            a._status === "active"
              ? "admin_reactivated"
              : a._status === "suspended"
                ? "admin_suspended"
                : "admin_revoked",
            m,
            { reason: a._reason },
          );
        }
        return null;
      }
      default:
        throw new Error(
          tr("ใช้ฟังก์ชันนี้ในโหมดสาธิตไม่ได้", "This action is not available in demo mode."),
        );
    }
  }
}
