-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('M3', 'MP', 'T');

-- CreateEnum
CREATE TYPE "ValueSource" AS ENUM ('AUTO', 'MANUAL', 'COMPANY_RATE');

-- CreateEnum
CREATE TYPE "MaterialCategory" AS ENUM ('WOOD', 'CHIPS', 'TONNAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "PartnerRole" AS ENUM ('SUPPLIER', 'BUYER', 'BOTH');

-- CreateEnum
CREATE TYPE "PartnerKind" AS ENUM ('COMPANY', 'FOREST_DISTRICT');

-- CreateEnum
CREATE TYPE "Ownership" AS ENUM ('OWN', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'SERVICE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ExternalCompanyKind" AS ENUM ('TRANSPORT', 'CHIPPING', 'SERVICES', 'OTHER');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('PURCHASE', 'SALE', 'PRODUCTION', 'TRANSFER', 'OPENING_BALANCE', 'INVENTORY');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('DRAFT', 'PENDING', 'POSTED', 'CORRECTED', 'DELETED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('PZ', 'WZ', 'RW', 'PW', 'MM', 'TR', 'BO', 'IN');

-- CreateEnum
CREATE TYPE "MovementKind" AS ENUM ('OPENING', 'PURCHASE', 'SALE', 'CONSUMPTION', 'PRODUCTION', 'TRANSFER_OUT', 'TRANSFER_IN', 'INVENTORY', 'CORRECTION', 'REVERSAL');

-- CreateEnum
CREATE TYPE "TransferState" AS ENUM ('IN_TRANSIT', 'RECEIVED');

-- CreateEnum
CREATE TYPE "TransportMode" AS ENUM ('NONE', 'OWN', 'EXTERNAL', 'MIXED', 'TRAIN', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "ProductionMode" AS ENUM ('FROM_STOCK', 'FROM_PURCHASE', 'DIRECT');

-- CreateEnum
CREATE TYPE "OpeningBatchStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AuthTokenKind" AS ENUM ('INVITE', 'PASSWORD_RESET', 'EMAIL_CONFIRM');

-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('PZ_CREATED', 'WZ_CREATED', 'PRODUCTION_CREATED', 'STOCK_OPERATION', 'CORRECTION', 'DOCUMENT_EDITED', 'DOCUMENT_DELETED', 'ADDITIONAL_OPERATION');

-- CreateEnum
CREATE TYPE "MailStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('SCHEDULED', 'MANUAL', 'ON_SHUTDOWN');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('RUNNING', 'OK', 'FAILED');

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "global" BOOLEAN NOT NULL DEFAULT false,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "code" VARCHAR(60) NOT NULL,
    "description" TEXT NOT NULL,
    "group" VARCHAR(40) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_code" VARCHAR(60) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_code")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "first_name" VARCHAR(80) NOT NULL,
    "last_name" VARCHAR(80) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "role_id" UUID NOT NULL,
    "default_warehouse_id" UUID,
    "lang" VARCHAR(5) NOT NULL DEFAULT 'pl',
    "theme" VARCHAR(20),
    "password_hash" TEXT,
    "password_changed_at" TIMESTAMPTZ(3),
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "identity_provider" VARCHAR(30) NOT NULL DEFAULT 'local',
    "external_id" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_warehouses" (
    "user_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,

    CONSTRAINT "user_warehouses_pkey" PRIMARY KEY ("user_id","warehouse_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" VARCHAR(80),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "AuthTokenKind" NOT NULL,
    "email" VARCHAR(254),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_events" (
    "id" BIGSERIAL NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" VARCHAR(254) NOT NULL,
    "user_id" UUID,
    "success" BOOLEAN NOT NULL,
    "reason" VARCHAR(60),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "address" VARCHAR(250),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "category" "MaterialCategory" NOT NULL,
    "stock_unit" "Unit" NOT NULL,
    "allowed_units" "Unit"[],
    "ton_per_unit" DECIMAL(12,6),
    "mp_per_m3" DECIMAL(12,6),
    "ton_per_m3" DECIMAL(12,6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_rates" (
    "id" UUID NOT NULL,
    "material_id" UUID,
    "from_unit" "Unit" NOT NULL,
    "to_unit" "Unit" NOT NULL,
    "factor" DECIMAL(12,6) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "conversion_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "nip" VARCHAR(15),
    "role" "PartnerRole" NOT NULL,
    "kind" "PartnerKind" NOT NULL DEFAULT 'COMPANY',
    "city" VARCHAR(120),
    "address" VARCHAR(250),
    "forestries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_companies" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "nip" VARCHAR(15),
    "kind" "ExternalCompanyKind" NOT NULL,
    "contact" VARCHAR(250),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "external_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(30),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operators" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(30),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "registration" VARCHAR(20) NOT NULL,
    "vehicle_type" VARCHAR(40),
    "ownership" "Ownership" NOT NULL DEFAULT 'OWN',
    "external_company_id" UUID,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "warehouse_id" UUID,
    "default_driver_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chippers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "registration" VARCHAR(20),
    "ownership" "Ownership" NOT NULL DEFAULT 'OWN',
    "external_company_id" UUID,
    "operator_id" UUID,
    "external_operator" VARCHAR(120),
    "notes" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "warehouse_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "chippers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "additional_operation_types" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "unit" VARCHAR(20),
    "default_rate" DECIMAL(14,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "additional_operation_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations" (
    "id" UUID NOT NULL,
    "type" "OperationType" NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'POSTED',
    "warehouse_id" UUID NOT NULL,
    "target_warehouse_id" UUID,
    "transfer_state" "TransferState",
    "operation_date" DATE NOT NULL,
    "idempotency_key" VARCHAR(80) NOT NULL,
    "transport_mode" "TransportMode" NOT NULL DEFAULT 'NONE',
    "place" VARCHAR(250),
    "notes" TEXT,
    "purchase_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "chipping_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "transport_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "additional_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "input" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,
    "delete_reason" TEXT,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "year" INTEGER NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "document_date" DATE NOT NULL,
    "movement_date" DATE NOT NULL,
    "partner_id" UUID,
    "external_number" VARCHAR(60),
    "status" "OperationStatus" NOT NULL DEFAULT 'POSTED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_lines" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "material_id" UUID NOT NULL,
    "qty_source" DECIMAL(18,6) NOT NULL,
    "unit_source" "Unit" NOT NULL,
    "qty_stock" DECIMAL(18,6) NOT NULL,
    "unit_stock" "Unit" NOT NULL,
    "conversion_factor" DECIMAL(12,6) NOT NULL,
    "conversion_source" "ValueSource" NOT NULL,
    "weight_t" DECIMAL(18,6),
    "weight_source" "ValueSource",
    "unit_price" DECIMAL(14,4),
    "price_unit" "Unit",
    "value" DECIMAL(14,2),

    CONSTRAINT "document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "document_id" UUID,
    "document_line_id" UUID,
    "kind" "MovementKind" NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "movement_date" DATE NOT NULL,
    "reversal_of_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "warehouse_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("warehouse_id","material_id")
);

-- CreateTable
CREATE TABLE "opening_balance_batches" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "effective_date" DATE NOT NULL,
    "status" "OpeningBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "operation_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "opening_balance_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_balance_lines" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "unit" "Unit" NOT NULL,
    "qty_stock" DECIMAL(18,6) NOT NULL,
    "note" TEXT,

    CONSTRAINT "opening_balance_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_runs" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "run_no" INTEGER NOT NULL,
    "ownership" "Ownership" NOT NULL,
    "vehicle_id" UUID,
    "driver_id" UUID,
    "external_company_id" UUID,
    "registration" VARCHAR(20),
    "driver_name" VARCHAR(120),
    "km" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "rate_per_km" DECIMAL(10,2),
    "freight" DECIMAL(14,2),
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "qty" DECIMAL(18,6),
    "unit" "Unit",
    "weight_t" DECIMAL(18,6),
    "waybill_no" VARCHAR(60),
    "waybill_m3" DECIMAL(18,6),
    "train" JSONB,

    CONSTRAINT "transport_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_runs" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "mode" "ProductionMode" NOT NULL,
    "raw_material_id" UUID,
    "out_material_id" UUID NOT NULL,
    "consume_qty" DECIMAL(18,6),
    "out_qty" DECIMAL(18,6) NOT NULL,
    "factor" DECIMAL(12,6),
    "chipper_id" UUID,
    "operator_id" UUID,
    "chip_rate" DECIMAL(10,2),
    "chipping_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "diff_reason" VARCHAR(40),
    "forest_district" VARCHAR(120),
    "forestry" VARCHAR(120),
    "waybill" VARCHAR(200),
    "invest_site" VARCHAR(250),
    "source_doc" VARCHAR(120),

    CONSTRAINT "production_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "additional_operations" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "type_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "performed_on" DATE NOT NULL,
    "quantity" DECIMAL(14,3),
    "cost" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "additional_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_receipts" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "received_date" DATE NOT NULL,
    "qty" DECIMAL(18,6) NOT NULL,
    "unit" "Unit" NOT NULL,
    "qty_stock" DECIMAL(18,6) NOT NULL,
    "diff_stock" DECIMAL(18,6) NOT NULL,
    "reason" VARCHAR(40),
    "note" TEXT,
    "weight_t" DECIMAL(18,6),
    "weight_source" "ValueSource",
    "idempotency_key" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "transfer_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrections" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "reverses" VARCHAR(40),

    CONSTRAINT "corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_revisions" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "document_id" UUID,
    "correction_id" UUID,
    "field" VARCHAR(80) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "document_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_periods" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "period" CHAR(7) NOT NULL,
    "status" "InventoryStatus" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_by_id" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,
    "auto_closed" BOOLEAN NOT NULL DEFAULT false,
    "operation_id" UUID,
    "lines" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "user_email" VARCHAR(254),
    "action" VARCHAR(60) NOT NULL,
    "entity" VARCHAR(40) NOT NULL,
    "entity_id" VARCHAR(80),
    "warehouse_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "request_id" VARCHAR(64),

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "user_id" UUID NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allowed_by_admin" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("user_id","event")
);

-- CreateTable
CREATE TABLE "mail_outbox" (
    "id" UUID NOT NULL,
    "template" VARCHAR(60) NOT NULL,
    "to_address" VARCHAR(254) NOT NULL,
    "subject" VARCHAR(250) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "MailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "provider_id" VARCHAR(120),
    "event_ref" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "mail_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "key" VARCHAR(80) NOT NULL,
    "user_id" UUID NOT NULL,
    "route" VARCHAR(120) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" UUID NOT NULL,
    "kind" "BackupKind" NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "primary_path" TEXT,
    "secondary_path" TEXT,
    "size_bytes" BIGINT,
    "sha256" CHAR(64),
    "verified_at" TIMESTAMPTZ(3),
    "restore_tested_at" TIMESTAMPTZ(3),
    "restore_test_result" TEXT,
    "error" TEXT,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_identity_provider_external_id_key" ON "users"("identity_provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_kind_idx" ON "auth_tokens"("user_id", "kind");

-- CreateIndex
CREATE INDEX "login_events_email_ts_idx" ON "login_events"("email", "ts");

-- CreateIndex
CREATE INDEX "login_events_ts_idx" ON "login_events"("ts");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_name_key" ON "warehouses"("name");

-- CreateIndex
CREATE UNIQUE INDEX "materials_code_key" ON "materials"("code");

-- CreateIndex
CREATE UNIQUE INDEX "materials_name_key" ON "materials"("name");

-- CreateIndex
CREATE INDEX "conversion_rates_material_id_from_unit_to_unit_valid_from_idx" ON "conversion_rates"("material_id", "from_unit", "to_unit", "valid_from");

-- CreateIndex
CREATE INDEX "partners_nip_idx" ON "partners"("nip");

-- CreateIndex
CREATE UNIQUE INDEX "partners_name_key" ON "partners"("name");

-- CreateIndex
CREATE UNIQUE INDEX "external_companies_name_key" ON "external_companies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_registration_key" ON "vehicles"("registration");

-- CreateIndex
CREATE UNIQUE INDEX "additional_operation_types_name_key" ON "additional_operation_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "operations_idempotency_key_key" ON "operations"("idempotency_key");

-- CreateIndex
CREATE INDEX "operations_warehouse_id_operation_date_idx" ON "operations"("warehouse_id", "operation_date");

-- CreateIndex
CREATE INDEX "operations_target_warehouse_id_transfer_state_idx" ON "operations"("target_warehouse_id", "transfer_state");

-- CreateIndex
CREATE INDEX "operations_type_operation_date_idx" ON "operations"("type", "operation_date");

-- CreateIndex
CREATE INDEX "operations_deleted_at_idx" ON "operations"("deleted_at");

-- CreateIndex
CREATE INDEX "documents_warehouse_id_document_date_idx" ON "documents"("warehouse_id", "document_date");

-- CreateIndex
CREATE INDEX "documents_partner_id_idx" ON "documents"("partner_id");

-- CreateIndex
CREATE INDEX "documents_operation_id_idx" ON "documents"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_type_warehouse_id_year_number_key" ON "documents"("type", "warehouse_id", "year", "number");

-- CreateIndex
CREATE INDEX "document_lines_material_id_idx" ON "document_lines"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_lines_document_id_line_no_key" ON "document_lines"("document_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_seq_key" ON "stock_movements"("seq");

-- CreateIndex
CREATE INDEX "stock_movements_warehouse_id_material_id_movement_date_idx" ON "stock_movements"("warehouse_id", "material_id", "movement_date");

-- CreateIndex
CREATE INDEX "stock_movements_operation_id_idx" ON "stock_movements"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "opening_balance_batches_operation_id_key" ON "opening_balance_batches"("operation_id");

-- CreateIndex
CREATE INDEX "opening_balance_batches_warehouse_id_status_idx" ON "opening_balance_batches"("warehouse_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "opening_balance_lines_batch_id_material_id_key" ON "opening_balance_lines"("batch_id", "material_id");

-- CreateIndex
CREATE UNIQUE INDEX "transport_runs_operation_id_run_no_key" ON "transport_runs"("operation_id", "run_no");

-- CreateIndex
CREATE UNIQUE INDEX "production_runs_operation_id_key" ON "production_runs"("operation_id");

-- CreateIndex
CREATE INDEX "additional_operations_warehouse_id_performed_on_idx" ON "additional_operations"("warehouse_id", "performed_on");

-- CreateIndex
CREATE INDEX "additional_operations_operation_id_idx" ON "additional_operations"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_receipts_operation_id_key" ON "transfer_receipts"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_receipts_idempotency_key_key" ON "transfer_receipts"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "corrections_number_key" ON "corrections"("number");

-- CreateIndex
CREATE INDEX "corrections_operation_id_idx" ON "corrections"("operation_id");

-- CreateIndex
CREATE INDEX "document_revisions_operation_id_created_at_idx" ON "document_revisions"("operation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_periods_operation_id_key" ON "inventory_periods"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_periods_warehouse_id_period_key" ON "inventory_periods"("warehouse_id", "period");

-- CreateIndex
CREATE INDEX "audit_log_ts_idx" ON "audit_log"("ts");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_user_id_ts_idx" ON "audit_log"("user_id", "ts");

-- CreateIndex
CREATE INDEX "audit_log_warehouse_id_ts_idx" ON "audit_log"("warehouse_id", "ts");

-- CreateIndex
CREATE INDEX "mail_outbox_status_next_attempt_at_idx" ON "mail_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE INDEX "backup_runs_started_at_idx" ON "backup_runs"("started_at");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_default_warehouse_id_fkey" FOREIGN KEY ("default_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warehouses" ADD CONSTRAINT "user_warehouses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warehouses" ADD CONSTRAINT "user_warehouses_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_rates" ADD CONSTRAINT "conversion_rates_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_external_company_id_fkey" FOREIGN KEY ("external_company_id") REFERENCES "external_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_default_driver_id_fkey" FOREIGN KEY ("default_driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chippers" ADD CONSTRAINT "chippers_external_company_id_fkey" FOREIGN KEY ("external_company_id") REFERENCES "external_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chippers" ADD CONSTRAINT "chippers_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chippers" ADD CONSTRAINT "chippers_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_target_warehouse_id_fkey" FOREIGN KEY ("target_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_document_line_id_fkey" FOREIGN KEY ("document_line_id") REFERENCES "document_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "opening_balance_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_runs" ADD CONSTRAINT "transport_runs_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_runs" ADD CONSTRAINT "transport_runs_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_runs" ADD CONSTRAINT "transport_runs_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_runs" ADD CONSTRAINT "transport_runs_external_company_id_fkey" FOREIGN KEY ("external_company_id") REFERENCES "external_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_chipper_id_fkey" FOREIGN KEY ("chipper_id") REFERENCES "chippers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_operations" ADD CONSTRAINT "additional_operations_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_operations" ADD CONSTRAINT "additional_operations_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "additional_operation_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_operations" ADD CONSTRAINT "additional_operations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "additional_operations" ADD CONSTRAINT "additional_operations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_correction_id_fkey" FOREIGN KEY ("correction_id") REFERENCES "corrections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_periods" ADD CONSTRAINT "inventory_periods_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Ograniczenia domenowe, których Prisma nie wyraża w schemacie
-- ============================================================================

-- e-mail zawsze małymi literami, bez spacji
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized_chk" CHECK ("email" = lower("email") AND position(' ' in "email") = 0);
ALTER TABLE "users" ADD CONSTRAINT "users_failed_logins_chk" CHECK ("failed_logins" >= 0);

-- materiał: jednostka magazynowa należy do jednostek dozwolonych; przeliczniki dodatnie
ALTER TABLE "materials" ADD CONSTRAINT "materials_stock_unit_allowed_chk" CHECK ("stock_unit" = ANY ("allowed_units"));
ALTER TABLE "materials" ADD CONSTRAINT "materials_factors_positive_chk" CHECK (
  ("ton_per_unit" IS NULL OR "ton_per_unit" > 0) AND ("mp_per_m3" IS NULL OR "mp_per_m3" > 0) AND ("ton_per_m3" IS NULL OR "ton_per_m3" > 0));
ALTER TABLE "conversion_rates" ADD CONSTRAINT "conversion_rates_factor_chk" CHECK ("factor" > 0 AND "from_unit" <> "to_unit" AND ("valid_to" IS NULL OR "valid_to" >= "valid_from"));

-- sprzęt firm zewnętrznych musi wskazywać firmę
ALTER TABLE "chippers" ADD CONSTRAINT "chippers_external_company_chk" CHECK ("ownership" = 'OWN' OR "external_company_id" IS NOT NULL);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_external_company_chk" CHECK ("ownership" = 'OWN' OR "external_company_id" IS NOT NULL);

-- operacje: MM ma magazyn docelowy różny od źródłowego; kwoty nieujemne
ALTER TABLE "operations" ADD CONSTRAINT "operations_transfer_target_chk" CHECK (
  ("type" = 'TRANSFER' AND "target_warehouse_id" IS NOT NULL AND "target_warehouse_id" <> "warehouse_id" AND "transfer_state" IS NOT NULL)
  OR ("type" <> 'TRANSFER' AND "target_warehouse_id" IS NULL AND "transfer_state" IS NULL));
ALTER TABLE "operations" ADD CONSTRAINT "operations_amounts_chk" CHECK (
  "purchase_cost" >= 0 AND "revenue" >= 0 AND "chipping_cost" >= 0 AND "transport_cost" >= 0 AND "additional_cost" >= 0);
ALTER TABLE "operations" ADD CONSTRAINT "operations_deleted_chk" CHECK (("status" = 'DELETED') = ("deleted_at" IS NOT NULL));

-- dokumenty: numer niepusty, rok zgodny z datą dokumentu
ALTER TABLE "documents" ADD CONSTRAINT "documents_number_chk" CHECK (length(btrim("number")) > 0);
ALTER TABLE "documents" ADD CONSTRAINT "documents_year_chk" CHECK ("year" = EXTRACT(YEAR FROM "document_date"));

-- pozycje: ilości dodatnie, przelicznik dodatni, tonaż nieujemny i ze źródłem
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_qty_chk" CHECK ("qty_source" > 0 AND "qty_stock" > 0 AND "conversion_factor" > 0);
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_weight_chk" CHECK (("weight_t" IS NULL AND "weight_source" IS NULL) OR ("weight_t" >= 0 AND "weight_source" IS NOT NULL));
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_value_chk" CHECK (("unit_price" IS NULL OR "unit_price" >= 0) AND ("value" IS NULL OR "value" >= 0));

-- ruchy i salda: ruch ≠ 0, saldo nie może być ujemne (dwie równoczesne sprzedaże — druga zostanie odrzucona)
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_qty_chk" CHECK ("qty" <> 0);
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_non_negative_chk" CHECK ("qty" >= 0);

-- bilans otwarcia: jeden zatwierdzony bilans na magazyn; ilości nieujemne
CREATE UNIQUE INDEX "opening_balance_batches_one_approved_per_wh" ON "opening_balance_batches" ("warehouse_id") WHERE "status" = 'APPROVED';
ALTER TABLE "opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_approved_chk" CHECK (("status" = 'APPROVED') = ("approved_at" IS NOT NULL AND "approved_by_id" IS NOT NULL));
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_qty_chk" CHECK ("qty" >= 0 AND "qty_stock" >= 0);

-- operacje dodatkowe, transport, przyjęcie MM
ALTER TABLE "additional_operations" ADD CONSTRAINT "additional_operations_cost_chk" CHECK ("cost" >= 0 AND ("quantity" IS NULL OR "quantity" > 0));
ALTER TABLE "transport_runs" ADD CONSTRAINT "transport_runs_values_chk" CHECK ("km" >= 0 AND "cost" >= 0 AND ("freight" IS NULL OR "freight" >= 0) AND ("rate_per_km" IS NULL OR "rate_per_km" >= 0));
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_qty_chk" CHECK ("qty" >= 0 AND "qty_stock" >= 0);
ALTER TABLE "inventory_periods" ADD CONSTRAINT "inventory_periods_period_chk" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- kolejka poczty
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_attempts_chk" CHECK ("attempts" >= 0);

-- ============================================================================
-- Dane niezmienne: dziennik audytu i ruchy magazynowe (tylko INSERT)
-- ============================================================================
CREATE OR REPLACE FUNCTION "riw_forbid_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabela % jest tylko do dopisywania (operacja % zabroniona)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER "audit_log_append_only" BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "riw_forbid_change"();
CREATE TRIGGER "audit_log_no_truncate" BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "riw_forbid_change"();
CREATE TRIGGER "stock_movements_append_only" BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "riw_forbid_change"();
CREATE TRIGGER "stock_movements_no_truncate" BEFORE TRUNCATE ON "stock_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION "riw_forbid_change"();
