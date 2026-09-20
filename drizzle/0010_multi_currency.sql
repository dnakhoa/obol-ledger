-- An entry balances in the functional currency, not in each currency.
--
-- Until now a multi-currency entry was unrepresentable, and deliberately: the
-- composite foreign key to (transaction_id, currency) meant every posting held
-- its entry's currency, so nothing could pay a USD supplier from a VND bank
-- account. That floor was right while the alternative was a half-built FX
-- model. It is wrong for a business whose every interesting entry crosses
-- currencies.
--
-- Across currencies, "sums to zero" needs a unit. Accounting's answer is the
-- functional currency: the one the books are kept in. Every posting carries
-- two amounts — what moved, in the account's currency, and what it was worth,
-- in the functional currency — and the invariant applies to the second.
--
-- See docs/adr/0010-multi-currency.md.

ALTER TABLE organizations ADD COLUMN functional_currency char(3) NOT NULL DEFAULT 'USD';

--> statement-breakpoint
ALTER TABLE organizations ADD CONSTRAINT organizations_functional_currency_check
  CHECK (functional_currency ~ '^[A-Z]{3}$');

--> statement-breakpoint
-- What the posting was worth in the organisation's functional currency.
--
-- Supplied, never computed here. Rate multiplication is where FX models rot: a
-- rate is a decimal, an amount is an integer, and the product must be rounded.
-- Round each leg independently and the entry stops summing to zero — not
-- always, just often enough that it arrives in production as a trial balance
-- off by one cent that nobody can attribute. Where that cent goes is an
-- accounting policy, not arithmetic, so the core stays exact and the
-- convenience layer that multiplies sits above it in the service.
ALTER TABLE postings ADD COLUMN base_amount_minor bigint;

--> statement-breakpoint
-- The rate used, for audit. Numeric, not float: at 1 USD = 25,470.5 VND a
-- double has already lost the tenth of a dong, and a rate wrong in the tenth
-- place is wrong by a dollar on a hundred thousand. Nothing checks against it.
ALTER TABLE postings ADD COLUMN fx_rate numeric(20, 10);

--> statement-breakpoint
-- Backfill, and refuse to guess.
--
-- A posting whose account is already in the functional currency was worth
-- exactly what it says, at a rate of one. A posting in any other currency has
-- a historical rate that cannot be invented, and a migration that invents one
-- produces a ledger that balances and lies — so this raises instead.
DO $$
DECLARE
  ambiguous integer;
BEGIN
  SELECT count(*) INTO ambiguous
    FROM postings p
    JOIN organizations o ON o.id = p.org_id
   WHERE p.currency <> o.functional_currency;

  IF ambiguous > 0 THEN
    RAISE EXCEPTION
      '% posting(s) are denominated in a currency other than their organisation''s functional currency. Their historical exchange rates cannot be reconstructed; backfill base_amount_minor deliberately before running this migration.',
      ambiguous
      USING ERRCODE = 'data_exception';
  END IF;
END
$$;

--> statement-breakpoint
-- The append-only trigger has to come off for the backfill.
--
-- This is the third migration to meet this, and the first two learned it in
-- production: the schema is green on an empty CI database and fails on a
-- populated one, because there is nothing to backfill until there is. The
-- trigger exists to protect the ledger from the application; a backfill that
-- adds a column's value to rows that already exist is neither.
--
-- Disabled rather than dropped, because unlike the two-phase migration this
-- one is not replacing it.
ALTER TABLE postings DISABLE TRIGGER postings_append_only;

--> statement-breakpoint
UPDATE postings SET base_amount_minor = amount_minor, fx_rate = 1
 WHERE base_amount_minor IS NULL;

--> statement-breakpoint
ALTER TABLE postings ENABLE TRIGGER postings_append_only;

--> statement-breakpoint
ALTER TABLE postings ALTER COLUMN base_amount_minor SET NOT NULL;
--> statement-breakpoint
ALTER TABLE postings ALTER COLUMN fx_rate SET NOT NULL;

--> statement-breakpoint
-- A rate is a positive number. Zero would make every foreign amount worthless
-- and negative is not a thing a rate can be.
ALTER TABLE postings ADD CONSTRAINT postings_fx_rate_check CHECK (fx_rate > 0);

--> statement-breakpoint
-- Both amounts move in the same direction, or one of them is describing the
-- opposite transaction. A debit of 100 USD cannot be worth a credit of
-- 2,500,000 VND.
ALTER TABLE postings ADD CONSTRAINT postings_base_sign_check
  CHECK (sign(base_amount_minor) = sign(amount_minor));

--> statement-breakpoint
-- The constraint that made a cross-currency entry unrepresentable.
--
-- (account_id, currency) stays: a posting still cannot be denominated in a
-- currency its account does not hold, which was never the thing in the way.
ALTER TABLE postings DROP CONSTRAINT postings_transaction_currency_fk;

--> statement-breakpoint
-- The balance rule, restated in the functional currency.
--
-- Still a DEFERRABLE INITIALLY DEFERRED constraint trigger, so it runs once at
-- COMMIT when every posting of the entry is present — checking per row would
-- reject the first line of every entry ever written.
CREATE OR REPLACE FUNCTION obol_assert_transaction_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  residual   bigint;
  line_count integer;
