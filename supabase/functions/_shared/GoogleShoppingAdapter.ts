import { IMarketplaceProvider, ProdutoOferta, detectarLoja } from './interfaces.ts'

const SERP_URL = 'https://serpapi.com/search.json'

interface SerpItem {
  title:                string
  extracted_price?:     number
  extracted_old_price?: number
  link:                 string
  source:               string
  thumbnail?:           string | null
}

interface SerpResponse {
  shopping_results?: SerpItem[]
}

export class GoogleShoppingAdapter implements IMarketplaceProvider {
  private readonly apiKey: string
  public lastRawDebug: Record<string, unknown> = {}

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async buscarOfertasPorInteresse(
    termo: string,
    descontoMinimo: number
  ): Promise<ProdutoOferta[]> {
    const qs = new URLSearchParams({
      engine:  'google_shopping',
      q:       termo,
      gl:      'br',
      hl:      'pt',
      num:     '20',
      api_key: this.apiKey,
    })

    const res = await fetch(`${SERP_URL}?${qs}`)
    if (!res.ok) throw new Error(`SerpAPI ${res.status}: ${termo}`)

    const raw  = await res.json().catch(() => null)
    const data = (raw && typeof raw === 'object' ? raw : {}) as SerpResponse & { error?: string }

    this.lastRawDebug = {
      total_bruto:       (data.shopping_results ?? []).length,
      lojas_encontradas: (data.shopping_results ?? []).map((i: SerpItem) => i.source),
      serp_error:        data.error ?? null,
    }

    if (data.error) throw new Error(`SerpAPI retornou erro: ${data.error}`)

    const items = data.shopping_results ?? []
    const comLoja = items.filter(item => detectarLoja(item.source, item.link) !== null)

    return comLoja
      .filter(item => {
        if (!item.extracted_price) return false

        // Sem preço original: passa se descontoMinimo for 0
        if (!item.extracted_old_price || item.extracted_old_price <= item.extracted_price) {
          return descontoMinimo === 0
        }

        const desc = ((item.extracted_old_price - item.extracted_price) / item.extracted_old_price) * 100
        return desc >= descontoMinimo
      })
      .map(item => {
        const precoAtual    = item.extracted_price!
        const precoOriginal = item.extracted_old_price ?? precoAtual
        const desconto      = precoOriginal > precoAtual
          ? ((precoOriginal - precoAtual) / precoOriginal) * 100
          : 0

        return {
          id:                  btoa(item.link).slice(0, 200),
          titulo:              item.title,
          preco_atual:         precoAtual,
          preco_original:      precoOriginal,
          percentual_desconto: Math.round(desconto * 100) / 100,
          link_afiliado:       item.link,
          imagem_url:          item.thumbnail ?? null,
          marketplace_id:      detectarLoja(item.source, item.link)!,
        }
      })
  }
}
