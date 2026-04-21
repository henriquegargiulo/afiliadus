export interface PerfilAfiliado {
  amazon_tag?:      string | null
  shopee_id?:       string | null
  mercadolivre_id?: string | null
}

/**
 * Reconstrói a URL com parâmetros de rastreio do afiliado.
 * Retorna url_original intacta se o usuário não tiver o ID da loja cadastrado
 * ou se a URL for inválida.
 */
export function construirLinkAfiliado(
  url_original:   string,
  marketplace_id: string,
  perfil:         PerfilAfiliado,
): string {
  if (!url_original) return url_original

  try {
    const url = new URL(url_original)

    switch (marketplace_id) {
      case 'amazon': {
        if (!perfil.amazon_tag) break
        // Amazon Associates: parâmetro ?tag=
        url.searchParams.set('tag', perfil.amazon_tag)
        return url.toString()
      }

      case 'shopee': {
        if (!perfil.shopee_id) break
        // Shopee AF: af_siteid identifica o afiliado no rastreio universal
        url.searchParams.set('af_siteid', perfil.shopee_id)
        url.searchParams.set('af_force_deeplink', 'true')
        return url.toString()
      }

      case 'mercadolivre': {
        // A API de afiliados do ML exige fluxo OAuth complexo (redirect + token por usuário).
        // Para o MVP, retornamos a URL original sem modificação.
        // Estrutura pronta para quando o fluxo OAuth for implementado:
        //   if (perfil.mercadolivre_id) { ... }
        break
      }
    }
  } catch {
    // URL malformada — retorna original sem modificar
  }

  return url_original
}
