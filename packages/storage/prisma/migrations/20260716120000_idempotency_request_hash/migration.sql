ALTER TABLE "idempotency_records"
ADD COLUMN "requestHash" TEXT;

ALTER TABLE "idempotency_records"
ADD CONSTRAINT "idempotency_records_request_hash_check"
CHECK ("requestHash" IS NULL OR "requestHash" ~ '^[0-9a-f]{64}$');
