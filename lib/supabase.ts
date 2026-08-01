import { createClient } from "@supabase/supabase-js";

// NUNCA importe isso em componentes de cliente ("use client").
// Usa a service key, que dá acesso total ao banco — só pode rodar no servidor.
export function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
