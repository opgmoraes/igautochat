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
  const now = new Date().toISOString();

  // Traz o item já com os dados da conta de Instagram correspondente (token/ig_user_id)
  const { data: items } = await db
    .from("queue")
    .select("*, contacts(*), ig_accounts(*)")
    .eq("status", "pending")
    .lte("send_after", now)
    .order("created_at")
    .limit(MAX_PER_RUN);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of items || []) {
    const account = item.ig_accounts;
    if (!account?.access_token || !account?.ig_user_id) {
      await db.from("queue").update({ status: "failed", error: "conta desconectada" }).eq("id", item.id);
      failed++;
      continue;
    }

    const { data: claimed } = await db
      .from("queue")
      .update({ status: "sending", claimed_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("status", "pending")
      .select()
      .single();
    if (!claimed) continue;

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
        await publicReply(item.recipient_value, account.access_token, item.payload.text);
      } else if (item.kind === "flow_step") {
        const { data: auto } = await db
          .from("automations")
          .select("steps")
          .eq("id", item.automation_id)
          .single();
        const step = auto?.steps?.[item.payload.step_index];
        if (!step) {
          await db.from("queue").update({ status: "skipped", error: "etapa não existe mais" }).eq("id", item.id);
          skipped++;
          await new Promise((r) => setTimeout(r, DELAY_MS));
          continue;
        }

        const message =
          step.type === "link"
            ? buildLinkMessage({
                welcome_message: step.text,
                link_label: step.link_label,
                link_url: step.link_url,
                quick_reply_label: "",
              })
            : buildQuickReplyMessage(step.text, step.button_label, `STEP_${item.payload.step_index + 1}`);

        await sendMessage({
          igUserId: account.ig_user_id,
          token: account.access_token,
          recipientType: item.recipient_type as "comment_id" | "id",
          recipientValue: item.recipient_value,
          message,
        });
      } else {
        const message = buildLinkMessage(item.payload as any);
        await sendMessage({
          igUserId: account.ig_user_id,
          token: account.access_token,
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
