-- Vietnam's second statutory chart: Thông tư 133/2016/TT-BTC.
--
-- Thông tư 200 is the chart for large enterprises. Most small and medium
-- ones — which is to say most importers, exporters and distributors — keep
-- their books under 133 instead: a shorter chart, with no 521 (returns and
-- discounts come straight off 511), and selling and administrative expense
-- as two halves of one 642 (6421 and 6422) rather than 641 and 642.
--
-- It is statutory in exactly the way 200 is. The codes are prescribed, and
-- the leading digit is the account class under the same scheme, so the same
-- CHECK applies — widened to cover both circulars rather than duplicated, so
-- a rule fixed for one cannot drift from the other. See ADR 11.

ALTER TABLE organizations DROP CONSTRAINT organizations_chart_template_check;

--> statement-breakpoint
ALTER TABLE organizations ADD CONSTRAINT organizations_chart_template_check
  CHECK (chart_template IN ('generic', 'au_nz', 'us_gaap', 'jp', 'vn_tt200', 'vn_tt133'));

--> statement-breakpoint
ALTER TABLE accounts DROP CONSTRAINT accounts_statutory_code_check;

--> statement-breakpoint
ALTER TABLE accounts ADD CONSTRAINT accounts_statutory_code_check CHECK (
  chart_template NOT IN ('vn_tt200', 'vn_tt133')
  OR (
    code IS NOT NULL
    AND (
      (left(code, 1) IN ('1', '2') AND type = 'asset')
      OR (left(code, 1) = '3' AND type = 'liability')
      OR (left(code, 1) = '4' AND type = 'equity')
      OR (left(code, 1) IN ('5', '7') AND type = 'revenue')
      OR (left(code, 1) IN ('6', '8') AND type = 'expense')
    )
  )
);
