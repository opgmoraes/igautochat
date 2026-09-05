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

  const signature = req.headers.get("x-hub-signature-256") || "";
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", process.env.IG_APP_SECRET!).update(raw).digest("hex");
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const body = JSON.parse(raw);
  const db = supabaseAdmin();

  for (const entry of body.entry || []) {
    // entry.id é o IGID da conta profissional que RECEBEU o evento.
    // Como agora suportamos várias contas conectadas ao mesmo app, é isso
    // que diz de qual conta (e com qual token/automações) tratar o evento.
    const { data: account } = await db
      .from("accounts")
      .select("*")
      .eq("ig_user_id", entry.id)
      .maybeSingle();
    if (!account) continue; // evento de uma conta que não está conectada aqui

    for (const change of entry.changes || []) {
      if (change.field === "comments") {
        await db.from("events").insert({ kind: "comment", raw: change.value });
        await handleComment(db, account, change.value);
      }
    }
    for (const msg of entry.messaging || []) {
      await db.from("events").insert({ kind: "message", raw: msg });
      await handleMessage(db, account, msg);
    }
  }

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

// Etapas do fluxo: array de { type: 'message', text, button_label } (0 ou mais)
// terminando sempre em 1 etapa { type: 'link', text, link_label, link_url }.
function firstStep(steps: any[]) {
  return steps?.[0] || null;
}

