/**
 * The database client the admin pages use.
 *
 * Normally this is the real Supabase client. While the public Demo Admin page is open,
 * `from()` and `rpc()` go to an in-browser sandbox with fictional sample data instead
 * (src/lib/demo-sandbox.ts), so a visitor can try every admin feature without reading or
 * changing the real database. `auth` always stays the real client.
 */
import { supabase } from "@/integrations/supabase/client";

type Routed = Pick<typeof supabase, "from" | "rpc">;

let sandbox: Routed | null = null;

/** Route from()/rpc() to the sandbox (or back to the real database with null). */
export function setSandboxClient(client: Routed | null) {
  sandbox = client;
}

export const isSandboxActive = () => sandbox !== null;

export const db = new Proxy(supabase, {
  get(target, prop, receiver) {
    if (sandbox && (prop === "from" || prop === "rpc")) {
      const fn = sandbox[prop] as (...args: unknown[]) => unknown;
      return fn.bind(sandbox);
    }
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
}) as typeof supabase;
