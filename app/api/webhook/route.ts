import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { matches, fetchMedia } from "@/lib/instagram";

// --- 1) Handshake de verificação (Meta faz um GET ao cadastrar o webhook) ---
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// --- 2) Eventos reais (comentários e mensagens) ---
export async function POST(req: NextRequest) {
  const raw = await req.text();

  // Valida a assinatura (HMAC-SHA256 do corpo cru com o app secret)
  const signature = req.headers.get("x-hub-signature-256") || "";
  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", process.env.IG_APP_SECRET!)
      .update(raw)
      .digest("hex");
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const body = JSON.parse(raw);
  const db = supabaseAdmin();

  for (const entry of body.entry || []) {
    // --- Comentários ---
    for (const change of entry.changes || []) {
      if (change.field === "comments") {
        await db.from("events").insert({ kind: "comment", raw: change.value });
        await handleComment(db, change.value);
      }
    }
    // --- Mensagens (DM, resposta de story, resposta ao botão) ---
    for (const msg of entry.messaging || []) {
      await db.from("events").insert({ kind: "message", raw: msg });
      await handleMessage(db, msg);
    }
  }

  // Dispara a drenagem da fila em background, sem atrasar a resposta ao webhook
  after(async () => {
    try {
      await fetch(`${process.env.APP_URL}/api/cron/drain`, {
        method: "POST",
        headers: { "x-cron-secret": process.env.CRON_SECRET! },
      });
    } catch {
      // o cron de 1 em 1 minuto cobre se isso falhar
    }
  });

  return NextResponse.json({ ok: true });
}

async function handleComment(db: ReturnType<typeof supabaseAdmin>, value: any) {
  const commentId = value.id;
  const mediaId = value.media?.id;
  const text = value.text || "";
  if (value.from?.id && process.env.IG_USER_ID && value.from.id === process.env.IG_USER_ID) return; // ignora comentário próprio

  const { data: autos } = await db
    .from("automations")
    .select("*")
    .eq("active", true)
    .eq("trigger_comment", true);

  // Se alguma automação usa "meu próximo post", busca o post mais recente 1x só
  // (assim funciona pra posts agendados: quando publicam, viram o post mais novo automaticamente)
  let latestMediaId: string | null | undefined;
  const needsLatest = (autos || []).some((a) => a.target_mode === "latest");
  if (needsLatest) {
    try {
      const { data: config } = await db.from("config").select("*").eq("id", 1).single();
      if (config?.access_token && config?.ig_user_id) {
        const res = await fetchMedia(config.ig_user_id, config.access_token);
        latestMediaId = res.data?.[0]?.id || null;
      }
    } catch {
      latestMediaId = null;
    }
  }

  for (const auto of autos || []) {
    if (auto.target_mode === "specific" && auto.target_media_id && auto.target_media_id !== mediaId) continue;
    if (auto.target_mode === "latest" && latestMediaId && latestMediaId !== mediaId) continue;
    if (!matches(auto.keywords, auto.match_type, text)) continue;

    // upsert do contato
    const igScopedId = value.from?.id;
    if (!igScopedId) continue;
    const { data: contact } = await db
      .from("contacts")
      .upsert(
        { ig_scoped_id: igScopedId, username: value.from?.username, last_automation_id: auto.id },
        { onConflict: "ig_scoped_id" }
      )
      .select()
      .single();

    // Resposta privada — fura a janela de 24h, 1x por comentário, até 7 dias
    await db.from("queue").insert({
      contact_id: contact.id,
      automation_id: auto.id,
      kind: "private_reply",
      recipient_type: "comment_id",
      recipient_value: commentId,
      needs_24h_window: false,
      payload: {
        welcome_message: auto.welcome_message,
        link_label: auto.link_label,
        link_url: auto.link_url,
        quick_reply_label: auto.quick_reply_label,
        pre_link_message: auto.pre_link_message,
        pre_link_quick_reply_label: auto.pre_link_quick_reply_label,
      },
    });

    // Resposta pública opcional (sorteia entre variações)
    if (auto.public_replies?.length) {
      const pick =
        auto.public_replies[Math.floor(Math.random() * auto.public_replies.length)];
      await db.from("queue").insert({
        contact_id: contact.id,
        automation_id: auto.id,
        kind: "public_reply",
        recipient_type: "comment_id",
        recipient_value: commentId,
        payload: { text: pick },
      });
    }
    break; // 1 automação por comentário
  }
}

