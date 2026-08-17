// Todas as chamadas à API "Instagram com Login do Instagram" (v25.0)
const GRAPH_BASE = "https://graph.instagram.com/v25.0";
const AUTH_BASE = "https://api.instagram.com";

export function buildLoginUrl(redirectUri: string, state?: string) {
  const params = new URLSearchParams({
    client_id: process.env.IG_APP_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope:
      "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish,instagram_business_manage_insights",
  });
  if (state) params.set("state", state);
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForShortToken(code: string, redirectUri: string) {
  const form = new URLSearchParams({
    client_id: process.env.IG_APP_ID!,
    client_secret: process.env.IG_APP_SECRET!,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${AUTH_BASE}/oauth/access_token`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`Falha ao trocar code: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; user_id: string }>;
}

export async function exchangeForLongToken(shortToken: string) {
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: process.env.IG_APP_SECRET!,
    access_token: shortToken,
  });
  const res = await fetch(`${GRAPH_BASE.replace("v25.0", "")}access_token?${params}`);
  if (!res.ok) throw new Error(`Falha ao trocar por token longo: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

export async function refreshLongToken(longToken: string) {
  const params = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: longToken,
  });
  const res = await fetch(`${GRAPH_BASE.replace("v25.0", "")}refresh_access_token?${params}`);
  if (!res.ok) throw new Error(`Falha ao renovar token: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

export async function fetchProfile(token: string) {
  const params = new URLSearchParams({
    fields: "user_id,username,name,profile_picture_url,followers_count,follows_count,media_count",
    access_token: token,
  });
  const res = await fetch(`${GRAPH_BASE}/me?${params}`);
  if (!res.ok) throw new Error(`Falha ao buscar perfil: ${await res.text()}`);
  return res.json();
}

export async function fetchMedia(igUserId: string, token: string) {
  const params = new URLSearchParams({
    fields: "id,media_type,media_url,thumbnail_url,caption,permalink,timestamp",
    access_token: token,
  });
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media?${params}`);
  if (!res.ok) throw new Error(`Falha ao buscar posts: ${await res.text()}`);
  return res.json();
}

export async function subscribeApp(igUserId: string, token: string) {
  const params = new URLSearchParams({
    subscribed_fields: "comments,messages",
    access_token: token,
  });
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/subscribed_apps?${params}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Falha ao assinar webhooks: ${await res.text()}`);
  return res.json();
}

// Alcance da conta nos últimos dias (métrica de nível de conta)
export async function fetchAccountReach(igUserId: string, token: string) {
  const params = new URLSearchParams({
    metric: "reach",
    period: "day",
    metric_type: "total_value",
    access_token: token,
  });
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/insights?${params}`);
  if (!res.ok) return null; // conta pode ser pequena demais / sem dado ainda, não trava a tela
  const json = await res.json();
  return json.data?.[0]?.total_value?.value ?? null;
}

// Curtidas, comentários, salvamentos e alcance de um post específico
export async function fetchMediaInsights(mediaId: string, token: string) {
  const params = new URLSearchParams({
    metric: "likes,comments,saved,reach",
    access_token: token,
  });
  const res = await fetch(`${GRAPH_BASE}/${mediaId}/insights?${params}`);
  if (!res.ok) return null; // nem todo tipo de mídia tem todas as métricas — ignora silenciosamente
  const json = await res.json();
  const result: Record<string, number> = {};
  for (const m of json.data || []) {
    result[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
  }
  return result;
}

type SendPayload =
  | { text: string }
  | { attachment: { type: "template"; payload: any } }
  | { text: string; quick_replies: any[] };

export async function sendMessage(opts: {
  igUserId: string;
  token: string;
  recipientType: "comment_id" | "id";
  recipientValue: string;
  message: SendPayload;
}) {
  const { igUserId, token, recipientType, recipientValue, message } = opts;
  const body = {
    recipient: { [recipientType]: recipientValue },
    message,
  };
  const res = await fetch(
    `${GRAPH_BASE}/${igUserId}/messages?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(`Falha ao enviar mensagem: ${JSON.stringify(json)}`);
  return json;
}

export async function publicReply(commentId: string, token: string, message: string) {
  const res = await fetch(
    `${GRAPH_BASE}/${commentId}/replies?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(`Falha ao responder comentário: ${JSON.stringify(json)}`);
  return json;
}

// Mensagem 2: enviada só DEPOIS que a pessoa toca no botão de resposta rápida.
// Essa sim contém o link de verdade.
export function buildLinkMessage(auto: {
  welcome_message: string;
  link_label: string;
  link_url: string;
  quick_reply_label: string;
}): SendPayload {
  if (auto.link_url) {
    return {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: auto.welcome_message,
          buttons: [
            { type: "web_url", url: auto.link_url, title: auto.link_label },
          ],
        },
      },
    };
  }
  return { text: auto.welcome_message };
}

// Mensagem de convite/etapa com um ou mais botões de RESPOSTA RÁPIDA (gera evento
// de volta pro webhook). Cada botão pode levar pra uma etapa diferente do fluxo —
// é assim que a ramificação funciona (ex: "Cursos" e "Conhecer a BITTO" no mesmo passo).
export function buildQuickReplyMessage(
  text: string,
  buttons: { label: string; payload: string }[]
): SendPayload {
  // A API do Instagram não aceita quick_replies vazio.
  // Isso pode acontecer quando uma etapa foi criada como
  // "Mensagem c/ botões", mas ficou sem nenhum botão (como nas etapas finais).
  // Nesse caso, enviamos a etapa como texto simples em vez de mandar
  // `quick_replies: []`, que gera: "param message[quick_replies] has too few elements".
  const quickReplies = (buttons || [])
    .filter((b) => b?.label?.trim() && b?.payload?.trim())
    .slice(0, 13)
    .map((b) => ({
      content_type: "text",
      title: b.label.trim().slice(0, 20),
      payload: b.payload.trim(),
    }));

  if (quickReplies.length === 0) {
    return { text: text || "Oi!" };
  }

  return {
    text: text || "Oi!",
    quick_replies: quickReplies,
  };
}

export function matches(keywords: string[], matchType: string, text: string) {
  const t = (text || "").trim().toLowerCase();
  if (matchType === "any") return keywords.length === 0 ? true : true;
  return keywords.some((k) => {
    const kw = k.trim().toLowerCase();
    if (!kw) return false;
    return matchType === "exact" ? t === kw : t.includes(kw);
  });
}
