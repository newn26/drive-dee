import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PROTOTYPE_NOTICE_TEXT, PrototypeNotice } from "@/components/prototype-notice";

describe("Prototype notice", () => {
  it("tells every visitor this is a demo with no real payments or personal data", () => {
    render(<PrototypeNotice />);
    const note = screen.getByRole("note", { name: "ประกาศระบบต้นแบบ" });
    expect(note).toHaveTextContent("ระบบต้นแบบ (DEMO)");
    expect(note).toHaveTextContent("ไม่มีการชำระเงินจริง");
    expect(note).toHaveTextContent("อย่ากรอกข้อมูลส่วนตัวจริง");
    expect(PROTOTYPE_NOTICE_TEXT).toContain("เลขบัตรประชาชน");
  });

  it("stays visible when printing, so printed demo contracts are marked too", () => {
    render(<PrototypeNotice />);
    expect(screen.getByRole("note").className).not.toContain("print:hidden");
  });
});
