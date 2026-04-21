-- Perfil do afiliado: nichos, canais e volume diário
CREATE TABLE perfis_afiliados (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  nichos_interesse      text[]      NOT NULL DEFAULT '{}',
  canais_publicacao     text[]      NOT NULL DEFAULT '{}',
  volume_ofertas_diario integer     NOT NULL DEFAULT 10,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE perfis_afiliados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perfis_afiliados_self" ON perfis_afiliados
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Trigger para manter atualizado_em sincronizado
CREATE OR REPLACE FUNCTION atualizar_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$;

CREATE TRIGGER perfis_afiliados_atualizado_em
  BEFORE UPDATE ON perfis_afiliados
  FOR EACH ROW EXECUTE FUNCTION atualizar_atualizado_em();

-- Watchlist: produtos que o usuário quer acompanhar
CREATE TABLE produto_watchlist (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  titulo_produto   text        NOT NULL,
  preco_alvo       numeric,
  url_original     text,
  notificar_queda  boolean     NOT NULL DEFAULT true,
  criado_em        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE produto_watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "watchlist_self" ON produto_watchlist
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
