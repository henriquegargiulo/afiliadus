import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleShoppingAdapter } from '../_shared/GoogleShoppingAdapter.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SERPAPI_KEY  = Deno.env.get('SERPAPI_KEY')!

const admin   = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const adapter = new GoogleShoppingAdapter(SERPAPI_KEY)

interface Interesse {
  id:              string
  user_id:         string
  categoria_id:    string | null
  termo_busca:     string | null
  desconto_minimo: number
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
      return Response.json({ message: 'Nenhum interesse ativo', ms: Date.now() - startedAt })
    }

    log.push(`${interesses.length} interesses ativos`)

    // Agrupa por termo de busca para evitar chamadas duplicadas à SerpAPI
    const grupos = new Map<string, Interesse[]>()
    for (const i of interesses as Interesse[]) {
      const chave = i.termo_busca ?? i.categoria_id ?? ''
      if (!chave) continue
      if (!grupos.has(chave)) grupos.set(chave, [])
      grupos.get(chave)!.push(i)
    }

    log.push(`${grupos.size} buscas únicas na SerpAPI`)
    let totalSalvas = 0

    for (const [chave, grupo] of grupos) {
      let produtos: Awaited<ReturnType<typeof adapter.buscarOfertasPorInteresse>> = []

      try {
        produtos = await adapter.buscarOfertasPorInteresse(chave, 0)
        log.push(`"${chave}": ${produtos.length} produto(s) encontrado(s)`)
      } catch (err) {
        log.push(`Erro na busca "${chave}": ${err}`)
        continue
      }

      for (const interesse of grupo) {
        const ofertas = produtos
          .filter(p => p.percentual_desconto >= interesse.desconto_minimo)
          .map(p => ({
            user_id:             interesse.user_id,
            interesse_id:        interesse.id,
            marketplace_id:      p.marketplace_id,
            external_id:         p.id,
            titulo:              p.titulo,
            url_original:        p.link_afiliado,
            url_imagem:          p.imagem_url,
            preco_atual:         p.preco_atual,
            preco_original:      p.preco_original,
            percentual_desconto: p.percentual_desconto,
            link_afiliado:       p.link_afiliado,
            expira_em:           new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          }))

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

      await new Promise(r => setTimeout(r, 300))
    }

    // Remove ofertas expiradas
    await admin.from('ofertas_curadas').delete().lt('expira_em', new Date().toISOString())

    log.push(`${totalSalvas} ofertas salvas/atualizadas`)

    return Response.json({ success: true, log, ms: Date.now() - startedAt })
  } catch (err) {
    return Response.json(
      { success: false, error: String(err), log },
      { status: 500 }
    )
  }
})
