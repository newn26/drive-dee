/**
 * UI tests for the contract workflow: the real booking page and admin contracts panel,
 * with only the router, auth and Supabase client mocked. Fictional data only.
 * (Permissions themselves are proven against a real database in src/test/db.)
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fromSpy = vi.hoisted(() => vi.fn());
const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, unknown>,
  rpc: vi.fn(),
  auth: {
    user: { id: "cust-1", email: "c@example.test" } as { id: string; email: string } | null,
    loading: false,
  },
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

/** Thenable query builder; maybeSingle() resolves to the first row. */
const builder = (rows: unknown) => {
  const list = Array.isArray(rows) ? rows : rows === undefined ? [] : [rows];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "in", "limit", "update"]) q[m] = () => q;
  q["maybeSingle"] = () => Promise.resolve({ data: list[0] ?? null, error: null });
  q["then"] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: list, error: null }).then(resolve);
  return q;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => {
      fromSpy(t);
      return builder(mocks.tables[t]);
    },
    rpc: (...args: unknown[]) => mocks.rpc(...args),
    auth: { getUser: vi.fn(), signOut: vi.fn() },
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (opts: Record<string, unknown>) => ({
      ...opts,
      useParams: () => ({ id: "b-1" }),
      useSearch: () => ({}),
    }),
    Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
    useNavigate: () => vi.fn(),
  };
});

import { Route as BookingRoute } from "@/routes/bookings_.$id";
import {
  AdminContractsPanel,
  type PanelBooking,
  type PanelContract,
} from "@/components/admin/contracts-panel";
import { ContractView } from "@/components/contract/contract-view";
import { dashboardPermissions } from "@/lib/roles";
import type { ContractRow, ContractVersionRow } from "@/lib/contract-api";

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

const BOOKING = {
  id: "b-1",
  booking_code: "BK261112TEST1",
  user_id: "cust-1",
  car_id: "car-1",
  status: "pending",
  start_date: "2026-12-01",
  end_date: "2026-12-03",
  days: 3,
  total_amount: 2970,
  pickup_location: "สาขากรุงเทพฯ",
  created_at: inMinutes(-30),
  hold_expires_at: inMinutes(60) as string | null,
  notes: "",
  cars: {
    id: "car-1",
    brand: "Toyota",
    model: "Yaris Ativ",
    year: 2024,
    plate_no: "1กข 1234",
    category: "eco",
    price_per_day: 990,
    image_url: "eco",
    transmission: "อัตโนมัติ",
    fuel: "เบนซิน",
  },
};

const contractRow = (over: Partial<ContractRow> = {}): ContractRow => ({
  id: "ct-1",
  contract_no: "CT261112TEST1",
  booking_id: "b-1",
  user_id: "cust-1",
  terms: "สัญญาเช่ารถยนต์ (ทดสอบ)",
  status: "pending_customer",
  customer_accepted_at: null,
  created_at: inMinutes(-20),
  current_version: 1,
  sent_version: 1,
  approved_at: null,
  approved_by: null,
  paid_at: null,
  cancelled_at: null,
  revision_reason: null,
  revision_requested_by: null,
  updated_at: inMinutes(-5),
  ...over,
});

const versionRow = (over: Partial<ContractVersionRow> = {}): ContractVersionRow => ({
  id: "v-1",
  contract_id: "ct-1",
  version: 1,
  is_legacy: false,
  customer_name: "ทดสอบ ลูกค้าเอ",
  customer_phone: "000-000-0001",
  customer_license_no: null,
  car_label: "Toyota Yaris Ativ (2024)",
  car_plate_no: "1กข 1234",
  pickup_location: "สาขากรุงเทพฯ",
  pickup_at: "2026-12-01T03:00:00Z",
  return_at: "2026-12-03T11:00:00Z",
  rental_days: 3,
  rental_price: 2970,
  deposit: 5000,
  mileage_allowance: "ไม่จำกัดระยะทาง",
  late_penalty: "500 บาท / ชั่วโมง",
  additional_conditions: "",
  terms: "สัญญาเช่ารถยนต์ เลขที่ CT261112TEST1 (ฉบับที่ 1)",
  created_by: "admin-1",
  created_at: inMinutes(-20),
  sent_at: inMinutes(-10),
  accepted_at: null,
  accepted_by: null,
  approved_at: null,
  approved_by: null,
  superseded_at: null,
  ...over,
});

function renderWithQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const BookingPage = (BookingRoute as unknown as { component: ComponentType }).component;

function setup(opts: {
  booking?: Partial<typeof BOOKING>;
  contract?: ContractRow | null;
  versions?: ContractVersionRow[];
  payment?: unknown;
  events?: unknown[];
}) {
  mocks.tables = {
    bookings: { ...BOOKING, ...opts.booking },
    contracts: opts.contract ?? [],
    contract_versions: opts.versions ?? [],
    contract_events: opts.events ?? [],
    payments: opts.payment ?? [],
  };
  return renderWithQuery(<BookingPage />);
}

beforeEach(() => {
  mocks.auth = { user: { id: "cust-1", email: "c@example.test" }, loading: false };
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});
afterEach(() => vi.clearAllMocks());

describe("customer booking page", () => {
  it("a new booking waits for the admin's draft: no payment yet", async () => {
    setup({ contract: null });
    expect(await screen.findByText("รอผู้ดูแลจัดทำสัญญาเช่า")).toBeInTheDocument();
    expect(screen.queryByTestId("payment-card")).not.toBeInTheDocument();
    // 990 x 3 days: rent 2,970 + insurance 2,970 - fee 1,000
    expect(screen.getByTestId("due-at-pickup")).toHaveTextContent("4,940");
  });

  it("once confirmed, the payment card shows the 1,000 THB booking fee", async () => {
    setup({
      booking: { hold_expires_at: inMinutes(14) },
      contract: contractRow({ status: "approved" }),
      versions: [versionRow()],
    });
    const card = await screen.findByTestId("payment-card");
    expect(within(card).getByText(/ค่าจอง \(ไม่ว่าจะเช่ากี่วัน\)/)).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: /จำลองยืนยันการชำระเงินผ่าน QR Code/ }),
    ).toBeEnabled();
    expect(within(card).getAllByText("฿1,000").length).toBeGreaterThan(0);
  });

  it("after the booking fee, the customer pays the rest (rent + deposit - fee) online", async () => {
    const fee = {
      id: "p-1",
      booking_id: "b-1",
      method: "qr",
      amount: 1000,
      status: "paid",
      kind: "booking_fee",
      deposit: 0,
      reference: "DEMO-FEE",
      card_last4: null,
      paid_at: inMinutes(-5),
      refund_status: "none",
    };
    setup({
      booking: { status: "confirmed", hold_expires_at: null },
      contract: contractRow({ status: "paid" }),
      versions: [versionRow()],
      payment: [fee],
    });
    const card = await screen.findByTestId("payment-card");
    expect(within(card).getByTestId("pickup-breakdown")).toHaveTextContent("฿4,940");
    fireEvent.click(
      within(card).getByRole("button", { name: /จำลองยืนยันการชำระเงินผ่าน QR Code/ }),
    );
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith("pay_pickup", { _booking_id: "b-1", _method: "qr" }),
    );
  });

  it("paid in full: no payment card, both payments listed", async () => {
    const base = {
      booking_id: "b-1",
      method: "qr",
      status: "paid",
      card_last4: null,
      paid_at: inMinutes(-5),
      refund_status: "none",
    };
    setup({
      booking: { status: "confirmed", hold_expires_at: null },
      contract: contractRow({ status: "paid" }),
      versions: [versionRow()],
      payment: [
        {
          ...base,
          id: "p-1",
          amount: 1000,
          kind: "booking_fee",
          deposit: 0,
          reference: "DEMO-FEE",
        },
        { ...base, id: "p-2", amount: 4940, kind: "pickup", deposit: 2970, reference: "DEMO-PICK" },
      ],
    });
    expect(await screen.findByTestId("paid-in-full")).toBeInTheDocument();
    expect(screen.queryByTestId("payment-card")).not.toBeInTheDocument();
    expect(screen.getByText("DEMO-PICK")).toBeInTheDocument();
  });

  it("P13 review stage: accept/revise buttons, no payment", async () => {
    setup({ contract: contractRow(), versions: [versionRow()] });
    expect(await screen.findByRole("button", { name: "ยืนยันสัญญาฉบับที่ 1" })).toBeDisabled(); // until ticked
    expect(screen.getByRole("button", { name: /ขอแก้ไขสัญญา/ })).toBeEnabled();
    expect(screen.queryByTestId("payment-card")).not.toBeInTheDocument();
    expect(
      await screen.findByText(/ชำระ ณ วันรับรถ ไม่รวมในการชำระเงินออนไลน์/),
    ).toBeInTheDocument();
  });

  it("asking for changes: name and times prefilled, times must be 08:00-18:00", async () => {
    setup({ contract: contractRow(), versions: [versionRow()] });
    await screen.findByText(/ชำระ ณ วันรับรถ ไม่รวมในการชำระเงินออนไลน์/); // version loaded
    fireEvent.click(screen.getByRole("button", { name: /ขอแก้ไขสัญญา/ }));
    expect(await screen.findByLabelText("ชื่อลูกค้า")).toHaveValue("ทดสอบ ลูกค้าเอ");
    expect(screen.getByLabelText(/เวลารับรถ/)).toHaveValue("10:00");
    expect(screen.getByLabelText(/เวลาคืนรถ/)).toHaveValue("18:00");

    fireEvent.change(screen.getByLabelText(/เวลารับรถ/), { target: { value: "07:30" } });
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอแก้ไข" }));
    expect(mocks.rpc).not.toHaveBeenCalledWith("customer_request_revision", expect.anything());

    fireEvent.change(screen.getByLabelText(/เวลารับรถ/), { target: { value: "09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอแก้ไข" }));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith("customer_request_revision", {
        _contract_id: "ct-1",
        _version: 1,
        _reason: "ชื่อลูกค้า: ทดสอบ ลูกค้าเอ\nเวลารับรถ: 09:00 น.\nเวลาคืนรถ: 18:00 น.",
      }),
    );
  });

  it("A01 accepting sends the exact version shown", async () => {
    setup({ contract: contractRow(), versions: [versionRow()] });
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันสัญญาฉบับที่ 1" }));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith("customer_accept_contract", {
        _contract_id: "ct-1",
        _version: 1,
      }),
    );
  });

  it("P13 awaiting admin approval: no payment", async () => {
    setup({
      contract: contractRow({
        status: "pending_admin_review",
        customer_accepted_at: inMinutes(-1),
      }),
      versions: [versionRow()],
    });
    expect(await screen.findByText("ยอมรับสัญญาแล้ว รอผู้ดูแลอนุมัติ")).toBeInTheDocument();
    expect(screen.queryByTestId("payment-card")).not.toBeInTheDocument();
  });

  it("P13 approved: the DEMO payment card appears with the 15-minute countdown", async () => {
    setup({
      booking: { hold_expires_at: inMinutes(14) },
      contract: contractRow({ status: "approved" }),
      versions: [versionRow()],
    });
    const card = await screen.findByTestId("payment-card");
    expect(
      within(card).getByRole("button", { name: /จำลองยืนยันการชำระเงินผ่าน QR Code/ }),
    ).toBeEnabled();
    expect(within(card).getByText(/ค่าจอง/)).toBeInTheDocument();
  });

  it("P08 approved but the window has passed: payment is disabled", async () => {
    setup({
      booking: { hold_expires_at: inMinutes(-1) },
      contract: contractRow({ status: "approved" }),
      versions: [versionRow()],
    });
    const card = await screen.findByTestId("payment-card");
    expect(
      within(card).getByRole("button", { name: /จำลองยืนยันการชำระเงินผ่าน QR Code/ }),
    ).toBeDisabled();
    expect(within(card).getAllByText("หมดเวลาชำระเงินแล้ว").length).toBeGreaterThan(0);
  });

  it("P03 QR DEMO payment calls pay_booking once", async () => {
    setup({
      booking: { hold_expires_at: inMinutes(14) },
      contract: contractRow({ status: "approved" }),
      versions: [versionRow()],
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /จำลองยืนยันการชำระเงินผ่าน QR Code/ }),
    );
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith("pay_booking", { _booking_id: "b-1", _method: "qr" }),
    );
  });

  it("P06 the declined test card never reaches the database and shows an error", async () => {
    setup({
      booking: { hold_expires_at: inMinutes(14) },
      contract: contractRow({ status: "approved" }),
      versions: [versionRow()],
    });
    const card = await screen.findByTestId("payment-card");
    fireEvent.mouseDown(within(card).getByRole("tab", { name: /บัตรเครดิต/ }));
    fireEvent.click(await screen.findByRole("button", { name: /บัตรทดสอบถูกปฏิเสธ/ }));
    fireEvent.click(screen.getByRole("button", { name: /จำลองชำระค่าจอง/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("บัตรถูกปฏิเสธ (DEMO)");
    expect(mocks.rpc).not.toHaveBeenCalledWith("pay_booking", expect.anything());
  });

  it("R07 someone other than the customer (an admin) sees no accept or payment controls", async () => {
    mocks.auth = { user: { id: "admin-1", email: "a@example.test" }, loading: false };
    setup({ contract: contractRow({ status: "approved" }), versions: [versionRow()] });
    expect(await screen.findByText(/มีเพียงลูกค้าเจ้าของการจองเท่านั้น/)).toBeInTheDocument();
    expect(screen.queryByTestId("payment-card")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ยอมรับสัญญา/ })).not.toBeInTheDocument();
  });

  it("B05 a cancelled paid booking shows the payment kept and not refunded", async () => {
    setup({
      booking: { status: "cancelled", hold_expires_at: null },
      contract: contractRow({ status: "cancelled", paid_at: inMinutes(-60) }),
      versions: [
        versionRow({
          accepted_at: inMinutes(-90),
          accepted_by: "cust-1",
          approved_at: inMinutes(-80),
          approved_by: "admin-1",
        }),
      ],
      payment: {
        id: "p-1",
        booking_id: "b-1",
        user_id: "cust-1",
        method: "qr",
        amount: 2970,
        status: "paid",
        reference: "DEMO-ABCDEF1234",
        card_last4: null,
        paid_at: inMinutes(-60),
        refund_status: "not_refunded",
      },
    });
    expect(await screen.findByTestId("refund-status")).toHaveTextContent(
      "ไม่คืนเงิน (ค่าจองไม่คืนเมื่อยกเลิก",
    );
    expect(screen.getByText("การจองนี้ถูกยกเลิกแล้ว")).toBeInTheDocument();
  });
});

