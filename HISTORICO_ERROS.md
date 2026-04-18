# Histórico de Erros e Tentativas de Solução — Afiliadus

## Erro 1 — `flag needs an argument: --project-ref`

**Contexto:** Pipeline do GitHub Actions falhava ao tentar linkar o projeto Supabase.

**Causa:** A variável de ambiente `SUPABASE_PROJECT_ID` estava vazia no GitHub Secrets.

**Solução:** Substituir a variável pelo valor fixo `wfxaeibeyjvgvboypqtd` direto no arquivo do workflow.

---

## Erro 2 — `Invalid access token format. Must be like sbp_...`

**Contexto:** Pipeline falhava na autenticação com o Supabase CLI.

**Causa:** O secret `SUPABASE_ACCESS_TOKEN` foi preenchido com a chave JWT (anon/service key) em vez do token pessoal do Supabase CLI.

**Solução:** Gerar um token correto no formato `sbp_...` em supabase.com/dashboard/account/tokens e atualizar o secret no GitHub.

---

## Erro 3 — `password authentication failed`

**Contexto:** Pipeline falhava ao tentar rodar migrações no banco.

**Causa:** O secret `SUPABASE_DB_PASSWORD` estava incorreto.

**Solução:** Resetar a senha do banco no dashboard do Supabase e atualizar o secret.

---

## Erro 4 — `mercadolivre-oauth function not found`

**Contexto:** Pipeline falhava ao fazer deploy das Edge Functions.

**Causa:** O `config.toml` referenciava a função `mercadolivre-oauth` que existia localmente mas não no Supabase remoto. O Supabase CLI tenta sincronizar o estado remoto e falha.

**Tentativas:**
- Remover a entrada do `config.toml` — não resolveu
- Deploy explícito por nome — não resolveu
- Deletar via Management API — não resolveu
- Criar stub vazio da função — não resolveu

**Solução:** Separar o workflow único em dois arquivos independentes:
- `deploy-migrations.yml` — somente migrações
- `deploy-functions.yml` — somente funções, com lista explícita de funções permitidas

---

## Erro 5 — `HAVING sem GROUP BY` (SQLSTATE 42803)

**Contexto:** Função SQL `calcular_oportunidades` falhava ao ser executada.

**Causa:** A query usava `HAVING` sem ter um `GROUP BY` correspondente.

**Solução:** Envolver a query inteira em uma subquery e usar `WHERE` na query externa para filtrar pelo score calculado.

---

## Erro 6 — `schema "cron" does not exist`

**Contexto:** Tentativa de agendar o job de coleta via `cron.schedule()`.

**Causa:** A extensão `pg_cron` não estava habilitada no projeto Supabase.

**Solução:** Habilitar manualmente em Supabase Dashboard → Database → Extensions → pg_cron.

---

## Erro 7 — `schema "net" does not exist`

**Contexto:** Função SQL que chamava a Edge Function via HTTP falhava.

**Causas:**
1. A extensão `pg_net` não estava habilitada.
2. O placeholder `<COLE_SUA_SERVICE_ROLE_KEY_AQUI>` não havia sido substituído pela chave real.

**Solução:** Habilitar `pg_net` nas extensões e recriar a função com a service role key real.

---

## Erro 8 — ML API retorna 403 (principal problema)

**Contexto:** A Edge Function `search-offers` (e depois `daily-deal-discovery`) fazia chamadas à API do Mercado Livre e recebia 403 Forbidden.

**Causa confirmada:** O Mercado Livre bloqueia requisições originadas de IPs de provedores cloud (AWS, onde o Supabase roda). O bloqueio é baseado em IP, não em credenciais.

**Tentativa 1:** Usar OAuth `client_credentials` com `ML_CLIENT_ID` e `ML_CLIENT_SECRET` para obter token e fazer chamadas autenticadas.
- Resultado: 403 persistiu. O token é válido, mas o IP da AWS é bloqueado independentemente da autenticação.

**Tentativa 2:** Confirmar o bloqueio acessando a URL da API diretamente no browser do usuário.
- Resultado: Browser retornou dados normalmente. Confirmado que o bloqueio é específico para IPs cloud.

**Tentativa 3:** Pivot de arquitetura — limpar código que não funcionava e implementar nova arquitetura baseada em interesses do usuário (`usuario_interesses` + `ofertas_curadas` + worker `daily-deal-discovery`).
- Resultado: A nova arquitetura funciona corretamente, mas o bloqueio 403 na ML API persiste.

**Tentativa 4:** Usar Cloudflare Worker como proxy reverso para a ML API, esperando que os IPs da Cloudflare não fossem bloqueados.
- Resultado: 403 retornado mesmo pelo Cloudflare Worker. ML bloqueia IPs da Cloudflare também.

---

## Estado atual

- Infraestrutura completa e funcionando: banco, migrações, RLS, Edge Functions, CI/CD, cron job
- Único bloqueio: impossibilidade de acessar a ML Search API (`/sites/MLB/search`) a partir de qualquer servidor cloud ou edge network

## Próximos passos sugeridos

| Opção | Descrição | Custo |
|---|---|---|
| **VPS com IP residencial** | Servidor barato (Hetzner ~€3/mês) rodando o worker com IP não bloqueado | ~R$20/mês |
| **Proxy residencial** | Serviço como BrightData ou Smartproxy que roteia por IPs domésticos | ~R$100-300/mês |
| **ML Affiliates API** | Verificar se a API específica do Programa de Afiliados tem endpoint diferente do Search | Gratuito |
| **Fonte alternativa** | Usar outra API (Buscape, Zoom, Amazon PA-API) que não bloqueie cloud | Varia |
