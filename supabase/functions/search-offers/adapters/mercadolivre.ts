import type { AdapterResult, NormalizedProduct, SearchParams } from '../../_shared/marketplace.ts'

const ML_API = 'https://api.mercadolibre.com'
const SITE   = 'MLB' // Brasil

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'afiliadus/1.0' }
    })
    if (res.status === 429) {
      // Rate limit: aguarda backoff exponencial antes de tentar novamente
      await new Promise(r => setTimeout(r, 1000 * 2 ** i))
      continue
    }
    return res
  }
  throw new Error('ML API rate limit excedido após retries')
}

export async function searchMercadoLivre(params: SearchParams): Promise<AdapterResult> {
  try {
    const url = `${ML_API}/sites/${SITE}/search?q=${encodeURIComponent(params.q)}&limit=${params.limit}&sort=relevance`
    const res = await fetchWithRetry(url)

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
