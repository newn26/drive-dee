/**
 * The real admin dashboard renders for each role (critical tests 13, 17, 18).
 * Only the router, auth and Supabase client are mocked; access rules themselves are
 * proven against a real database in src/test/db. Fictional data only.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  auth: {} as Record<string, unknown>,
  writes: [] as { table: string; op: string; row: unknown }[],
}));

const builder = (rows: unknown[] = [], table = "") => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "in", "limit", "delete"]) q[m] = () => q;
  for (const op of ["insert", "update"])
    q[op] = (row: unknown) => {
      mocks.writes.push({ table, op, row });
      return q;
    };
  q["maybeSingle"] = () => Promise.resolve({ data: rows[0] ?? null, error: null });
  q["then"] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return q;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => builder(mocks.tables[t], t),
    rpc: () => Promise.resolve({ data: 0, error: null }),
    auth: { getUser: vi.fn(), signOut: vi.fn() },
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (opts: Record<string, unknown>) => ({
      ...opts,
      useParams: () => ({}),
      useSearch: () => ({}),
    }),
    Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
    useNavigate: () => vi.fn(),
  };
});

import { toast } from "sonner";

import { AdminDashboard } from "@/routes/admin";

beforeAll(() => {
  // Recharts measures its container
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  vi.clearAllMocks();
  mocks.writes = [];
});

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const CAR = {
  id: "car-1",
  brand: "Toyota",
  model: "Yaris Ativ",
  year: 2024,
  plate_no: "1กข 1234",
  category: "eco",
  price_per_day: 990,
  status: "available",
  image_url: "eco",
  seats: 5,
  transmission: "อัตโนมัติ",
  fuel: "เบนซิน",
  mileage: 0,
  description: "",
  created_at: inMinutes(-9999),
};
const PENDING = {
  id: "b-1",
  booking_code: "BK261112NEW01",
  user_id: "cust-1",
  car_id: "car-1",
  status: "pending",
  start_date: "2026-12-01",
  end_date: "2026-12-03",
  days: 3,
  total_amount: 2970,
  pickup_location: "สาขากรุงเทพฯ",
  created_at: inMinutes(-5),
  hold_expires_at: inMinutes(600),
  notes: "",
  cars: CAR,
};
const LEGACY = {
  ...PENDING,
  id: "b-0",
  booking_code: "BK261101OLD01",
  status: "confirmed",
  hold_expires_at: null,
};
const LEGACY_CONTRACT = {
  id: "ct-0",
  contract_no: "CT261101OLD01",
  booking_id: "b-0",
  user_id: "cust-1",
  terms: "สัญญาเดิม",
  status: "paid",
  customer_accepted_at: inMinutes(-9000),
  created_at: inMinutes(-9000),
  current_version: 1,
  sent_version: 1,
  updated_at: inMinutes(-9000),
  bookings: LEGACY,
};

function renderDashboard(auth: Record<string, unknown>) {
  mocks.auth = { loading: false, ...auth };
  mocks.tables = {
    cars: [CAR],
    bookings: [PENDING, LEGACY],
    profiles: [
      { id: "cust-1", full_name: "ทดสอบ ลูกค้าเอ", phone: "000" },
      { id: "admin-1", full_name: "ทดสอบ แอดมิน", phone: "111" },
    ],
    contracts: [LEGACY_CONTRACT],
    payments: [
      {
        id: "p-0",
        booking_id: "b-0",
        user_id: "cust-1",
        amount: 2970,
        status: "paid",
        method: "qr",
        paid_at: inMinutes(-9000),
        reference: "DEMO-OLD",
        card_last4: null,
      },
    ],
    maintenance: [],
    user_roles: [{ user_id: "admin-1", role: "admin" }],
    reviews: [],
    admin_members: [],
    admin_invitations: [],
    admin_audit_log: [],
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminDashboard mode="admin" />
    </QueryClientProvider>,
  );
}

const admin = { user: { id: "admin-1", email: "a@example.test" }, role: "admin" };
const member = (over: Record<string, unknown> = {}) => ({
  user_id: "admin-1",
  email: "a@example.test",
  is_owner: false,
  status: "active",
  permissions: [
    "contracts_manage",
    "contracts_approve",
    "bookings_manage",
    "fleet_manage",
    "reviews_moderate",
  ],
  ...over,
});

describe("admin dashboard", () => {
  it("18 loads for an admin, with existing data and the contract work queue", async () => {
    renderDashboard({ ...admin, adminMember: member() });
    expect(await screen.findByTestId("contract-work-queue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ภาพรวมระบบ/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /จัดการรถยนต์ในระบบ/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /รายการจองของลูกค้า/ })).toBeInTheDocument();
    // one pending booking is waiting for a contract (counts appear once the bookings load)
    expect(
      await screen.findByRole("button", { name: /1\s*การจองรอสร้างสัญญา/ }),
    ).toBeInTheDocument();
  });

  it("the work queue opens the contracts panel on that stage", async () => {
    renderDashboard({ ...admin, adminMember: member() });
    fireEvent.click(await screen.findByRole("button", { name: /1\s*การจองรอสร้างสัญญา/ }));
    expect(await screen.findByText("BK261112NEW01")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /สร้างสัญญา$/ })).toBeEnabled();
  });

  it("legacy paid contracts are listed under 'paid'", async () => {
    renderDashboard({ ...admin, adminMember: member() });
    fireEvent.click(await screen.findByRole("button", { name: /1\s*ชำระเงินแล้ว/ }));
    expect(await screen.findByText("CT261101OLD01")).toBeInTheDocument();
  });

  it("15 the Owner sees Admin Management", async () => {
    renderDashboard({ ...admin, adminMember: member({ is_owner: true }) });
    const nav = await screen.findByRole("button", { name: /ผู้ดูแลระบบ \(Owner\)/ });
    fireEvent.click(nav);
    expect(await screen.findByText("เชิญผู้ดูแลใหม่")).toBeInTheDocument();
    expect(screen.getByText("บันทึกตรวจสอบ (Audit log)")).toBeInTheDocument();
  });

  it("14 a normal admin has no Admin Management and no manual confirm", async () => {
    renderDashboard({ ...admin, adminMember: member() });
    await screen.findByTestId("contract-work-queue");
    expect(screen.queryByRole("button", { name: /ผู้ดูแลระบบ \(Owner\)/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /รายการจองของลูกค้า/ }));
    expect(await screen.findByText("BK261112NEW01")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยืนยันด้วยตนเอง" })).not.toBeInTheDocument();
  });

  it("13 a customer is refused (no Admin Management, no data)", () => {
    renderDashboard({
      user: { id: "cust-1", email: "c@example.test" },
      role: "customer",
      adminMember: null,
    });
    expect(screen.getByText(/ปฏิเสธการเข้าถึง/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ผู้ดูแลระบบ \(Owner\)/ })).not.toBeInTheDocument();
  });

  it("the customers tab lists customers only (no admins)", async () => {
    renderDashboard({ ...admin, adminMember: member() });
    fireEvent.click(await screen.findByRole("button", { name: /ข้อมูลลูกค้า/ }));
    expect(await screen.findByText("ทดสอบ ลูกค้าเอ")).toBeInTheDocument();
    expect(screen.queryByText("ทดสอบ แอดมิน")).not.toBeInTheDocument();
  });

  it("16 an admin limited to contracts sees no booking-status or fleet actions", async () => {
    renderDashboard({ ...admin, adminMember: member({ permissions: ["contracts_manage"] }) });
    fireEvent.click(await screen.findByRole("button", { name: /รายการจองของลูกค้า/ }));
    await screen.findByText("BK261112NEW01");
    const buttons = screen.getAllByRole("button", { name: "เปลี่ยนสถานะ" });
    expect(buttons.length).toBe(2);
    for (const b of buttons) expect(b).toBeDisabled();
  });
});

describe("admin car form price (B1)", () => {
  async function submitNewCar(price: string) {
    renderDashboard({ ...admin, adminMember: member() });
    fireEvent.click((await screen.findAllByRole("button", { name: /เพิ่มรถยนต์ใหม่/ }))[0]!);
    fireEvent.change(await screen.findByLabelText(/ยี่ห้อ/), { target: { value: "Honda" } });
    fireEvent.change(screen.getByLabelText(/รุ่น \(Model\)/), { target: { value: "City" } });
    fireEvent.change(screen.getByLabelText(/หมายเลขทะเบียน/), { target: { value: "9กก 9999" } });
    fireEvent.change(screen.getByLabelText(/ราคาต่อวัน/), { target: { value: price } });
    fireEvent.submit(screen.getByLabelText(/ราคาต่อวัน/).closest("form")!);
  }

  it.each(["-100", "0", ""])("does not save a car priced %j", async (price) => {
    await submitNewCar(price);
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(mocks.writes.filter((w) => w.table === "cars")).toEqual([]);
  });

  it("saves a car with a positive price", async () => {
    await submitNewCar("1200");
    await vi.waitFor(() => expect(mocks.writes.some((w) => w.table === "cars")).toBe(true));
    expect(mocks.writes.find((w) => w.table === "cars")!.row).toMatchObject({ price_per_day: 1200 });
  });
});
