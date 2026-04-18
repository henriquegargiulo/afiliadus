import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ML_API       = 'https://api.mercadolibre.com'

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ── ML OAuth ────────────────────────────────────────────────────
let tokenCache: { value: string; expiresAt: number } | null = null

async function getMlToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.value

  const res = await fetch(`${ML_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     Deno.env.get('ML_CLIENT_ID')!,
      client_secret: Deno.env.get('ML_CLIENT_SECRET')!,
    }),
  })
  if (!res.ok) throw new Error(`ML OAuth falhou: ${res.status}`)
  const data = await res.json()
  tokenCache = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 }
  return tokenCache.value
}

// ── ML Search ───────────────────────────────────────────────────
interface MlItem {
  id: string
  title: string
  price: number
  original_price: number | null
  permalink: string
  thumbnail: string | null
  sold_quantity: number | null
  category_id: string
}

async function searchMl(params: {
  categoria_id?: string | null
  termo_busca?: string | null
  limit?: number
}): Promise<MlItem[]> {
  const token = await getMlToken()
  const qs    = new URLSearchParams({ limit: String(params.limit ?? 50), sort: 'relevance' })
  if (params.categoria_id) qs.set('category', params.categoria_id)
  if (params.termo_busca)   qs.set('q', params.termo_busca)

  // Retry com backoff para rate limit
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${ML_API}/sites/MLB/search?${qs}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
      continue
    }
    if (!res.ok) throw new Error(`ML Search ${res.status}: ${params.categoria_id ?? params.termo_busca}`)
    const data = await res.json()
    return data.results ?? []
  }
  return []
}

// ── Processamento em lote ───────────────────────────────────────
async function processBatch<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency = 3,
  delayMs = 200
) {
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    await Promise.allSettled(batch.map(fn))
    if (i + concurrency < items.length) await new Promise(r => setTimeout(r, delayMs))
  }
}

// ── Handler principal ───────────────────────────────────────────
Deno.serve(async () => {
  const startedAt = Date.now()
  const log: string[] = []

  try {
    // 1. Busca interesses ativos agrupados por categoria/termo
    const { data: interesses, error } = await admin
      .from('usuario_interesses')
      .select('id, user_id, categoria_id, termo_busca, desconto_minimo')
      .eq('ativo', true)

    if (error) throw error
    if (!interesses?.length) {
      return new Response(JSON.stringify({ message: 'Nenhum interesse ativo', ms: Date.now() - startedAt }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    log.push(`${interesses.length} interesses ativos encontrados`)

    // 2. Agrupa por chave de busca para evitar chamadas duplicadas à API
    const searchGroups = new Map<string, typeof interesses>()
    for (const i of interesses) {
      const key = `${i.categoria_id ?? ''}|${i.termo_busca ?? ''}`
      if (!searchGroups.has(key)) searchGroups.set(key, [])
      searchGroups.get(key)!.push(i)
    }

    log.push(`${searchGroups.size} buscas únicas na API do ML`)

    let totalSalvas = 0

    // 3. Para cada grupo, faz UMA chamada à API e distribui para todos os usuários
    await processBatch(
      [...searchGroups.entries()],
      async ([, grupo]) => {
        const primeiro = grupo[0]
        let items: MlItem[] = []

        try {
          items = await searchMl({
            categoria_id: primeiro.categoria_id,
            termo_busca:  primeiro.termo_busca,
            limit:        50,
          })
        } catch (err) {
          log.push(`Erro na busca "${primeiro.categoria_id ?? primeiro.termo_busca}": ${err}`)
          return
        }

        // 4. Para cada usuário no grupo, filtra pelos seus critérios e salva
        for (const interesse of grupo) {
          const ofertasFiltradas = items
            .filter(item => {
              if (!item.original_price || item.original_price <= item.price) return false
              const desconto = ((item.original_price - item.price) / item.original_price) * 100
              return desconto >= Number(interesse.desconto_minimo)
            })
            .map(item => {
              const desconto = ((item.original_price! - item.price) / item.original_price!) * 100
              return {
                user_id:             interesse.user_id,
                interesse_id:        interesse.id,
                marketplace_id:      'mercadolivre',
                external_id:         item.id,
                titulo:              item.title,
                url_original:        item.permalink,
                url_imagem:          item.thumbnail?.replace('-I.jpg', '-O.jpg') ?? null,
                preco_atual:         item.price,
                preco_original:      item.original_price,
                percentual_desconto: Math.round(desconto * 100) / 100,
                total_vendas:        item.sold_quantity,
                link_afiliado:       item.permalink, // tracking params adicionados via redirect-engine
                expira_em:           new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              }
            })

          if (ofertasFiltradas.length === 0) continue

          const { error: upsertErr } = await admin
            .from('ofertas_curadas')
            .upsert(ofertasFiltradas, { onConflict: 'user_id,external_id', ignoreDuplicates: false })

          if (upsertErr) {
            log.push(`Erro ao salvar ofertas user ${interesse.user_id}: ${upsertErr.message}`)
          } else {
            totalSalvas += ofertasFiltradas.length
          }
        }
      },
      3,   // 3 buscas em paralelo
      300  // 300ms entre lotes (respeita rate limit ML)
    )

    // 5. Remove ofertas expiradas
    await admin
      .from('ofertas_curadas')
      .delete()
      .lt('expira_em', new Date().toISOString())

    log.push(`${totalSalvas} ofertas salvas/atualizadas`)

    return new Response(
      JSON.stringify({ success: true, log, ms: Date.now() - startedAt }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: String(err), log }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