async function handleMessage(db: ReturnType<typeof supabaseAdmin>, msg: any) {
  const senderId = msg.sender?.id;
  if (!senderId || (process.env.IG_USER_ID && senderId === process.env.IG_USER_ID)) return;

  const isStoryReply = !!msg.message?.reply_to?.story;
  const text = msg.message?.text || "";
  const isQuickReplyClick = !!msg.message?.quick_reply;

  const { data: contact } = await db
    .from("contacts")
    .upsert({ ig_scoped_id: senderId }, { onConflict: "ig_scoped_id" })
    .select()
    .single();

  // Se a pessoa tocou num botão de resposta rápida -> decide a próxima etapa
  // usando o "payload" que veio junto do clique (não o texto solto, nunca dispara nisso)
  if (isQuickReplyClick && contact.last_automation_id) {
    const clickPayload: string = msg.message?.quick_reply?.payload || "STEP_LINK";

    const { data: auto } = await db
      .from("automations")
      .select("*")
      .eq("id", contact.last_automation_id)
      .single();

    if (!auto) return;

    // Etapa intermediária do funil (ex: "pede pra seguir antes")
    if (clickPayload === "STEP_PRELINK") {
      // evita reenviar se já mandou essa etapa pra esse contato+automação
      const { data: already } = await db
        .from("queue")
        .select("id")
        .eq("contact_id", contact.id)
        .eq("automation_id", contact.last_automation_id)
        .eq("kind", "prelink")
        .limit(1);
      if (already && already.length > 0) return;

      await db.from("queue").insert({
        contact_id: contact.id,
        automation_id: contact.last_automation_id,
        kind: "prelink",
        recipient_type: "id",
        recipient_value: senderId,
        needs_24h_window: false, // conversa está aberta, acabou de responder
        payload: {
          text: auto.pre_link_message,
          button_label: auto.pre_link_quick_reply_label,
          next_payload: "STEP_LINK",
        },
      });
      return;
    }

    // Etapa final: manda o link de verdade (+ agenda o lembrete, se configurado)
    if (clickPayload === "STEP_LINK") {
      const { data: already } = await db
        .from("queue")
        .select("id")
        .eq("contact_id", contact.id)
        .eq("automation_id", contact.last_automation_id)
        .in("kind", ["link", "reminder"])
        .limit(1);
      if (already && already.length > 0) return; // já processado, não duplica

      await db
        .from("contacts")
        .update({ last_reply_at: new Date().toISOString() })
        .eq("id", contact.id);

      const { data: followups } = await db
        .from("followups")
        .select("*")
        .eq("automation_id", contact.last_automation_id)
        .order("step");

      for (const f of followups || []) {
        await db.from("queue").insert({
          contact_id: contact.id,
          automation_id: contact.last_automation_id,
          kind: f.kind === "reminder" ? "reminder" : "link",
          recipient_type: "id",
          recipient_value: senderId,
          needs_24h_window: true,
          send_after: new Date(Date.now() + f.delay_minutes * 60000).toISOString(),
          payload: {
            welcome_message: f.kind === "reminder" ? auto.reminder_text : auto.welcome_message,
            link_label: auto.link_label,
            link_url: auto.link_url,
          },
        });
      }
    }
    return;
  }

  // Story reply ou DM comum batendo com palavra-chave -> manda boas-vindas direto
  const { data: autos } = await db
    .from("automations")
    .select("*")
    .eq("active", true)
    .eq(isStoryReply ? "trigger_story_reply" : "trigger_dm", true);

  for (const auto of autos || []) {
    if (!matches(auto.keywords, auto.match_type, text)) continue;
    await db.from("contacts").update({ last_automation_id: auto.id }).eq("id", contact.id);
    await db.from("queue").insert({
      contact_id: contact.id,
      automation_id: auto.id,
      kind: "dm",
      recipient_type: "id",
      recipient_value: senderId,
      needs_24h_window: false, // conversa já está aberta
      payload: {
        welcome_message: auto.welcome_message,
        link_label: auto.link_label,
        link_url: auto.link_url,
        quick_reply_label: auto.quick_reply_label,
        pre_link_message: auto.pre_link_message,
        pre_link_quick_reply_label: auto.pre_link_quick_reply_label,
      },
    });
    break;
  }
}
