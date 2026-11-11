import { createFileRoute } from "@tanstack/react-router";
import { AdminDashboard } from "./admin";

// Restricted demonstration dashboard. Opens only for accounts with the demo_admin role;
// the database policies enforce the same limits (no deletes, no role or contract changes).
export const Route = createFileRoute("/demo-admin")({
  head: () => ({
    meta: [
      { title: "แดชบอร์ดสาธิต (Demo Admin) — Drive Dee" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <AdminDashboard mode="demo" />,
});
