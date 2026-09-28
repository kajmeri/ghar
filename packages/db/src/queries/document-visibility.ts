import { can } from '@ghar/core/auth'
import type { DocumentViewer } from '@ghar/core/documents'
import { eq, or, sql, type SQL } from 'drizzle-orm'
import { documents, householdPeople } from '../schema'

// Which documents someone may see, as SQL, for every query that reads documents or what links to
// them. It is the same rule as canSeeDocument in core: a sensitive document is for owners and adults
// and for the person it belongs to. Kept in one place so no list can drift from the others.

/**
 * A condition on `documents` for the documents this viewer may see, or undefined when they may see
 * them all. Add it to a query's where clause next to its household filter.
 */
export function visibleDocumentSql(viewer: DocumentViewer): SQL | undefined {
  if (can(viewer.role, 'documents.viewSensitive')) return undefined
  if (viewer.userId === null) return eq(documents.isSensitive, false)
  return or(eq(documents.isSensitive, false), ownDocumentSql(viewer.userId))
}

/** The document belongs to this account's person. A person is in one household, as the document is. */
function ownDocumentSql(userId: string): SQL {
  return sql`${documents.personId} in (select ${householdPeople.id} from ${householdPeople} where ${householdPeople.userId} = ${userId})`
}
