import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Thenable stand-in for a Supabase query builder: every call returns itself. */
const builder = (result: unknown, calls: string[] = []) => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "delete"]) {
    q[m] = (...args: unknown[]) => {
      calls.push(`${m}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      return q;
    };
  }
  q["then"] = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return q;
};

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mocks.getUser }, from: mocks.from },
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

import { deleteReviewAsAdmin } from "@/lib/admin-reviews";
import { AdminReviewsPanel } from "@/components/admin/reviews-panel";

const REVIEW = {
  id: "rev-1",
  booking_id: "b-1",
  car_id: "car-1",
  user_id: "cust-1",
  reviewer_name: "สมชาย",
  rating: 1,
  comment: "ข้อความไม่เหมาะสม",
  created_at: "2026-11-01T03:00:00Z",
  cars: { brand: "Toyota", model: "Yaris", plate_no: "1กข 1234" },
  bookings: { booking_code: "BK261101ABCDE" },
};

/** Route supabase.from(table) to per-table results. */
const tables = (byTable: Record<string, unknown>, calls: string[] = []) =>
  mocks.from.mockImplementation((table: string) => {
    calls.push(`from(${table})`);
    return builder(byTable[table], calls);
  });

afterEach(() => vi.clearAllMocks());

describe("deleteReviewAsAdmin — authorization", () => {
  it("refuses when nobody is signed in", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const calls: string[] = [];
    tables({}, calls);
    expect(await deleteReviewAsAdmin("rev-1")).toMatchObject({
      ok: false,
      reason: "not_signed_in",
    });
    expect(calls).toEqual([]);
  });

  it("refuses a signed-in customer without touching the reviews table", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "cust-1" } }, error: null });
    const calls: string[] = [];
    tables({ user_roles: { data: [], error: null } }, calls);
    expect(await deleteReviewAsAdmin("rev-1")).toMatchObject({ ok: false, reason: "not_admin" });
    expect(calls).not.toContain("from(reviews)");
  });

  it("treats a delete that removed no row (blocked by row-level security) as a failure", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    tables({
      user_roles: { data: [{ role: "admin" }], error: null },
      reviews: { data: [], error: null },
    });
    expect(await deleteReviewAsAdmin("rev-1")).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("deletes exactly the chosen review for an admin", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    const calls: string[] = [];
    tables(
      {
        user_roles: { data: [{ role: "admin" }], error: null },
        reviews: { data: [{ id: "rev-1" }], error: null },
      },
      calls,
    );
    expect(await deleteReviewAsAdmin("rev-1")).toEqual({ ok: true });
    expect(calls).toContain('eq("id","rev-1")');
    expect(calls).toContain("delete()");
  });

  it("returns database errors instead of throwing", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    tables({
      user_roles: { data: [{ role: "admin" }], error: null },
      reviews: { data: null, error: { message: "denied" } },
    });
    expect(await deleteReviewAsAdmin("rev-1")).toEqual({
      ok: false,
      reason: "error",
      message: "denied",
    });
  });
});

describe("Admin reviews panel", () => {
  const renderPanel = (isAdmin = true) =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AdminReviewsPanel isAdmin={isAdmin} />
      </QueryClientProvider>,
    );

  it("renders nothing and loads nothing for non-admins", () => {
    const { container } = renderPanel(false);
    expect(container).toBeEmptyDOMElement();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("asks for confirmation and does not delete when cancelled", async () => {
    const calls: string[] = [];
    tables({ reviews: { data: [REVIEW], error: null } }, calls);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "ลบรีวิวของ สมชาย" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("ข้อความไม่เหมาะสม")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "ยกเลิก" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls).not.toContain("delete()");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("deletes after confirmation and reports success", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    const calls: string[] = [];
    tables(
      {
        reviews: { data: [REVIEW], error: null },
        user_roles: { data: [{ role: "admin" }], error: null },
      },
      calls,
    );
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "ลบรีวิวของ สมชาย" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "ยืนยันการลบรีวิว" }),
    );

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("ลบรีวิวเรียบร้อยแล้ว"));
    expect(calls).toContain("delete()");
    expect(calls).toContain('eq("id","rev-1")');
  });

  it("shows the error and keeps the review when deletion is refused", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "cust-1" } }, error: null });
    tables({ reviews: { data: [REVIEW], error: null }, user_roles: { data: [], error: null } });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "ลบรีวิวของ สมชาย" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "ยืนยันการลบรีวิว" }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("เฉพาะผู้ดูแลระบบเท่านั้นที่ลบรีวิวได้"),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
