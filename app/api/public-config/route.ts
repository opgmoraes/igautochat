import { NextResponse } from "next/server";

// A chave "anon"/publishable NÃO é secreta — é feita pra rodar no navegador.
// A chave que precisa ficar só no servidor é a service_role (usada em lib/supabase.ts).
export async function GET() {
  return NextResponse.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
}
