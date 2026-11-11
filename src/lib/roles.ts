/**
 * App roles and what each one may do in the dashboard.
 *
 * The database (RLS policies) is the real security boundary. These flags only decide
 * which buttons and tabs the UI shows, so a demo admin never sees an action the
 * database would reject.
 */
export type AppRole = "customer" | "admin" | "demo_admin";

/** The strongest role a user has: admin > demo_admin > customer. */
export function resolveRole(roles: readonly { role: string }[] | null | undefined): AppRole {
  const names = new Set((roles ?? []).map((r) => r.role));
  if (names.has("admin")) return "admin";
  if (names.has("demo_admin")) return "demo_admin";
  return "customer";
}

/**
 * Demo Customer accounts (created by createDemoAccount) carry app_metadata.demo = true.
 * Only the server can set app_metadata, so users cannot fake or remove the flag.
 */
export function isDemoCustomerAccount(appMetadata: Record<string, unknown> | null | undefined): boolean {
  return appMetadata?.["demo"] === true;
}

/**
 * A Demo Customer is always a plain customer in the app, whatever user_roles says.
 * The database trigger already blocks "admin" for these accounts; this also covers "demo_admin".
 */
export function roleForAccount(role: AppRole, appMetadata: Record<string, unknown> | null | undefined): AppRole {
  return isDemoCustomerAccount(appMetadata) ? "customer" : role;
}

export type DashboardPermissions = {
  viewDashboard: boolean;
  addEditCars: boolean;
  deleteCars: boolean;
  updateBookingStatus: boolean;
  viewContracts: boolean;
  editContracts: boolean;
  manageMaintenance: boolean;
  viewReports: boolean;
  moderateReviews: boolean;
};

const NONE: DashboardPermissions = {
  viewDashboard: false,
  addEditCars: false,
  deleteCars: false,
  updateBookingStatus: false,
  viewContracts: false,
  editContracts: false,
  manageMaintenance: false,
  viewReports: false,
  moderateReviews: false,
};

export function dashboardPermissions(role: AppRole): DashboardPermissions {
  if (role === "admin") {
    return {
      viewDashboard: true,
      addEditCars: true,
      deleteCars: true,
      updateBookingStatus: true,
      viewContracts: true,
      editContracts: true,
      manageMaintenance: true,
      viewReports: true,
      moderateReviews: true,
    };
  }
  if (role === "demo_admin") {
    // No deletes, no contract edits, no review moderation, no role or account changes.
    return {
      ...NONE,
      viewDashboard: true,
      addEditCars: true,
      updateBookingStatus: true,
      viewContracts: true,
      manageMaintenance: true,
      viewReports: true,
    };
  }
  return NONE;
}

/** Where each role lands after signing in. */
export function homeForRole(role: AppRole): "/admin" | "/demo-admin" | "/" {
  if (role === "admin") return "/admin";
  if (role === "demo_admin") return "/demo-admin";
  return "/";
}