describe("G04 contract view and printing", () => {
  it("shows a legacy contract's original text with a print button", () => {
    const legacy = versionRow({
      is_legacy: true,
      terms: "สัญญาเดิม ข้อความต้นฉบับ",
      customer_name: null,
    });
    renderWithQuery(
      <ContractView
        contract={contractRow({ status: "paid" })}
        versions={[legacy]}
        events={[]}
        audience="customer"
      />,
    );
    expect(screen.getByText("สัญญาเดิม ข้อความต้นฉบับ")).toBeInTheDocument();
    expect(screen.getByText(/สัญญาฉบับเดิม/)).toBeInTheDocument();
    const print = screen.getByRole("button", { name: /พิมพ์สัญญา/ });
    expect(print.className).toContain("print:hidden");
  });

  it("shows older versions with their stamps on request", () => {
    const v1 = versionRow({
      superseded_at: inMinutes(-3),
      accepted_at: inMinutes(-8),
      accepted_by: "cust-1",
    });
    const v2 = versionRow({ id: "v-2", version: 2, terms: "ฉบับที่สอง" });
    renderWithQuery(
      <ContractView
        contract={contractRow({ current_version: 2, sent_version: 2 })}
        versions={[v1, v2]}
        events={[]}
        audience="customer"
      />,
    );
    expect(screen.getByText("ฉบับที่สอง")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ดูประวัติสัญญา \(1 ฉบับก่อนหน้า\)/ }));
    expect(screen.getByText(/ฉบับที่ 1 \(ถูกแทนที่แล้ว\)/)).toBeInTheDocument();
  });
});

