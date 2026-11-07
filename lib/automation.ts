export type Step = { type: 'message' | 'link'; text: string; button_label?: string; link_label?: string; link_url?: string };
export type Followup = { text: string; delay_minutes: number; link_label?: string; link_url?: string };
export type Flow = { steps: Step[]; require_follow?: boolean; followup_steps?: Followup[]; reminder_text?: string; reminder_delay_minutes?: number; reminder_link_label?: string; reminder_link_url?: string };

export function withinWindow(lastReply: string | null, now = Date.now()) {
  const time = lastReply ? Date.parse(lastReply) : NaN;
  return Number.isFinite(time) && time <= now && now - time < 86400000;
}

export function followerState(profile: unknown): 'following' | 'not_following' | 'unavailable' {
  const value = (profile as { is_user_follow_business?: unknown } | null)?.is_user_follow_business;
  return value === true ? 'following' : value === false ? 'not_following' : 'unavailable';
}

function httpUrl(value: unknown) {
  try { return ['https:', 'http:'].includes(new URL(String(value)).protocol); } catch { return false; }
}

export function validateFlow(body: Record<string, unknown>): string | null {
  const steps = body.steps as Step[];
  if (!Array.isArray(steps) || !steps.length || steps.length > 20) return 'Configure entre 1 e 20 etapas.';
  if (steps.at(-1)?.type !== 'link' || steps.slice(0, -1).some(s => s?.type !== 'message')) return 'O fluxo deve terminar com um link e começar com mensagens de convite.';
  if (body.require_follow && steps.length < 2) return 'Adicione uma mensagem com botão antes da verificação de seguidor.';
  for (const s of steps) {
    if (!s || typeof s.text !== 'string' || !s.text.trim() || s.text.length > 1000) return 'Cada mensagem deve conter de 1 a 1000 caracteres.';
    if (s.type === 'link' && !httpUrl(s.link_url)) return 'Informe um link HTTP ou HTTPS válido.';
    const label = s.type === 'message' ? s.button_label : s.link_label;
    if (typeof label !== 'string' || !label.trim() || label.length > 20) return 'Os botões devem conter de 1 a 20 caracteres.';
  }
  if (body.require_follow !== undefined && typeof body.require_follow !== 'boolean') return 'Condição de seguidor inválida.';
  const followups = body.followup_steps ?? [];
  if (!Array.isArray(followups) || followups.length > 20) return 'Use no máximo 20 follow-ups.';
  for (const f of followups as Followup[]) {
    if (!f || typeof f.text !== 'string' || !f.text.trim() || f.text.length > 1000) return 'Preencha o texto de cada follow-up (até 1000 caracteres).';
    if (typeof f.delay_minutes !== 'number' || !Number.isInteger(f.delay_minutes) || f.delay_minutes < 1 || f.delay_minutes > 43200) return 'Intervalos devem ser de 1 minuto a 30 dias.';
    if (f.link_url && (!httpUrl(f.link_url) || !f.link_label?.trim() || f.link_label.length > 20)) return 'Confira o link e o botão do follow-up.';
  }
  if (body.reminder_text && (!Number.isInteger(Number(body.reminder_delay_minutes ?? 60)) || Number(body.reminder_delay_minutes ?? 60) < 1)) return 'Intervalo do lembrete inválido.';
  if (body.reminder_link_url && !httpUrl(body.reminder_link_url)) return 'Link do lembrete inválido.';
  return null;
}

export function followupsFor(flow: Flow): Followup[] {
  const link = flow.steps.at(-1);
  return [...(flow.reminder_text ? [{ text: flow.reminder_text, delay_minutes: flow.reminder_delay_minutes || 60, link_url: flow.reminder_link_url || link?.link_url, link_label: flow.reminder_link_label || link?.link_label }] : []), ...(flow.followup_steps || [])];
}

export function nextFollowup(steps: Followup[], previousIndex: number, sentAt: number) {
  const index = previousIndex + 1;
  const step = steps[index];
  return step ? { index, send_after: new Date(sentAt + step.delay_minutes * 60000).toISOString() } : null;
}
