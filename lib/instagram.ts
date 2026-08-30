// Todas as chamadas à API "Instagram com Login do Instagram" (v25.0)
const GRAPH_BASE = "https://graph.instagram.com/v25.0";
const AUTH_BASE = "https://api.instagram.com";

export function buildLoginUrl(redirectUri: string, state?: string) {
  const params = new URLSearchParams({
    client_id: process.env.IG_APP_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope:
      "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish",
  });
  if (state) params.set("state", state);
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForShortToken(
  code: string,
  redirectUri: string,
) {
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
  const res = await fetch(
    `${GRAPH_BASE.replace("v25.0", "")}access_token?${params}`,
  );
  if (!res.ok)
    throw new Error(`Falha ao trocar por token longo: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

export async function refreshLongToken(longToken: string) {
  const params = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: longToken,
  });
  const res = await fetch(
    `${GRAPH_BASE.replace("v25.0", "")}refresh_access_token?${params}`,
  );
  if (!res.ok) throw new Error(`Falha ao renovar token: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

export async function fetchProfile(token: string) {
  const params = new URLSearchParams({
    fields: "user_id,username,name,profile_picture_url",
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
  const res = await fetch(
    `${GRAPH_BASE}/${igUserId}/subscribed_apps?${params}`,
    {
      method: "POST",
    },
  );
  if (!res.ok)
    throw new Error(`Falha ao assinar webhooks: ${await res.text()}`);
  return res.json();
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
    },
  );
  const json = await res.json();
  if (!res.ok)
    throw new Error(`Falha ao enviar mensagem: ${JSON.stringify(json)}`);
  return json;
}

export async function publicReply(
  commentId: string,
  token: string,
  message: string,
) {
  const res = await fetch(
    `${GRAPH_BASE}/${commentId}/replies?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    },
  );
  const json = await res.json();
  if (!res.ok)
    throw new Error(`Falha ao responder comentário: ${JSON.stringify(json)}`);
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

// Mensagem de convite com botão de RESPOSTA RÁPIDA (gera evento de volta pro webhook).
// Usada tanto pro convite inicial quanto pra etapa intermediária do funil (ex: pedir follow).
export function buildQuickReplyMessage(
  text: string,
  buttonLabel: string,
  payload: string,
): SendPayload {
  return {
    text: text || "Oi!",
    quick_replies: [
      {
        content_type: "text",
        title: (buttonLabel || "Continuar").slice(0, 20),
        payload,
      },
    ],
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

// Alcance total da conta nos últimos dias (usado no painel de analytics)
export async function fetchAccountReach(igUserId: string, token: string) {
  const params = new URLSearchParams({
    metric: "reach",
    period: "day",
    metric_type: "total_value",
    access_token: token,
  });
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/insights?${params}`);
  if (!res.ok)
    throw new Error(`Falha ao buscar alcance da conta: ${await res.text()}`);
  const json = await res.json();
  const total = json?.data?.[0]?.total_value?.value;
  return typeof total === "number" ? total : null;
}

// Métricas de um post específico (likes/comentários vêm do objeto da mídia,
// que é mais confiável; reach/saved vêm do endpoint de insights, que nem todo
// tipo de mídia suporta — por isso os dois blocos têm try/catch separados)
export async function fetchMediaInsights(mediaId: string, token: string) {
  let likes: number | null = null;
  let comments: number | null = null;
  try {
    const fieldsParams = new URLSearchParams({
      fields: "like_count,comments_count",
      access_token: token,
    });
    const res = await fetch(`${GRAPH_BASE}/${mediaId}?${fieldsParams}`);
    if (res.ok) {
      const json = await res.json();
      likes = json.like_count ?? null;
      comments = json.comments_count ?? null;
    }
  } catch {
    // segue sem likes/comentários
  }

  let reach: number | null = null;
  let saved: number | null = null;
  try {
    const insightParams = new URLSearchParams({
      metric: "reach,saved",
      access_token: token,
    });
    const res = await fetch(
      `${GRAPH_BASE}/${mediaId}/insights?${insightParams}`,
    );
    if (res.ok) {
      const json = await res.json();
      for (const item of json.data || []) {
        const value = item.values?.[0]?.value ?? null;
        if (item.name === "reach") reach = value;
        if (item.name === "saved") saved = value;
      }
    }
  } catch {
    // alguns formatos de mídia (ex: carrossel) não suportam essas métricas — segue sem elas
  }

  return { likes, comments, reach, saved };
}
