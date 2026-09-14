import { can } from '@ghar/core/auth';
import type { Metadata } from 'next';
import { Button } from '@/components/ui/button';
import { getPageContext } from '@/lib/auth/context';
import { EmptyState } from '../_components/ui/empty-state';
import { DocumentIllustration } from '../_components/ui/illustrations';
import { PageHeader } from '../_components/ui/page-header';

export const metadata: Metadata = { title: 'Documents' };

export default async function DocumentsPage() {
  const { ctx } = await getPageContext();

  return (
    <>
      <PageHeader title="Documents" description="Passports, policies and warranties" />
      {can(ctx.role, 'documents.manage') ? (
        <EmptyState
          illustration={<DocumentIllustration />}
          title="Keep important papers in one place"
          description="Add passports, insurance policies and warranties and Ghar reminds you before anything expires."
          action={<Button disabled>Add a document</Button>}
          hint="Uploads arrive in a later update."
        />
      ) : (
        <EmptyState
          illustration={<DocumentIllustration />}
          title="No documents yet"
          description="Ask an adult in your household to add the papers you need, and they show up here."
        />
      )}
    </>
  );
}
