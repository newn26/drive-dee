/**
 * Profile form refuses to save invalid details (B2–B4). Router, auth and Supabase are mocked.
 * Fictional data only.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  // stable object, like the real auth hook: a new one each render would re-run the form's fill effect
  auth: { user: { id: "cust-1", email: "c@example.test", user_metadata: {} }, isDemo: false, loading: false },
}));

vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) q[m] = () => q;
  q["maybeSingle"] = () =>
    Promise.resolve({
      data: {
        id: "cust-1",
        full_name: "ทดสอบ ลูกค้า",
        phone: "0812345678",
        address: "",
        license_no: "12345678",
        id_card_no: "1103700012345",
      },
      error: null,
    });
  q["upsert"] = (row: unknown) => {
    mocks.upsert(row);
    return Promise.resolve({ error: null });
  };
  return { supabase: { from: () => q, auth: { updateUser: vi.fn() } } };
});
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (opts: Record<string, unknown>) => opts,
    useNavigate: () => vi.fn(),
  };
});

import { Route } from "@/routes/profile";

const ProfilePage = (Route as unknown as { component: ComponentType }).component;

afterEach(() => vi.clearAllMocks());

async function renderProfile() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProfilePage />
    </QueryClientProvider>,
  );
  // wait until the saved profile has filled the form
  await vi.waitFor(() => expect(screen.getByLabelText(/ใบอนุญาตขับขี่/)).toHaveValue("12345678"));
}

const save = () => fireEvent.submit(screen.getByRole("button", { name: /บันทึกข้อมูลส่วนตัว/ }).closest("form")!);

describe("profile form validation", () => {
  it.each([
    ["B2 empty driver's license", /ใบอนุญาตขับขี่/, "", /กรุณาระบุหมายเลขใบอนุญาตขับขี่/],
    ["B3 phone 'abc12'", /เบอร์โทรศัพท์/, "abc12", /เบอร์โทรศัพท์ไม่ถูกต้อง/],
    ["B4 ID '123'", /เลขบัตรประชาชน/, "123", /เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก/],
  ])("does not save with %s and shows why", async (_name, label, value, message) => {
    await renderProfile();
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    save();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("saves valid details, normalising separators", async () => {
    await renderProfile();
    fireEvent.change(screen.getByLabelText(/เบอร์โทรศัพท์/), { target: { value: "081-234-5678" } });
    save();
    await vi.waitFor(() => expect(mocks.upsert).toHaveBeenCalledTimes(1));
    expect(mocks.upsert.mock.calls[0]![0]).toMatchObject({
      phone: "0812345678",
      license_no: "12345678",
      id_card_no: "1103700012345",
    });
  });
});
