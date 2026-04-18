import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Clientes Supabase inicializados uma vez (fora do handler = warm reuse)
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// service_role contorna RLS → necessário para inserir em cliques_analytics
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

Deno.serve(async (req: Request) => {
  // Aceita apenas GET
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // Extrai short_code do path: /functions/v1/redirect-engine/<short_code>
  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const shortCode = segments[segments.length - 1]

  if (!shortCode || shortCode === 'redirect-engine') {
    return new Response('Missing short_code', { status: 400 })
  }

  // Busca URL original — SELECT mínimo para latência baixa
  const { data: link, error } = await supabase
    .from('links_afiliados')
    .select('id, url_original')
    .eq('short_code', shortCode)
    .eq('ativo', true)
    .maybeSingle()

  if (error) {
    console.error('DB error:', error.message)
    return new Response('Internal Server Error', { status: 500 })
  }

  if (!link) {
    return new Response('Link not found', { status: 404 })
  }

  // Registra o clique de forma assíncrona via waitUntil
  // (garante execução mesmo após a Response ser enviada ao cliente)
  const logClick = supabase.from('cliques_analytics').insert({
    link_id: link.id,
    metadata: {
      ip: req.headers.get('x-forwarded-for') ??
          req.headers.get('cf-connecting-ip') ??
          req.headers.get('x-real-ip'),
      user_agent: req.headers.get('user-agent'),
      referer: req.headers.get('referer'),
    },
  })

  // @ts-ignore: EdgeRuntime disponível no ambiente Supabase/Deno Deploy
  if (typeof EdgeRuntime !== 'undefined') {
    // deno-lint-ignore no-undef
    EdgeRuntime.waitUntil(logClick)
  } else {
    // Fallback local/CI: awaita normalmente
    await logClick
  }

  return new Response(null, {
    status: 302,
    headers: {
      'Location': link.url_original,
      // Impede que proxies/browsers façam cache do redirect
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    },
  })
})