async function handleComment(db: ReturnType<typeof supabaseAdmin>, account: any, value: any) {
  const commentId = value.id;
  const mediaId = value.media?.id;
  const text = value.text || "";
  if (value.from?.id && account.ig_user_id && value.from.id === account.ig_user_id) return;

  // Meta pode reentregar o mesmo evento de comentário (retry de webhook).
  // Sem essa trava, cada reentrega sorteia e enfileira outra resposta pública/DM
  // pro mesmo comentário, dando a impressão de que "todas as variações" são enviadas.
  const { data: already } = await db
    .from("queue")
    .select("id")
    .eq("recipient_type", "comment_id")
    .eq("recipient_value", commentId)
    .limit(1);
  if (already && already.length) return;

  // Só automações DESSA conta — é isso que impede a conta A responder
  // com o token/fluxo configurado pra conta B.
  const { data: autos } = await db
    .from("automations")
    .select("*")
    .eq("account_id", account.id)
    .eq("active", true)
    .eq("trigger_comment", true);

  // Se alguma automação usa "meu próximo post", busca o post mais recente dessa conta 1x só
  let latestMediaId: string | null | undefined;
  const needsLatest = (autos || []).some((a) => a.target_mode === "latest");
  if (needsLatest) {
    try {
      if (account.access_token && account.ig_user_id) {
        const res = await fetchMedia(account.ig_user_id, account.access_token);
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

    const igScopedId = value.from?.id;
    if (!igScopedId) continue;
    const { data: contact } = await db
      .from("contacts")
      .upsert(
        {
          ig_scoped_id: igScopedId,
          username: value.from?.username,
          last_automation_id: auto.id,
          account_id: account.id,
        },
        { onConflict: "ig_scoped_id" }
      )
      .select()
      .single();

    const step0 = firstStep(auto.steps);
    if (step0) {
      // Resposta privada — fura a janela de 24h, 1x por comentário, até 7 dias
      await db.from("queue").insert({
        contact_id: contact.id,
        automation_id: auto.id,
        account_id: account.id,
        kind: "flow_step",
        recipient_type: "comment_id",
        recipient_value: commentId,
        needs_24h_window: false,
        payload: { step_index: 0 },
      });
    }

    // Resposta pública opcional (sorteia entre variações)
    if (auto.public_replies?.length) {
      const pick = auto.public_replies[Math.floor(Math.random() * auto.public_replies.length)];
      await db.from("queue").insert({
        contact_id: contact.id,
        automation_id: auto.id,
        account_id: account.id,
        kind: "public_reply",
        recipient_type: "comment_id",
        recipient_value: commentId,
        payload: { text: pick },
      });
    }
    break; // 1 automação por comentário
  }
}

async function handleMessage(db: ReturnType<typeof supabaseAdmin>, account: any, msg: any) {
  const senderId = msg.sender?.id;
  if (!senderId || (account.ig_user_id && senderId === account.ig_user_id)) return;

  const isStoryReply = !!msg.message?.reply_to?.story;
  const text = msg.message?.text || "";
  const isQuickReplyClick = !!msg.message?.quick_reply;

  const { data: contact } = await db
    .from("contacts")
    .upsert({ ig_scoped_id: senderId, account_id: account.id }, { onConflict: "ig_scoped_id" })
    .select()
    .single();

  // Clique num botão de resposta rápida -> avança pra etapa indicada no payload do clique
  // (nunca reage a texto solto — só a cliques reais, senão reenvia toda hora)
  if (isQuickReplyClick && contact.last_automation_id) {
    const clickPayload: string = msg.message?.quick_reply?.payload || "";
    const match = clickPayload.match(/^STEP_(\d+)$/);
    const stepIndex = match ? parseInt(match[1], 10) : 0;

    const { data: auto } = await db
      .from("automations")
      .select("*")
      .eq("id", contact.last_automation_id)
      .single();

    if (!auto || !Array.isArray(auto.steps) || !auto.steps[stepIndex]) return;

    // Evita reenviar a mesma etapa se a Meta reentregar o mesmo evento
    const { data: already } = await db
      .from("queue")
      .select("id, payload")
      .eq("contact_id", contact.id)
      .eq("automation_id", contact.last_automation_id)
      .eq("kind", "flow_step");
    const alreadySent = (already || []).some((q: any) => q.payload?.step_index === stepIndex);
    if (alreadySent) return;

    const step = auto.steps[stepIndex];

    await db.from("queue").insert({
      contact_id: contact.id,
      automation_id: contact.last_automation_id,
      account_id: account.id,
      kind: "flow_step",
      recipient_type: "id",
      recipient_value: senderId,
      needs_24h_window: false, // conversa está aberta, acabou de responder
      payload: { step_index: stepIndex },
    });

    // Se essa foi a etapa final (o link), marca resposta e agenda o lembrete opcional
    if (step.type === "link") {
      await db
        .from("contacts")
        .update({ last_reply_at: new Date().toISOString() })
        .eq("id", contact.id);

      if (auto.reminder_text) {
        await db.from("queue").insert({
          contact_id: contact.id,
          automation_id: contact.last_automation_id,
          account_id: account.id,
          kind: "reminder",
          recipient_type: "id",
          recipient_value: senderId,
          needs_24h_window: true,
          send_after: new Date(Date.now() + (auto.reminder_delay_minutes || 60) * 60000).toISOString(),
          payload: {
            welcome_message: auto.reminder_text,
            // Lembrete usa seu próprio link, se configurado; senão cai no link da etapa final
            link_label: auto.reminder_link_label || step.link_label,
            link_url: auto.reminder_link_url || step.link_url,
          },
        });
      }
    }
    return;
  }

  // Story reply ou DM comum batendo com palavra-chave -> começa o fluxo direto
  const { data: autos } = await db
    .from("automations")
    .select("*")
    .eq("account_id", account.id)
    .eq("active", true)
    .eq(isStoryReply ? "trigger_story_reply" : "trigger_dm", true);

  for (const auto of autos || []) {
    if (!matches(auto.keywords, auto.match_type, text)) continue;
    const step0 = firstStep(auto.steps);
    if (!step0) continue;
    await db.from("contacts").update({ last_automation_id: auto.id }).eq("id", contact.id);
    await db.from("queue").insert({
      contact_id: contact.id,
      automation_id: auto.id,
      account_id: account.id,
      kind: "flow_step",
      recipient_type: "id",
      recipient_value: senderId,
      needs_24h_window: false, // conversa já está aberta
      payload: { step_index: 0 },
    });
    break;
  }
}
