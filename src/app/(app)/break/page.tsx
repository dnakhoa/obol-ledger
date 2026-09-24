import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { AttackLab } from '@/components/attack-lab';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import type { AttackConnection, AttackId, AttackPlan } from '@/server/services/attacks';
import { runAttackAction } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.breakIt.title, description: t.breakIt.description };
}
export const dynamic = 'force-dynamic';

/**
 * Try to break it.
 *
 * Every other page shows what the ledger holds. This one shows what it
 * refuses, which is the harder claim to believe from a screenshot — so the
 * reader fires the attacks themselves, at the same database the rest of the
 * site reads, and sees Postgres' own words come back.
 */
export default async function BreakItPage() {
  const { locale, t } = await translations();
  const copy = t.breakIt;

  let plans: AttackPlan[];
  let connection: AttackConnection;
  try {
    const { services } = await viewerServices();
    [plans, connection] = await Promise.all([
      services.attacks.plan(),
      services.attacks.connection(),
    ]);
  } catch (error) {
    if (error instanceof SetupRequiredError) {
      return <SetupNotice detail={error.message} />;
    }
    throw error;
  }

  // The catalogue is keyed in camelCase, the attacks in the kebab-case a URL
  // fragment uses; the mapping is stated once, here, rather than derived.
  const attacks: Record<AttackId, { title: string; guard: string; why: string }> = {
    unbalanced: copy.attacks.unbalanced,
    rewrite: copy.attacks.rewrite,
    erase: copy.attacks.erase,
    overdraw: copy.attacks.overdraw,
    'wrong-currency': copy.attacks.wrongCurrency,
    'reverse-twice': copy.attacks.reverseTwice,
    backdate: copy.attacks.backdate,
    plant: copy.attacks.plant,
    peek: copy.attacks.peek,
  };

  return (
    <>
      <PageHeader title={copy.title} description={copy.description} />

      <AttackLab
        plans={plans}
        connection={connection}
        locale={locale}
        run={runAttackAction}
        labels={{
          runAll: copy.runAll,
          runAgain: copy.runAgain,
          running: copy.running,
          run: copy.run,
          scoreboard: copy.scoreboard,
          scoreIdle: copy.scoreIdle,
          score: copy.score,
          breachedCount: copy.breachedCount,
          written: copy.written,
          writtenNote: copy.writtenNote,
          connection: copy.connection,
          connectionBypass: copy.connectionBypass,
          aimedAt: copy.aimedAt,
          stoppedBy: copy.stoppedBy,
          verdictRefused: copy.verdictRefused,
          verdictHeld: copy.verdictHeld,
          verdictBreached: copy.verdictBreached,
          verdictUnavailable: copy.verdictUnavailable,
          refusedIn: copy.refusedIn,
          heldIn: copy.heldIn,
          breachedNote: copy.breachedNote,
          unavailableNote: copy.unavailableNote,
          skipped: copy.skipped,
          rateLimited: copy.rateLimited,
          failed: copy.failed,
          sqlLabel: copy.sqlLabel,
          attacks,
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>{copy.howTitle}</CardTitle>
        </CardHeader>
        <CardBody className="text-ink-secondary grid gap-4 text-sm md:grid-cols-3">
          <p>{copy.howRollback}</p>
          <p>{copy.howDeferred}</p>
          <p>{copy.howExact}</p>
        </CardBody>
      </Card>
    </>
  );
}
