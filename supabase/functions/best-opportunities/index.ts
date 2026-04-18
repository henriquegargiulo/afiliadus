import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!

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

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: { user }, error: authErr } = await client.auth.getUser()
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  // Parâmetros opcionais
  const url            = new URL(req.url)
  const marketplace_id = url.searchParams.get('marketplace') ?? null
  const limite         = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 50)
  const min_score      = parseFloat(url.searchParams.get('min_score') ?? '0')

  // Chama a SQL function calcular_oportunidades
  const { data, error } = await client.rpc('calcular_oportunidades', {
    p_marketplace_id: marketplace_id,
    p_limite:         limite,
    p_min_score:      min_score,
  })

  if (error) {
    console.error('calcular_oportunidades:', error.message)
    return json({ error: 'Erro ao calcular oportunidades' }, 500)
  }

  return json({
    total:        (data ?? []).length,
    oportunidades: data ?? [],
    filtros: {
      marketplace: marketplace_id ?? 'todos',
      limite,
      min_score,
    },
  })
})
