import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleShoppingAdapter } from '../_shared/adapters/GoogleShoppingAdapter.ts'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CACHE_MINUTES = 60

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function normalizarProduto(row: Record<string, unknown>) {
  return {
    id:                  row.id,
    titulo:              row.titulo,
    preco_atual:         row.preco_atual,
    preco_original:      row.preco_original,
    percentual_desconto: row.percentual_desconto,
    loja:                row.marketplace_id,
    link:                row.url_original,
    imagem:              row.url_imagem ?? null,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  const url    = new URL(req.url)
  const query  = url.searchParams.get('q')?.trim()
  if (!query)  return json({ error: 'Parâmetro "q" obrigatório' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Cache: busca ofertas com título similar criadas há menos de CACHE_MINUTES min
  const cacheLimit = new Date(Date.now() - CACHE_MINUTES * 60 * 1000).toISOString()
  const { data: cached } = await admin
    .from('ofertas_curadas')
    .select('id, titulo, preco_atual, preco_original, percentual_desconto, marketplace_id, url_original, url_imagem')
    .ilike('titulo', `%${query}%`)
    .gte('descoberta_em', cacheLimit)
    .limit(40)

  if (cached && cached.length > 0) {
    return json({
      query,
      fonte: 'cache',
      total: cached.length,
      resultados: cached.map(normalizarProduto),
    })
  }

  // Cache miss: chama SerpAPI
  const adapter = new GoogleShoppingAdapter()
  const produtos = await adapter.buscarOfertas(query)

  if (!produtos.length) {
    return json({ query, fonte: 'serpapi', total: 0, resultados: [] })
  }

  // Persiste no banco associado ao usuário que buscou
  const ofertas = produtos
    .filter(p => p.link_afiliado && p.titulo && p.preco_atual)
    .map(p => ({
      user_id:             user.id,
      marketplace_id:      p.marketplace_id,
      external_id:         p.id,
      titulo:              p.titulo,
      url_original:        p.link_afiliado,
      url_imagem:          p.imagem_url ?? null,
      preco_atual:         p.preco_atual,
      preco_original:      p.preco_original ?? p.preco_atual,
      percentual_desconto: p.preco_original && p.preco_atual && p.preco_original > p.preco_atual
        ? Math.round(((p.preco_original - p.preco_atual) / p.preco_original) * 10000) / 100
        : 0,
      link_afiliado:       p.link_afiliado,
      expira_em:           new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }))

  if (ofertas.length > 0) {
    await admin
      .from('ofertas_curadas')
      .upsert(ofertas, { onConflict: 'user_id,external_id', ignoreDuplicates: false })
  }

  return json({
    query,
    fonte: 'serpapi',
    total: ofertas.length,
    resultados: ofertas.map(o => ({
      id:                  o.external_id,
      titulo:              o.titulo,
      preco_atual:         o.preco_atual,
      preco_original:      o.preco_original,
      percentual_desconto: o.percentual_desconto,
      loja:                o.marketplace_id,
      link:                o.url_original,
      imagem:              o.url_imagem,
    })),
  })
})
