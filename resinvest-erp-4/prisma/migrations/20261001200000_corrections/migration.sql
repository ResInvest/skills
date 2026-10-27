-- F5: korekty dokumentów — klucz idempotencji żądania korekty i indeks do zakładki „Korekty”.
ALTER TABLE "corrections" ADD COLUMN "idempotency_key" VARCHAR(80);
CREATE UNIQUE INDEX "corrections_idempotency_key_key" ON "corrections"("idempotency_key");
CREATE INDEX "corrections_created_at_idx" ON "corrections"("created_at");
