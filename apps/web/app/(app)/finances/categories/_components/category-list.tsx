'use client'

import type { Category } from '@ghar/contracts'
import { useState } from 'react'
import { SectionHeader } from '@/app/(app)/_components/ui/section-header'
import { Pill } from '@/components/ui/pill'
import { cn } from '@/lib/utils'
import { CategoryIcon } from './category-icon'
import { CategorySheet } from './category-sheet'

const ROW = 'flex w-full min-h-tap items-center gap-3 rounded-card border border-line bg-surface p-3 text-left md:p-4'
const TAPPABLE = 'transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'

export interface CategoryGroup {
  /** Null for the group of archived categories, which spans every kind. */
  id: string
  title: string
  description?: string
  /** Each top-level category with whatever sits under it. */
  trees: { parent: Category; children: Category[] }[]
}

/**
 * Every category the household keeps, by what it is for. A row opens the category, which is also
 * the only way to stop using one: nothing here deletes, because months of spending are filed
 * under these names.
 */
export function CategoryList({
  groups,
  parents,
  ruleCounts,
  canManage,
}: {
  groups: CategoryGroup[]
  parents: Category[]
  /** How many rules file into each category, by category id. */
  ruleCounts: Record<string, number>
  canManage: boolean
}) {
  const [editing, setEditing] = useState<Category | null>(null)

  const row = (category: Category, depth: 0 | 1) => {
    const rules = ruleCounts[category.id] ?? 0
    const body = (
      <>
        <CategoryIcon icon={category.icon} colorToken={category.colorToken} />
        <span className='min-w-0 flex-1 break-words'>{category.name}</span>
        {rules > 0 ? <Pill>{rules === 1 ? '1 rule' : `${String(rules)} rules`}</Pill> : null}
      </>
    )
    return (
      <li key={category.id} className={cn(depth === 1 && 'ps-6')}>
        {canManage ? (
          <button
            type='button'
            className={cn(ROW, TAPPABLE)}
            onClick={() => {
              setEditing(category)
            }}
          >
            {body}
            <span className='sr-only'>Edit this category</span>
          </button>
        ) : (
          <div className={ROW}>{body}</div>
        )}
      </li>
    )
  }

  return (
    <>
      {groups.map(group => (
        <section key={group.id} aria-labelledby={`categories-${group.id}`}>
          <SectionHeader id={`categories-${group.id}`} title={group.title} description={group.description} />
          <ul className='flex flex-col gap-2'>
            {group.trees.map(tree => (
              <li key={tree.parent.id}>
                <ul className='flex flex-col gap-2'>
                  {row(tree.parent, 0)}
                  {tree.children.map(child => row(child, 1))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* Keyed on the category, so the form always opens on the one that was tapped. */}
      {editing ? (
        <CategorySheet
          key={editing.id}
          category={editing}
          parents={parents}
          open
          onOpenChange={next => {
            if (!next) setEditing(null)
          }}
        />
      ) : null}
    </>
  )
}
