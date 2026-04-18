// v2 — usa GoogleShoppingAdapter com todas as lojas + product_link
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleShoppingAdapter } from '../_shared/adapters/GoogleShoppingAdapter.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin   = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const adapter = new GoogleShoppingAdapter()

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

    // Agrupa por termo para evitar chamadas duplicadas à SerpAPI
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
      const { produtos, debug } = await adapter.buscarOfertasComDebug(chave)
      log.push(`"${chave}": ${produtos.length} produto(s) encontrado(s)`)
      if (debug) log.push(`[raio-x] ${JSON.stringify(debug)}`)

      for (const interesse of grupo) {
        const ofertas = produtos
          .filter(p => p.link_afiliado && p.titulo && p.preco_atual)
          .filter(p => {
            if (interesse.desconto_minimo === 0) return true
            if (!p.preco_atual || !p.preco_original) return false
            const desc = ((p.preco_original - p.preco_atual) / p.preco_original) * 100
            return desc >= interesse.desconto_minimo
          })
          .map(p => ({
            user_id:             interesse.user_id,
            interesse_id:        interesse.id,
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

        if (!ofertas.length) continue

        console.log('Payload a enviar:', Object.keys(ofertas[0]), JSON.stringify(ofertas[0]))

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
