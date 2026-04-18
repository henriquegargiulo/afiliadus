import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Cliente admin — bypassa RLS para INSERT com user_id explícito
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

function generateShortCode(length = 7): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes).map(b => chars[b % chars.length]).join('')
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405)

  // Autentica usuário pelo JWT do header Authorization
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return json({ error: 'Unauthorized' }, 401)

  // Valida body
  let body: { url_original: string; marketplace_id: string; titulo?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const { url_original, marketplace_id, titulo } = body

  if (!url_original || !marketplace_id) {
    return json({ error: 'url_original e marketplace_id são obrigatórios' }, 400)
  }

  try {
    new URL(url_original)
  } catch {
    return json({ error: 'url_original inválida' }, 400)
  }

  // Gera short_code único com até 5 tentativas
  let short_code = ''
  for (let i = 0; i < 5; i++) {
    const candidate = generateShortCode(7)
    const { data } = await admin
      .from('links_afiliados')
      .select('id')
      .eq('short_code', candidate)
      .maybeSingle()
    if (!data) { short_code = candidate; break }
  }

  if (!short_code) return json({ error: 'Falha ao gerar short code único' }, 500)

  // Insere o link
  const { data: link, error: insertError } = await admin
    .from('links_afiliados')
    .insert({ user_id: user.id, url_original, short_code, marketplace_id, titulo: titulo ?? null })
    .select()
    .single()

  if (insertError) {
    console.error('insert error:', insertError.message)
    return json({ error: 'Falha ao salvar link' }, 500)
  }

  return json({
    ...link,
    short_url: `${SUPABASE_URL}/functions/v1/redirect-engine/${short_code}`,
  }, 201)
})
