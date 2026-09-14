-- AlterTable
-- `user_code` is required, and sys_user may already hold rows, so it is added
-- nullable, backfilled with the `user.0001` system-code convention, and only
-- then constrained.
ALTER TABLE "sys_user" ADD COLUMN     "created_by" INTEGER,
ADD COLUMN     "updated_by" INTEGER,
ADD COLUMN     "user_code" TEXT;

UPDATE "sys_user" SET "user_code" = 'user.' || LPAD("id"::text, 4, '0') WHERE "user_code" IS NULL;

ALTER TABLE "sys_user" ALTER COLUMN "user_code" SET NOT NULL;

-- CreateTable
CREATE TABLE "sys_role" (
    "id" SERIAL NOT NULL,
    "role_code" TEXT NOT NULL,
    "role_label" TEXT NOT NULL,
    "role_name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'Active',
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_permission" (
    "id" SERIAL NOT NULL,
    "permission_code" TEXT NOT NULL,
    "permission_name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_user_role" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_user_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_role_permission" (
    "id" SERIAL NOT NULL,
    "role_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_session" (
    "id" SERIAL NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sys_role_role_code_key" ON "sys_role"("role_code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_role_role_label_key" ON "sys_role"("role_label");

-- CreateIndex
CREATE UNIQUE INDEX "sys_permission_permission_code_key" ON "sys_permission"("permission_code");

-- CreateIndex
CREATE INDEX "sys_permission_module_idx" ON "sys_permission"("module");

-- CreateIndex
CREATE INDEX "sys_user_role_user_id_idx" ON "sys_user_role"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_user_role_user_id_role_id_key" ON "sys_user_role"("user_id", "role_id");

-- CreateIndex
CREATE INDEX "sys_role_permission_role_id_idx" ON "sys_role_permission"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_role_permission_role_id_permission_id_key" ON "sys_role_permission"("role_id", "permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_session_token_hash_key" ON "sys_session"("token_hash");

-- CreateIndex
CREATE INDEX "sys_session_user_id_idx" ON "sys_session"("user_id");

-- CreateIndex
CREATE INDEX "sys_session_expires_at_idx" ON "sys_session"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sys_user_user_code_key" ON "sys_user"("user_code");

-- AddForeignKey
ALTER TABLE "sys_user_role" ADD CONSTRAINT "sys_user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_user_role" ADD CONSTRAINT "sys_user_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "sys_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_role_permission" ADD CONSTRAINT "sys_role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "sys_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_role_permission" ADD CONSTRAINT "sys_role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "sys_permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_session" ADD CONSTRAINT "sys_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

