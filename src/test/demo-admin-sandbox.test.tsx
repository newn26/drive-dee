/**
 * Public Demo Admin: the admin dashboard runs on in-browser sample data and never calls the
 * real database. The real Supabase client is replaced by spies that fail the test if the
 * sandbox ever lets a read or write through.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const real = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: real.from,
    rpc: real.rpc,
    auth: { getUser: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() },
  },
}));
vi.mock("@/hooks/use-auth", () => ({
  // Signed out: the demo needs no account
  useAuth: () => ({ user: null, role: "customer", adminMember: null, loading: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (opts: Record<string, unknown>) => ({ ...opts }),
    Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
    useNavigate: () => vi.fn(),
  };
});

import { AdminDashboard } from "@/routes/admin";
import { setSandboxClient } from "@/lib/db";
import { Sandbox } from "@/lib/demo-sandbox";
import { syncCarStatus } from "@/lib/car-status";
import { createContract, fetchAdminMembers, sendContract } from "@/lib/contract-api";
import { DEFAULT_CONTRACT_FORM } from "@/lib/contract-workflow";
import { toast } from "sonner";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  setSandboxClient(null);
  vi.clearAllMocks();
});

function renderDemo() {
  const sandbox = new Sandbox();
  setSandboxClient(sandbox as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AdminDashboard mode="demo" />
    </QueryClientProvider>,
  );
  return sandbox;
}

describe("Demo Admin sandbox", () => {
  it("opens without an account, shows sample data and the demo banner", async () => {
    renderDemo();
    expect(await screen.findByTestId("contract-work-queue")).toBeInTheDocument();
    expect(screen.getByText(/ข้อมูลตัวอย่าง/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ผู้ดูแลระบบ \(Owner\)/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /รายการจองของลูกค้า/ }));
    expect(await screen.findByText("BKDEMO005")).toBeInTheDocument();
    expect(real.from).not.toHaveBeenCalled();
    expect(real.rpc).not.toHaveBeenCalled();
  });

  it("actions change the sample data only, never the real database", async () => {
    const sandbox = renderDemo();
    await screen.findByTestId("contract-work-queue");

    const booking = sandbox.tables.bookings.find(
      (b: { booking_code: string }) => b.booking_code === "BKDEMO001",
    );
    const id = await createContract(
      booking.id,
      DEFAULT_CONTRACT_FORM,
      booking.start_date,
      booking.end_date,
    );
    await sendContract(id);
    expect(sandbox.tables.contracts.find((c: { id: string }) => c.id === id).status).toBe(
      "pending_customer",
    );

    await syncCarStatus("car-1");
    expect(await fetchAdminMembers()).toHaveLength(3);

    await waitFor(() => expect(toast.error).not.toHaveBeenCalled());
    expect(real.from).not.toHaveBeenCalled();
    expect(real.rpc).not.toHaveBeenCalled();
  });

  it("follows the real rules: a car with bookings cannot be deleted, a booking cannot be confirmed by hand", async () => {
    const sandbox = new Sandbox();
    const del = await sandbox.from("cars").delete().eq("id", "car-1");
    expect(del.error?.code).toBe("23503");
    const upd = await sandbox
      .from("bookings")
      .update({ status: "confirmed" })
      .eq("id", "booking-1");
    expect(upd.error).not.toBeNull();
    const free = await sandbox.from("cars").delete().eq("id", "car-7");
    expect(free.error).toBeNull();
    expect(sandbox.tables.maintenance.some((m: { car_id: string }) => m.car_id === "car-7")).toBe(
      false,
    );
  });

  it("goes back to the real client when the demo page closes", async () => {
    const { db } = await import("@/lib/db");
    setSandboxClient(new Sandbox() as never);
    setSandboxClient(null);
    real.from.mockReturnValue({ select: () => Promise.resolve({ data: [], error: null }) });
    await db.from("cars").select("*");
    expect(real.from).toHaveBeenCalledWith("cars");
  });
});
