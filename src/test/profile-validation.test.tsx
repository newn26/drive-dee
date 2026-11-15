/**
 * B2-B4: the profile page checks licence, phone and ID card before saving; B1: the admin
 * car form rejects a price of 0 or less. Router, auth and Supabase are mocked; fictional data.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  upsert: vi.fn(),
  // stable like the real hook (the page refills the form when `user` changes)
  auth: {
    user: { id: "cust-1", email: "c@example.test", user_metadata: {} },
    isDemo: false,
    loading: false,
  },
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) q[m] = () => q;
      q["maybeSingle"] = () => Promise.resolve({ data: mocks.profile, error: null });
      q["upsert"] = (row: unknown) => {
        mocks.upsert(row);
        return Promise.resolve({ error: null });
      };
      return q;
    },
    auth: { signInWithPassword: vi.fn(), updateUser: vi.fn() },
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (opts: Record<string, unknown>) => opts,
    Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
    useNavigate: () => vi.fn(),
  };
});

import { Route as ProfileRoute } from "@/routes/profile";
import { isValidThaiId, profileErrors } from "@/lib/profile-validation";
import { carFormError } from "@/lib/car-validation";

const ProfilePage = (ProfileRoute as unknown as { component: ComponentType }).component;

afterEach(() => vi.clearAllMocks());

const VALID = {
  fullName: "ทดสอบ ลูกค้าเอ",
  phone: "081-234-5678",
  idCardNo: "1101700230708",
  licenseNo: "64001234",
};

describe("profile rules", () => {
  it("accepts a valid profile, a passport and an empty ID card", () => {
    expect(profileErrors(VALID)).toEqual({});
    expect(profileErrors({ ...VALID, idCardNo: "AA1234567" })).toEqual({});
    expect(profileErrors({ ...VALID, phone: "" })).toEqual({});
    expect(profileErrors({ ...VALID, idCardNo: "" }).idCardNo).toMatch(/จองรถได้/);
  });

  it("B2 licence is required; B3 phone 'abc12' and B4 ID '123' are rejected", () => {
    expect(profileErrors({ ...VALID, licenseNo: "  " }).licenseNo).toMatch(/กรุณากรอก/);
    expect(profileErrors({ ...VALID, phone: "abc12" }).phone).toMatch(/เบอร์โทรศัพท์ไม่ถูกต้อง/);
    expect(profileErrors({ ...VALID, phone: "0812" }).phone).toBeDefined();
    expect(profileErrors({ ...VALID, idCardNo: "123" }).idCardNo).toMatch(/13 หลัก/);
  });

  it("checks the Thai ID check digit", () => {
    expect(isValidThaiId("1101700230708")).toBe(true);
    expect(isValidThaiId("1101700230709")).toBe(false);
    expect(isValidThaiId("110170023070")).toBe(false);
  });
});

describe("profile page", () => {
  async function renderPage() {
    mocks.profile = {
      id: "cust-1",
      full_name: "ทดสอบ ลูกค้าเอ",
      phone: "0812345678",
      address: "",
      license_no: "",
      id_card_no: "",
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ProfilePage />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/ชื่อ-นามสกุล/)).toHaveValue("ทดสอบ ลูกค้าเอ"),
    );
  }
  const field = (label: RegExp, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const save = () => fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));

  it("does not save an empty licence, phone 'abc12' or ID '123', and says why", async () => {
    await renderPage();
    field(/เบอร์โทรศัพท์/, "abc12");
    field(/เลขบัตรประชาชน/, "123");
    save();
    expect(await screen.findByText(/กรุณากรอกหมายเลขใบอนุญาตขับขี่/)).toBeInTheDocument();
    expect(screen.getByText(/เบอร์โทรศัพท์ไม่ถูกต้อง/)).toBeInTheDocument();
    expect(screen.getByText(/เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก/)).toBeInTheDocument();
    expect(screen.getByLabelText(/ใบอนุญาตขับขี่รถยนต์/)).toHaveAttribute("aria-invalid", "true");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("saves valid values, normalised", async () => {
    await renderPage();
    field(/เบอร์โทรศัพท์/, "081-234-5678");
    field(/เลขบัตรประชาชน/, "1-1017-00230-70-8");
    field(/ใบอนุญาตขับขี่รถยนต์/, "6400 1234");
    save();
    await waitFor(() =>
      expect(mocks.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: "0812345678",
          id_card_no: "1101700230708",
          license_no: "64001234",
        }),
      ),
    );
  });
});

describe("B1 admin car form", () => {
  const ok = { price_per_day: 1200, seats: 5, mileage: 0, year: 2022 };
  it("rejects a price of -100 or 0, and bad seats/mileage/year", () => {
    expect(carFormError(ok)).toBeNull();
    expect(carFormError({ ...ok, price_per_day: -100 })).toMatch(/มากกว่า 0/);
    expect(carFormError({ ...ok, price_per_day: 0 })).toMatch(/มากกว่า 0/);
    expect(carFormError({ ...ok, price_per_day: Number.NaN })).toMatch(/มากกว่า 0/);
    expect(carFormError({ ...ok, seats: 0 })).toMatch(/ที่นั่ง/);
    expect(carFormError({ ...ok, mileage: -5 })).toMatch(/ไมล์/);
    expect(carFormError({ ...ok, year: 1800 })).toMatch(/ปีรถ/);
  });
});
