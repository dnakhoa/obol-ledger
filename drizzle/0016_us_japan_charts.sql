-- Two more conventional charts: the United States and Japan.
--
-- Both are conventions rather than law — no US authority prescribes account
-- numbers, and Japan's rules prescribe the shape of the statements rather
-- than a numbered list of accounts. Neither gets a digit constraint; only
-- Vietnam's Thông tư 200 has one, and that remains the point of the
-- distinction.
--
-- The structural difference between them is the tax treatment, and it is the
-- reason both are worth shipping rather than one generic chart:
--
--   * US sales tax is collected and remitted and *never reclaimed*. The chart
--     carries a Sales Tax Payable and deliberately no input-tax asset — a
--     business given one would accumulate a receivable from the state that
--     does not exist.
--   * Japanese consumption tax is reclaimable, like VAT. The chart carries
--     both halves, 仮払消費税 paid and 仮受消費税 collected, and the return is
--     the net of the two.
--
-- See docs/adr/0011-chart-of-accounts.md.

ALTER TABLE organizations DROP CONSTRAINT organizations_chart_template_check;

--> statement-breakpoint
ALTER TABLE organizations ADD CONSTRAINT organizations_chart_template_check
  CHECK (chart_template IN ('generic', 'au_nz', 'us_gaap', 'jp', 'vn_tt200'));
