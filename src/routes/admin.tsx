import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "admin — ไดร์ฟดี รถเช่า" }, { name: "description", content: "ไดร์ฟดี รถเช่า" }, { property: "og:title", content: "ไดร์ฟดี" }, { property: "og:description", content: "ไดร์ฟดี รถเช่า" }] }),
  component: () => <div className="mx-auto max-w-3xl px-4 py-20 text-center text-muted-foreground">หน้านี้ยังอยู่ระหว่างการพัฒนา</div>,
});
