import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireUser } from "@/lib/authGuard";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account_id");

  const db = supabaseAdmin();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let sentQuery = db
    .from("queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .not("kind", "in", "(public_reply,verify_follow)")
    .gte("created_at", since7d);
  if (accountId) sentQuery = sentQuery.eq("account_id", accountId);
  const { count: sentWeek } = await sentQuery;

  let failedQuery = db
    .from("queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("created_at", since24h);
  if (accountId) failedQuery = failedQuery.eq("account_id", accountId);
  const { count: failed24h } = await failedQuery;

  const countMetric = (kind: string) => {
    let q = db.from('queue').select('id',{count:'exact',head:true}).eq('status','sent').gte('sent_at',since7d);
    q = kind === 'links' ? q.contains('payload',{delivery_type:'link'}) : q.eq('kind','verify_follow');
    return accountId ? q.eq('account_id',accountId) : q;
  };
  const [links,verifications] = await Promise.all([countMetric('links'),countMetric('verifications')]);

  let tokenExpiresAt: string | null = null;
  if (accountId) {
    const { data: account } = await db
      .from("accounts")
      .select("token_expires_at")
      .eq("id", accountId)
      .single();
    tokenExpiresAt = account?.token_expires_at || null;
  }

  return NextResponse.json({
    sentWeek: sentWeek || 0,
    failed24h: failed24h || 0,
    tokenExpiresAt,
    linksWeek: links.count || 0,
    verificationsWeek: verifications.count || 0,
  });
}
