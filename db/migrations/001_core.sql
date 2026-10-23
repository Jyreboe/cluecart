CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY, subject text UNIQUE, email text UNIQUE NOT NULL, password_hash text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS organizations(id uuid PRIMARY KEY, name text NOT NULL, category text NOT NULL DEFAULT 'Lighting', tone text NOT NULL DEFAULT 'Warm & straightforward', store_url text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS memberships(user_id uuid REFERENCES users ON DELETE CASCADE, org_id uuid REFERENCES organizations ON DELETE CASCADE, role text NOT NULL CHECK(role IN ('owner','editor','viewer')), PRIMARY KEY(user_id,org_id));
CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS products(id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,org_id));
CREATE TABLE IF NOT EXISTS evidence_records(id uuid PRIMARY KEY, org_id uuid NOT NULL, product_id uuid NOT NULL, source_id text, content_hash text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(product_id,org_id) REFERENCES products(id,org_id) ON DELETE CASCADE, UNIQUE(product_id,content_hash), UNIQUE(product_id,source_id));
CREATE TABLE IF NOT EXISTS jobs(id uuid PRIMARY KEY, org_id uuid NOT NULL,product_id uuid NOT NULL, request_key text NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','completed','failed','cancelled')), progress integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0, error text, result jsonb, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, FOREIGN KEY(product_id,org_id) REFERENCES products(id,org_id) ON DELETE CASCADE, UNIQUE(org_id,request_key));
CREATE TABLE IF NOT EXISTS usage_events(job_id uuid PRIMARY KEY REFERENCES jobs ON DELETE CASCADE,org_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS drafts(id uuid PRIMARY KEY,org_id uuid NOT NULL,product_id uuid NOT NULL,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(product_id,org_id) REFERENCES products(id,org_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS approvals(id uuid PRIMARY KEY,org_id uuid NOT NULL,product_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users, snapshot jsonb NOT NULL,approved_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(product_id,org_id) REFERENCES products(id,org_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS outcome_observations(id uuid PRIMARY KEY,org_id uuid NOT NULL,product_id uuid NOT NULL,data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(product_id,org_id) REFERENCES products(id,org_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS audit_events(id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,user_id uuid REFERENCES users,action text NOT NULL,target_id uuid,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status,created_at);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
-- API queries always scope by authenticated org_id. RLS additionally scopes product data
-- when used from a non-owner PostgreSQL application role and SET LOCAL app.org_id.
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['products','evidence_records','jobs','drafts','approvals','outcome_observations','audit_events','usage_events'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='tenant_scope') THEN
 EXECUTE format('CREATE POLICY tenant_scope ON %I USING (org_id = nullif(current_setting(''app.org_id'',true),'''')::uuid) WITH CHECK (org_id = nullif(current_setting(''app.org_id'',true),'''')::uuid)',t); END IF;
END LOOP; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS approval_draft_once ON approvals(org_id,(snapshot->>'draftID'));
CREATE TABLE IF NOT EXISTS fact_decisions(id uuid PRIMARY KEY,org_id uuid NOT NULL,product_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users, snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(product_id,org_id) REFERENCES products(id,org_id) ON DELETE CASCADE);
ALTER TABLE fact_decisions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='fact_decisions' AND policyname='tenant_scope') THEN CREATE POLICY tenant_scope ON fact_decisions USING(org_id=nullif(current_setting('app.org_id',true),'')::uuid) WITH CHECK(org_id=nullif(current_setting('app.org_id',true),'')::uuid);END IF;END $$;
