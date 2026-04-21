// v3 — perfis_afiliados + watchlist + filtro ML/Amazon/Shopee
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleShoppingAdapter } from '../_shared/adapters/GoogleShoppingAdapter.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin   = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const adapter = new GoogleShoppingAdapter()

interface Interesse {
  id: string; user_id: string; termo_busca: string | null; desconto_minimo: number
}
interface Perfil {
  user_id: string; nichos_interesse: string[]; volume_ofertas_diario: number
}
interface WatchlistItem {
  id: string; user_id: string; titulo_produto: string; preco_alvo: number | null
}

function calcDesc(atual: number, original: number | null) {
  if (!original || original <= atual) return 0
  return Math.round(((original - atual) / original) * 10000) / 100
}

function montarOferta(userId: string, interesseId: string | null, p: {
  id: string; titulo: string; preco_atual: number | null; preco_original?: number | null
  link_afiliado: string; imagem_url: string | null; marketplace_id: string
}) {
  return {
    user_id:             userId,
    interesse_id:        interesseId,
    marketplace_id:      p.marketplace_id,
    external_id:         p.id,
    titulo:              p.titulo,
    url_original:        p.link_afiliado,
    url_imagem:          p.imagem_url ?? null,
    preco_atual:         p.preco_atual,
    preco_original:      p.preco_original ?? p.preco_atual,
    percentual_desconto: calcDesc(p.preco_atual!, p.preco_original ?? null),
    link_afiliado:       p.link_afiliado,
    expira_em:           new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }
}

