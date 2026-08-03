import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendMessage, publicReply, buildLinkMessage, buildQuickReplyMessage } from "@/lib/instagram";

const MAX_PER_RUN = 100; // ~limite prático de 200/h, drenado a cada minuto em lotes menores
const DELAY_MS = 500; // ~2 por segundo

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const db = supabaseAdmin();
  const { data: config } = await db.from("config").select("*").eq("id", 1).single();
  if (!config?.access_token || !config?.ig_user_id) {
    return NextResponse.json({ ok: false, reason: "Instagram não conectado" });
  }

  const now = new Date().toISOString();

  // Pega itens pendentes, prontos pra enviar, ordenados por criação
  const { data: items } = await db
    .from("queue")
    .select("*, contacts(*)")
    .eq("status", "pending")
    .lte("send_after", now)
    .order("created_at")
    .limit(MAX_PER_RUN);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of items || []) {
    // Trava atômica: só processa se conseguir passar de pending -> sending
    const { data: claimed } = await db
      .from("queue")
      .update({ status: "sending", claimed_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("status", "pending")
      .select()
      .single();
    if (!claimed) continue; // outro processo já pegou

    // Respeita a janela de 24h quando necessário
    if (item.needs_24h_window) {
      const lastReply = item.contacts?.last_reply_at
        ? new Date(item.contacts.last_reply_at).getTime()
        : 0;
      const withinWindow = Date.now() - lastReply < 24 * 60 * 60 * 1000;
      if (!withinWindow) {
        await db.from("queue").update({ status: "skipped", error: "fora da janela de 24h" }).eq("id", item.id);
        skipped++;
        continue;
      }
    }

    try {
      if (item.kind === "public_reply") {
        await publicReply(item.recipient_value, config.access_token, item.payload.text);
      } else if (item.kind === "private_reply" || item.kind === "dm") {
        // Primeiro contato: convite com botão de resposta rápida (sem o link ainda).
        // Se a automação tiver etapa de pré-link (ex: pedir follow), o botão leva pra lá;
        // senão, vai direto pra etapa final.
        const nextStep = item.payload.pre_link_message ? "STEP_PRELINK" : "STEP_LINK";
        const message = buildQuickReplyMessage(
          item.payload.welcome_message,
          item.payload.quick_reply_label,
          nextStep
        );
        await sendMessage({
          igUserId: config.ig_user_id,
          token: config.access_token,
          recipientType: item.recipient_type as "comment_id" | "id",
          recipientValue: item.recipient_value,
          message,
        });
      } else if (item.kind === "prelink") {
        // Etapa intermediária do funil (ex: "segue lá antes")
        const message = buildQuickReplyMessage(
          item.payload.text,
          item.payload.button_label,
          item.payload.next_payload || "STEP_LINK"
        );
        await sendMessage({
          igUserId: config.ig_user_id,
          token: config.access_token,
          recipientType: item.recipient_type as "comment_id" | "id",
          recipientValue: item.recipient_value,
          message,
        });
      } else {
        // Followups (link / reminder): aqui sim vai o link de verdade
        const message = buildLinkMessage(item.payload as any);
        await sendMessage({
          igUserId: config.ig_user_id,
          token: config.access_token,
          recipientType: item.recipient_type as "comment_id" | "id",
          recipientValue: item.recipient_value,
          message,
        });
      }
      await db.from("queue").update({ status: "sent" }).eq("id", item.id);
      sent++;
    } catch (e: any) {
      await db
        .from("queue")
        .update({
          status: "failed",
          error: String(e.message || e).slice(0, 500),
          attempts: (item.attempts || 0) + 1,
        })
        .eq("id", item.id);
      failed++;
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  return NextResponse.json({ ok: true, sent, failed, skipped });
}
