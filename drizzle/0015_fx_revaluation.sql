-- Unrealized foreign exchange: retranslating what you still hold.
--
-- Realized gain and loss answers "the rate moved between booking and paying".
-- This answers the other half: the rate moved and you have *not* paid yet. A
-- 40,000 USD payable on a dong ledger is worth a different number of dong at
-- month end than it was when it was booked, and that difference is real
-- whether or not anyone has settled anything.
--
-- IAS 21 calls the items this applies to *monetary*: units of currency held,
-- or assets and liabilities to be received or paid in a fixed or determinable
-- number of units. Cash, receivables, payables, loans. They are retranslated
-- at the closing rate each reporting date and the difference goes to profit
-- or loss.
--
-- Inventory and fixed assets are *not*. The asymmetry is the most examined
-- point in the standard and it is worth stating plainly: buy stock on credit
-- in dollars, and one transaction produces two different treatments — the
-- inventory stays at the purchase-date rate forever, while the payable it
-- created moves every month end.
--
-- Our five account types cannot tell cash from inventory, so monetary-ness is
-- a property of the account rather than something derived.
--
-- See docs/adr/0012-fx-revaluation.md.

ALTER TABLE accounts ADD COLUMN monetary boolean NOT NULL DEFAULT true;

--> statement-breakpoint
-- Existing accounts: assets and liabilities are monetary by default, which is
-- right for every account in the seed and for the overwhelming majority a
-- trading company opens. The known exceptions — inventory, fixed assets —
-- are set by the chart templates, which know which is which.
UPDATE accounts SET monetary = (type IN ('asset', 'liability'));

--> statement-breakpoint
-- Only a balance-sheet item can be monetary. Revenue and expense are closed
-- out each period and never carried; equity contributions are non-monetary by
-- definition. Marking one monetary would schedule it for a retranslation that
-- has no meaning.
ALTER TABLE accounts ADD CONSTRAINT accounts_monetary_type_check
  CHECK (monetary = false OR type IN ('asset', 'liability'));

--> statement-breakpoint
-- A retranslation moves no foreign currency.
--
-- That is the whole shape of the entry: the dollars in the bank are the same
-- dollars, and only their worth in dong has changed. So the posting carries
-- `amount_minor = 0` and a non-zero `base_amount_minor`, which the sign check
-- written for ordinary postings forbade — sign(0) is 0, so it demanded a base
-- amount of zero too.
--
-- Relaxed rather than removed: when currency *does* move, both amounts must
-- still point the same way. A debit of 100 USD cannot be worth a credit of
-- 2,500,000 VND.
ALTER TABLE postings DROP CONSTRAINT postings_base_sign_check;

--> statement-breakpoint
ALTER TABLE postings ADD CONSTRAINT postings_base_sign_check
  CHECK (amount_minor = 0 OR sign(base_amount_minor) = sign(amount_minor));

--> statement-breakpoint
-- But a posting must still record *something*. Both amounts zero is a line
-- that says nothing, and the double-entry rule would happily let a pair of
-- them balance.
ALTER TABLE postings ADD CONSTRAINT postings_records_something_check
  CHECK (amount_minor <> 0 OR base_amount_minor <> 0);

--> statement-breakpoint
-- A period remembers whether it has been retranslated, and with what.
--
-- On the period rather than inferred from entry metadata, because the close
-- has to *refuse* without it and a gate that depends on a search is a gate
-- that opens when the search is wrong.
ALTER TABLE accounting_periods ADD COLUMN revalued_at timestamptz;
--> statement-breakpoint
ALTER TABLE accounting_periods ADD COLUMN revaluation_transaction_id text;

--> statement-breakpoint
ALTER TABLE accounting_periods ADD CONSTRAINT accounting_periods_revaluation_fk
  FOREIGN KEY (revaluation_transaction_id) REFERENCES transactions (id) ON DELETE restrict;

--> statement-breakpoint
-- An entry implies a timestamp, but not the other way round.
--
-- "We retranslated and nothing had moved" is a real outcome and a different
-- state from "nobody retranslated" — the close gate has to tell them apart,
-- and a month with no foreign balances at all would otherwise be unclosable.
-- So a timestamp may stand alone; an entry without one may not.
ALTER TABLE accounting_periods ADD CONSTRAINT accounting_periods_revaluation_check
  CHECK (revaluation_transaction_id IS NULL OR revalued_at IS NOT NULL);

--> statement-breakpoint
-- A column default cannot depend on another column, and `monetary` defaults
-- to true — which the CHECK above forbids on a revenue or expense account.
-- So any insert that does not mention the column would fail on exactly the
-- accounts where the flag is meaningless.
--
-- This trigger only ever *clears* the flag, and only for the types that
-- cannot carry it. An asset or liability keeps whatever was supplied, so
-- inventory can still be marked non-monetary deliberately while cash defaults
-- to being retranslated — which is the conservative direction: an account
-- wrongly included shows up in the revaluation preview, where a person sees
-- it, and one wrongly excluded is silent.
CREATE OR REPLACE FUNCTION obol_normalise_account_monetary() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type NOT IN ('asset', 'liability') THEN
    NEW.monetary := false;
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER accounts_normalise_monetary
  BEFORE INSERT OR UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION obol_normalise_account_monetary();
