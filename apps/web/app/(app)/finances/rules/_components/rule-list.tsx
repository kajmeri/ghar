'use client'

import { deleteCategoryRule, type CategoryRule } from '@ghar/contracts'
import { DeleteButton } from '@/app/(app)/_components/ui/delete-button'
import { api } from '@/lib/api/client'
import { ruleHits, ruleSentence } from '@/lib/finances/display'

/**
 * Every rule, in the order they run. A rule is a small, whole thing: it is made, and it is taken
 * away. Nothing here edits one, because changing a rule's merchant is a different rule — and
 * saving the same merchant again points the existing rule at the new category.
 */
export function RuleList({ rules, currency, canManage }: { rules: CategoryRule[]; currency: string; canManage: boolean }) {
  return (
    <ul className='flex flex-col gap-2'>
      {rules.map(rule => (
        <li key={rule.id} className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-center'>
          <div className='min-w-0 flex-1'>
            <p className='break-words'>
              {ruleSentence(rule, currency)} <span className='text-ink-muted'>is filed as</span> {rule.categoryName}
            </p>
            <p className='text-sm text-ink-muted'>{ruleHits(rule.hitCount)}</p>
          </div>
          {canManage ? (
            <DeleteButton
              label='Delete'
              accessibleLabel={`Delete the rule for ${ruleSentence(rule, currency).toLowerCase()}`}
              title='Delete this rule?'
              description='Charges it has already filed keep their category. New ones go back to being worked out by Ghar.'
              onDelete={() => api.request(deleteCategoryRule, { params: { ruleId: rule.id } })}
            />
          ) : null}
        </li>
      ))}
    </ul>
  )
}