describe("D08 admin contracts panel", () => {
  const panelBooking = BOOKING as unknown as PanelBooking;
  const reviewContract = {
    ...contractRow({ status: "pending_admin_review", customer_accepted_at: inMinutes(-2) }),
    bookings: panelBooking,
  } as PanelContract;
  const profiles = { "cust-1": { full_name: "ทดสอบ ลูกค้าเอ", phone: "000" } };

  it("an admin with contracts_approve can approve the accepted version", async () => {
    mocks.tables = {
      contract_versions: [versionRow({ accepted_at: inMinutes(-2), accepted_by: "cust-1" })],
      contract_events: [],
    };
    renderWithQuery(
      <AdminContractsPanel
        perms={dashboardPermissions("admin")}
        initialView="pending_admin_review"
        contracts={[reviewContract]}
        bookings={[panelBooking]}
        profileMap={profiles}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "เปิดสัญญา" }));
    fireEvent.click(await screen.findByRole("button", { name: /อนุมัติฉบับที่ 1/ }));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith("admin_approve_contract", {
        _contract_id: "ct-1",
        _version: 1,
      }),
    );
  });

  it("a customer's change request: admin sees old vs new and applies it in one click", async () => {
    mocks.tables = {
      contract_versions: [versionRow({ sent_at: inMinutes(-30) })],
      contract_events: [],
    };
    const requested = {
      ...contractRow({
        status: "revision_requested",
        revision_requested_by: "customer",
        revision_reason: "ชื่อลูกค้า: ทดสอบ ลูกค้าเอ\nเวลารับรถ: 09:00 น.\nเวลาคืนรถ: 17:00 น.",
      }),
      bookings: panelBooking,
    } as PanelContract;
    renderWithQuery(
      <AdminContractsPanel
        perms={dashboardPermissions("admin")}
        contracts={[requested]}
        bookings={[panelBooking]}
        profileMap={profiles}
        initialView="revision_requested"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "เปิดสัญญา" }));
    const card = await screen.findByTestId("customer-request");
    expect(within(card).getByText(/^09:00/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: /ยืนยันการแก้ไขและส่งให้ลูกค้า/ }));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        "admin_update_contract",
        expect.objectContaining({
          _contract_id: "ct-1",
          _pickup_at: "2026-12-01T09:00:00+07:00",
          _return_at: "2026-12-03T17:00:00+07:00",
        }),
      ),
    );
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith("admin_send_contract", { _contract_id: "ct-1" }),
    );
  });

  it("an admin without contracts_approve sees no approve button", async () => {
    mocks.tables = {
      contract_versions: [versionRow({ accepted_at: inMinutes(-2), accepted_by: "cust-1" })],
      contract_events: [],
    };
    const perms = dashboardPermissions("admin", {
      is_owner: false,
      status: "active",
      permissions: ["contracts_manage"],
    });
    renderWithQuery(
      <AdminContractsPanel
        perms={perms}
        initialView="pending_admin_review"
        contracts={[reviewContract]}
        bookings={[panelBooking]}
        profileMap={profiles}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "เปิดสัญญา" }));
    // wait until the version (with its acceptance stamp) has loaded into the dialog
    expect(await screen.findByText(/ลูกค้ายอมรับ /)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /อนุมัติฉบับที่/ })).not.toBeInTheDocument();
  });

  it("lists pending bookings without a contract under 'create'", () => {
    mocks.tables = {};
    renderWithQuery(
      <AdminContractsPanel
        perms={dashboardPermissions("admin")}
        contracts={[]}
        bookings={[panelBooking]}
        profileMap={profiles}
      />,
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: /สร้างสัญญา \(1\)/ }));
    expect(screen.getByText("BK261112TEST1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /สร้างสัญญา$/ })).toBeEnabled();
  });
});

