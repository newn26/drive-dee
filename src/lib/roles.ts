/**
 * App roles and what each one may do in the dashboard.
 *
 * The database (RLS policies) is the real security boundary. These flags only decide
 * which buttons and tabs the UI shows, so a demo admin never sees an action the
 * database would reject.
 */
export type AppRole = "customer" | "admin" | "demo_admin";

/**
 * Shows the Demo Admin sign-in on /auth (and its link from /demo-admin).
 * Off until the demo_admin database migration is applied
 * (docs/database/demo-admin-lovable-prompt.md). Set to true to turn it back on.
 */
export const DEMO_ADMIN_SIGN_IN_ENABLED = false;

/** The /auth screen to open first; ?demo=true only opens Demo Admin sign-in when it is enabled. */
export function initialAuthMode(
  demoRequested: boolean | undefined,
  demoSignInEnabled: boolean = DEMO_ADMIN_SIGN_IN_ENABLED,
): "login" | "demo" {
  return demoRequested && demoSignInEnabled ? "demo" : "login";
}

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
  /** Create, edit and send contracts (contracts_manage). */
  editContracts: boolean;
  /** Approve contracts or ask for a revision (contracts_approve). */
  approveContracts: boolean;
  manageMaintenance: boolean;
  viewReports: boolean;
  moderateReviews: boolean;
  /** Owner only: invite, suspend and revoke admins, change permissions, read the audit log. */
  manageAdmins: boolean;
  /** Owner only: confirm a booking without the payment workflow (reason + audit). */
  manualConfirm: boolean;
};

const NONE: DashboardPermissions = {
  viewDashboard: false,
  addEditCars: false,
  deleteCars: false,
  updateBookingStatus: false,
  viewContracts: false,
  editContracts: false,
  approveContracts: false,
  manageMaintenance: false,
  viewReports: false,
  moderateReviews: false,
  manageAdmins: false,
  manualConfirm: false,
};

/** The admin's member row (admin_members): Owner flag, status and fine-grained permissions. */
export type AdminMemberInfo = {
  is_owner: boolean;
  status: string;
  permissions: readonly string[];
};

/**
 * What the dashboard shows. For admins the member row decides: a suspended or revoked admin
 * gets nothing, an Owner gets everything, other admins get exactly their permissions.
 * Without a member row (database not migrated yet) an admin keeps the old full access,
 * minus the Owner-only actions.
 */
export function dashboardPermissions(role: AppRole, member?: AdminMemberInfo | null): DashboardPermissions {
  if (role === "admin") {
    if (member && member.status !== "active") return NONE;
    const owner = !!member?.is_owner;
    const has = (p: string) => owner || !member || member.permissions.includes(p);
    return {
      viewDashboard: true,
      addEditCars: has("fleet_manage"),
      deleteCars: has("fleet_manage"),
      updateBookingStatus: has("bookings_manage"),
      viewContracts: true,
      editContracts: has("contracts_manage"),
      approveContracts: has("contracts_approve"),
      manageMaintenance: has("fleet_manage"),
      viewReports: true,
      moderateReviews: has("reviews_moderate"),
      manageAdmins: owner,
      manualConfirm: owner,
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
