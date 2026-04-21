-- IDs de parceiro por plataforma no perfil do afiliado
ALTER TABLE perfis_afiliados
  ADD COLUMN amazon_tag      text,   -- ex: meunome-20
  ADD COLUMN shopee_id       text,   -- AF site ID da Shopee
  ADD COLUMN mercadolivre_id text;   -- reservado para fluxo OAuth ML
