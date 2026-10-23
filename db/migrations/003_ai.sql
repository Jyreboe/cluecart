ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_consent boolean NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_consent_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS provider_started_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS retryable boolean NOT NULL DEFAULT true;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS evidence_revision integer NOT NULL DEFAULT 0;
