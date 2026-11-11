import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: { authCallback: ((event: string, session: unknown) => void) | null } = {
    authCallback: null,
  };
  return {
    state,
    getSession: vi.fn(),
    updateUser: vi.fn(),
    unsubscribe: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        mocks.state.authCallback = cb;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      },
      getSession: mocks.getSession,
      updateUser: mocks.updateUser,
    },
  },
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

import { RECOVERY_SESSION_TIMEOUT_MS, ResetPasswordForm } from "@/components/reset-password-form";
import { recoveryLinkError, validateNewPassword } from "@/lib/password";

describe("Reset link routing", () => {
  it("keeps ?reset=true whether the router parses it as a boolean or a string", async () => {
    const { Route } = await import("@/routes/auth");
    const validate = Route.options.validateSearch as (s: Record<string, unknown>) => {
      reset?: boolean;
    };
    expect(validate({ reset: true })).toEqual({ reset: true });
    expect(validate({ reset: "true" })).toEqual({ reset: true });
    expect(validate({})).toEqual({ reset: undefined });
    expect(validate({ reset: "nope" })).toEqual({ reset: undefined });
  });
});

describe("Password rules", () => {
  it("requires 6+ characters and a matching confirmation", () => {
    expect(validateNewPassword("12345", "12345")).not.toBeNull();
    expect(validateNewPassword("123456", "1234567")).not.toBeNull();
    expect(validateNewPassword("123456", "123456")).toBeNull();
  });

  it("reads Supabase link errors from the hash or query", () => {
    expect(
      recoveryLinkError("#error=access_denied&error_code=otp_expired&error_description=x", ""),
    ).toMatch("หมดอายุ");
    expect(recoveryLinkError("", "?reset=true&error=server_error&error_description=x")).toMatch(
      "ไม่ถูกต้อง",
    );
    expect(recoveryLinkError("#access_token=abc&type=recovery", "?reset=true")).toBeNull();
  });
});

describe("Reset password form", () => {
  beforeEach(() => {
    mocks.state.authCallback = null;
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    mocks.updateUser.mockResolvedValue({ error: null });
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    window.location.hash = "";
  });

  const renderForm = () => {
    const onDone = vi.fn();
    const onRequestNewLink = vi.fn();
    render(<ResetPasswordForm onDone={onDone} onRequestNewLink={onRequestNewLink} />);
    return { onDone, onRequestNewLink };
  };

  const fill = (pw: string, confirm: string) => {
    fireEvent.change(screen.getByLabelText("รหัสผ่านใหม่"), { target: { value: pw } });
    fireEvent.change(screen.getByLabelText("ยืนยันรหัสผ่านใหม่"), { target: { value: confirm } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกรหัสผ่านใหม่" }));
  };

  it("shows the form once Supabase reports the recovery session", async () => {
    renderForm();
    expect(screen.getByText("กำลังตรวจสอบลิงก์รีเซ็ตรหัสผ่าน...")).toBeInTheDocument();
    act(() => mocks.state.authCallback?.("PASSWORD_RECOVERY", { user: { id: "u1" } }));
    expect(await screen.findByLabelText("รหัสผ่านใหม่")).toBeInTheDocument();
  });

  it("does not call Supabase when the passwords do not match", async () => {
    renderForm();
    act(() => mocks.state.authCallback?.("PASSWORD_RECOVERY", { user: { id: "u1" } }));
    await screen.findByLabelText("รหัสผ่านใหม่");
    fill("newpass1", "newpass2");
    expect(mocks.toastError).toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("updates the password and finishes", async () => {
    const { onDone } = renderForm();
    act(() => mocks.state.authCallback?.("PASSWORD_RECOVERY", { user: { id: "u1" } }));
    await screen.findByLabelText("รหัสผ่านใหม่");
    fill("newpass1", "newpass1");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "newpass1" });
    expect(screen.getByText("ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว")).toBeInTheDocument();
  });

  it("shows Supabase's error and stays on the form when the update fails", async () => {
    mocks.updateUser.mockResolvedValue({
      error: { message: "New password should be different from the old password." },
    });
    const { onDone } = renderForm();
    act(() => mocks.state.authCallback?.("PASSWORD_RECOVERY", { user: { id: "u1" } }));
    await screen.findByLabelText("รหัสผ่านใหม่");
    fill("newpass1", "newpass1");
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม"),
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByLabelText("รหัสผ่านใหม่")).toBeInTheDocument();
  });

  it("explains an expired link and offers a new one", () => {
    window.location.hash = "#error=access_denied&error_code=otp_expired&error_description=expired";
    const { onRequestNewLink } = renderForm();
    expect(screen.getByRole("alert")).toHaveTextContent("หมดอายุ");
    fireEvent.click(screen.getByRole("button", { name: "ขอลิงก์รีเซ็ตรหัสผ่านใหม่" }));
    expect(onRequestNewLink).toHaveBeenCalled();
  });

  it("treats a link with no recovery session as invalid after the timeout", async () => {
    vi.useFakeTimers();
    renderForm();
    await act(async () => {
      vi.advanceTimersByTime(RECOVERY_SESSION_TIMEOUT_MS + 10);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("ไม่ถูกต้องหรือหมดอายุ");
    expect(screen.queryByLabelText("รหัสผ่านใหม่")).not.toBeInTheDocument();
  });
});
