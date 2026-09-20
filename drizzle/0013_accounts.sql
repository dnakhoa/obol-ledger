-- People, and the ledgers they are allowed to touch.
--
-- Until now the deployment had exactly one identity — a demo tenant whose
-- dashboard accepted writes from anyone. That is a fine way to let a stranger
-- see the thing work and a bad way to let them keep books in it.
--
-- Two concerns, deliberately kept apart.
--
-- **Authentication** — proving who is at the keyboard — is delegated to a
-- library. It is the one part of a system where inventing something is
-- negative signal: the failure modes are subtle, the attacks are well funded,
-- and nothing about this project is improved by a hand-rolled session cookie.
--
-- **Authorisation** — which ledger that person may read and write — stays
-- here, in the database, because that is where every other rule in this
-- project lives. A membership row is what turns a session into an `org_id`,
-- and the row-level security policies that already exist do the rest.
--
-- The auth tables carry no policy, for the same reason `api_keys` does not:
-- resolving a session happens *before* a tenant is known, so a policy keyed
-- on `app.current_org` would be circular.

CREATE TABLE "user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE TABLE "session" (
  id text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE
);

--> statement-breakpoint
-- Sessions are swept by expiry, and read by token on every request.
CREATE INDEX session_user_idx ON "session" ("userId");
--> statement-breakpoint
CREATE INDEX session_expires_idx ON "session" ("expiresAt");

--> statement-breakpoint
CREATE TABLE "account" (
  id text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
-- One link per provider identity. Without this, two sign-ins racing on a first
-- login create two rows and the second one wins arbitrarily.
CREATE UNIQUE INDEX account_provider_key ON "account" ("providerId", "accountId");
--> statement-breakpoint
CREATE INDEX account_user_idx ON "account" ("userId");

--> statement-breakpoint
CREATE TABLE "verification" (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE INDEX verification_identifier_idx ON "verification" (identifier);

--> statement-breakpoint
-- The join that authorises.
--
-- Deliberately this project's own table rather than the auth library's
-- organisation plugin. `organizations` already exists and every row-level
-- security policy in the schema keys off its id; a second organisation table
-- would mean two sources of truth for the one question that matters, and the
-- policies would follow whichever the application happened to consult.
CREATE TABLE memberships (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_user_org_key UNIQUE (user_id, org_id),
  CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'member', 'viewer'))
);

--> statement-breakpoint
CREATE INDEX memberships_user_idx ON memberships (user_id, created_at);

--> statement-breakpoint
-- The published demo, marked rather than matched by slug.
--
-- The dashboard needs to know which ledger a signed-out visitor may read, and
-- deciding that by comparing a slug to a string in an environment variable is
-- how a tenant becomes publicly readable by renaming itself.
ALTER TABLE organizations ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

--> statement-breakpoint
-- At most one, so "the demo" is never ambiguous.
CREATE UNIQUE INDEX organizations_one_demo ON organizations ((true)) WHERE is_demo;
