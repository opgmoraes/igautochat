export default function Privacidade() {
  return (
    <div style={{
      maxWidth: 680, margin: "0 auto", padding: "40px 24px 80px",
      fontFamily: "Inter, system-ui, sans-serif", lineHeight: 1.7,
      background: "#0b0d10", color: "#edeef0", minHeight: "100vh"
    }}>
      <style>{`a { color: #5eead4; }`}</style>
      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26 }}>Política de Privacidade</h1>
      <p>
        Este aplicativo é uma ferramenta pessoal de automação de mensagens diretas (DM) do
        Instagram, usada exclusivamente pelo administrador desta conta para responder
        automaticamente a comentários e mensagens recebidas.
      </p>
      <h2>Quais dados coletamos</h2>
      <p>
        Coletamos o identificador (ID) do Instagram de quem interage com os posts, reels ou
        mensagens da conta administrada, além do texto do comentário ou mensagem, para
        determinar se uma automação deve ser disparada.
      </p>
      <h2>Como usamos os dados</h2>
      <p>
        Os dados são usados apenas para identificar quem já interagiu, controlar a janela de
        24 horas de mensagens permitida pela Meta e evitar envios duplicados. Não vendemos
        nem compartilhamos esses dados com terceiros.
      </p>
      <h2>Armazenamento</h2>
      <p>
        Os dados ficam armazenados em um banco de dados privado (Supabase), acessível apenas
        pelo administrador da conta.
      </p>
      <h2>Exclusão de dados</h2>
      <p>
        Para solicitar a exclusão dos seus dados, acesse a página{" "}
        <a href="/exclusao-de-dados">Exclusão de Dados</a>.
      </p>
      <h2>Contato</h2>
      <p>Em caso de dúvidas, entre em contato com o administrador desta conta pelo Instagram.</p>
    </div>
  );
}
