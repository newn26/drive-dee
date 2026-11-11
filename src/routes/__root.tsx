import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/hooks/use-auth";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">ไม่พบหน้าที่คุณต้องการ</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          หน้านี้ไม่มีอยู่ในระบบ หรืออาจถูกย้ายไปแล้ว
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            กลับสู่หน้าหลัก
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          หน้านี้โหลดไม่สำเร็จ
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          เกิดข้อผิดพลาดบางอย่าง กรุณาลองใหม่อีกครั้ง หรือกลับไปที่หน้าหลัก
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            ลองใหม่
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            กลับสู่หน้าหลัก
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    // Site-wide defaults. Each page sets its own title and description in its head().
    // Do not add og:image or twitter:image here, or every page would inherit the same preview image.
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Drive Dee (ไดร์ฟดี รถเช่า) — Siam Wheels Rental Hub" },
      {
        name: "description",
        content:
          "Drive Dee รถเช่า — Siam Wheels Rental Hub ระบบบริหารจัดการรถเช่า จองรถออนไลน์ สัญญาเช่าดิจิทัล และรายงานสำหรับผู้ดูแลระบบ",
      },
      { name: "application-name", content: "Drive Dee" },
      { name: "apple-mobile-web-app-title", content: "Drive Dee" },
      { name: "theme-color", content: "#005a64" },
      { property: "og:site_name", content: "Drive Dee" },
      { property: "og:title", content: "Drive Dee (ไดร์ฟดี รถเช่า) — Siam Wheels Rental Hub" },
      {
        property: "og:description",
        content:
          "Siam Wheels Rental Hub, the Drive Dee car rental management system: จองรถออนไลน์ สัญญาเช่าดิจิทัล งานซ่อมบำรุง และรายงานผลประกอบการ",
      },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "th_TH" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Anuphan:wght@400;500;600&family=Prompt:wght@500;600;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SiteHeader />
        <main className="min-h-[calc(100vh-4rem)]">
          <Outlet />
        </main>
        <Toaster richColors position="top-center" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
