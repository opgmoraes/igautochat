import Link from "next/link";
import { getConfig, getAutomations, toggleAutomation, deleteAutomation } from "./actions";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const config = await getConfig();
  const automations = await getAutomations();
  const connected = !!config?.access_token;
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Painel — Meu ManyChat</h1>
      {!connected ? (
        <div style={{ marginTop: 16, padding: 16, background: "#fff3e0", borderRadius: 8 }}>
          <p>Seu Instagram ainda não está conectado.</p>
          
            href="/api/oauth/start"
            style={{
              display: "inline-block",
              marginTop: 8,
              padding: "10px 16px",
              background: "#111",
              color: "#fff",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            Conectar Instagram
          </a>
        </div>
      ) : (
        <div style={{ marginTop: 16, padding: 16, background: "#e8f5e9", borderRadius: 8 }}>
          Conectado como <b>@{config.ig_username}</b>
        </div>
      )}
      <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Automações</h2>
        <Link
          href="/dashboard/automations/new"
          style={{ padding: "8px 14px", background: "#ff5a1f", color: "#fff", borderRadius: 8, textDecoration: "none" }}
        >
          + Nova automação
        </Link>
      </div>
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {automations.length === 0 && <p style={{ color: "#666" }}>Nenhuma automação criada ainda.</p>}
        {automations.map((a: any) => (
          <div key={a.id} style={{ padding: 16, border: "1px solid #eee", borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <b>{a.name}</b>
              <span style={{ color: a.active ? "green" : "#999" }}>{a.active ? "Ativa" : "Pausada"}</span>
            </div>
            <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
              Palavras: {a.keywords.join(", ") || "(qualquer)"} · Gatilhos:{" "}
              {[a.trigger_comment && "comentário", a.trigger_story_reply && "story", a.trigger_dm && "DM"]
                .filter(Boolean)
                .join(", ")}
            </div>
            <form
              action={async () => {
                "use server";
                await toggleAutomation(a.id, !a.active);
              }}
              style={{ display: "inline" }}
            >
              <button type="submit" style={{ marginTop: 8, marginRight: 8 }}>
                {a.active ? "Pausar" : "Ativar"}
              </button>
            </form>
            <form
              action={async () => {
                "use server";
                await deleteAutomation(a.id);
              }}
              style={{ display: "inline" }}
            >
              <button type="submit" style={{ marginTop: 8, color: "red" }}>
                Excluir
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