describe("G02 booking history", () => {
  it("lists legacy and new-workflow bookings with the right tabs and actions", async () => {
    const { Route: BookingsRoute } = await import("@/routes/bookings");
    const Page = (BookingsRoute as unknown as { component: ComponentType }).component;
    mocks.tables = {
      bookings: [
        // legacy: paid before the migration, contract mapped to 'paid'
        {
          ...BOOKING,
          id: "b-old",
          booking_code: "BK261101LEGACY",
          status: "confirmed",
          hold_expires_at: null,
          reviews: null,
          contracts: { id: "ct-old", status: "paid", current_version: 1, sent_version: 1 },
        },
        // new workflow: contract sent, waiting for the customer
        {
          ...BOOKING,
          reviews: null,
          contracts: [
            { id: "ct-1", status: "pending_customer", current_version: 1, sent_version: 1 },
          ],
        },
      ],
    };
    renderWithQuery(<Page />);
    expect(await screen.findByText("BK261101LEGACY")).toBeInTheDocument();
    expect(screen.getByText("BK261112TEST1")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "รอตรวจสัญญา (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "ยืนยันแล้ว/กำลังเช่า (1)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ตรวจสอบสัญญา/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ดูสัญญาเช่า/ })).toBeInTheDocument();
  });
});

describe("booking-fee wording", () => {
  it("a booking-fee contract shows fee online and rent + deposit at pickup, not rent online", () => {
    const v = versionRow({
      terms: "สัญญาเช่ารถยนต์ ... ค่าจอง (ชำระออนไลน์หลังยืนยันสัญญา): 1,000.00 บาท",
    });
    renderWithQuery(
      <ContractView contract={contractRow()} versions={[v]} events={[]} audience="customer" />,
    );
    expect(screen.queryByText("ค่าเช่ารวม (ชำระออนไลน์)")).not.toBeInTheDocument();
    expect(screen.getByText("ค่าจอง (ชำระออนไลน์)")).toBeInTheDocument();
    // rent 2,970 + deposit 5,000 (fixture) - fee 1,000
    expect(screen.getByText(/6,970/)).toBeInTheDocument();
  });

  it("a contract signed before the fee keeps its original wording", () => {
    renderWithQuery(
      <ContractView
        contract={contractRow()}
        versions={[versionRow()]}
        events={[]}
        audience="customer"
      />,
    );
    expect(screen.getByText("ค่าเช่ารวม (ชำระออนไลน์)")).toBeInTheDocument();
    expect(screen.queryByText("ค่าจอง (ชำระออนไลน์)")).not.toBeInTheDocument();
  });

  it("booking list: rent label, fee breakdown for pending, cancel warns about the fee", async () => {
    const { Route: BookingsRoute } = await import("@/routes/bookings");
    const Page = (BookingsRoute as unknown as { component: ComponentType }).component;
    mocks.tables = {
      bookings: [
        {
          ...BOOKING,
          id: "b-paid",
          booking_code: "BK261114PAID1",
          status: "confirmed",
          hold_expires_at: null,
          reviews: null,
          contracts: { id: "ct-p", status: "paid", current_version: 1, sent_version: 1 },
        },
        {
          ...BOOKING,
          reviews: null,
          contracts: [
            { id: "ct-1", status: "pending_customer", current_version: 1, sent_version: 1 },
          ],
        },
      ],
    };
    renderWithQuery(<Page />);
    expect(await screen.findByText("BK261114PAID1")).toBeInTheDocument();
    expect(screen.queryByText("ยอดรวมสุทธิ")).not.toBeInTheDocument();
    expect(screen.getAllByText("ค่าเช่ารวม").length).toBe(2);
    // only the pending booking shows the fee split: 2,970 * 2 - 1,000
    expect(screen.getByTestId("fee-breakdown")).toHaveTextContent("4,940");
    expect(screen.getByRole("tab", { name: "ขอแก้ไขสัญญา (0)" })).toBeInTheDocument();

    const cancels = screen.getAllByRole("button", { name: /ยกเลิกการจอง/ });
    fireEvent.click(cancels[0]!); // the confirmed (paid) booking comes first
    expect(await screen.findByTestId("cancel-fee-warning")).toHaveTextContent("จะไม่ได้รับคืน");
  });

  it("admin overview hides the old 'waiting for admin approval' tile when nothing waits", async () => {
    const { ContractWorkQueue } = await import("@/components/admin/contracts-panel");
    renderWithQuery(<ContractWorkQueue contracts={[]} bookings={[]} onOpen={() => {}} />);
    expect(screen.queryByText(/รอผู้ดูแลอนุมัติ/)).not.toBeInTheDocument();
    renderWithQuery(
      <ContractWorkQueue
        contracts={[{ status: "pending_admin_review", booking_id: "b-1" }]}
        bookings={[]}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText(/รอผู้ดูแลอนุมัติ \(ระบบเดิม\)/)).toBeInTheDocument();
  });
});

