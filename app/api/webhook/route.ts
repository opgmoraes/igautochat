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
    const account = await resolveAccount(db, entry.id);
    if (!account) continue;

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

const accountCache = new Map<string, any>();
async function resolveAccount(db: ReturnType<typeof supabaseAdmin>, igUserId: string) {
  if (accountCache.has(igUserId)) return accountCache.get(igUserId);
  const { data } = await db.from("ig_accounts").select("*").eq("ig_user_id", igUserId).single();
  accountCache.set(igUserId, data || null);
  return data || null;
}

// Etapas agora têm um "id" próprio (string) em vez de índice numérico — isso é o
// que permite ramificação: cada botão de uma etapa aponta pro id de outra etapa,
// então o fluxo pode se abrir em caminhos diferentes (ex: "Cursos" x "Conhecer a BITTO").
function findStep(steps: any[], id: string) {
  return (steps || []).find((s: any) => s.id === id) || null;
}
function firstStep(steps: any[]) {
  return steps?.[0] || null;
}
function isTerminal(step: any) {
  return step?.type === "link" || step?.type === "final_message";
}

async function handleComment(db: ReturnType<typeof supabaseAdmin>, account: any, value: any) {
  const commentId = value.id;
  const mediaId = value.media?.id;
  const text = value.text || "";
  if (value.from?.id && value.from.id === account.ig_user_id) return;

  const { data: autos } = await db
    .from("automations")
    .select("*")
    .eq("active", true)
    .eq("trigger_comment", true)
    .eq("ig_account_id", account.id);

  let latestMediaId: string | null | undefined;
  const needsLatest = (autos || []).some((a) => a.target_mode === "latest");
  if (needsLatest && account.access_token && account.ig_user_id) {
    try {
      const res = await fetchMedia(account.ig_user_id, account.access_token);
      latestMediaId = res.data?.[0]?.id || null;
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
          ig_account_id: account.id,
          ig_scoped_id: igScopedId,
          username: value.from?.username,
          last_automation_id: auto.id,
        },
        { onConflict: "ig_account_id,ig_scoped_id" }
      )
      .select()
      .single();

    const entry = firstStep(auto.steps);
    if (entry) {
      await db.from("queue").insert({
        ig_account_id: account.id,
        contact_id: contact.id,
        automation_id: auto.id,
        kind: "flow_step",
        recipient_type: "comment_id",
        recipient_value: commentId,
        needs_24h_window: false,
        payload: { step_id: entry.id },
      });
    }

    if (auto.public_replies?.length) {
      const pick = auto.public_replies[Math.floor(Math.random() * auto.public_replies.length)];
      await db.from("queue").insert({
        ig_account_id: account.id,
        contact_id: contact.id,
        automation_id: auto.id,
        kind: "public_reply",
        recipient_type: "comment_id",
        recipient_value: commentId,
        payload: { text: pick },
      });
    }
    break;
  }
}

async function handleMessage(db: ReturnType<typeof supabaseAdmin>, account: any, msg: any) {
  const senderId = msg.sender?.id;
  if (!senderId || senderId === account.ig_user_id) return;

  const isStoryReply = !!msg.message?.reply_to?.story;
  const text = msg.message?.text || "";
  const isQuickReplyClick = !!msg.message?.quick_reply;

  const { data: contact } = await db
    .from("contacts")
    .upsert(
      { ig_account_id: account.id, ig_scoped_id: senderId },
      { onConflict: "ig_account_id,ig_scoped_id" }
    )
    .select()
    .single();

  if (isQuickReplyClick && contact.last_automation_id) {
    const clickPayload: string = msg.message?.quick_reply?.payload || "";
    const match = clickPayload.match(/^STEP_(.+)$/);
    const stepId = match ? match[1] : null;
    if (!stepId) return;

    const { data: auto } = await db
      .from("automations")
      .select("*")
      .eq("id", contact.last_automation_id)
      .single();

    const step = auto ? findStep(auto.steps, stepId) : null;
    if (!auto || !step) return;

    // Evita reenviar a mesma etapa se a Meta reentregar o mesmo evento
    const { data: already } = await db
      .from("queue")
      .select("id, payload")
      .eq("contact_id", contact.id)
      .eq("automation_id", contact.last_automation_id)
      .eq("kind", "flow_step");
    const alreadySent = (already || []).some((q: any) => q.payload?.step_id === stepId);
    if (alreadySent) return;

    await db.from("queue").insert({
      ig_account_id: account.id,
      contact_id: contact.id,
      automation_id: contact.last_automation_id,
      kind: "flow_step",
      recipient_type: "id",
      recipient_value: senderId,
      needs_24h_window: false,
      payload: { step_id: stepId },
    });

    // Se essa etapa é terminal (link ou mensagem final), marca resposta e
    // agenda o lembrete — que agora é totalmente independente, com seu próprio
    // texto e link (pode falar de outro assunto, tipo convidar pra BITTO)
    if (isTerminal(step)) {
      await db
        .from("contacts")
        .update({ last_reply_at: new Date().toISOString() })
        .eq("id", contact.id);

      if (auto.reminder_step?.text) {
        await db.from("queue").insert({
          ig_account_id: account.id,
          contact_id: contact.id,
          automation_id: contact.last_automation_id,
          kind: "reminder",
          recipient_type: "id",
          recipient_value: senderId,
          needs_24h_window: true,
          send_after: new Date(Date.now() + (auto.reminder_delay_minutes || 60) * 60000).toISOString(),
          payload: {
            welcome_message: auto.reminder_step.text,
            link_label: auto.reminder_step.link_label,
            link_url: auto.reminder_step.link_url,
          },
        });
      }
    }
    return;
  }

  const { data: autos } = await db
    .from("automations")
    .select("*")
    .eq("active", true)
    .eq(isStoryReply ? "trigger_story_reply" : "trigger_dm", true)
    .eq("ig_account_id", account.id);

  for (const auto of autos || []) {
    if (!matches(auto.keywords, auto.match_type, text)) continue;
    const entry = firstStep(auto.steps);
    if (!entry) continue;
    await db.from("contacts").update({ last_automation_id: auto.id }).eq("id", contact.id);
    await db.from("queue").insert({
      ig_account_id: account.id,
      contact_id: contact.id,
      automation_id: auto.id,
      kind: "flow_step",
      recipient_type: "id",
      recipient_value: senderId,
      needs_24h_window: false,
      payload: { step_id: entry.id },
    });
    break;
  }
}