BEGIN
  SELECT COALESCE(SUM(base_amount_minor), 0), COUNT(*)
    INTO residual, line_count
    FROM postings
   WHERE transaction_id = NEW.transaction_id;

  -- The entry was rolled back or never completed; nothing to assert.
  IF line_count = 0 THEN
    RETURN NULL;
  END IF;

  IF line_count < 2 THEN
    RAISE EXCEPTION
      'transaction % has % posting(s); double-entry requires at least two',
      NEW.transaction_id, line_count
      USING ERRCODE = 'check_violation';
  END IF;

  IF residual <> 0 THEN
    RAISE EXCEPTION
      'transaction % is unbalanced by % minor units of the functional currency',
      NEW.transaction_id, residual
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

--> statement-breakpoint
-- Rates, as point-in-time facts.
--
-- Never updated. A rate that changes is a new row with a later `as_of`, and a
-- lookup asks for the most recent one at or before the entry's date — so
-- re-running last quarter's reports uses last quarter's rates, which is the
-- only way a restated figure can be explained.
CREATE TABLE exchange_rates (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  base_currency char(3) NOT NULL,
  quote_currency char(3) NOT NULL,
  /** One unit of base is worth this many of quote. */
  rate numeric(20, 10) NOT NULL,
  as_of date NOT NULL,
  /** Where it came from: a provider, a contract, a customs declaration. */
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exchange_rates_rate_check CHECK (rate > 0),
  CONSTRAINT exchange_rates_pair_check CHECK (base_currency <> quote_currency),
  CONSTRAINT exchange_rates_currency_check
    CHECK (base_currency ~ '^[A-Z]{3}$' AND quote_currency ~ '^[A-Z]{3}$'),
  -- One rate per pair per day per source. Two rows claiming a different rate
  -- for the same pair on the same day from the same source is a data error,
  -- and letting both exist means every lookup picks arbitrarily.
  CONSTRAINT exchange_rates_unique_key UNIQUE (org_id, base_currency, quote_currency, as_of, source)
);

--> statement-breakpoint
-- The lookup's index: the pair, then the most recent date at or before a given
-- one, which is a backwards scan of exactly this key.
CREATE INDEX exchange_rates_lookup_idx
  ON exchange_rates (org_id, base_currency, quote_currency, as_of DESC);

--> statement-breakpoint
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE exchange_rates FORCE  ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY exchange_rates_tenant_isolation ON exchange_rates
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
-- The account's balance, also in the functional currency.
--
-- Without it the trial balance has nothing to sum. `balance_minor` is in the
-- account's own currency, and adding a dong balance to a dollar balance
-- produces a number with no meaning — it only ever looked right because every
-- account was USD.
ALTER TABLE accounts ADD COLUMN base_balance_minor bigint NOT NULL DEFAULT 0;

--> statement-breakpoint
-- Valid because the migration already refused to proceed if any posting was
-- denominated outside its organisation's functional currency.
UPDATE accounts SET base_balance_minor = balance_minor;

--> statement-breakpoint
-- The same trigger maintains both, so they cannot drift apart. Pending
-- inflow and outflow stay in the account's own currency: the available
-- balance is a statement about that account, and a dong account's spendable
-- balance is a number of dong.
CREATE OR REPLACE FUNCTION obol_apply_posting_to_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry_status transaction_status;
  presented    bigint;
BEGIN
  SELECT status INTO entry_status FROM transactions WHERE id = NEW.transaction_id;

  IF entry_status = 'posted' THEN
    UPDATE accounts
       SET balance_minor      = balance_minor + NEW.amount_minor,
           base_balance_minor = base_balance_minor + NEW.base_amount_minor,
           version            = version + 1,
           updated_at         = now()
     WHERE id = NEW.account_id;
    RETURN NULL;
  END IF;

  IF entry_status = 'pending' THEN
    SELECT obol_presented_sign(a.type) * NEW.amount_minor INTO presented
      FROM accounts a WHERE a.id = NEW.account_id;

    UPDATE accounts
       SET pending_inflow_minor  = pending_inflow_minor  + GREATEST(presented, 0),
           pending_outflow_minor = pending_outflow_minor + GREATEST(-presented, 0),
           version               = version + 1,
           updated_at            = now()
     WHERE id = NEW.account_id;
  END IF;

  -- An archived entry moves nothing.
  RETURN NULL;
END;
$$;

--> statement-breakpoint
-- Settling a pending entry moves both balances too, for the same reason.
CREATE OR REPLACE FUNCTION obol_apply_status_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line RECORD;
  presented bigint;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NULL;
  END IF;

  FOR line IN
    SELECT p.account_id, p.amount_minor, p.base_amount_minor,
           obol_presented_sign(a.type) AS sign
      FROM postings p JOIN accounts a ON a.id = p.account_id
     WHERE p.transaction_id = NEW.id
  LOOP
    presented := line.sign * line.amount_minor;

    -- Leaving pending always releases the reservation.
    IF OLD.status = 'pending' THEN
      UPDATE accounts
         SET pending_inflow_minor  = pending_inflow_minor  - GREATEST(presented, 0),
             pending_outflow_minor = pending_outflow_minor - GREATEST(-presented, 0)
       WHERE id = line.account_id;
    END IF;

    -- Becoming posted settles it, in both units.
    IF NEW.status = 'posted' THEN
      UPDATE accounts
         SET balance_minor      = balance_minor + line.amount_minor,
             base_balance_minor = base_balance_minor + line.base_amount_minor
       WHERE id = line.account_id;
    END IF;

    UPDATE accounts SET version = version + 1, updated_at = now() WHERE id = line.account_id;
  END LOOP;

  RETURN NULL;
END;
$$;
