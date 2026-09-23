import type { Category } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { ChevronRight } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getPageSession } from '@/lib/api/authed'
import { RULES_PATH } from '@/lib/finances/display'
import { loadRules } from '@/lib/finances/rules'
import { listAllCategories } from '@/lib/finances/service'
import { BackLink } from '../../_components/ui/back-link'
import { EmptyState } from '../../_components/ui/empty-state'
import { LockIllustration } from '../../_components/ui/illustrations'
import { PageHeader } from '../../_components/ui/page-header'
import { AddCategory } from './_components/add-category'
import { CategoryList, type CategoryGroup } from './_components/category-list'
import { CATEGORY_KIND_LABELS, CATEGORY_KINDS_IN_ORDER } from './_components/kinds'

export const metadata: Metadata = { title: 'Categories' }

const SECTION_LINK =
  'flex min-h-tap items-center justify-between gap-4 rounded-card border border-line bg-surface p-4 transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden md:p-6'

/** Top-level categories with whatever sits under them, in the household's own order. */
function trees(categories: Category[]): { parent: Category; children: Category[] }[] {
  return categories
    .filter(category => category.parentId === null)
    .map(parent => ({ parent, children: categories.filter(category => category.parentId === parent.id) }))
}

export default async function CategoriesPage() {
  const session = await getPageSession()
  const { role } = session.context

  if (!can(role, 'finances.view')) {
    return (
      <>
        <PageHeader title='Categories' />
        <EmptyState
          illustration={<LockIllustration />}
          title='Money is for owners and adults'
          description='Ask an owner to change your role if you need to see how spending is filed.'
        />
      </>
    )
  }

  const canManage = can(role, 'finances.manage')
  const [categories, { rules }] = await Promise.all([listAllCategories(session), loadRules(session)])

  const inUse = categories.filter(category => !category.isArchived)
  const archived = categories.filter(category => category.isArchived)
  const parents = inUse.filter(category => category.parentId === null)

  const ruleCounts: Record<string, number> = {}
  for (const rule of rules) ruleCounts[rule.categoryId] = (ruleCounts[rule.categoryId] ?? 0) + 1

  const groups: CategoryGroup[] = CATEGORY_KINDS_IN_ORDER.map(kind => ({
    id: kind,
    title: CATEGORY_KIND_LABELS[kind].many,
    trees: trees(inUse.filter(category => category.kind === kind)),
  })).filter(group => group.trees.length > 0)

  if (archived.length > 0) {
    groups.push({
      id: 'archived',
      title: 'No longer in use',
      description: 'Still on everything filed under them. Open one to bring it back.',
      trees: archived.filter(category => category.parentId === null).map(parent => ({ parent, children: [] })),
    })
    // A child whose parent is still in use has nowhere else to appear.
    const orphans = archived.filter(category => category.parentId !== null)
    groups[groups.length - 1]?.trees.push(...orphans.map(parent => ({ parent, children: [] })))
  }

  const add = canManage ? <AddCategory parents={parents} /> : null

  return (
    <>
      <BackLink href='/finances'>Money</BackLink>
      <PageHeader title='Categories' description='How spending is filed' action={add} />
      {categories.length === 0 ? (
        <EmptyState
          title='No categories yet'
          description='Ghar usually sets up a starting list when a household is made. Add the first one and everything filed from now on can go under it.'
          action={add ?? undefined}
          hint={canManage ? undefined : 'Ask an owner or another adult to add one.'}
        />
      ) : (
        <div className='flex flex-col gap-8'>
          <CategoryList groups={groups} parents={parents} ruleCounts={ruleCounts} canManage={canManage} />

          <Link href={RULES_PATH} className={SECTION_LINK}>
            <span className='min-w-0'>
              <span className='block font-medium'>Filing rules</span>
              <span className='block text-sm text-ink-muted'>
                {rules.length === 0
                  ? 'Teach Ghar to file a merchant the same way every time'
                  : `${rules.length === 1 ? 'One rule' : `${String(rules.length)} rules`} deciding where charges go before Ghar guesses`}
              </span>
            </span>
            <ChevronRight aria-hidden className='size-5 shrink-0 text-ink-muted' />
          </Link>
        </div>
      )}
    </>
  )
}
