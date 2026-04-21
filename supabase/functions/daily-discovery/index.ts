// v4 — cacheBuscas explícito + deduplicação garantida por termo
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleShoppingAdapter, type ProdutoOferta } from '../_shared/adapters/GoogleShoppingAdapter.ts'

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
  user_id: string; titulo_produto: string; preco_alvo: number | null
}

function calcDesc(atual: number, original: number | null) {
  if (!original || original <= atual) return 0
  return Math.round(((original - atual) / original) * 10000) / 100
}

function montarOferta(userId: string, interesseId: string | null, p: ProdutoOferta) {
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
    // ── 1. Carregar dados base ───────────────────────────────────────────────
    const { data: interesses, error: intErr } = await admin
      .from('usuario_interesses')
      .select('id, user_id, termo_busca, desconto_minimo')
      .eq('ativo', true)
    if (intErr) throw intErr
    if (!interesses?.length) {
      return Response.json({ message: 'Nenhum interesse ativo', ms: Date.now() - startedAt })
    }

    const userIds = [...new Set((interesses as Interesse[]).map(i => i.user_id))]

    const [{ data: perfisRaw }, { data: watchlistRaw }] = await Promise.all([
      admin.from('perfis_afiliados')
           .select('user_id, nichos_interesse, volume_ofertas_diario')
           .in('user_id', userIds),
      admin.from('produto_watchlist')
           .select('user_id, titulo_produto, preco_alvo')
           .in('user_id', userIds),
    ])

    const perfis = new Map<string, Perfil>(
      (perfisRaw ?? []).map((p: Perfil) => [p.user_id, p])
    )
    const watchlistPorUser = new Map<string, WatchlistItem[]>()
    for (const w of (watchlistRaw ?? []) as WatchlistItem[]) {
      if (!watchlistPorUser.has(w.user_id)) watchlistPorUser.set(w.user_id, [])
      watchlistPorUser.get(w.user_id)!.push(w)
    }

    // ── 2. Coletar todos os termos únicos de todos os usuários ───────────────
    // termosParaUsuarios mapeia: termo → { users que o querem, interesse_id por user }
    const termosParaUsuarios = new Map<string, {
      userIds: string[]
      interesseIdPorUser: Map<string, string | null>
    }>()

    function registrarTermo(termo: string, userId: string, interesseId: string | null) {
      const chave = termo.trim().toLowerCase()
      if (!chave) return
      if (!termosParaUsuarios.has(chave)) {
        termosParaUsuarios.set(chave, { userIds: [], interesseIdPorUser: new Map() })
      }
      const entry = termosParaUsuarios.get(chave)!
      if (!entry.userIds.includes(userId)) entry.userIds.push(userId)
      if (!entry.interesseIdPorUser.has(userId)) entry.interesseIdPorUser.set(userId, interesseId)
    }

    for (const i of interesses as Interesse[]) {
      if (i.termo_busca) registrarTermo(i.termo_busca, i.user_id, i.id)
    }
    for (const [userId, perfil] of perfis) {
      for (const nicho of perfil.nichos_interesse) registrarTermo(nicho, userId, null)
    }
    for (const [userId, items] of watchlistPorUser) {
      for (const w of items) registrarTermo(w.titulo_produto, userId, null)
    }

    log.push(`${userIds.length} usuário(s) | ${termosParaUsuarios.size} termos únicos`)

    // ── 3. Cache de buscas — SerpAPI chamada UMA vez por termo ──────────────
    // Se N usuários rastrearem o mesmo produto, a API é chamada apenas 1 vez.
    const cacheBuscas = new Map<string, ProdutoOferta[]>()

    for (const termo of termosParaUsuarios.keys()) {
      if (cacheBuscas.has(termo)) continue // já buscado nesta execução

      const { produtos, debug } = await adapter.buscarOfertasComDebug(termo)
      cacheBuscas.set(termo, produtos)
      log.push(`[cache] "${termo}": ${produtos.length} produto(s)`)
      if (debug) log.push(`[raio-x] ${JSON.stringify(debug)}`)
      await new Promise(r => setTimeout(r, 300)) // respeita rate limit SerpAPI
    }

    // ── 4. Distribuir resultados por usuário ─────────────────────────────────
    let totalSalvas = 0

    for (const userId of userIds) {
      const perfil    = perfis.get(userId)
      const volumeMax = perfil?.volume_ofertas_diario ?? 10
      const watchlist = watchlistPorUser.get(userId) ?? []
      const coletadas: ReturnType<typeof montarOferta>[] = []

      // Prioridade 1 — watchlist com preco_alvo
      for (const w of watchlist) {
        const chave    = w.titulo_produto.trim().toLowerCase()
        const produtos = cacheBuscas.get(chave) ?? []
        for (const p of produtos) {
          if (!p.preco_atual || !p.link_afiliado) continue
          if (!w.preco_alvo || p.preco_atual <= w.preco_alvo) {
            coletadas.push(montarOferta(userId, null, p))
          }
        }
      }

      // Prioridade 2 — interesses explícitos
      for (const i of (interesses as Interesse[]).filter(x => x.user_id === userId)) {
        if (!i.termo_busca) continue
        const chave    = i.termo_busca.trim().toLowerCase()
        const produtos = cacheBuscas.get(chave) ?? []
        for (const p of produtos) {
          if (!p.preco_atual || !p.link_afiliado) continue
          if (i.desconto_minimo > 0 && calcDesc(p.preco_atual, p.preco_original ?? null) < i.desconto_minimo) continue
          coletadas.push(montarOferta(userId, i.id, p))
        }
      }

      // Prioridade 3 — nichos do perfil
      for (const nicho of (perfil?.nichos_interesse ?? [])) {
        const chave    = nicho.trim().toLowerCase()
        const produtos = cacheBuscas.get(chave) ?? []
        for (const p of produtos) {
          if (!p.preco_atual || !p.link_afiliado) continue
          coletadas.push(montarOferta(userId, null, p))
        }
      }

      // Deduplicar por external_id e limitar ao volume diário do perfil
      const vistos = new Set<string>()
      const ofertasFinal = coletadas
        .filter(o => { if (vistos.has(o.external_id)) return false; vistos.add(o.external_id); return true })
        .slice(0, volumeMax)

      if (!ofertasFinal.length) continue

      const { error: upsertErr } = await admin
        .from('ofertas_curadas')
        .upsert(ofertasFinal, { onConflict: 'user_id,external_id', ignoreDuplicates: false })

      if (upsertErr) {
        log.push(`Erro user ${userId.substring(0, 8)}: ${upsertErr.message}`)
      } else {
        totalSalvas += ofertasFinal.length
        log.push(`User ${userId.substring(0, 8)}: ${ofertasFinal.length}/${volumeMax} ofertas`)
      }
    }

    // ── 5. Limpeza de ofertas expiradas ──────────────────────────────────────
    await admin.from('ofertas_curadas').delete().lt('expira_em', new Date().toISOString())

    log.push(`Total: ${totalSalvas} ofertas salvas/atualizadas`)
    return Response.json({
      success: true,
      cache_stats: { termos_unicos: termosParaUsuarios.size, chamadas_api: cacheBuscas.size },
      log,
      ms: Date.now() - startedAt,
    })

  } catch (err) {
    return Response.json({ success: false, error: String(err), log }, { status: 500 })
  }
})
