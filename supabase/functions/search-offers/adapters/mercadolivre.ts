import type { AdapterResult, NormalizedProduct, SearchParams } from '../../_shared/marketplace.ts'

const ML_API = 'https://api.mercadolibre.com'
const SITE   = 'MLB'

// Cache simples de token em memória (válido por 6h, ML expira em 21600s)
let cachedToken: { value: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value
  }

  const clientId     = Deno.env.get('ML_CLIENT_ID')
  const clientSecret = Deno.env.get('ML_CLIENT_SECRET')

  if (!clientId || !clientSecret) {
    throw new Error('ML_CLIENT_ID ou ML_CLIENT_SECRET não configurados nos secrets')
  }

  const res = await fetch(`${ML_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  })

  if (!res.ok) {
    throw new Error(`ML OAuth falhou: ${res.status}`)
  }

  const data = await res.json()
  cachedToken = {
    value:     data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // 60s de margem
  }

  return cachedToken.value
}

async function fetchWithRetry(url: string, token: string, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/json',
      },
    })
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 1000 * 2 ** i))
      continue
    }
    return res
  }
  throw new Error('ML API rate limit excedido após retries')
}

export async function searchMercadoLivre(params: SearchParams): Promise<AdapterResult> {
  try {
    const token = await getAccessToken()
    const url   = `${ML_API}/sites/${SITE}/search?q=${encodeURIComponent(params.q)}&limit=${params.limit}&sort=relevance`
    const res   = await fetchWithRetry(url, token)

    if (!res.ok) {
      return { produtos: [], error: `ML API erro: ${res.status}` }
    }

    const data = await res.json()

    const produtos: NormalizedProduct[] = (data.results ?? []).map((item: any) => {
      const precoOriginal = item.original_price ?? null
      const precoAtual    = item.price ?? 0
      const desconto      = precoOriginal && precoOriginal > precoAtual
        ? Math.round(((precoOriginal - precoAtual) / precoOriginal) * 100 * 100) / 100
        : null

      return {
        external_id:         String(item.id),
        marketplace_id:      'mercadolivre' as const,
        titulo:              item.title ?? '',
        url_produto:         item.permalink ?? '',
        url_imagem:          item.thumbnail?.replace(/\-I\.jpg$/, '-O.jpg') ?? null,
        categoria:           item.category_id ?? null,
        vendedor:            item.seller?.nickname ?? null,
        preco_atual:         precoAtual,
        preco_original:      precoOriginal,
        percentual_desconto: desconto,
        total_vendas:        item.sold_quantity ?? null,
        avaliacao:           item.reviews?.rating_average ?? null,
      }
    })

    return { produtos }
  } catch (err) {
    return { produtos: [], error: String(err) }
  }
}
