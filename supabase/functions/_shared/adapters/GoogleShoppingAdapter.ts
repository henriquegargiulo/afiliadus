export interface ProdutoOferta {
  id: string;
  titulo: string;
  preco_atual: number | null;
  preco_original?: number | null;
  link_afiliado: string;
  imagem_url: string | null;
  marketplace_id: string;
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

      // Raio-X: captura estrutura bruta para diagnóstico
      // deno-lint-ignore no-explicit-any
      this._lastDebug = (data.shopping_results as any[]).slice(0, 3).map((i: any) => ({
        source:           i.source,
        title:            i.title?.substring(0, 30),
        extracted_price:  i.extracted_price,
        link:             i.link?.substring(0, 60),
        product_link:     i.product_link?.substring(0, 60),
      }))

      const ofertasValidas: ProdutoOferta[] = [];

      // deno-lint-ignore no-explicit-any
      for (const item of data.shopping_results as any[]) {
        // Aceita qualquer loja — comparador de preços geral
        const link = item.product_link || item.link || null;
        if (!link || !item.title || !item.extracted_price) continue;

        const lojaId = this.normalizarLoja(item.source);

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

  private normalizarLoja(sourceNome?: string): string {
    if (!sourceNome) return 'desconhecido';
    const n = sourceNome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (n.includes('mercado livre') || n.includes('mercadolivre')) return 'mercadolivre';
    if (n.includes('amazon'))         return 'amazon';
    if (n.includes('shopee'))         return 'shopee';
    if (n.includes('magazine luiza') || n.includes('magalu')) return 'magalu';
    if (n.includes('americanas'))     return 'americanas';
    if (n.includes('submarino'))      return 'submarino';
    if (n.includes('shoptime'))       return 'shoptime';
    if (n.includes('kabum'))          return 'kabum';
    if (n.includes('carrefour'))      return 'carrefour';
    if (n.includes('havan'))          return 'havan';
    return n.replace(/\s+/g, '_').substring(0, 50);
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
