import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405)

  // Autentica usuário
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  // Parâmetros opcionais
  const url             = new URL(req.url)
  const apenasNovas     = url.searchParams.get('apenas_novas') !== 'false'
  const descMinimo      = parseFloat(url.searchParams.get('desconto_minimo') ?? '0')
  const limite          = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100)
  const marcarVistas    = url.searchParams.get('marcar_visualizada') === 'true'

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Busca ofertas curadas do usuário
  let query = admin
    .from('ofertas_curadas')
    .select(`
      id, titulo, url_original, url_imagem,
      preco_atual, preco_original, percentual_desconto,
      total_vendas, link_afiliado, visualizada,
      descoberta_em, expira_em,
      usuario_interesses (categoria_id, termo_busca, desconto_minimo)
    `)
    .eq('user_id', user.id)
    .gt('expira_em', new Date().toISOString())
    .gte('percentual_desconto', descMinimo)
    .order('percentual_desconto', { ascending: false })
    .limit(limite)

  if (apenasNovas) query = query.eq('visualizada', false)

  const { data: ofertas, error: queryErr } = await query

  if (queryErr) {
    console.error('query ofertas_curadas:', queryErr.message)
    return json({ error: 'Erro ao buscar curadoria' }, 500)
  }

  // Gera short_url via redirect-engine para cada oferta
  const resultado = (ofertas ?? []).map(oferta => ({
    ...oferta,
    short_url: `${SUPABASE_URL}/functions/v1/redirect-engine/${oferta.id}`,
  }))

  // Marca como visualizadas (fire-and-forget)
  if (marcarVistas && resultado.length > 0) {
    const ids = resultado.map(o => o.id)
    // @ts-ignore
    const markPromise = admin
      .from('ofertas_curadas')
      .update({ visualizada: true })
      .in('id', ids)
      .eq('user_id', user.id)

    // @ts-ignore
    if (typeof EdgeRuntime !== 'undefined') {
      EdgeRuntime.waitUntil(markPromise)
    } else {
      await markPromise
    }
  }

  return json({
    total:   resultado.length,
    ofertas: resultado,
    filtros: {
      apenas_novas:     apenasNovas,
      desconto_minimo:  descMinimo,
      limite,
    },
  })
})
