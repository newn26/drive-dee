import { createFileRoute } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AdminDashboard } from "./admin";
import { setSandboxClient } from "@/lib/db";
import { Sandbox } from "@/lib/demo-sandbox";
import { tr } from "@/lib/i18n";

/**
 * Public Demo Admin: the full admin dashboard on fictional sample data held in the browser.
 * While this page is open, admin reads and actions go to the sandbox, never to the real
 * database; it has its own query cache so sample data never mixes with real admin data.
 */
/** One sandbox per browser visit: kept when the language switch remounts the page, gone on reload. */
let visitSandbox: Sandbox | null = null;

function DemoAdminPage() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );
  // Switch to the sandbox in the browser only, before the dashboard's first render: the
  // server (and the first client render) show a loading line, so hydration matches.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    visitSandbox ??= new Sandbox();
    setSandboxClient(visitSandbox as never);
    setReady(true);
    return () => setSandboxClient(null);
  }, []);
  if (!ready) {
    return (
      <p className="py-20 text-center text-sm text-muted-foreground" role="status">
        {tr("กำลังเตรียมข้อมูลตัวอย่าง...", "Preparing sample data...")}
      </p>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <AdminDashboard mode="demo" />
    </QueryClientProvider>
  );
}

export const Route = createFileRoute("/demo-admin")({
  head: () => ({
    meta: [
      { title: "แดชบอร์ดสาธิต (Demo Admin) — Drive Dee" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DemoAdminPage,
});
