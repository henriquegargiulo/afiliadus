import 'dotenv/config'
import cron from 'node-cron'
import { createClient } from '@supabase/supabase-js'
import { GoogleShoppingAdapter } from './GoogleShoppingAdapter'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const adapter = new GoogleShoppingAdapter()

interface Interesse {
  id: string
  user_id: string
  categoria_id: string | null
  termo_busca: string | null
  desconto_minimo: number
}

async function executarColeta() {
  console.log(`[${new Date().toISOString()}] Iniciando coleta...`)

  const { data: interesses, error } = await supabase
    .from('usuario_interesses')
    .select('id, user_id, categoria_id, termo_busca, desconto_minimo')
    .eq('ativo', true)

  if (error) {
    console.error('Erro ao buscar interesses:', error.message)
    return
  }

  if (!interesses?.length) {
    console.log('Nenhum interesse ativo encontrado.')
    return
  }

  console.log(`${interesses.length} interesse(s) encontrado(s).`)

  const grupos = new Map<string, Interesse[]>()
  for (const i of interesses as Interesse[]) {
    const chave = i.termo_busca ?? i.categoria_id ?? ''
    if (!grupos.has(chave)) grupos.set(chave, [])
    grupos.get(chave)!.push(i)
  }

  let totalSalvas = 0

  for (const [chave, grupo] of grupos) {
    if (!chave) continue

    try {
      console.log(`  Buscando: "${chave}"`)
      const produtos = await adapter.buscarOfertasPorInteresse(chave, 0)

      for (const interesse of grupo) {
        const filtrados = produtos.filter(
          p => p.percentual_desconto >= interesse.desconto_minimo
        )

        if (!filtrados.length) continue

        const registros = filtrados.map(p => ({
          user_id:             interesse.user_id,
          interesse_id:        interesse.id,
          marketplace_id:      p.marketplace_id,
          external_id:         p.id,
          titulo:              p.titulo,
          url_original:        p.link_afiliado,
          url_imagem:          p.imagem_url,
          preco_atual:         p.preco_atual,
          preco_original:      p.preco_original,
          percentual_desconto: p.percentual_desconto,
          link_afiliado:       p.link_afiliado,
          expira_em:           new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }))

        const { error: upsertErr } = await supabase
          .from('ofertas_curadas')
          .upsert(registros, { onConflict: 'user_id,external_id', ignoreDuplicates: false })

        if (upsertErr) {
          console.error(`  Erro ao salvar para user ${interesse.user_id}:`, upsertErr.message)
        } else {
          totalSalvas += registros.length
        }
      }

      await new Promise(r => setTimeout(r, 500))
    } catch (err) {
      console.error(`  Erro na busca "${chave}":`, err)
    }
  }

  await supabase
    .from('ofertas_curadas')
    .delete()
    .lt('expira_em', new Date().toISOString())

  console.log(`Coleta concluída. ${totalSalvas} oferta(s) salva(s)/atualizada(s).`)
}

executarColeta()

cron.schedule('0 * * * *', executarColeta)

console.log('Worker rodando. Próxima coleta em 1 hora.')
