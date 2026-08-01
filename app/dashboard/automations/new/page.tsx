import { createAutomation, getMyMedia } from "../../actions";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function NewAutomation() {
  const media = await getMyMedia();

  async function action(formData: FormData) {
    "use server";
    await createAutomation(formData);
    redirect("/dashboard");
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Nova automação</h1>
      <form action={action} style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
        <label>
          Nome da automação
          <input name="name" required style={inputStyle} placeholder="Ex: Ebook grátis" />
        </label>

        <fieldset style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <legend>Onde ativar</legend>
          <label><input type="checkbox" name="trigger_comment" defaultChecked /> Comentário em post/reels</label><br />
          <label><input type="checkbox" name="trigger_story_reply" /> Resposta a story</label><br />
          <label><input type="checkbox" name="trigger_dm" /> DM direta</label>
        </fieldset>

        <label>
          Palavras-chave (separadas por vírgula)
          <input name="keywords" style={inputStyle} placeholder="quero, link, eu quero" />
        </label>

        <label>
          Tipo de correspondência
          <select name="match_type" style={inputStyle}>
            <option value="contains">Contém a palavra</option>
            <option value="exact">Exatamente igual</option>
            <option value="any">Qualquer comentário</option>
          </select>
        </label>

        <label>
          Post/reels específico (opcional)
          <select name="target_media_id" style={inputStyle}>
            <option value="">Qualquer post</option>
            {media.map((m: any) => (
              <option key={m.id} value={m.id}>
                {(m.caption || m.id).slice(0, 60)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Respostas públicas (uma por linha, sorteia entre elas — opcional)
          <textarea name="public_replies" style={inputStyle} rows={3} placeholder={"Te chamei no direct! 😉\nVai lá no direct que te mandei algo"} />
        </label>

        <label>
          Mensagem de boas-vindas (DM)
          <textarea name="welcome_message" required style={inputStyle} rows={3} placeholder="Oi! Toca no botão abaixo pra receber o link 👇" />
        </label>

        <label>
          Rótulo do botão de resposta rápida
          <input name="quick_reply_label" style={inputStyle} defaultValue="Quero!" />
        </label>

        <label>
          Rótulo do botão do link
          <input name="link_label" style={inputStyle} defaultValue="Acessar" />
        </label>

        <label>
          URL do link
          <input name="link_url" style={inputStyle} placeholder="https://" />
        </label>

        <label>
          Texto do lembrete (opcional)
          <textarea name="reminder_text" style={inputStyle} rows={2} placeholder="Ainda não viu? O link continua aqui 👇" />
        </label>

        <label>
          Atraso do lembrete (minutos)
          <input name="reminder_delay_minutes" type="number" style={inputStyle} defaultValue={60} />
        </label>

        <button type="submit" style={{ padding: "12px 16px", background: "#ff5a1f", color: "#fff", border: 0, borderRadius: 8, fontWeight: 600 }}>
          Criar automação
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  marginTop: 4,
  border: "1px solid #ddd",
  borderRadius: 8,
  display: "block",
};
