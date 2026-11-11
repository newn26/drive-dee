import { createServerFn } from "@tanstack/react-start";

export const DEMO_EMAIL_DOMAIN = "demo.siamwheels.invalid";

const FIRST = ["สมมติ", "ทดลอง", "ตัวอย่าง", "เดโม่"];
const LAST = ["ใจดี", "รักรถ", "เดินทาง", "สบายดี"];

// Creates a fictional, pre-confirmed customer account. Demo accounts:
// - use a reserved non-deliverable email domain (separate from real accounts)
// - are flagged via app_metadata.demo (not editable by the user)
// - get the normal "customer" role only; a DB trigger blocks admin for them
export const createDemoAccount = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const email = `demo-${id}@${DEMO_EMAIL_DOMAIN}`;
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const password = btoa(String.fromCharCode(...bytes));
  const pick = (a: string[]) => a[bytes[0] % a.length];
  const full_name = `[DEMO] คุณ${pick(FIRST)} ${pick(LAST)}`;

  const { error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { demo: true },
    user_metadata: { full_name, phone: "" },
  });
  if (error) throw new Error("ไม่สามารถสร้างบัญชีทดลองได้");
  return { email, password };
});