Deno.serve(async () => {
  const startedAt = Date.now()
  const log: string[] = []

  try {
    // 1. Carregar interesses ativos
    const { data: interesses, error: intErr } = await admin
      .from('usuario_interesses')
      .select('id, user_id, termo_busca, desconto_minimo')
      .eq('ativo', true)
    if (intErr) throw intErr
    if (!interesses?.length) {
      return Response.json({ message: 'Nenhum interesse ativo', ms: Date.now() - startedAt })
    }

    const userIds = [...new Set((interesses as Interesse[]).map(i => i.user_id))]

    // 2. Carregar perfis e watchlists em paralelo
    const [{ data: perfisRaw }, { data: watchlistRaw }] = await Promise.all([
      admin.from('perfis_afiliados').select('user_id, nichos_interesse, volume_ofertas_diario').in('user_id', userIds),
      admin.from('produto_watchlist').select('id, user_id, titulo_produto, preco_alvo').in('user_id', userIds),
    ])

    const perfis = new Map<string, Perfil>(
      (perfisRaw ?? []).map((p: Perfil) => [p.user_id, p])
    )
    const watchlistPorUser = new Map<string, WatchlistItem[]>()
    for (const w of (watchlistRaw ?? []) as WatchlistItem[]) {
      if (!watchlistPorUser.has(w.user_id)) watchlistPorUser.set(w.user_id, [])
      watchlistPorUser.get(w.user_id)!.push(w)
    }

    // 3. Montar termos de busca por usuário
    // Prioridade: interesses explícitos > nichos do perfil > termos da watchlist
    const termosGlobais = new Map<string, { userIds: string[]; interesseIdPorUser: Map<string, string | null> }>()

    function registrarTermo(termo: string, userId: string, interesseId: string | null) {
      if (!termosGlobais.has(termo)) {
        termosGlobais.set(termo, { userIds: [], interesseIdPorUser: new Map() })
      }
      const entry = termosGlobais.get(termo)!
      if (!entry.userIds.includes(userId)) entry.userIds.push(userId)
      if (!entry.interesseIdPorUser.has(userId)) entry.interesseIdPorUser.set(userId, interesseId)
    }

    for (const i of interesses as Interesse[]) {
      if (i.termo_busca) registrarTermo(i.termo_busca, i.user_id, i.id)
    }
    for (const [userId, perfil] of perfis) {
      for (const nicho of perfil.nichos_interesse) {
        registrarTermo(nicho, userId, null)
      }
    }
    for (const [userId, items] of watchlistPorUser) {
      for (const w of items) {
        registrarTermo(w.titulo_produto, userId, null)
      }
    }

    log.push(`${userIds.length} usuário(s) | ${termosGlobais.size} buscas únicas na SerpAPI`)

    // 4. Buscar na SerpAPI (uma vez por termo)
    const resultadosPorTermo = new Map<string, Awaited<ReturnType<typeof adapter.buscarOfertasComDebug>>>()
    for (const termo of termosGlobais.keys()) {
      const resultado = await adapter.buscarOfertasComDebug(termo)
      resultadosPorTermo.set(termo, resultado)
      log.push(`"${termo}": ${resultado.produtos.length} produto(s) (ML/Amazon/Shopee)`)
      await new Promise(r => setTimeout(r, 300))
    }

    // 5. Distribuir resultados por usuário respeitando volume_ofertas_diario
    let totalSalvas = 0

    for (const userId of userIds) {
      const perfil = perfis.get(userId)
      const volumeMax = perfil?.volume_ofertas_diario ?? 10
      const watchlist = watchlistPorUser.get(userId) ?? []
      const ofertasUsuario: ReturnType<typeof montarOferta>[] = []

      // 5a. Watchlist: prioridade máxima — busca por título e verifica preco_alvo
      for (const w of watchlist) {
        const resultado = resultadosPorTermo.get(w.titulo_produto)
        if (!resultado) continue
        for (const p of resultado.produtos) {
          if (!p.preco_atual || !p.link_afiliado) continue
          const atingiuAlvo = !w.preco_alvo || p.preco_atual <= w.preco_alvo
          if (atingiuAlvo) {
            ofertasUsuario.push(montarOferta(userId, null, p))
          }
        }
      }

      // 5b. Interesses e nichos
      const interessesUser = (interesses as Interesse[]).filter(i => i.user_id === userId)
      for (const i of interessesUser) {
        if (!i.termo_busca) continue
        const resultado = resultadosPorTermo.get(i.termo_busca)
        if (!resultado) continue
        for (const p of resultado.produtos) {
          if (!p.preco_atual || !p.link_afiliado) continue
          if (i.desconto_minimo > 0) {
            const desc = calcDesc(p.preco_atual, p.preco_original ?? null)
            if (desc < i.desconto_minimo) continue
          }
          ofertasUsuario.push(montarOferta(userId, i.id, p))
        }
      }

      // Nichos do perfil
      for (const nicho of (perfil?.nichos_interesse ?? [])) {
        const resultado = resultadosPorTermo.get(nicho)
        if (!resultado) continue
        for (const p of resultado.produtos) {
          if (!p.preco_atual || !p.link_afiliado) continue
          ofertasUsuario.push(montarOferta(userId, null, p))
        }
      }

      // Deduplicar por external_id e limitar ao volume diário
      const vistos = new Set<string>()
      const ofertasFinal = ofertasUsuario
        .filter(o => { if (vistos.has(o.external_id)) return false; vistos.add(o.external_id); return true })
        .slice(0, volumeMax)

      if (!ofertasFinal.length) continue

      const { error: upsertErr } = await admin
        .from('ofertas_curadas')
        .upsert(ofertasFinal, { onConflict: 'user_id,external_id', ignoreDuplicates: false })

      if (upsertErr) {
        log.push(`Erro user ${userId}: ${upsertErr.message}`)
      } else {
        totalSalvas += ofertasFinal.length
        log.push(`User ${userId.substring(0, 8)}: ${ofertasFinal.length}/${volumeMax} ofertas salvas`)
      }
    }

    // 6. Limpar ofertas expiradas
    await admin.from('ofertas_curadas').delete().lt('expira_em', new Date().toISOString())

    log.push(`Total: ${totalSalvas} ofertas salvas/atualizadas`)
    return Response.json({ success: true, log, ms: Date.now() - startedAt })

  } catch (err) {
    return Response.json({ success: false, error: String(err), log }, { status: 500 })
  }
})
