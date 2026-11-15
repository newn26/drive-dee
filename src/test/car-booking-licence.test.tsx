/**
 * Car page: a customer without a driving licence number cannot book. Router, auth and
 * Supabase are mocked; the database also refuses such a booking (src/test/db). Fictional data only.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
};

const mocks = vi.hoisted(() => ({
  // stable object, like the real auth hook
  auth: { user: { id: "cust-1", email: "c@example.test" } as { id: string; email?: string } | null },
  profile: Promise.resolve({ data: null as unknown, error: null }),
  insert: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const table = (t: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) q[m] = () => q;
    q["maybeSingle"] = () =>
      t === "profiles" ? mocks.profile : Promise.resolve({ data: t === "cars" ? CAR : null, error: null });
    q["insert"] = (row: unknown) => {
      mocks.insert(t, row);
      return q;
    };
    q["single"] = () => Promise.resolve({ data: { id: "b-new" }, error: null });
    q["then"] = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve);
    return q;
  };
  return {
    supabase: { from: table, rpc: () => Promise.resolve({ data: [], error: null }) },
  };
});
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (opts: Record<string, unknown>) => ({
      ...opts,
      useParams: () => ({ id: "car-1" }),
    }),
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
    useNavigate: () => vi.fn(),
  };
});

import { Route } from "@/routes/cars_.$id";

const CarDetail = (Route as unknown as { component: ComponentType }).component;

afterEach(() => {
  vi.clearAllMocks();
  mocks.auth = { user: { id: "cust-1", email: "c@example.test" } };
});

const withProfile = (license_no: string) => {
  mocks.profile = Promise.resolve({
    data: { id: "cust-1", full_name: "ทดสอบ ลูกค้า", license_no },
    error: null,
  });
};

function renderCar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CarDetail />
    </QueryClientProvider>,
  );
}

describe("booking needs a driving licence", () => {
  it("a logged-in customer without a licence cannot book and is pointed to the profile", async () => {
    withProfile("  ");
    renderCar();
    const alert = await screen.findByText(/กรุณากรอกเลขใบอนุญาตขับขี่ในโปรไฟล์ก่อนจองรถ/);
    expect(alert.closest("[role=alert]")!.querySelector("a")).toHaveAttribute("href", "/profile");
    const button = screen.getByRole("button", { name: "จองรถคันนี้" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("a customer with a licence can book", async () => {
    withProfile("TEST-0001");
    renderCar();
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "จองรถคันนี้" })).toBeEnabled());
    expect(screen.queryByText(/กรุณากรอกเลขใบอนุญาตขับขี่/)).not.toBeInTheDocument();
  });

  it("while the profile is loading the button stays disabled", async () => {
    mocks.profile = new Promise(() => {});
    renderCar();
    expect(await screen.findByRole("button", { name: "จองรถคันนี้" })).toBeDisabled();
  });

  it("a logged-out visitor still gets an enabled sign-in button", async () => {
    mocks.auth = { user: null };
    renderCar();
    expect(await screen.findByRole("button", { name: "เข้าสู่ระบบเพื่อจอง" })).toBeEnabled();
  });
});
