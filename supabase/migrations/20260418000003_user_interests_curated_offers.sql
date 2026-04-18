-- ================================================================
-- Migration: 20260418000003
-- Remove buscas_monitoradas (substituída por modelo baseado em usuário)
-- Adiciona: usuario_interesses, ofertas_curadas
-- ================================================================

DROP TABLE IF EXISTS public.buscas_monitoradas;

-- ----------------------------------------------------------------
-- USUÁRIO INTERESSES — preferências de cada afiliado
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usuario_interesses (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  categoria_id     varchar(50),                      -- ID de categoria ML (ex: MLB1051)
  termo_busca      text,                             -- busca livre (ex: "iPhone 15")
  desconto_minimo  decimal(5,2) NOT NULL DEFAULT 10, -- % mínimo de desconto
  ativo            boolean      NOT NULL DEFAULT true,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chk_interesse CHECK (categoria_id IS NOT NULL OR termo_busca IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_interesses_user_id ON public.usuario_interesses (user_id);
CREATE INDEX IF NOT EXISTS idx_interesses_ativo   ON public.usuario_interesses (ativo);

ALTER TABLE public.usuario_interesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "interesses: CRUD próprio"
  ON public.usuario_interesses FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ----------------------------------------------------------------
-- OFERTAS CURADAS — produtos filtrados pelo worker, prontos para o afiliado
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ofertas_curadas (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  interesse_id        uuid          NOT NULL REFERENCES public.usuario_interesses(id) ON DELETE CASCADE,
  marketplace_id      varchar(50)   NOT NULL DEFAULT 'mercadolivre',
  external_id         varchar(200)  NOT NULL,
  titulo              text          NOT NULL,
  url_original        text          NOT NULL,
  url_imagem          text,
  preco_atual         decimal(12,2) NOT NULL,
  preco_original      decimal(12,2),
  percentual_desconto decimal(5,2)  NOT NULL,
  total_vendas        int,
  link_afiliado       text,         -- URL com parâmetros de tracking do afiliado
  visualizada         boolean       NOT NULL DEFAULT false,
  descoberta_em       timestamptz   NOT NULL DEFAULT now(),
  expira_em           timestamptz   NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (user_id, external_id)     -- evita duplicatas por usuário
);

CREATE INDEX IF NOT EXISTS idx_curadas_user_id      ON public.ofertas_curadas (user_id);
CREATE INDEX IF NOT EXISTS idx_curadas_desconto     ON public.ofertas_curadas (percentual_desconto DESC);
CREATE INDEX IF NOT EXISTS idx_curadas_expira_em    ON public.ofertas_curadas (expira_em);
CREATE INDEX IF NOT EXISTS idx_curadas_visualizada  ON public.ofertas_curadas (user_id, visualizada);

ALTER TABLE public.ofertas_curadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "curadas: leitura própria"
  ON public.ofertas_curadas FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "curadas: atualização própria"
  ON public.ofertas_curadas FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "curadas: escrita service_role"
  ON public.ofertas_curadas FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "curadas: deleção service_role"
  ON public.ofertas_curadas FOR DELETE
  TO service_role
  USING (true);
