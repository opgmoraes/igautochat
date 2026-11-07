# Ativação e validação

## Banco e deploy

1. No ambiente de destino, aplicar `supabase/automation_sequences.sql` **depois**
   de `schema.sql` e antes de ativar o novo código. A migração é transacional e
   reexecutável. Não elimina campanhas, contatos nem mensagens existentes.
   Faz a unicidade de contatos passar de global para `(account_id, ig_scoped_id)`.
   Não executar simultaneamente com o código antigo recebendo webhooks; combinar
   a troca do código e a migração numa janela curta de manutenção.
2. Manter `IG_APP_ID`, `IG_APP_SECRET`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `WEBHOOK_VERIFY_TOKEN`, `CRON_SECRET` e `APP_URL`.
   O worker usa no máximo 60 segundos por execução. Nenhuma nova credencial é exigida.
3. Confirmar o cron existente: POST `/api/cron/drain` a cada minuto, com
   `x-cron-secret`. O acionamento pelo webhook é uma aceleração; não substitui cron.
   Agendamentos têm precisão aproximada de um minuto, além da latência da fila.
4. Conferir o acesso do app a `instagram_business_basic`,
   `instagram_business_manage_messages` e `instagram_business_manage_comments`.
   OAuth já solicita esses escopos. Acesso para pessoas fora dos papéis de teste
   depende da aprovação e do nível de acesso do app na Meta. Não foi possível
   consultar o painel do app ou um token real neste ambiente.

## Funcionamento

- Mensagens anteriores ao link continuam avançando por clique. A condição de
  seguidor troca o último botão por “Já segui ✅”. Configure o texto anterior
  para convidar a pessoa a seguir o perfil.
- O clique consulta o perfil no Graph v25.0 com o token da conta destinatária.
  Somente `is_user_follow_business: true` libera o link. `false` informa que
  não segue; erro/campo ausente informa indisponibilidade e mantém o bloqueio.
  Nenhuma API não oficial é usada. Não existe confirmação por texto digitado.
- Follow-ups têm texto, link opcional e intervalo próprio em minutos. Os atalhos
  oferecem 10 minutos, 2 horas e 1 dia. Cada atraso parte do envio confirmado
  anterior; somente o próximo item é agendado. O lembrete antigo continua
  funcionando e, quando configurado, vem antes dos novos follow-ups.
- Todos os envios por IGSID conferem janela de 24h imediatamente antes de chamar
  o transporte. Envios, comentários, recibos e ecos não abrem essa janela.
  Uma mensagem bloqueada por janela vencida encerra a sequência e não é
  ressuscitada automaticamente por uma interação posterior.
- Comentário permite a resposta privada inicial dentro do limite de 7 dias;
  não abre janela para sequência. Eventos LIVE identificados são ignorados
  porque têm regras diferentes. Não habilitar campanha para Live neste fluxo.
- Cada execução guarda um snapshot. Edição vale para execuções novas; botões de
  uma execução anterior continuam vinculados a ela. Pausar suspende o pendente;
  retomar reavalia a janela e pode bloquear mensagens vencidas. Um envio já em
  andamento na Meta não pode ser desfeito pela pausa.
- Duplicação copia configuração e cria campanha **pausada**, sem contatos ou fila.

## Falhas e observabilidade

Reentregas usam chave única; claims atômicos impedem dois workers de enviarem o
mesmo item. Há apenas uma verificação pendente por etapa/execução. Rejeições
explicitamente transitórias da Meta têm até 3 tentativas com backoff (2 e 4
minutos antes das novas tentativas). Timeout/queda com resultado desconhecido
fica como falha para revisão, sem repetição automática. Claims com mais de 10
minutos também viram falha incerta. Não há promessa de exactly-once entre banco
e API externa. Se o envio confirmado for persistido, o cron pode recuperar o
agendamento seguinte sem reenviar a mensagem anterior.

O painel mostra totais por campanha e métricas semanais por conta. “Link entregue”
significa envio aceito pela Meta, não abertura ou clique. Verificações contam
consultas processadas; indisponibilidade aparece no log e nos erros da campanha.
Histórico anterior à migração sem `delivery_type` não é contado como entrega de
link nas novas métricas. A lista de atividade distingue sequência e verificação.
Não há botão de reenvio para resultado incerto; primeiro conferir na Meta.

## Verificação local

Requer Node 22.18+ (testado em 24.13.1):

```sh
npm ci --ignore-scripts
npm test
npx tsc --noEmit
npm run build
```

Os testes executam os handlers reais com banco em memória e transporte Meta
controlado. Não substituem um ensaio com Postgres/Supabase e contas reais.
Para inspecionar as páginas com dados fictícios, executar
`node tests/ui-preview.cjs` e abrir
`http://127.0.0.1:3101/new-automation.html?id=demo`, `/dashboard.html` e `/mobile`.
Esse servidor é apenas local, usa auth simulada e **não deve ser publicado**.

Antes de produção, testar numa cópia pausada e depois de ativá-la:
comentário com palavra-chave, botão sem seguir, seguir e repetir, campo/permissão
indisponível, duas contas com o mesmo contato, follow-up dentro da janela e
bloqueio após 24h. Conferir webhook `comments,messages`, acesso avançado e o
retorno real de `is_user_follow_business` no contexto da conversa.

Limites desta entrega: nenhuma migração/deploy remoto foi executado. Não há
credenciais locais. A documentação principal da Meta retornou 429/inacessível;
a coleção oficial no Postman foi consultada. A renderização visual não pôde
ser inspecionada porque o host do navegador está indisponível.

Resultados locais: 27 testes passaram; TypeScript e build de produção passaram.
ESLint dos arquivos alterados passou. O lint global permanece com 7 erros de
`no-explicit-any` preexistentes em analytics (3), content/[id] (1),
cron/refresh-token (1), media (1), oauth/callback (1), mais um aviso de parâmetro
não utilizado em oauth/start. Essas rotas não foram reescritas nesta entrega.
