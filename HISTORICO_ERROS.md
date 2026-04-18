# Histórico de Erros e Tentativas de Solução — Afiliadus

---

## Erro 1 — `flag needs an argument: --project-ref`
**Causa:** Secret `SUPABASE_PROJECT_ID` vazio no GitHub.
**Solução:** Hardcoded o project ref direto no workflow.
**Status:** Resolvido.

---

## Erro 2 — `Invalid access token format. Must be like sbp_...`
**Causa:** Secret `SUPABASE_ACCESS_TOKEN` preenchido com JWT em vez do token pessoal do CLI.
**Solução:** Gerado token correto `sbp_...` em supabase.com/dashboard/account/tokens.
**Status:** Resolvido.

---

## Erro 3 — `password authentication failed`
**Causa:** `SUPABASE_DB_PASSWORD` incorreto.
**Solução:** Resetada a senha no dashboard do Supabase.
**Status:** Resolvido.

---

## Erro 4 — `mercadolivre-oauth function not found`
**Causa:** `config.toml` referenciava função inexistente no Supabase remoto.
**Solução:** Separar workflow em `deploy-migrations.yml` + `deploy-functions.yml` com lista explícita.
**Status:** Resolvido.

---

## Erro 5 — `HAVING sem GROUP BY` (SQLSTATE 42803)
**Causa:** Função SQL usava HAVING sem GROUP BY.
**Solução:** Reescrita com subquery e WHERE externo.
**Status:** Resolvido.

---

## Erro 6 — `schema "cron" does not exist`
**Causa:** Extensão `pg_cron` não habilitada.
**Solução:** Habilitada em Dashboard → Extensions.
**Status:** Resolvido.

---

## Erro 7 — `schema "net" does not exist`
**Causa:** `pg_net` não habilitado + placeholder de credencial não substituído.
**Solução:** Habilitado `pg_net` e recriada função com key real.
**Status:** Resolvido.

---

## Erro 8 — ML API retorna 403 em todos os ambientes
**Causa:** Mercado Livre bloqueia IPs de provedores cloud (AWS, Cloudflare) e também bloqueia o token `client_credentials` para o endpoint de busca, mesmo a partir de IP residencial.
**Tentativa 1:** OAuth `client_credentials` com token — 403 persiste.
**Tentativa 2:** Cloudflare Worker como proxy — Cloudflare IPs também bloqueados.
**Tentativa 3:** Worker local (Mac) com IP residencial — 403 mesmo localmente.
**Conclusão:** ML bloqueia o tipo de app/token para o endpoint de busca. Decisão: migrar para SerpAPI.
**Status:** Abandonado. Substituído por SerpAPI.

---

## Erro 9 — SerpAPI retorna 0 produtos com operador `site:`
**Causa:** A query montada com `site:mercadolivre.com.br OR site:amazon.com.br` não é suportada pelo Google Shopping — retorna array `shopping_results` vazio.
**Solução:** Removido o operador `site:` da query. Filtragem de lojas feita somente no código via `detectarLoja()`.
**Status:** Resolvido — passou a retornar 15 produtos.

---

## Erro 10 — 15 produtos encontrados mas 0 salvos
**Causa:** O interesse de teste tinha `desconto_minimo = 20`. O Google Shopping raramente retorna `extracted_old_price`, então `percentual_desconto` calculado era 0 para todos os produtos, e nenhum passava no filtro de 20%.
**Solução:** Atualizado `desconto_minimo = 0` no interesse de teste para validar o fluxo completo.
**Status:** Parcialmente resolvido — o filtro de lojas passou a ser o novo bloqueio.

---

## Erro 11 — 0 produtos após filtro de lojas (`detectarLoja`)
**Causa provável:** O Google Shopping Brasil retorna lojas como "Shoptime", "Kabum", "Magazine Luiza" etc. A função `detectarLoja()` usava comparação simples com `includes()` e descartava tudo que não fosse exatamente "mercado livre", "amazon" ou "shopee".
**Tentativa 1:** Adicionados logs de diagnóstico com `console.log` — logs não aparecem nas abas de Invocations nem Details do Supabase.
**Tentativa 2:** Reescrita do `detectarLoja()` com normalização (minúsculo, sem acentos) e múltiplas keywords por loja.
**Tentativa 3:** Adicionado campo `lastRawDebug` público no adapter para expor dados brutos da SerpAPI no JSON de resposta.
**Status:** Em investigação.

---

## Erro 12 — `TypeError: Cannot read properties of undefined`
**Contexto:** Após as mudanças de diagnóstico, o worker passou a lançar TypeError dentro do `GoogleShoppingAdapter`.
**Causa:** A SerpAPI estava retornando uma resposta inesperada (possivelmente erro de quota ou resposta não-JSON), e o código tentava acessar `.shopping_results` em um objeto `null` ou `undefined` sem proteção.
**Solução aplicada:** Parsing defensivo com `.catch(() => null)` no `res.json()` e fallback para objeto vazio. Adicionado `if (data.error) throw new Error(...)` para expor o erro real da SerpAPI no log.
**Suspeita:** Quota do plano gratuito da SerpAPI esgotada (100 buscas/mês). Cada teste de disparo consome 1 busca.
**Status:** Aguardando próximo disparo para confirmar erro real via campo `serp_error` no log.

---

## Estado atual da arquitetura

```
pg_cron (a cada 12h)
    ↓
daily-discovery (Edge Function)
    ↓ SerpAPI Google Shopping
    ↓ filtra ML / Amazon / Shopee
    ↓ upsert
ofertas_curadas (Supabase)
    ↓
minha-curadoria (GET autenticado)
    ↓
App do afiliado
```

## Funções ativas

| Função             | Descrição                          |
|--------------------|------------------------------------|
| daily-discovery    | Worker de coleta via SerpAPI       |
| minha-curadoria    | GET ofertas curadas do usuário     |
| buscar-precos      | Busca ad-hoc por produto           |
| redirect-engine    | Encurtador + rastreio de cliques   |
| create-link        | Criação de links afiliados         |

## Próximo passo imediato

Verificar em serpapi.com/dashboard quantas buscas foram consumidas.
Se a quota estiver esgotada, aguardar renovação mensal ou fazer upgrade do plano.
Após o próximo disparo bem-sucedido, o campo `serp_error` no JSON de resposta vai confirmar a causa raiz.
