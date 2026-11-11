import { describe, expect, it } from "vitest";
import { dashboardPermissions, homeForRole, resolveRole } from "@/lib/roles";

describe("resolveRole", () => {
  it("defaults to customer", () => {
    expect(resolveRole(null)).toBe("customer");
    expect(resolveRole([])).toBe("customer");
    expect(resolveRole([{ role: "customer" }])).toBe("customer");
  });

  it("picks the strongest role", () => {
    expect(resolveRole([{ role: "customer" }, { role: "demo_admin" }])).toBe("demo_admin");
    expect(resolveRole([{ role: "demo_admin" }, { role: "admin" }])).toBe("admin");
  });

  it("ignores unknown role names", () => {
    expect(resolveRole([{ role: "superuser" }])).toBe("customer");
  });
});

describe("dashboardPermissions", () => {
  it("gives customers nothing", () => {
    expect(Object.values(dashboardPermissions("customer")).every((v) => v === false)).toBe(true);
  });

  it("gives admins everything", () => {
    expect(Object.values(dashboardPermissions("admin")).every((v) => v === true)).toBe(true);
  });

  it("lets demo admins work but never delete, edit contracts or moderate reviews", () => {
    const p = dashboardPermissions("demo_admin");
    expect(p).toMatchObject({
      viewDashboard: true,
      addEditCars: true,
      updateBookingStatus: true,
      viewContracts: true,
      manageMaintenance: true,
      viewReports: true,
      deleteCars: false,
      editContracts: false,
      moderateReviews: false,
    });
  });
});

describe("homeForRole", () => {
  it("sends each role to its own page", () => {
    expect(homeForRole("admin")).toBe("/admin");
    expect(homeForRole("demo_admin")).toBe("/demo-admin");
    expect(homeForRole("customer")).toBe("/");
  });
});
