-- ================================================================
-- Migration: 20260418000001 — Core schema de afiliados
-- Tabelas: perfis, links_afiliados, cliques_analytics, comissoes
-- ================================================================


-- ----------------------------------------------------------------
-- PERFIS
-- Shadow de auth.users criado automaticamente via trigger
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.perfis (
  id            uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perfis: leitura própria"
  ON public.perfis FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "perfis: atualização própria"
  ON public.perfis FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Trigger: popula perfis automaticamente ao criar usuário no Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.perfis (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Remove trigger anterior se existir (idempotência)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ----------------------------------------------------------------
-- LINKS AFILIADOS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.links_afiliados (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url_original   text         NOT NULL,
  short_code     varchar(20)  NOT NULL UNIQUE,
  marketplace_id varchar(50)  NOT NULL,
  titulo         text,
  ativo          boolean      NOT NULL DEFAULT true,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_links_short_code ON public.links_afiliados (short_code);
CREATE INDEX IF NOT EXISTS idx_links_user_id    ON public.links_afiliados (user_id);
CREATE INDEX IF NOT EXISTS idx_links_marketplace ON public.links_afiliados (marketplace_id);

ALTER TABLE public.links_afiliados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "links: leitura própria"
  ON public.links_afiliados FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "links: inserção própria"
  ON public.links_afiliados FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "links: atualização própria"
  ON public.links_afiliados FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "links: deleção própria"
  ON public.links_afiliados FOR DELETE
  USING (auth.uid() = user_id);


-- ----------------------------------------------------------------
-- CLIQUES ANALYTICS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cliques_analytics (
  id         bigserial    PRIMARY KEY,
  link_id    uuid         NOT NULL REFERENCES public.links_afiliados(id) ON DELETE CASCADE,
  timestamp  timestamptz  NOT NULL DEFAULT now(),
  metadata   jsonb        -- ip, user_agent, referer, país, etc.
);

CREATE INDEX IF NOT EXISTS idx_cliques_link_id   ON public.cliques_analytics (link_id);
CREATE INDEX IF NOT EXISTS idx_cliques_timestamp ON public.cliques_analytics (timestamp DESC);
-- Índice para queries analíticas por link + janela de tempo
CREATE INDEX IF NOT EXISTS idx_cliques_link_time ON public.cliques_analytics (link_id, timestamp DESC);

ALTER TABLE public.cliques_analytics ENABLE ROW LEVEL SECURITY;

-- Usuários leem apenas cliques de seus próprios links
CREATE POLICY "cliques: leitura pelo dono do link"
  ON public.cliques_analytics FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.links_afiliados la
      WHERE la.id = link_id
        AND la.user_id = auth.uid()
    )
  );

-- Inserção restrita ao service_role (Edge Function redirect-engine)
-- Usuários comuns não devem inserir cliques diretamente
CREATE POLICY "cliques: inserção via service_role"
  ON public.cliques_analytics FOR INSERT
  WITH CHECK (
    (SELECT current_setting('role') = 'service_role')
    OR auth.role() = 'service_role'
  );


-- ----------------------------------------------------------------
-- COMISSÕES
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comissoes (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  link_id        uuid          REFERENCES public.links_afiliados(id) ON DELETE SET NULL,
  marketplace_id varchar(50)   NOT NULL,
  valor          decimal(12,2) NOT NULL DEFAULT 0,
  moeda          char(3)       NOT NULL DEFAULT 'BRL',
  status         varchar(20)   NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','confirmado','cancelado','pago')),
  periodo_ref    date          NOT NULL, -- mês/ano de referência (1º dia do mês)
  observacao     text,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comissoes_user_id  ON public.comissoes (user_id);
CREATE INDEX IF NOT EXISTS idx_comissoes_periodo  ON public.comissoes (periodo_ref DESC);
CREATE INDEX IF NOT EXISTS idx_comissoes_status   ON public.comissoes (status);

ALTER TABLE public.comissoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comissoes: leitura própria"
  ON public.comissoes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "comissoes: inserção própria"
  ON public.comissoes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "comissoes: atualização própria"
  ON public.comissoes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
