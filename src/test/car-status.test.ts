import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { computeCarStatus } from "@/lib/car-status";

const TODAY = "2026-11-11";

describe("computeCarStatus", () => {
  it("keeps a manual 'unavailable' no matter what", () => {
    expect(
      computeCarStatus(
        "unavailable",
        [{ status: "in_progress", scheduled_date: TODAY }],
        true,
        TODAY,
      ),
    ).toBe("unavailable");
  });

  it("is 'maintenance' while a job is in progress", () => {
    expect(
      computeCarStatus(
        "available",
        [{ status: "in_progress", scheduled_date: "2026-11-01" }],
        false,
        TODAY,
      ),
    ).toBe("maintenance");
  });

  it("is 'maintenance' when a scheduled job is due today or overdue, not before", () => {
    expect(
      computeCarStatus("available", [{ status: "scheduled", scheduled_date: TODAY }], false, TODAY),
    ).toBe("maintenance");
    expect(
      computeCarStatus(
        "available",
        [{ status: "scheduled", scheduled_date: "2026-11-20" }],
        false,
        TODAY,
      ),
    ).toBe("available");
  });

  it("goes back to 'available' when all jobs are completed", () => {
    expect(
      computeCarStatus(
        "maintenance",
        [{ status: "completed", scheduled_date: TODAY }],
        false,
        TODAY,
      ),
    ).toBe("available");
  });

  it("is 'rented' with an active booking and no maintenance", () => {
    expect(computeCarStatus("available", [], true, TODAY)).toBe("rented");
  });

  it("maintenance wins over an active booking", () => {
    expect(
      computeCarStatus("rented", [{ status: "in_progress", scheduled_date: TODAY }], true, TODAY),
    ).toBe("maintenance");
  });
});
