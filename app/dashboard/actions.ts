"use server";

import { supabaseAdmin } from "@/lib/supabase";
import { fetchMedia } from "@/lib/instagram";
import { revalidatePath } from "next/cache";

export async function getConfig() {
  const db = supabaseAdmin();
  const { data } = await db.from("config").select("*").eq("id", 1).single();
  return data;
}

export async function getAutomations() {
  const db = supabaseAdmin();
  const { data } = await db.from("automations").select("*").order("created_at", { ascending: false });
  return data || [];
}

export async function getMyMedia() {
  const config = await getConfig();
  if (!config?.access_token || !config?.ig_user_id) return [];
  const res = await fetchMedia(config.ig_user_id, config.access_token);
  return res.data || [];
}

export async function createAutomation(formData: FormData) {
  const db = supabaseAdmin();

  const keywords = String(formData.get("keywords") || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const publicReplies = String(formData.get("public_replies") || "")
    .split("\n")
    .map((k) => k.trim())
    .filter(Boolean);

  const { data: auto, error } = await db
    .from("automations")
    .insert({
      name: String(formData.get("name") || "Automação"),
      active: true,
      trigger_comment: formData.get("trigger_comment") === "on",
      trigger_story_reply: formData.get("trigger_story_reply") === "on",
      trigger_dm: formData.get("trigger_dm") === "on",
      keywords,
      match_type: String(formData.get("match_type") || "contains"),
      target_media_id: String(formData.get("target_media_id") || "") || null,
      public_replies: publicReplies,
      welcome_message: String(formData.get("welcome_message") || ""),
      quick_reply_label: String(formData.get("quick_reply_label") || "Quero!"),
      link_label: String(formData.get("link_label") || "Acessar"),
      link_url: String(formData.get("link_url") || ""),
      reminder_text: String(formData.get("reminder_text") || "") || null,
      reminder_delay_minutes: Number(formData.get("reminder_delay_minutes") || 60),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Cria os followups derivados: passo 1 = link (imediato), passo 2 = lembrete (com atraso)
  await db.from("followups").insert([
    { automation_id: auto.id, step: 1, kind: "link", delay_minutes: 0 },
    ...(auto.reminder_text
      ? [
          {
            automation_id: auto.id,
            step: 2,
            kind: "reminder",
            delay_minutes: auto.reminder_delay_minutes,
          },
        ]
      : []),
  ]);

  revalidatePath("/dashboard");
}

export async function toggleAutomation(id: string, active: boolean) {
  const db = supabaseAdmin();
  await db.from("automations").update({ active }).eq("id", id);
  revalidatePath("/dashboard");
}

export async function deleteAutomation(id: string) {
  const db = supabaseAdmin();
  await db.from("automations").delete().eq("id", id);
  revalidatePath("/dashboard");
}
