-- AlterTable: expand only. Every existing token is an ordinary reset.
ALTER TABLE "password_reset_tokens" ADD COLUMN "verifies_email" BOOLEAN NOT NULL DEFAULT false;
