-- Closing the books.
--
-- Every real ledger has a line in time behind which the numbers stop moving.
-- Without one, a report is a statement about the moment it was run: last
-- quarter's revenue can change tomorrow because somebody back-dated an entry,
-- and the figure an auditor signed no longer reproduces. Closing a period is
-- what makes a financial statement a fact rather than a snapshot.
--
-- Two things happen at a close, and they are easy to conflate.
--
--   1. The period is *locked*: no entry may be dated inside it any more.
--   2. Revenue and expense are *zeroed* into retained earnings, because they
--      measure a period rather than a position. An income statement that never
--      resets is measuring since the beginning of time.
--
-- The first is enforced here, by a trigger, because it is exactly the kind of
-- rule an application forgets on the one code path nobody reviewed. The second
-- is an ordinary journal entry — it has to be, or it would not obey the
-- balance rule that makes the rest of this trustworthy.

CREATE TYPE "public"."period_status" AS ENUM('open', 'closed');

--> statement-breakpoint
CREATE TABLE accounting_periods (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  -- The first day of the month covered.
  --
  -- Monthly granularity rather than arbitrary date ranges, and that is a
  -- deliberate trade. Arbitrary ranges need an exclusion constraint
  -- (`EXCLUDE USING gist (org_id WITH =, daterange(…) WITH &&)`) to make
  -- overlapping periods unrepresentable, which needs btree_gist — not
  -- available in the embedded Postgres the test suite runs the real schema
  -- against. A schema the tests cannot execute is worth less than a coarser
  -- period, and months are what a close is scheduled on anyway.
  --
  -- With months, non-overlap is a unique constraint.
  period_month date NOT NULL,
  status period_status NOT NULL DEFAULT 'open',
  closed_at timestamptz,
  /** The entry that zeroed revenue and expense. Null while open. */
  closing_transaction_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounting_periods_org_month_key UNIQUE (org_id, period_month)
);

--> statement-breakpoint
-- A period is a month, so its marker is the first day of one. Anything else is
-- a range pretending to be a month.
ALTER TABLE accounting_periods ADD CONSTRAINT accounting_periods_month_check
  CHECK (date_trunc('month', period_month) = period_month);

--> statement-breakpoint
-- A closed period has both a timestamp and a closing entry; an open one has
-- neither. Two nullable columns can otherwise disagree with the status, and a
-- period that claims to be closed with no entry behind it is a lie the reports
-- would repeat.
ALTER TABLE accounting_periods ADD CONSTRAINT accounting_periods_closed_check
  CHECK (
    (status = 'open'   AND closed_at IS NULL     AND closing_transaction_id IS NULL)
    OR
    (status = 'closed' AND closed_at IS NOT NULL AND closing_transaction_id IS NOT NULL)
  );

--> statement-breakpoint
ALTER TABLE accounting_periods ADD CONSTRAINT accounting_periods_closing_fk
  FOREIGN KEY (closing_transaction_id) REFERENCES transactions (id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE accounting_periods ADD CONSTRAINT accounting_periods_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
CREATE INDEX accounting_periods_org_idx ON accounting_periods (org_id, period_month DESC);

--> statement-breakpoint
ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE accounting_periods FORCE  ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY accounting_periods_tenant_isolation ON accounting_periods
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
-- Retained earnings: where a period's profit goes when the period ends.
--
-- Designated by a column rather than found by name, because "Retained
-- Earnings" is a string a tenant is free to rename, translate or misspell, and
-- a closing routine that matches on it breaks silently the day somebody does.
CREATE TYPE "public"."account_role" AS ENUM('retained_earnings');

--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN role account_role;

--> statement-breakpoint
-- At most one per tenant. A partial unique index rather than an application
-- check, because two concurrent requests designating a second one is exactly
-- the race an application check loses.
CREATE UNIQUE INDEX accounts_one_retained_earnings
  ON accounts (org_id)
  WHERE role = 'retained_earnings';

--> statement-breakpoint
-- Profit accrues to the owners, so the account it lands in must be equity.
-- Posting a period's earnings into an expense account would balance and mean
-- nothing.
ALTER TABLE accounts ADD CONSTRAINT accounts_role_type_check
  CHECK (role IS NULL OR (role = 'retained_earnings' AND type = 'equity'));

--> statement-breakpoint
-- The lock itself.
--
-- Checked in the database rather than in the service because back-dating is
-- precisely the operation that arrives through an import script, a migration
-- or a psql session — the paths that never see the service. A rule enforced
-- only where it is convenient is not enforced.
CREATE OR REPLACE FUNCTION obol_reject_entry_in_closed_period() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  period accounting_periods%ROWTYPE;
BEGIN
  SELECT * INTO period
    FROM accounting_periods
   WHERE org_id = NEW.org_id
     AND period_month = date_trunc('month', NEW.occurred_at AT TIME ZONE 'UTC')::date
     AND status = 'closed';

  IF FOUND THEN
    RAISE EXCEPTION
      'period % is closed; date the correcting entry in an open period instead',
      to_char(period.period_month, 'YYYY-MM')
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

--> statement-breakpoint
-- On INSERT only. An UPDATE that settles a pending entry does not move it in
-- time — `obol_guard_transaction_mutation` already freezes `occurred_at` — so
-- checking again on every status change would cost a lookup to re-prove
-- something the other trigger guarantees.
CREATE TRIGGER transactions_reject_closed_period
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION obol_reject_entry_in_closed_period();
