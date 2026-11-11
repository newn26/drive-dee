import { describe, expect, it } from "vitest";
import {
  DEMO_ADMIN_SIGN_IN_ENABLED,
  initialAuthMode,
  dashboardPermissions,
  homeForRole,
  isDemoCustomerAccount,
  resolveRole,
  roleForAccount,
} from "@/lib/roles";

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

describe("Demo Customer accounts", () => {
  it("are detected only from the server-set app_metadata flag", () => {
    expect(isDemoCustomerAccount({ demo: true })).toBe(true);
    expect(isDemoCustomerAccount({ demo: "true" })).toBe(false);
    expect(isDemoCustomerAccount({})).toBe(false);
    expect(isDemoCustomerAccount(null)).toBe(false);
  });

  it("never get admin or demo_admin in the app", () => {
    expect(roleForAccount("admin", { demo: true })).toBe("customer");
    expect(roleForAccount("demo_admin", { demo: true })).toBe("customer");
  });

  it("leave other accounts' roles unchanged", () => {
    expect(roleForAccount("admin", {})).toBe("admin");
    expect(roleForAccount("demo_admin", { provider: "email" })).toBe("demo_admin");
    expect(roleForAccount("customer", undefined)).toBe("customer");
  });
});

describe("Demo Admin sign-in switch", () => {
  it("is off until the demo_admin migration is applied", () => {
    expect(DEMO_ADMIN_SIGN_IN_ENABLED).toBe(false);
  });

  it("ignores ?demo=true while Demo Admin sign-in is off", () => {
    expect(initialAuthMode(true, false)).toBe("login");
    expect(initialAuthMode(undefined, false)).toBe("login");
  });

  it("opens Demo Admin sign-in for ?demo=true once it is turned back on", () => {
    expect(initialAuthMode(true, true)).toBe("demo");
    expect(initialAuthMode(undefined, true)).toBe("login");
  });
});
