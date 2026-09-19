import { Money } from './money';
import { Table, TableScroll, Td, Th, Tr } from './ui/table';
import type { StatementSection } from '@/server/services/dto';

/**
 * One section of a financial statement.
 *
 * Statements are read by scanning a column of figures for the one that looks
 * wrong, so the amounts are right-aligned with tabular numerals and the totals
 * are separated by a rule rather than by weight alone — a bold row is easy to
 * miss when every row is the same shape.
 *
 * Accounts with a zero balance are kept rather than filtered. Their absence
 * would be indistinguishable from the account not existing, and "we spent
 * nothing on this" is information.
 */
export function StatementSectionTable({
  section,
  emphasis = false,
}: {
  section: StatementSection;
  emphasis?: boolean;
}) {
  return (
    <TableScroll>
      <Table caption={`${section.label} by account`}>
        <thead>
          <tr>
            <Th>{section.label}</Th>
            <Th align="right">Amount</Th>
          </tr>
        </thead>
        <tbody>
          {section.lines.length === 0 ? (
            <tr>
              <Td colSpan={2} className="text-ink-muted text-xs">
                No {section.label.toLowerCase()} accounts in this currency.
              </Td>
            </tr>
          ) : (
            section.lines.map((line) => (
              <Tr key={line.accountId}>
                <Td>{line.accountName}</Td>
                <Td align="right" numeric>
                  <Money value={line.amount} />
                </Td>
              </Tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <Td className={emphasis ? 'font-semibold' : 'font-medium'}>Total {section.label}</Td>
            <Td align="right" numeric className={emphasis ? 'font-semibold' : 'font-medium'}>
              <Money value={section.total} />
            </Td>
          </tr>
        </tfoot>
      </Table>
    </TableScroll>
  );
}
