import type { AdapterResult, SearchParams } from '../../_shared/marketplace.ts'

// TODO: Implementar quando as credenciais da Amazon Product Advertising API estiverem disponíveis.
// Docs: https://webservices.amazon.com/paapi5/documentation/
// Secrets necessários: AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY, AMAZON_PARTNER_TAG

export async function searchAmazon(_params: SearchParams): Promise<AdapterResult> {
  const configured = !!Deno.env.get('AMAZON_ACCESS_KEY')

  if (!configured) {
    return { produtos: [], error: 'Amazon não configurada — adicione AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY e AMAZON_PARTNER_TAG como secrets' }
  }

  // Implementação futura
  return { produtos: [] }
}
