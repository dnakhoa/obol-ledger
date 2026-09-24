-- How long a customer or supplier has to pay.
--
-- An aged report that counts from the invoice date is a report about how old
-- invoices are, not about who is late. On sixty-day terms — ordinary for a
-- distributor selling to builders — an invoice forty days old is not overdue,
-- and a report that files it under "31–60 days" beside the genuinely late ones
-- trains the reader to ignore the column that matters.
--
-- Terms belong to the counterparty, and a counterparty here is an open-item
-- account (see 0021): one receivable per customer is how Thông tư 200 keeps
-- 131, and how this ledger tells customers apart. So the terms are a column on
-- that account. An individual invoice can still carry its own due date in
-- `metadata.dueDate`, which wins — a sale records one, see 0027.
--
-- NULL means "not stated", and the report assumes thirty days, which is what
-- it assumed before this column existed. Zero means payment on receipt.
ALTER TABLE accounts ADD COLUMN payment_terms_days integer;

--> statement-breakpoint
-- Only something that ages can have terms, and a year is the longest credit
-- any business here extends; a larger number is a typo in a date field.
ALTER TABLE accounts ADD CONSTRAINT accounts_payment_terms_check CHECK (
  payment_terms_days IS NULL OR (open_items AND payment_terms_days BETWEEN 0 AND 365)
);
