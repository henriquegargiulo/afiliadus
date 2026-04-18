export type MarketplaceId = 'mercadolivre' | 'amazon' | 'shopee'

export interface ProdutoOferta {
  id:                  string
  titulo:              string
  preco_atual:         number
  preco_original:      number
  percentual_desconto: number
  link_afiliado:       string
  imagem_url:          string | null
  marketplace_id:      MarketplaceId
}

export interface IMarketplaceProvider {
  buscarOfertasPorInteresse(
    termo: string,
    descontoMinimo: number
  ): Promise<ProdutoOferta[]>
}

// Para adicionar uma nova loja no futuro, basta incluir uma entrada aqui.
export const LOJAS: Array<{ source: string; domain: string; id: MarketplaceId }> = [
  { source: 'mercado livre', domain: 'mercadolivre.com.br', id: 'mercadolivre' },
  { source: 'amazon',        domain: 'amazon.com.br',       id: 'amazon'       },
  { source: 'shopee',        domain: 'shopee.com.br',       id: 'shopee'       },
]

export function detectarLoja(source: string, link: string): MarketplaceId | null {
  const s = source.toLowerCase()
  const l = link.toLowerCase()
  for (const loja of LOJAS) {
    if (s.includes(loja.source) || l.includes(loja.domain)) return loja.id
  }
  return null
}
