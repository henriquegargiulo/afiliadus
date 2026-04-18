export interface NormalizedProduct {
  external_id:          string
  marketplace_id:       'mercadolivre' | 'shopee' | 'amazon'
  titulo:               string
  url_produto:          string
  url_imagem:           string | null
  categoria:            string | null
  vendedor:             string | null
  preco_atual:          number
  preco_original:       number | null
  percentual_desconto:  number | null
  total_vendas:         number | null
  avaliacao:            number | null
}

export interface SearchParams {
  q:     string
  limit: number
}

export interface AdapterResult {
  produtos:  NormalizedProduct[]
  error?:    string
}
