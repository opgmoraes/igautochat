# Diagnóstico e plano — automações

## Base existente
Next.js 16.2.12, páginas HTML autenticadas, Supabase com service role no servidor,
OAuth Instagram Login, Graph v25.0, múltiplas contas, webhook assinado,
fila com claim atômico, mensagens por clique e um lembrete após o link.
Não há testes, dependências instaladas ou credenciais locais fornecidas.

## Lacunas
O clique STEP_n avança sem verificar seguidor nem vincular à execução original.
A janela é atualizada só na etapa final e dispensada em vários envios.
Deduplicação usa leitura antes de inserção, permitindo corrida. Contatos têm
unicidade global em vez de por conta. Pausar não interrompe fila já criada.
Lembretes são agendados antes da confirmação de envio do link.

## Limites da Meta
Usar somente Graph oficial e instagram_business_basic,
instagram_business_manage_messages e instagram_business_manage_comments já
solicitados no OAuth. Aprovação/Advanced Access depende do app e precisa ser
validado numa conta real. A consulta GET /{IGSID}?fields=is_user_follow_business
depende de acesso ao perfil no contexto da conversa; comentário sozinho não é
confirmação de consentimento. Booleano ausente/erro = indisponível, nunca true.
Resposta privada inicial não abre janela; novos envios exigem interação recebida
há menos de 24 horas. Não usar HUMAN_AGENT para automação promocional.

Consultado em 2026-11-07: coleção oficial Meta no Postman:
https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
Os guias de user-profile e private-replies de developers.facebook.com retornaram
429/inacessível; detalhes do campo e aprovação precisam de validação no app real.

## Implementação autorizada
- [x] Migração aditiva: execuções com snapshot, chave única por gatilho,
  unicidade da fila e contatos por conta; preservar registros antigos.
- [x] Testes de janela, validação, resposta de seguidor e progressão.
- [x] Webhook idempotente: interação autêntica abre janela pelo timestamp do evento;
  cliques vinculados à execução e à etapa realmente enviada.
- [x] Worker: checar janela no envio, suspender campanhas pausadas, consultar
  seguidor antes do link, agendar sequência após envio confirmado.
- [x] Falhas explícitas transitórias com backoff limitado; envio ambíguo não será
  repetido automaticamente. Recuperar claims travados como falhas para revisão.
- [x] Formulário: condição de seguidor, sequência com intervalos em minutos/horas/dias,
  visão do fluxo; duplicação pausada e métricas no painel.
- [x] Verificar testes, TypeScript, build e JavaScript da interface; documentar ativação SQL/cron.
- [ ] Inspeção visual desktop/móvel: navegador de revisão indisponível.
- [ ] Aplicação SQL e teste com Meta real: faltam credenciais e ambiente conectado.

Decisão de implementação: preservar message/link existentes; follow-ups ficam num
array separado, cada intervalo contado a partir do envio anterior. Execuções
usam snapshot para que edição de campanha não troque conteúdo no meio do fluxo.
Sem deploy nem alteração do banco remoto neste trabalho.
