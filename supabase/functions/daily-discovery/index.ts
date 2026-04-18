import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SERPAPI_KEY  = Deno.env.get('SERPAPI_KEY')!
const SERP_URL     = 'https://serpapi.com/search.json'

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

const LOJAS_PERMITIDAS = [
  { source: 'mercado livre', domain: 'mercadolivre.com.br', id: 'mercadolivre' },
  { source: 'amazon',        domain: 'amazon.com.br',       id: 'amazon'       },
  { source: 'shopee',        domain: 'shopee.com.br',       id: 'shopee'       },
]

interface SerpItem {
  title:                string
  extracted_price?:     number
  extracted_old_price?: number
  link:                 string
  source:               string
  thumbnail?:           string | null
}

function detectarLoja(item: SerpItem): string | null {
  const s = item.source.toLowerCase()
  const l = item.link.toLowerCase()
  for (const loja of LOJAS_PERMITIDAS) {
    if (s.includes(loja.source) || l.includes(loja.domain)) return loja.id
  }
  return null
}

async function buscarGoogleShopping(termo: string): Promise<SerpItem[]> {
  const query = `${termo} (site:mercadolivre.com.br OR site:amazon.com.br OR site:shopee.com.br)`
  const qs = new URLSearchParams({
    engine:  'google_shopping',
    q:       query,
    gl:      'br',
    hl:      'pt',
    num:     '20',
    api_key: SERPAPI_KEY,
  })

  const res = await fetch(`${SERP_URL}?${qs}`)
  if (!res.ok) throw new Error(`SerpAPI ${res.status}: ${termo}`)

  const data = await res.json() as { shopping_results?: SerpItem[] }
  return data.shopping_results ?? []
}

Deno.serve(async () => {
  const startedAt = Date.now()
  const log: string[] = []

  try {
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

    log.push(`${interesses.length} interesses ativos`)

    const grupos = new Map<string, typeof interesses>()
    for (const i of interesses) {
      const chave = i.termo_busca ?? i.categoria_id ?? ''
      if (!chave) continue
      if (!grupos.has(chave)) grupos.set(chave, [])
      grupos.get(chave)!.push(i)
    }

    log.push(`${grupos.size} buscas únicas`)
    let totalSalvas = 0

    for (const [chave, grupo] of grupos) {
      let items: SerpItem[] = []

      try {
        items = await buscarGoogleShopping(chave)
      } catch (err) {
        log.push(`Erro na busca "${chave}": ${err}`)
        continue
      }

      const itemsFiltrados = items.filter(i => detectarLoja(i) !== null && i.extracted_price)

      for (const interesse of grupo) {
        const ofertas = itemsFiltrados
          .filter(item => {
            if (!item.extracted_old_price || item.extracted_old_price <= item.extracted_price!) return false
            const desconto = ((item.extracted_old_price - item.extracted_price!) / item.extracted_old_price) * 100
            return desconto >= Number(interesse.desconto_minimo)
          })
          .map(item => {
            const precoAtual    = item.extracted_price!
            const precoOriginal = item.extracted_old_price ?? precoAtual
            const desconto      = precoOriginal > precoAtual
              ? ((precoOriginal - precoAtual) / precoOriginal) * 100
              : 0

            return {
              user_id:             interesse.user_id,
              interesse_id:        interesse.id,
              marketplace_id:      detectarLoja(item)!,
              external_id:         btoa(item.link).slice(0, 200),
              titulo:              item.title,
              url_original:        item.link,
              url_imagem:          item.thumbnail ?? null,
              preco_atual:         precoAtual,
              preco_original:      precoOriginal,
              percentual_desconto: Math.round(desconto * 100) / 100,
              link_afiliado:       item.link,
              expira_em:           new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            }
          })

        if (!ofertas.length) continue

        const { error: upsertErr } = await admin
          .from('ofertas_curadas')
          .upsert(ofertas, { onConflict: 'user_id,external_id', ignoreDuplicates: false })

        if (upsertErr) {
          log.push(`Erro ao salvar user ${interesse.user_id}: ${upsertErr.message}`)
        } else {
          totalSalvas += ofertas.length
        }
      }

      await new Promise(r => setTimeout(r, 500))
    }

    await admin.from('ofertas_curadas').delete().lt('expira_em', new Date().toISOString())

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
