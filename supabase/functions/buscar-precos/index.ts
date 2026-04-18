import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SERP_KEY    = Deno.env.get('SERPAPI_KEY')!
const SERP_URL    = 'https://serpapi.com/search.json'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')!

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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
  const query  = url.searchParams.get('q')
  const limite = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 50)

  if (!query) return json({ error: 'Parâmetro "q" obrigatório' }, 400)

  const qs = new URLSearchParams({
    engine:  'google_shopping',
    q:       query,
    gl:      'br',
    hl:      'pt',
    num:     String(limite),
    api_key: SERP_KEY,
  })

  const res = await fetch(`${SERP_URL}?${qs}`)
  if (!res.ok) return json({ error: `SerpAPI error: ${res.status}` }, 502)

  const data = await res.json() as {
    shopping_results?: {
      title: string
      price: string
      extracted_price: number
      link: string
      source: string
      thumbnail: string | null
      rating?: number
      reviews?: number
    }[]
  }

  const resultados = (data.shopping_results ?? []).map(item => ({
    titulo:   item.title,
    preco:    item.extracted_price,
    preco_formatado: item.price,
    loja:     item.source,
    link:     item.link,
    imagem:   item.thumbnail ?? null,
    avaliacao: item.rating ?? null,
    avaliacoes: item.reviews ?? null,
  }))

  resultados.sort((a, b) => a.preco - b.preco)

  return json({
    query,
    total: resultados.length,
    resultados,
  })
})
