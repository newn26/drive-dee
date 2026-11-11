import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoadError } from "@/components/load-error";

describe("LoadError", () => {
  it("announces the failure and retries on click", () => {
    const onRetry = vi.fn();
    render(<LoadError title="โหลดข้อมูลรถไม่สำเร็จ" onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("โหลดข้อมูลรถไม่สำเร็จ");
    fireEvent.click(screen.getByRole("button", { name: /ลองใหม่/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("has no retry button when no retry is possible", () => {
    render(<LoadError title="ไม่พบรถคันนี้" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
