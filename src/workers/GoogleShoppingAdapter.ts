import { IMarketplaceProvider, ProdutoOferta } from '../core/interfaces/Marketplace'

const SERP_URL = 'https://serpapi.com/search.json'

const LOJAS_PERMITIDAS = [
  { source: 'mercado livre', domain: 'mercadolivre.com.br', id: 'mercadolivre' },
  { source: 'amazon',        domain: 'amazon.com.br',       id: 'amazon'       },
  { source: 'shopee',        domain: 'shopee.com.br',       id: 'shopee'       },
]

interface SerpItem {
  title:               string
  price?:              string
  extracted_price?:    number
  old_price?:          string
  extracted_old_price?: number
  link:                string
  source:              string
  thumbnail?:          string | null
}

interface SerpResponse {
  shopping_results?: SerpItem[]
}

function detectarLoja(item: SerpItem): string | null {
  const sourceLower = item.source.toLowerCase()
  const linkLower   = item.link.toLowerCase()
  for (const loja of LOJAS_PERMITIDAS) {
    if (sourceLower.includes(loja.source) || linkLower.includes(loja.domain)) {
      return loja.id
    }
  }
  return null
}

export class GoogleShoppingAdapter implements IMarketplaceProvider {
  async buscarOfertasPorInteresse(
    termo: string,
    descontoMinimo: number
  ): Promise<ProdutoOferta[]> {
    const query = `${termo} (site:mercadolivre.com.br OR site:amazon.com.br OR site:shopee.com.br)`

    const qs = new URLSearchParams({
      engine:  'google_shopping',
      q:       query,
      gl:      'br',
      hl:      'pt',
      num:     '20',
      api_key: process.env.SERPAPI_KEY!,
    })

    const res = await fetch(`${SERP_URL}?${qs}`)
    if (!res.ok) throw new Error(`SerpAPI error ${res.status}: ${termo}`)

    const data = await res.json() as SerpResponse
    const items = data.shopping_results ?? []

    return items
      .filter(item => detectarLoja(item) !== null)
      .filter(item => {
        if (!item.extracted_price) return false
        if (!item.extracted_old_price || item.extracted_old_price <= item.extracted_price) {
          return descontoMinimo === 0
        }
        const desconto = ((item.extracted_old_price - item.extracted_price) / item.extracted_old_price) * 100
        return desconto >= descontoMinimo
      })
      .map(item => {
        const precoAtual    = item.extracted_price!
        const precoOriginal = item.extracted_old_price ?? precoAtual
        const desconto      = precoOriginal > precoAtual
          ? ((precoOriginal - precoAtual) / precoOriginal) * 100
          : 0

        return {
          id:                  Buffer.from(item.link).toString('base64').slice(0, 200),
          titulo:              item.title,
          preco_atual:         precoAtual,
          preco_original:      precoOriginal,
          percentual_desconto: Math.round(desconto * 100) / 100,
          link_afiliado:       item.link,
          imagem_url:          item.thumbnail ?? null,
          marketplace_id:      detectarLoja(item)!,
        }
      })
  }
}