describe("revision rules (name applied by the admin, at most 2 requests)", () => {
  const customerRequest = (i: number) => ({
    id: `e-${i}`,
    contract_id: "ct-1",
    booking_id: "b-1",
    version: i,
    actor_id: "cust-1",
    actor_role: "customer",
    action: "revision_requested",
    note: "ชื่อลูกค้า: ทดสอบ ลูกค้าเอ\nเวลารับรถ: 09:00 น.\nเวลาคืนรถ: 18:00 น.",
    created_at: inMinutes(-10 + i),
  });

  it("a new name in the request is not written to the profile by the customer", async () => {
    setup({ contract: contractRow(), versions: [versionRow()] });
    await screen.findByText(/ชำระ ณ วันรับรถ ไม่รวมในการชำระเงินออนไลน์/);
    expect(screen.getByTestId("revisions-left")).toHaveTextContent("ขอแก้ไขได้อีก 2 ครั้ง");
    fireEvent.click(screen.getByRole("button", { name: /ขอแก้ไขสัญญา/ }));
    fireEvent.change(await screen.findByLabelText("ชื่อลูกค้า"), {
      target: { value: "ทดสอบ ชื่อใหม่" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอแก้ไข" }));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        "customer_request_revision",
        expect.objectContaining({ _reason: expect.stringContaining("ชื่อลูกค้า: ทดสอบ ชื่อใหม่") }),
      ),
    );
    // the only database call is the request itself (the profile is not touched)
    expect(mocks.rpc.mock.calls.map((c) => c[0])).toEqual(["customer_request_revision"]);
    expect(fromSpy).not.toHaveBeenCalledWith("profiles");
  });

  it("after 2 requests the customer can only confirm or cancel", async () => {
    setup({
      contract: contractRow({ current_version: 3, sent_version: 3 }),
      versions: [versionRow({ version: 3 })],
      events: [customerRequest(1), customerRequest(2)],
    });
    await waitFor(() =>
      expect(screen.getByTestId("revisions-left")).toHaveTextContent("ขอแก้ไขครบ 2 ครั้งแล้ว"),
    );
    expect(screen.getByRole("button", { name: /ขอแก้ไขสัญญา/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ยืนยันสัญญาฉบับที่ 3" })).toBeInTheDocument();
  });

  it("applying a request with a new name sends the name to the database before the new version", async () => {
    mocks.tables = {
      contract_versions: [versionRow({ sent_at: inMinutes(-30) })],
      contract_events: [],
    };
    const requested = {
      ...contractRow({
        status: "revision_requested",
        revision_requested_by: "customer",
        revision_reason: "ชื่อลูกค้า: ทดสอบ ชื่อใหม่\nเวลารับรถ: 10:00 น.\nเวลาคืนรถ: 18:00 น.",
      }),
      bookings: BOOKING as unknown as PanelBooking,
    } as PanelContract;
    renderWithQuery(
      <AdminContractsPanel
        perms={dashboardPermissions("admin")}
        contracts={[requested]}
        bookings={[BOOKING as unknown as PanelBooking]}
        profileMap={{ "cust-1": { full_name: "ทดสอบ ลูกค้าเอ" } }}
        initialView="revision_requested"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "เปิดสัญญา" }));
    const card = await screen.findByTestId("customer-request");
    fireEvent.click(within(card).getByRole("button", { name: /ยืนยันการแก้ไขและส่งให้ลูกค้า/ }));
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith("admin_send_contract", { _contract_id: "ct-1" }),
    );
    const order = mocks.rpc.mock.calls.map((c) => c[0]);
    expect(order).toEqual([
      "admin_apply_requested_name",
      "admin_update_contract",
      "admin_send_contract",
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("admin_apply_requested_name", {
      _contract_id: "ct-1",
      _name: "ทดสอบ ชื่อใหม่",
    });
  });
});

describe("7. review stars are named for screen readers", () => {
  it("each star is a radio with its number of stars", async () => {
    const { Route: BookingsRoute } = await import("@/routes/bookings");
    const Page = (BookingsRoute as unknown as { component: ComponentType }).component;
    mocks.tables = {
      bookings: [
        {
          ...BOOKING,
          status: "completed",
          hold_expires_at: null,
          reviews: null,
          contracts: { id: "ct-1", status: "paid", current_version: 1, sent_version: 1 },
        },
      ],
    };
    renderWithQuery(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "เขียนรีวิว" }));
    expect(await screen.findByRole("radiogroup", { name: "คะแนนความพึงพอใจ" })).toBeInTheDocument();
    const four = screen.getByRole("radio", { name: "4 ดาว" });
    fireEvent.click(four);
    expect(four).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "5 ดาว" })).toHaveAttribute("aria-checked", "false");
  });
});
