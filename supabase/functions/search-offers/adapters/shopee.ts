import type { AdapterResult, SearchParams } from '../../_shared/marketplace.ts'

// TODO: Implementar quando as credenciais da Shopee Affiliate API estiverem disponíveis.
// Docs: https://open.shopee.com/documents/v2/OpenAPI2.0/affiliate
// Secrets necessários: SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY

export async function searchShopee(_params: SearchParams): Promise<AdapterResult> {
  const configured = !!Deno.env.get('SHOPEE_PARTNER_ID')

  if (!configured) {
    return { produtos: [], error: 'Shopee não configurada — adicione SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY como secrets' }
  }

  // Implementação futura
  return { produtos: [] }
}
