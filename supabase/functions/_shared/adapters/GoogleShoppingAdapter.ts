export interface ProdutoOferta {
  id: string;
  titulo: string;
  preco_atual: number | null;
  preco_original?: number | null;
  link_afiliado: string;
  imagem_url: string;
  marketplace_id: string;
}

export class GoogleShoppingAdapter {
  private apiKey: string;

  constructor() {
    this.apiKey = Deno.env.get('SERPAPI_KEY') || '';
  }

  async buscarOfertasComDebug(termo: string): Promise<{ produtos: ProdutoOferta[]; debug: unknown }> {
    const produtos = await this.buscarOfertas(termo)
    return { produtos, debug: this._lastDebug }
  }

  private _lastDebug: unknown = null

  async buscarOfertas(termo: string): Promise<ProdutoOferta[]> {
    if (!this.apiKey) {
      console.error('[SerpApi] SERPAPI_KEY não configurada no ambiente.');
      return [];
    }

    const params = new URLSearchParams({
      engine:  'google_shopping',
      q:       termo,
      gl:      'br',
      hl:      'pt',
      api_key: this.apiKey,
    });

    const url = `https://serpapi.com/search.json?${params.toString()}`;

    try {
      const res  = await fetch(url);
      const data = await res.json().catch(() => ({}));

      if (data.error) {
        console.error('[SerpApi Error]', data.error);
        return [];
      }

      if (!data.shopping_results) {
        console.error('[SerpApi Alerta] Sem shopping_results. Chaves devolvidas:', Object.keys(data));
        console.log('[SerpApi Dump]', JSON.stringify(data).substring(0, 400));
        return [];
      }

      // Raio-X: captura estrutura bruta para diagnóstico
      // deno-lint-ignore no-explicit-any
      this._lastDebug = (data.shopping_results ?? []).slice(0, 5).map((i: any) => ({
        source:          i.source,
        title:           i.title?.substring(0, 30),
        extracted_price: i.extracted_price,
        price:           i.price,
        has_link:        !!i.link,
        link_sample:     i.link?.substring(0, 50),
      }))

      const ofertasValidas: ProdutoOferta[] = [];

      for (const item of data.shopping_results) {
        const lojaDetectada = this.detectarLoja(item.source);
        if (lojaDetectada) {
          ofertasValidas.push({
            id:             item.product_id || crypto.randomUUID(),
            titulo:         item.title,
            preco_atual:    item.extracted_price ?? this.extrairPreco(item.price),
            preco_original: item.extracted_old_price ?? this.extrairPreco(item.old_price),
            link_afiliado:  item.link,
            imagem_url:     item.thumbnail,
            marketplace_id: lojaDetectada,
          });
        }
      }

      return ofertasValidas;

    } catch (error) {
      console.error('[GoogleShoppingAdapter] Falha na requisição:', error);
      return [];
    }
  }

  private detectarLoja(sourceNome?: string): string | null {
    if (!sourceNome) return null;
    const n = sourceNome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (n.includes('mercado livre') || n.includes('mercadolivre')) return 'mercadolivre';
    if (n.includes('amazon'))  return 'amazon';
    if (n.includes('shopee'))  return 'shopee';
    return null;
  }

  // deno-lint-ignore no-explicit-any
  private extrairPreco(precoStr: any): number | null {
    if (!precoStr) return null;
    if (typeof precoStr === 'number') return precoStr;
    const limpo = precoStr.toString().replace(/[^\d,]/g, '').replace(',', '.');
    const valor = parseFloat(limpo);
    return isNaN(valor) ? null : valor;
  }
}
