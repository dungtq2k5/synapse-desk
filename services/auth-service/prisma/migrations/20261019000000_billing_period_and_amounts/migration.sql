-- AlterTable: expand only. Nullable columns, and a boolean whose default is
-- what every existing subscription reads until its next event: not canceling.
ALTER TABLE "organizations" ADD COLUMN "stripe_price_id" VARCHAR(255),
ADD COLUMN "current_period_end" TIMESTAMPTZ,
ADD COLUMN "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "subscription_plan_prices" ADD COLUMN "unit_amount" INTEGER,
ADD COLUMN "currency" VARCHAR(3);
