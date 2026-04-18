-- Relax constraints on ofertas_curadas to avoid NOT NULL violations
-- when percentual_desconto or expira_em are absent from the payload.

ALTER TABLE ofertas_curadas
  ALTER COLUMN percentual_desconto SET DEFAULT 0,
  ALTER COLUMN percentual_desconto DROP NOT NULL;

ALTER TABLE ofertas_curadas
  ALTER COLUMN expira_em SET DEFAULT (now() + interval '24 hours'),
  ALTER COLUMN expira_em DROP NOT NULL;

ALTER TABLE ofertas_curadas
  ALTER COLUMN visualizada SET DEFAULT false;
