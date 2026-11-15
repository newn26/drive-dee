/**
 * Changing the password needs the current password first (profile page).
 * Supabase auth is mocked; fictional data only.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { signInWithPassword: mocks.signInWithPassword, updateUser: mocks.updateUser },
  },
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

import { ChangePasswordCard } from "@/components/change-password-card";
import { validatePasswordChange } from "@/lib/password";

afterEach(() => vi.clearAllMocks());

const fill = (current: string, next: string, confirm: string) => {
  fireEvent.change(screen.getByLabelText("รหัสผ่านปัจจุบัน"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("รหัสผ่านใหม่"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("ยืนยันรหัสผ่านใหม่"), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }));
};

describe("password change rules", () => {
  it("needs the current password, 6+ characters, a match, and a different password", () => {
    expect(validatePasswordChange("", "newpass1", "newpass1")).toMatch(/รหัสผ่านปัจจุบัน/);
    expect(validatePasswordChange("oldpass1", "12345", "12345")).toMatch(/อย่างน้อย 6/);
    expect(validatePasswordChange("oldpass1", "newpass1", "newpass2")).toMatch(/ไม่ตรงกัน/);
    expect(validatePasswordChange("samepass", "samepass", "samepass")).toMatch(/ไม่ซ้ำ/);
    expect(validatePasswordChange("oldpass1", "newpass1", "newpass1")).toBeNull();
  });
});

describe("change password card", () => {
  it("checks the current password, then saves the new one", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    mocks.updateUser.mockResolvedValue({ data: {}, error: null });
    render(<ChangePasswordCard email="user@example.test" isDemo={false} />);
    fill("oldpass1", "newpass1", "newpass1");
    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith({ password: "newpass1" }));
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.test",
      password: "oldpass1",
    });
    expect(mocks.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateUser.mock.invocationCallOrder[0]!,
    );
    expect(mocks.toastSuccess).toHaveBeenCalled();
    expect(screen.getByLabelText("รหัสผ่านปัจจุบัน")).toHaveValue("");
  });

  it("a wrong current password stops the change", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: "Invalid login credentials" },
    });
    render(<ChangePasswordCard email="user@example.test" isDemo={false} />);
    fill("wrongpass", "newpass1", "newpass1");
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("รหัสผ่านปัจจุบันไม่ถูกต้อง"),
    );
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("invalid input never reaches Supabase", () => {
    render(<ChangePasswordCard email="user@example.test" isDemo={false} />);
    fill("oldpass1", "newpass1", "different");
    expect(mocks.toastError).toHaveBeenCalledWith("รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน");
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("demo accounts cannot change the password", () => {
    render(<ChangePasswordCard email="demo@demo.siamwheels.invalid" isDemo />);
    expect(screen.getByTestId("demo-password-note")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" })).toBeDisabled();
    expect(screen.getByLabelText("รหัสผ่านปัจจุบัน")).toBeDisabled();
  });
});
