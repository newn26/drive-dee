import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LanguageSwitch } from "@/components/site-header";
import { PrototypeNotice } from "@/components/prototype-notice";
import { LanguageProvider, getLang, tr, trError } from "@/lib/i18n";
import { adminPermissionLabel } from "@/lib/contract-api";
import { bookingStatusLabel, categoryLabel, pickupLocationLabel, thb } from "@/lib/format";
import { profileErrors } from "@/lib/profile-validation";

/** Like every page: text is computed when the component renders, inside the provider. */
function Labels() {
  return (
    <>
      <p data-testid="status">{bookingStatusLabel["confirmed"]}</p>
      <p data-testid="money">{thb(1000)}</p>
    </>
  );
}

function Page() {
  return (
    <LanguageProvider>
      <LanguageSwitch />
      <PrototypeNotice />
      <Labels />
    </LanguageProvider>
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("TH / EN switch", () => {
  it("starts in Thai", () => {
    render(<Page />);
    expect(screen.getByRole("note")).toHaveTextContent("ระบบต้นแบบ (DEMO)");
    expect(screen.getByTestId("status")).toHaveTextContent("ยืนยันแล้ว");
    expect(screen.getByTestId("language-switch")).toHaveTextContent("EN");
  });

  it("switches the page to English and back, and remembers the choice", () => {
    const { unmount } = render(<Page />);
    fireEvent.click(screen.getByTestId("language-switch"));
    expect(screen.getByRole("note", { name: "Prototype notice" })).toHaveTextContent(
      "Prototype (DEMO)",
    );
    expect(screen.getByRole("note")).toHaveTextContent("No real payments are made");
    expect(screen.getByTestId("status")).toHaveTextContent("Confirmed");
    expect(screen.getByTestId("money")).toHaveTextContent("฿1,000");
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("drive-dee-lang")).toBe("en");
    unmount();

    // A new visit reads the saved choice
    render(<Page />);
    expect(screen.getByTestId("status")).toHaveTextContent("Confirmed");
    fireEvent.click(screen.getByTestId("language-switch"));
    expect(screen.getByTestId("status")).toHaveTextContent("ยืนยันแล้ว");
    expect(localStorage.getItem("drive-dee-lang")).toBe("th");
  });

  it("shows the switch everywhere, admin labels included", () => {
    localStorage.setItem("drive-dee-lang", "en");
    function AdminLabel() {
      return <p data-testid="perm">{adminPermissionLabel.fleet_manage}</p>;
    }
    render(
      <LanguageProvider>
        <LanguageSwitch />
        <AdminLabel />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("language-switch")).toHaveTextContent("ไทย");
    expect(screen.getByTestId("perm")).toHaveTextContent("Manage cars and maintenance");
  });
});

describe("English text helpers", () => {
  const inEnglish = (fn: () => void) => {
    localStorage.setItem("drive-dee-lang", "en");
    render(
      <LanguageProvider>
        <span />
      </LanguageProvider>,
    );
    expect(getLang()).toBe("en");
    act(fn);
  };

  it("translates labels, pickup points and validation messages", () => {
    inEnglish(() => {
      expect(tr("ไทย", "English")).toBe("English");
      expect(categoryLabel["van"]).toBe("Van");
      expect(pickupLocationLabel("สนามบินสุวรรณภูมิ")).toBe("Suvarnabhumi Airport");
      expect(pickupLocationLabel("Somewhere new")).toBe("Somewhere new");
      expect(
        profileErrors({ fullName: "A", phone: "", idCardNo: "", licenseNo: "12345678" }).idCardNo,
      ).toMatch(/required to book/);
    });
  });

  it("translates the database's Thai error messages, and leaves unknown ones as they are", () => {
    inEnglish(() => {
      expect(
        trError(
          "กรุณากรอกเลขบัตรประชาชน (หรือพาสปอร์ต) และเลขใบอนุญาตขับขี่ในหน้าโปรไฟล์ก่อนจองรถ",
        ),
      ).toMatch(/ID card .* driving licence number to your profile/);
      expect(
        trError("ขอแก้ไขสัญญาได้สูงสุด 2 ครั้งต่อการจอง กรุณายืนยันสัญญาหรือยกเลิกการจอง"),
      ).toMatch(/at most 2 times/);
      expect(trError("Some other error")).toBe("Some other error");
    });
  });

  it("in Thai, database messages are shown unchanged", () => {
    render(
      <LanguageProvider>
        <span />
      </LanguageProvider>,
    );
    expect(trError("รถคันนี้ไม่พร้อมให้เช่า")).toBe("รถคันนี้ไม่พร้อมให้เช่า");
  });
});
