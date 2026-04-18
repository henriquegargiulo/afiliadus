-- ================================================================
-- Migration: 20260418000002 — Catálogo de produtos + histórico de preços
-- ================================================================

-- ----------------------------------------------------------------
-- PRODUTOS — catálogo normalizado (todos os marketplaces)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.produtos (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_id      varchar(50)  NOT NULL,
  external_id         varchar(200) NOT NULL,
  titulo              text         NOT NULL,
  url_produto         text         NOT NULL,
  url_imagem          text,
  categoria           text,
  vendedor            text,
  avaliacao           decimal(3,2),
  total_vendas        int          NOT NULL DEFAULT 0,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (marketplace_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_produtos_marketplace ON public.produtos (marketplace_id);
CREATE INDEX IF NOT EXISTS idx_produtos_categoria   ON public.produtos (categoria);

ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;

-- Produtos são lidos por qualquer usuário autenticado
CREATE POLICY "produtos: leitura autenticada"
  ON public.produtos FOR SELECT
  TO authenticated
  USING (true);

-- Escrita apenas via service_role (Edge Functions)
CREATE POLICY "produtos: escrita service_role"
  ON public.produtos FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ----------------------------------------------------------------
-- HISTÓRICO DE PREÇOS — snapshot a cada busca
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.historico_precos (
  id                  bigserial     PRIMARY KEY,
  produto_id          uuid          NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  preco_atual         decimal(12,2) NOT NULL,
  preco_original      decimal(12,2),
  percentual_desconto decimal(5,2),
  disponivel          boolean       NOT NULL DEFAULT true,
  coletado_em         timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hist_produto_id  ON public.historico_precos (produto_id);
CREATE INDEX IF NOT EXISTS idx_hist_coletado_em ON public.historico_precos (coletado_em DESC);
-- Índice composto para queries de tendência
CREATE INDEX IF NOT EXISTS idx_hist_produto_tempo ON public.historico_precos (produto_id, coletado_em DESC);

ALTER TABLE public.historico_precos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "historico: leitura autenticada"
  ON public.historico_precos FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "historico: escrita service_role"
  ON public.historico_precos FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ----------------------------------------------------------------
-- BUSCAS MONITORADAS — termos coletados automaticamente pelo scheduler
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.buscas_monitoradas (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  termo          text        NOT NULL,
  marketplace_id varchar(50) NOT NULL DEFAULT 'all',
  ativa          boolean     NOT NULL DEFAULT true,
  intervalo_min  int         NOT NULL DEFAULT 60, -- frequência de coleta em minutos
  ultima_coleta  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.buscas_monitoradas (termo, marketplace_id) VALUES
  ('smartphone', 'mercadolivre'),
  ('notebook', 'mercadolivre'),
  ('fone de ouvido', 'mercadolivre'),
  ('tênis', 'mercadolivre'),
  ('perfume', 'mercadolivre')
ON CONFLICT DO NOTHING;

ALTER TABLE public.buscas_monitoradas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "buscas: leitura autenticada"
  ON public.buscas_monitoradas FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "buscas: escrita service_role"
  ON public.buscas_monitoradas FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ----------------------------------------------------------------
-- FUNÇÃO SQL — Calcula score de oportunidade
-- score = (desconto% × 0.4) + (desvio da média histórica × 0.4) + (vendas normalizadas × 0.2)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calcular_oportunidades(
  p_marketplace_id text    DEFAULT NULL,
  p_limite         int     DEFAULT 20,
  p_min_score      decimal DEFAULT 0
)
RETURNS TABLE (
  produto_id           uuid,
  titulo               text,
  marketplace_id       varchar,
  url_produto          text,
  url_imagem           text,
  preco_atual          decimal,
  preco_original       decimal,
  preco_medio_30d      decimal,
  percentual_desconto  decimal,
  desvio_media_pct     decimal,
  total_vendas         int,
  score_oportunidade   decimal
)
LANGUAGE sql STABLE
AS $$
  SELECT * FROM (
    WITH ultimo_preco AS (
      SELECT DISTINCT ON (produto_id)
        produto_id,
        preco_atual,
        preco_original,
        percentual_desconto
      FROM public.historico_precos
      ORDER BY produto_id, coletado_em DESC
    ),
    media_30d AS (
      SELECT
        produto_id,
        AVG(preco_atual) AS media_preco
      FROM public.historico_precos
      WHERE coletado_em >= now() - interval '30 days'
      GROUP BY produto_id
    )
    SELECT
      p.id                                                                   AS produto_id,
      p.titulo,
      p.marketplace_id,
      p.url_produto,
      p.url_imagem,
      up.preco_atual,
      up.preco_original,
      ROUND(m.media_preco, 2)                                                AS preco_medio_30d,
      COALESCE(up.percentual_desconto, 0)                                    AS percentual_desconto,
      CASE
        WHEN m.media_preco > 0
          THEN ROUND(((m.media_preco - up.preco_atual) / m.media_preco * 100), 2)
        ELSE 0
      END                                                                    AS desvio_media_pct,
      p.total_vendas,
      ROUND((
        COALESCE(up.percentual_desconto, 0) * 0.4 +
        CASE
          WHEN m.media_preco > 0
            THEN GREATEST(((m.media_preco - up.preco_atual) / m.media_preco * 100), 0) * 0.4
          ELSE 0
        END +
        LEAST(COALESCE(p.total_vendas, 0)::decimal / 1000.0, 100) * 0.2
      ), 2)                                                                  AS score_oportunidade
    FROM public.produtos p
    JOIN ultimo_preco up ON up.produto_id = p.id
    JOIN media_30d    m  ON m.produto_id  = p.id
    WHERE (p_marketplace_id IS NULL OR p.marketplace_id = p_marketplace_id)
  ) sub
  WHERE sub.score_oportunidade >= p_min_score
  ORDER BY sub.score_oportunidade DESC
  LIMIT p_limite;
$$;
