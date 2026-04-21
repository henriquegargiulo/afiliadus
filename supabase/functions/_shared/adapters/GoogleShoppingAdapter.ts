export interface ProdutoOferta {
  id: string;
  titulo: string;
  preco_atual: number | null;
  preco_original?: number | null;
  link_afiliado: string;
  imagem_url: string | null;
  marketplace_id: string;
}

// Único ponto de verdade sobre lojas permitidas
const LOJAS_PERMITIDAS: Record<string, string> = {
  'mercado livre': 'mercadolivre',
  'mercadolivre':  'mercadolivre',
  'amazon':        'amazon',
  'shopee':        'shopee',
}

export class GoogleShoppingAdapter {
  private apiKey: string;
  private _lastDebug: unknown = null;

  constructor() {
    this.apiKey = Deno.env.get('SERPAPI_KEY') || '';
  }

  async buscarOfertasComDebug(termo: string): Promise<{ produtos: ProdutoOferta[]; debug: unknown }> {
    const produtos = await this.buscarOfertas(termo)
    return { produtos, debug: this._lastDebug }
  }

  async buscarOfertas(termo: string): Promise<ProdutoOferta[]> {
    if (!this.apiKey) {
      console.error('[SerpApi] SERPAPI_KEY não configurada.');
      return [];
    }

    const params = new URLSearchParams({
      engine:  'google_shopping',
      q:       termo,
      gl:      'br',
      hl:      'pt',
      api_key: this.apiKey,
    });

    try {
      const res  = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
      const data = await res.json().catch(() => ({}));

      if (data.error) {
        console.error('[SerpApi Error]', data.error);
        return [];
      }

      if (!data.shopping_results) {
        console.error('[SerpApi] Sem shopping_results. Chaves:', Object.keys(data));
        return [];
      }

      // deno-lint-ignore no-explicit-any
      this._lastDebug = (data.shopping_results as any[]).slice(0, 3).map((i: any) => ({
        source:          i.source,
        title:           i.title?.substring(0, 30),
        extracted_price: i.extracted_price,
        loja_aceita:     this.normalizarLoja(i.source) !== null,
      }))

      const ofertasValidas: ProdutoOferta[] = [];

      // deno-lint-ignore no-explicit-any
      for (const item of data.shopping_results as any[]) {
        const lojaId = this.normalizarLoja(item.source);
        if (!lojaId) continue; // descarta lojas fora de ML, Amazon e Shopee

        const link = item.link || item.product_link || null;
        if (!link || !item.title || !item.extracted_price) continue;

        ofertasValidas.push({
          id:             item.product_id || crypto.randomUUID(),
          titulo:         item.title,
          preco_atual:    item.extracted_price,
          preco_original: item.extracted_old_price ?? null,
          link_afiliado:  link,
          imagem_url:     item.thumbnail ?? null,
          marketplace_id: lojaId,
        });
      }

      return ofertasValidas;

    } catch (error) {
      console.error('[GoogleShoppingAdapter] Erro:', error);
      return [];
    }
  }

  // Retorna null para lojas não permitidas — produtos serão descartados pelo chamador
  private normalizarLoja(sourceNome?: string): string | null {
    if (!sourceNome) return null;
    const n = sourceNome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const [chave, id] of Object.entries(LOJAS_PERMITIDAS)) {
      if (n.includes(chave)) return id;
    }
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
