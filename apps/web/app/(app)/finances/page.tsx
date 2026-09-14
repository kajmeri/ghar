import { can } from '@ghar/core/auth';
import type { Metadata } from 'next';
import { Button } from '@/components/ui/button';
import { getPageContext } from '@/lib/auth/context';
import { EmptyState } from '../_components/ui/empty-state';
import { LockIllustration, WalletIllustration } from '../_components/ui/illustrations';
import { PageHeader } from '../_components/ui/page-header';

export const metadata: Metadata = { title: 'Money' };

export default async function FinancesPage() {
  const { ctx } = await getPageContext();

  if (!can(ctx.role, 'finances.view')) {
    return (
      <>
        <PageHeader title="Money" />
        <EmptyState
          illustration={<LockIllustration />}
          title="Money is for owners and adults"
          description="Ask an owner to change your role if you need to see accounts and budgets."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Money" description="Accounts, spending and budgets" />
      {can(ctx.role, 'connections.manage') ? (
        <EmptyState
          illustration={<WalletIllustration />}
          title="Connect a bank to see your money"
          description="Link your checking and credit card accounts and Ghar keeps balances, spending and budgets up to date on its own."
          action={<Button disabled>Connect a bank account</Button>}
          hint="Bank connections arrive in a later update."
        />
      ) : (
        <EmptyState
          illustration={<WalletIllustration />}
          title="No bank accounts connected yet"
          description="Ask an owner to connect your bank accounts, and balances, spending and budgets show up here."
        />
      )}
    </>
  );
}
