-- Preferencje interfejsu: język (pl / cs / en), motyw (5 gotowych + własny) i dwa kolory motywu własnego.
-- Tylko dodanie kolumn i ograniczeń — istniejące dane bez zmian (lang ma domyślnie 'pl', theme jest puste).
ALTER TABLE "users" ADD COLUMN "theme_primary" VARCHAR(7);
ALTER TABLE "users" ADD COLUMN "theme_secondary" VARCHAR(7);
ALTER TABLE "users" ADD CONSTRAINT "users_lang_chk" CHECK ("lang" IN ('pl', 'cs', 'en'));
ALTER TABLE "users" ADD CONSTRAINT "users_theme_chk" CHECK ("theme" IS NULL OR "theme" IN ('pearl', 'graphite', 'azure', 'ultra', 'premium', 'custom'));
ALTER TABLE "users" ADD CONSTRAINT "users_theme_colors_chk" CHECK (
  ("theme_primary" IS NULL OR "theme_primary" ~ '^#[0-9a-f]{6}$') AND ("theme_secondary" IS NULL OR "theme_secondary" ~ '^#[0-9a-f]{6}$'));
