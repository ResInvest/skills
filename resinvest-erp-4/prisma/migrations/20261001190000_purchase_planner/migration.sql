-- F4c Planer zakupów: plan dzienny magazynu (MP) + uprawnienie planner.edit.

-- CreateTable
CREATE TABLE "purchase_plans" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "plan_mp" DECIMAL(12,2) NOT NULL,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "purchase_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_plans_warehouse_id_day_key" ON "purchase_plans"("warehouse_id", "day");

-- AddForeignKey
ALTER TABLE "purchase_plans" ADD CONSTRAINT "purchase_plans_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Plan nie może być ujemny (ochrona także przed zapisem z pominięciem API).
ALTER TABLE "purchase_plans" ADD CONSTRAINT "purchase_plans_plan_mp_chk" CHECK ("plan_mp" >= 0);

-- Uprawnienie dla istniejących instalacji (nowe instalacje dostają je z danych startowych).
INSERT INTO "permissions" ("code", "description", "group") VALUES ('planner.edit', 'Planer zakupów — plan dzienny', 'Operacje') ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_code")
  SELECT "id", 'planner.edit' FROM "roles" WHERE "code" IN ('ADMINISTRATOR', 'MANAGER') AND "system" = true
  ON CONFLICT DO NOTHING;
