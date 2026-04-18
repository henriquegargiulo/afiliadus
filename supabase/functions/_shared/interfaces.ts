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

// Para adicionar uma nova loja, inclua uma entrada aqui.
export const LOJAS: Array<{ keywords: string[]; domain: string; id: MarketplaceId }> = [
  { keywords: ['mercado livre', 'mercadolivre', 'mercado-livre'], domain: 'mercadolivre.com.br', id: 'mercadolivre' },
  { keywords: ['amazon'],                                          domain: 'amazon.com.br',       id: 'amazon'       },
  { keywords: ['shopee'],                                          domain: 'shopee.com.br',       id: 'shopee'       },
]

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function detectarLoja(source: string, link: string): MarketplaceId | null {
  const s = normalizar(source)
  const l = normalizar(link)
  for (const loja of LOJAS) {
    if (loja.keywords.some(k => s.includes(k) || l.includes(k))) return loja.id
    if (l.includes(loja.domain)) return loja.id
  }
  return null
}
