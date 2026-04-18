import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { searchMercadoLivre } from './adapters/mercadolivre.ts'
import { searchShopee }       from './adapters/shopee.ts'
import { searchAmazon }       from './adapters/amazon.ts'
import type { NormalizedProduct } from '../_shared/marketplace.ts'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function persistProducts(produtos: NormalizedProduct[]) {
  if (produtos.length === 0) return

  // Upsert produtos (atualiza se já existir pelo par marketplace+external_id)
  const { data: upserted, error: upsertErr } = await admin
    .from('produtos')
    .upsert(
      produtos.map(p => ({
        marketplace_id: p.marketplace_id,
        external_id:    p.external_id,
        titulo:         p.titulo,
        url_produto:    p.url_produto,
        url_imagem:     p.url_imagem,
        categoria:      p.categoria,
        vendedor:       p.vendedor,
        avaliacao:      p.avaliacao,
        total_vendas:   p.total_vendas ?? 0,
        updated_at:     new Date().toISOString(),
      })),
      { onConflict: 'marketplace_id,external_id', ignoreDuplicates: false }
    )
    .select('id, external_id, marketplace_id')

  if (upsertErr) {
    console.error('upsert produtos:', upsertErr.message)
    return
  }

  // Mapeia external_id → uuid do banco
  const idMap = new Map(
    (upserted ?? []).map((r: any) => [`${r.marketplace_id}:${r.external_id}`, r.id])
  )

  // Insere snapshot de preço para cada produto
  const snapshots = produtos
    .map(p => {
      const produto_id = idMap.get(`${p.marketplace_id}:${p.external_id}`)
      if (!produto_id) return null
      return {
        produto_id,
        preco_atual:          p.preco_atual,
        preco_original:       p.preco_original,
        percentual_desconto:  p.percentual_desconto,
        disponivel:           true,
      }
    })
    .filter(Boolean)

  if (snapshots.length > 0) {
    const { error: snapErr } = await admin.from('historico_precos').insert(snapshots)
    if (snapErr) console.error('insert historico_precos:', snapErr.message)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'Method Not Allowed' }, 405)
  }

  // Suporta GET (?q=...&marketplace=...&limit=...) e POST (body JSON)
  let q = '', marketplace = 'all', limit = 20

  if (req.method === 'GET') {
    const url = new URL(req.url)
    q           = url.searchParams.get('q') ?? ''
    marketplace = url.searchParams.get('marketplace') ?? 'all'
    limit       = parseInt(url.searchParams.get('limit') ?? '20', 10)
  } else {
    try {
      const body = await req.json()
      q           = body.q ?? ''
      marketplace = body.marketplace ?? 'all'
      limit       = body.limit ?? 20
    } catch {
      return json({ error: 'Body JSON inválido' }, 400)
    }
  }

  if (!q.trim()) return json({ error: 'Parâmetro q é obrigatório' }, 400)
  limit = Math.min(Math.max(limit, 1), 50)

  const params = { q, limit }

  // Chama adapters em paralelo conforme marketplace solicitado
  const calls: Promise<{ marketplace: string; produtos: NormalizedProduct[]; error?: string }>[] = []

  if (marketplace === 'all' || marketplace === 'mercadolivre') {
    calls.push(searchMercadoLivre(params).then(r => ({ marketplace: 'mercadolivre', ...r })))
  }
  if (marketplace === 'all' || marketplace === 'shopee') {
    calls.push(searchShopee(params).then(r => ({ marketplace: 'shopee', ...r })))
  }
  if (marketplace === 'all' || marketplace === 'amazon') {
    calls.push(searchAmazon(params).then(r => ({ marketplace: 'amazon', ...r })))
  }

  const results = await Promise.all(calls)

  const todos = results.flatMap(r => r.produtos)
  const erros = results.filter(r => r.error).map(r => ({ marketplace: r.marketplace, error: r.error }))

  // Persiste assincronamente — não bloqueia a resposta
  // @ts-ignore
  if (typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(persistProducts(todos))
  } else {
    await persistProducts(todos)
  }

  return json({
    q,
    total: todos.length,
    produtos: todos,
    ...(erros.length > 0 && { avisos: erros }),
  })
})
