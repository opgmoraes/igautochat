import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireUser } from "@/lib/authGuard";
import { fetchProfile, fetchMedia, fetchAccountReach, fetchMediaInsights } from "@/lib/instagram";

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const accountId = req.nextUrl.searchParams.get("account_id");
  if (!accountId) return NextResponse.json({ error: "conta não informada" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: account } = await db.from("accounts").select("*").eq("id", accountId).single();

  if (!account?.access_token || !account?.ig_user_id) {
    return NextResponse.json({ error: "conta desconectada" }, { status: 400 });
  }

  try {
    const [profile, reach, mediaRes] = await Promise.all([
      fetchProfile(account.access_token),
      fetchAccountReach(account.ig_user_id, account.access_token),
      fetchMedia(account.ig_user_id, account.access_token),
    ]);

    const recentMedia = (mediaRes.data || []).slice(0, 12);

    // Busca insights de cada post em paralelo (com limite pra não estourar rate limit)
    const mediaWithInsights = await Promise.all(
      recentMedia.map(async (m: any) => {
        const insights = await fetchMediaInsights(m.id, account.access_token);
        return {
          id: m.id,
          caption: m.caption,
          thumbnail: m.thumbnail_url || m.media_url,
          permalink: m.permalink,
          timestamp: m.timestamp,
          likes: insights?.likes ?? null,
          comments: insights?.comments ?? null,
          saved: insights?.saved ?? null,
          reach: insights?.reach ?? null,
        };
      })
    );

    const totalLikes = mediaWithInsights.reduce((sum, m) => sum + (m.likes || 0), 0);
    const totalComments = mediaWithInsights.reduce((sum, m) => sum + (m.comments || 0), 0);
    const avgLikes = mediaWithInsights.length ? Math.round(totalLikes / mediaWithInsights.length) : 0;
    const best = [...mediaWithInsights].sort((a, b) => (b.likes || 0) - (a.likes || 0))[0] || null;

    // Funil interno: quantas conversas começaram (etapa 0) vs quantas avançaram
    const { count: initiations } = await db
      .from("queue")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("kind", "flow_step")
      .filter("payload->>step_index", "eq", "0");

    const { data: engagedRows } = await db
      .from("queue")
      .select("contact_id")
      .eq("account_id", accountId)
      .eq("kind", "flow_step")
      .filter("payload->>step_index", "neq", "0");
    const engaged = new Set((engagedRows || []).map((r: any) => r.contact_id)).size;

    const { count: automationsCount } = await db
      .from("automations")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("active", true);

    return NextResponse.json({
      profile: {
        username: profile.username,
        followers_count: profile.followers_count ?? null,
        follows_count: profile.follows_count ?? null,
        media_count: profile.media_count ?? null,
      },
      reach,
      totalLikes,
      totalComments,
      avgLikes,
      best,
      media: mediaWithInsights,
      funnel: {
        activeAutomations: automationsCount || 0,
        initiations: initiations || 0,
        engaged,
        conversionRate: initiations ? Math.round((engaged / initiations) * 100) : null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
