import { randomUUID } from 'node:crypto'
import { billDueDates, type BillCadence } from '@ghar/core/bills'
import { allDayRange, type EventCategory, type EventColorToken } from '@ghar/core/calendar'
import { addCalendarDays, addCalendarMonths, instantInTimeZone, type CalendarDate } from '@ghar/core/dates'
import { documentStoragePath, type DocumentKind } from '@ghar/core/documents'
import type { AssetKind } from '@ghar/core/home'
import type { Database } from '@ghar/db'
import * as queries from '@ghar/db/queries'
import type { RequestContext } from '@ghar/db/queries'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DOCUMENTS_BUCKET } from '@/lib/providers/storage/supabase'

// The household's records: the people it calls, what it owns and looks after, its paperwork, its
// bills and its calendar, plus the categories, budget and goals behind money. Each section is
// written once, into an empty table, so running the seed again never doubles anything and never
// touches what someone has since added by hand.

export interface RecordsSeedInput {
  owner: RequestContext
  adult: RequestContext
  timeZone: string
  today: CalendarDate
  supabase: SupabaseClient
}

/** One line per section, for the seed's summary. */
export async function ensureHouseholdRecords(db: Database, input: RecordsSeedInput): Promise<string[]> {
  const contacts = await ensureContacts(db, input)
  const assets = await ensureAssets(db, input)
  const documents = await ensureDocuments(db, input, assets.ids)
  const maintenance = await ensureMaintenance(db, input, assets.ids, contacts.ids, documents.ids)
  return [
    contacts.summary,
    assets.summary,
    documents.summary,
    maintenance,
    await ensureBills(db, input),
    await ensureEvents(db, input),
    await ensureMoneySetup(db, input),
    await ensureDigestPreferences(db, input),
  ]
}

type Named = Map<string, string>

function skipped(what: string): string {
  return `${what}: already there, left alone`
}

// Contacts

const CONTACTS: queries.ContactInput[] = [
  { name: 'Dana Okafor', role: 'Plumber', phone: '(914) 555-0142', email: 'dana@okaforplumbing.test', url: null, notes: 'Fixed the basement shutoff in 2025. Ask for Dana, not the dispatcher.', tags: ['home', 'emergency'] },
  { name: 'Brightline Electric', role: 'Electrician', phone: '(914) 555-0188', email: null, url: 'https://brightline-electric.test', notes: null, tags: ['home'] },
  { name: 'Northside Heating & Air', role: 'HVAC', phone: '(914) 555-0107', email: 'service@northsidehvac.test', url: 'https://northsidehvac.test', notes: 'Annual furnace tune-up contract. Account #NH-22817.', tags: ['home'] },
  { name: 'Dr. Priya Raman', role: 'Pediatrician', phone: '(914) 555-0171', email: null, url: 'https://westchesterpeds.test', notes: 'After-hours line goes to the on-call nurse.', tags: ['health', 'kids'] },
  { name: 'Hudson Family Dental', role: 'Dentist', phone: '(914) 555-0125', email: 'frontdesk@hudsondental.test', url: null, notes: null, tags: ['health'] },
  { name: 'Marcus Webb', role: 'Insurance agent', phone: '(914) 555-0163', email: 'mwebb@keystoneins.test', url: null, notes: 'Home and both cars. Renewal every March.', tags: ['insurance'] },
  { name: 'Riverbend Animal Hospital', role: 'Vet', phone: '(914) 555-0199', email: null, url: 'https://riverbendvet.test', notes: 'Biscuit is due for boosters in the spring.', tags: ['pets', 'health'] },
  { name: 'Green Acre Lawn Care', role: 'Landscaper', phone: '(914) 555-0134', email: null, url: null, notes: 'Mows every other Thursday, April to October.', tags: ['home'] },
  { name: 'Maya Chen', role: 'Babysitter', phone: '(914) 555-0112', email: 'maya.chen@example.test', url: null, notes: 'Free most Friday nights. $22 an hour.', tags: ['kids'] },
  { name: 'Liu & Partners CPA', role: 'Accountant', phone: '(212) 555-0150', email: 'tax@liupartners.test', url: 'https://liupartners.test', notes: 'Sends the organizer in January.', tags: ['money'] },
]

async function ensureContacts(db: Database, { owner }: RecordsSeedInput): Promise<{ ids: Named; summary: string }> {
  const existing = await queries.listContacts(owner, db)
  const ids: Named = new Map(existing.map(contact => [contact.name, contact.id]))
  if (existing.length > 0) return { ids, summary: skipped('Contacts') }
  for (const contact of CONTACTS) ids.set(contact.name, (await queries.createContact(owner, db, contact)).id)
  return { ids, summary: `Contacts: ${String(CONTACTS.length)}` }
}

// Assets

interface DemoAsset {
  name: string
  kind: AssetKind
  make: string | null
  model: string | null
  serialNumber: string | null
  /** Months before today it was bought. */
  boughtMonthsAgo: number | null
  purchasePriceCents: number | null
  /** Days from today the warranty runs out. Negative has already run out. */
  warrantyDays: number | null
  location: string | null
  notes: string | null
}

const ASSETS: DemoAsset[] = [
  { name: 'Honda CR-V', kind: 'vehicle', make: 'Honda', model: 'CR-V EX-L 2022', serialNumber: '7FARW2H85NE018842', boughtMonthsAgo: 44, purchasePriceCents: 3_415_000, warrantyDays: 400, location: 'Garage', notes: 'Plate NY KRV-2291. Oil every 6 months or 5,000 miles.' },
  { name: 'Furnace', kind: 'system', make: 'Carrier', model: 'Infinity 59MN7', serialNumber: '2419A51872', boughtMonthsAgo: 70, purchasePriceCents: 640_000, warrantyDays: 1500, location: 'Basement', notes: 'Filter is 16x25x4, MERV 11.' },
  { name: 'Water heater', kind: 'system', make: 'Rheem', model: 'Performance Plus 50 gal', serialNumber: 'Q121904311', boughtMonthsAgo: 98, purchasePriceCents: 185_000, warrantyDays: -40, location: 'Basement', notes: 'Getting old. Start pricing a replacement.' },
  { name: 'Refrigerator', kind: 'appliance', make: 'LG', model: 'LRMVS3006S', serialNumber: '305KRCK0M552', boughtMonthsAgo: 34, purchasePriceCents: 279_900, warrantyDays: 25, location: 'Kitchen', notes: 'Extended warranty through Best Buy. Water filter LT1000P.' },
  { name: 'Dishwasher', kind: 'appliance', make: 'Bosch', model: '500 Series SHPM65Z55N', serialNumber: 'FD9912 00471', boughtMonthsAgo: 20, purchasePriceCents: 109_900, warrantyDays: 150, location: 'Kitchen', notes: null },
  { name: 'Washer', kind: 'appliance', make: 'Whirlpool', model: 'WFW6620HW', serialNumber: 'C92203415', boughtMonthsAgo: 52, purchasePriceCents: 94_900, warrantyDays: null, location: 'Laundry room', notes: null },
  { name: 'Dryer', kind: 'appliance', make: 'Whirlpool', model: 'WED6620HW', serialNumber: 'C92203980', boughtMonthsAgo: 52, purchasePriceCents: 89_900, warrantyDays: null, location: 'Laundry room', notes: 'Vent runs 18 ft to the side of the house.' },
  { name: 'Roof', kind: 'property', make: 'GAF', model: 'Timberline HDZ', serialNumber: null, boughtMonthsAgo: 110, purchasePriceCents: 1_420_000, warrantyDays: 5000, location: null, notes: 'Installed by Summit Roofing. Workmanship warranty is transferable.' },
  { name: 'Family laptop', kind: 'electronics', make: 'Apple', model: 'MacBook Air 13" M3', serialNumber: 'C02FK1XYQ6L4', boughtMonthsAgo: 11, purchasePriceCents: 129_900, warrantyDays: 30, location: 'Office', notes: 'AppleCare+ ends soon. Decide whether to renew.' },
]

async function ensureAssets(db: Database, { owner, today }: RecordsSeedInput): Promise<{ ids: Named; summary: string }> {
  const existing = await queries.listAssets(owner, db)
  const ids: Named = new Map(existing.map(asset => [asset.name, asset.id]))
  if (existing.length > 0) return { ids, summary: skipped('House assets') }
  for (const { boughtMonthsAgo, warrantyDays, ...asset } of ASSETS) {
    const created = await queries.createAsset(owner, db, {
      ...asset,
      purchasedOn: boughtMonthsAgo === null ? null : addCalendarMonths(today, -boughtMonthsAgo),
      warrantyExpiresOn: warrantyDays === null ? null : addCalendarDays(today, warrantyDays),
    })
    ids.set(asset.name, created.id)
  }
  return { ids, summary: `House assets: ${String(ASSETS.length)}, with warranties expired, running out and fine` }
}

// Documents

interface DemoDocument {
  title: string
  kind: DocumentKind
  issuedDaysAgo: number | null
  /** Days from today it expires. Negative has already expired. */
  expiresDays: number | null
  issuer: string | null
  referenceNumber: string | null
  asset: string | null
  notes: string | null
  isSensitive: boolean
}

const DOCUMENTS: DemoDocument[] = [
  { title: 'Homeowners insurance policy', kind: 'insurance', issuedDaysAgo: 320, expiresDays: 45, issuer: 'Keystone Mutual', referenceNumber: 'HO3-4418207', asset: null, notes: 'Renews automatically. Marcus sends the new declarations page.', isSensitive: false },
  { title: 'Auto insurance card', kind: 'insurance', issuedDaysAgo: 100, expiresDays: 83, issuer: 'Keystone Mutual', referenceNumber: 'PA-9920114', asset: 'Honda CR-V', notes: null, isSensitive: false },
  { title: 'Passport, Alex', kind: 'id', issuedDaysAgo: 3400, expiresDays: 160, issuer: 'U.S. Department of State', referenceNumber: 'Ending 4812', asset: null, notes: 'Renew before any international trip. Many countries want six months left.', isSensitive: true },
  { title: 'Passport, Sam', kind: 'id', issuedDaysAgo: 3640, expiresDays: -12, issuer: 'U.S. Department of State', referenceNumber: 'Ending 0447', asset: null, notes: 'Expired. Renewal form DS-82 is on the desk.', isSensitive: true },
  { title: '2025 federal tax return', kind: 'tax', issuedDaysAgo: 150, expiresDays: null, issuer: 'Liu & Partners CPA', referenceNumber: null, asset: null, notes: 'Filed jointly, refund received in May.', isSensitive: true },
  { title: 'Refrigerator extended warranty', kind: 'warranty', issuedDaysAgo: 1030, expiresDays: 25, issuer: 'Best Buy Protection', referenceNumber: 'GS-77310045', asset: 'Refrigerator', notes: null, isSensitive: false },
  { title: 'Furnace install invoice', kind: 'warranty', issuedDaysAgo: 2120, expiresDays: 1500, issuer: 'Northside Heating & Air', referenceNumber: 'INV-10442', asset: 'Furnace', notes: 'Ten-year parts warranty, registered with Carrier.', isSensitive: false },
  { title: 'Vaccination record, Leo', kind: 'medical', issuedDaysAgo: 60, expiresDays: null, issuer: 'Westchester Pediatrics', referenceNumber: null, asset: null, notes: 'School asks for this every fall.', isSensitive: true },
  { title: 'Property deed', kind: 'property', issuedDaysAgo: 2900, expiresDays: null, issuer: 'Westchester County Clerk', referenceNumber: 'Liber 13022 Page 118', asset: null, notes: null, isSensitive: false },
  { title: 'Wills and healthcare proxies', kind: 'legal', issuedDaysAgo: 700, expiresDays: null, issuer: 'Harmon & Reyes LLP', referenceNumber: null, asset: null, notes: 'Originals are in the fireproof box in the office closet.', isSensitive: true },
]

async function ensureDocuments(db: Database, input: RecordsSeedInput, assetIds: Named): Promise<{ ids: Named; summary: string }> {
  const { owner, today, supabase } = input
  const existing = await queries.listDocuments(owner, db)
  const ids: Named = new Map(existing.map(document => [document.title, document.id]))
  if (existing.length > 0) return { ids, summary: skipped('Documents') }

  const bucket = supabase.storage.from(DOCUMENTS_BUCKET)
  for (const demo of DOCUMENTS) {
    const file = demoPdf(demo.title, [demo.issuer ?? '', demo.referenceNumber ?? '', 'A made-up document from the Ghar seed.'])
    const storagePath = documentStoragePath(owner.householdId, randomUUID(), 'application/pdf')
    const { error } = await bucket.upload(storagePath, file, { contentType: 'application/pdf' })
    if (error) throw new Error(`Could not upload ${demo.title} to the ${DOCUMENTS_BUCKET} bucket: ${error.message}`)

    const created = await queries.createDocument(owner, db, {
      title: demo.title,
      kind: demo.kind,
      issuedOn: demo.issuedDaysAgo === null ? null : addCalendarDays(today, -demo.issuedDaysAgo),
      expiresOn: demo.expiresDays === null ? null : addCalendarDays(today, demo.expiresDays),
      issuer: demo.issuer,
      referenceNumber: demo.referenceNumber,
      assetId: demo.asset === null ? null : (assetIds.get(demo.asset) ?? null),
      personId: null,
      notes: demo.notes,
      isSensitive: demo.isSensitive,
      storagePath,
      mimeType: 'application/pdf',
      sizeBytes: file.byteLength,
    })
    ids.set(demo.title, created.id)
  }
  return { ids, summary: `Documents: ${String(DOCUMENTS.length)} one-page PDFs, some sensitive, one expired and a few expiring` }
}

/** A one-page PDF with a title and a few lines, so opening a seeded document shows something. */
function demoPdf(title: string, lines: readonly string[]): Uint8Array {
  const escape = (text: string) => text.replace(/[^\x20-\x7e]/g, '*').replace(/[\\()]/g, match => `\\${match}`)
  const body = [`BT /F1 22 Tf 72 720 Td (${escape(title)}) Tj ET`]
  lines.forEach((line, index) => body.push(`BT /F1 12 Tf 72 ${String(680 - index * 20)} Td (${escape(line)}) Tj ET`))
  const stream = body.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${String(index + 1)} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

// Maintenance

interface DemoTask {
  title: string
  asset: string | null
  cadenceMonths: number | null
  cadenceMiles: number | null
  /** Days before today it was done, oldest first. The newest sets when it is next due. */
  doneDaysAgo: readonly number[]
  /** For a job never done: when it is first due, in days from today. */
  firstDueDays?: number
  assignedTo: 'owner' | 'adult' | null
  instructions: string | null
  vendor: string | null
  costCents?: number
  receipt?: string
}

const TASKS: DemoTask[] = [
  { title: 'Replace furnace filter', asset: 'Furnace', cadenceMonths: 3, cadenceMiles: null, doneDaysAgo: [300, 205, 118], assignedTo: 'adult', instructions: '16x25x4 MERV 11. Arrow points toward the blower. Spares are on the shelf above the washer.', vendor: null, costCents: 4200 },
  { title: 'Furnace tune-up', asset: 'Furnace', cadenceMonths: 12, cadenceMiles: null, doneDaysAgo: [352], assignedTo: 'owner', instructions: 'Book in September, before the first cold week.', vendor: 'Northside Heating & Air', costCents: 18_900, receipt: 'Furnace install invoice' },
  { title: 'Clean the gutters', asset: 'Roof', cadenceMonths: 6, cadenceMiles: null, doneDaysAgo: [360, 172], assignedTo: 'owner', instructions: 'Ladder is in the garage. Check the downspout by the deck, it clogs first.', vendor: null },
  { title: 'Flush the water heater', asset: 'Water heater', cadenceMonths: 12, cadenceMiles: null, doneDaysAgo: [410], assignedTo: null, instructions: 'Turn the gas to pilot first. Hose to the floor drain, run until clear.', vendor: 'Dana Okafor', costCents: 12_500 },
  { title: 'Oil change', asset: 'Honda CR-V', cadenceMonths: 6, cadenceMiles: 5000, doneDaysAgo: [330, 150], assignedTo: 'adult', instructions: '0W-20 full synthetic. Reset the maintenance minder after.', vendor: null, costCents: 8900 },
  { title: 'Clean the dryer vent', asset: 'Dryer', cadenceMonths: 12, cadenceMiles: null, doneDaysAgo: [200], assignedTo: 'owner', instructions: 'Disconnect at the back, brush all 18 ft, then the outside flap.', vendor: null },
  { title: 'Test smoke and CO alarms', asset: null, cadenceMonths: 6, cadenceMiles: null, doneDaysAgo: [190, 9], assignedTo: 'adult', instructions: 'Seven alarms: every bedroom, hallway, basement and kitchen. Batteries are 9V.', vendor: null },
  { title: 'Replace fridge water filter', asset: 'Refrigerator', cadenceMonths: 6, cadenceMiles: null, doneDaysAgo: [], firstDueDays: 4, assignedTo: null, instructions: 'LT1000P. Twist a quarter turn left.', vendor: null },
  { title: 'Winterize the outdoor spigots', asset: null, cadenceMonths: 12, cadenceMiles: null, doneDaysAgo: [], firstDueDays: 45, assignedTo: 'owner', instructions: 'Close the inside valves, open the spigots to drain, put the foam covers on.', vendor: null },
]

async function ensureMaintenance(
  db: Database,
  { owner, adult, today }: RecordsSeedInput,
  assetIds: Named,
  contactIds: Named,
  documentIds: Named
): Promise<string> {
  if ((await queries.listMaintenanceTasks(owner, db)).length > 0) return skipped('Maintenance')

  let entries = 0
  for (const demo of TASKS) {
    const [first] = demo.doneDaysAgo
    const task = await queries.createMaintenanceTask(owner, db, {
      title: demo.title,
      assetId: demo.asset === null ? null : (assetIds.get(demo.asset) ?? null),
      cadenceMonths: demo.cadenceMonths,
      cadenceMiles: demo.cadenceMiles,
      lastDoneOn: null,
      nextDueOn: first === undefined ? addCalendarDays(today, demo.firstDueDays ?? 0) : addCalendarDays(today, -first),
      assignedUserId: demo.assignedTo === 'owner' ? owner.userId : demo.assignedTo === 'adult' ? adult.userId : null,
      instructions: demo.instructions,
      vendorContactId: demo.vendor === null ? null : (contactIds.get(demo.vendor) ?? null),
    })
    // Logged the way someone would have, one Mark done at a time, oldest first.
    for (const [index, daysAgo] of demo.doneDaysAgo.entries()) {
      const last = index === demo.doneDaysAgo.length - 1
      await queries.completeMaintenanceTask(owner, db, task.id, {
        completedOn: addCalendarDays(today, -daysAgo),
        costCents: demo.costCents ?? null,
        notes: last && demo.vendor !== null ? `Done by ${demo.vendor}.` : null,
        documentId: last && demo.receipt !== undefined ? (documentIds.get(demo.receipt) ?? null) : null,
        today,
      })
      entries += 1
    }
  }
  return `Maintenance: ${String(TASKS.length)} jobs, some overdue and some due soon, with ${String(entries)} past completions`
}

// Bills

interface DemoBill {
  name: string
  payee: string
  amountCents: number | null
  isVariable: boolean
  cadence: BillCadence
  dueDay: number
  dueMonth: number | null
  autopay: boolean
  category: string | null
  url: string | null
  notes: string | null
  /** Its latest past due date is left unpaid, so it shows as late. */
  late?: boolean
}

const BILLS: DemoBill[] = [
  { name: 'Mortgage', payee: 'Keystone Lending', amountCents: 312_400, isVariable: false, cadence: 'monthly', dueDay: 1, dueMonth: null, autopay: true, category: 'rent_mortgage', url: 'https://keystone-lending.test', notes: null },
  { name: 'Electric', payee: 'Con Edison', amountCents: 18_600, isVariable: true, cadence: 'monthly', dueDay: 22, dueMonth: null, autopay: false, category: 'utilities', url: 'https://coned.test', notes: 'Higher in July and August with the AC.' },
  { name: 'Gas', payee: 'Con Edison Gas', amountCents: 7400, isVariable: true, cadence: 'monthly', dueDay: 22, dueMonth: null, autopay: false, category: 'utilities', url: null, notes: null },
  { name: 'Internet', payee: 'Optimum', amountCents: 8999, isVariable: false, cadence: 'monthly', dueDay: 19, dueMonth: null, autopay: true, category: 'internet_phone', url: null, notes: 'Promo rate ends in January. Call to renegotiate.' },
  { name: 'Phones', payee: 'Verizon Wireless', amountCents: 14_250, isVariable: false, cadence: 'monthly', dueDay: 12, dueMonth: null, autopay: false, category: 'internet_phone', url: null, notes: null, late: true },
  { name: 'Water and sewer', payee: 'Village of Tarrytown', amountCents: 21_800, isVariable: true, cadence: 'quarterly', dueDay: 15, dueMonth: 3, autopay: false, category: 'utilities', url: null, notes: null },
  { name: 'Streaming', payee: 'Netflix', amountCents: 2299, isVariable: false, cadence: 'monthly', dueDay: 27, dueMonth: null, autopay: true, category: 'subscriptions', url: null, notes: null },
  { name: 'Daycare', payee: 'Little Oaks Learning Center', amountCents: 185_000, isVariable: false, cadence: 'monthly', dueDay: 5, dueMonth: null, autopay: false, category: 'childcare', url: null, notes: 'Paid by check or Zelle to the director.' },
  { name: 'Car insurance', payee: 'Keystone Mutual', amountCents: 96_400, isVariable: false, cadence: 'annual', dueDay: 1, dueMonth: 12, autopay: false, category: null, url: null, notes: null },
  { name: 'Property tax', payee: 'Town of Greenburgh', amountCents: 612_000, isVariable: false, cadence: 'quarterly', dueDay: 30, dueMonth: 1, autopay: false, category: null, url: null, notes: 'Not escrowed. Paid directly each quarter.' },
]

/** How long ago the bills were entered, so there is history to have paid. */
const BILLS_ENTERED_MONTHS_AGO = 4

async function ensureBills(db: Database, { owner, today }: RecordsSeedInput): Promise<string> {
  if ((await queries.listBills(owner, db)).length > 0) return skipped('Bills')

  const categories = await categoriesByKey(db, owner)
  const checking = (await queries.listAccounts(owner, db)).find(account => account.name === 'Joint checking')
  const enteredOn = addCalendarMonths(today, -BILLS_ENTERED_MONTHS_AGO)
  let paid = 0
  for (const { category, late = false, ...demo } of BILLS) {
    const bill = await queries.createBill(owner, db, {
      ...demo,
      accountId: checking?.id ?? null,
      categoryId: category === null ? null : (categories.get(category) ?? null),
    })
    // Bills only count as late from when they were entered, so backdate that to have a history.
    await db.$client`update bills set created_at = ${`${enteredOn}T12:00:00Z`} where id = ${bill.id}`

    const dueDates = billDueDates(demo, enteredOn, addCalendarDays(today, -1))
    for (const [index, dueOn] of dueDates.entries()) {
      if (late && index === dueDates.length - 1) continue
      const paidOn = addCalendarDays(dueOn, demo.autopay ? 0 : -2)
      await queries.markBillPaid(owner, db, { billId: bill.id, dueOn, paidOn: paidOn < enteredOn ? dueOn : paidOn })
      paid += 1
    }
  }
  return `Bills: ${String(BILLS.length)}, ${String(paid)} past payments, one late`
}

// Calendar

interface DemoEvent {
  title: string
  description?: string
  location?: string
  category: EventCategory
  colorToken?: EventColorToken
  /** Days from today. */
  day: number
  /** "HH:MM" to "HH:MM" in the household's zone, or all day through `lastDay`. */
  time: readonly [string, string] | { lastDay: number }
  rrule?: string
  attendees: 'owner' | 'adult' | 'both'
}

const EVENTS: DemoEvent[] = [
  { title: 'Soccer practice', location: 'Patriot Park field 2', category: 'school', day: -12, time: ['17:30', '18:45'], rrule: 'FREQ=WEEKLY;BYDAY=TU,TH', attendees: 'adult' },
  { title: 'Garbage and recycling out', category: 'household', day: -6, time: ['20:00', '20:15'], rrule: 'FREQ=WEEKLY;BYDAY=SU', attendees: 'owner' },
  { title: 'Book club', location: 'Warner Library', category: 'personal', day: -20, time: ['19:00', '21:00'], rrule: 'FREQ=MONTHLY;BYDAY=2WE', attendees: 'adult' },
  { title: 'Piano lesson', location: 'Ms. Albright’s', category: 'school', day: -9, time: ['16:00', '16:45'], rrule: 'FREQ=WEEKLY;BYDAY=MO', attendees: 'owner' },
  { title: 'Dentist, Leo', location: 'Hudson Family Dental', category: 'personal', day: 2, time: ['15:30', '16:15'], description: 'Six-month cleaning. Bring the insurance card.', attendees: 'adult' },
  { title: 'Parent-teacher conference', location: 'Washington Irving School, room 14', category: 'school', day: 8, time: ['18:10', '18:30'], attendees: 'both' },
  { title: 'Furnace tune-up visit', location: 'Home', category: 'maintenance', day: 5, time: ['08:00', '10:00'], description: 'Northside arrives between 8 and 10.', attendees: 'owner' },
  { title: 'No school, Yom Kippur', category: 'school', colorToken: 'caution', day: 4, time: { lastDay: 4 }, attendees: 'both' },
  { title: 'Grandma visiting', category: 'household', day: 13, time: { lastDay: 16 }, description: 'Guest room sheets, pick up at the train Friday 4:40.', attendees: 'both' },
  { title: 'Anniversary dinner', location: 'Blue Hill at Stone Barns', category: 'personal', colorToken: 'positive', day: 10, time: ['19:00', '21:30'], description: 'Maya is babysitting.', attendees: 'both' },
  { title: 'Property tax due', category: 'bill', colorToken: 'negative', day: 1, time: { lastDay: 1 }, attendees: 'owner' },
  { title: 'Leo’s birthday', category: 'personal', colorToken: 'positive', day: 27, time: { lastDay: 27 }, rrule: 'FREQ=YEARLY', attendees: 'both' },
  { title: 'Flu shots', location: 'CVS on Main St', category: 'personal', day: 18, time: ['10:00', '10:30'], attendees: 'both' },
  { title: 'Pumpkin picking', location: 'Stuart’s Fruit Farm', category: 'household', day: 24, time: ['11:00', '14:00'], attendees: 'both' },
  { title: 'Car inspection', location: 'Tarrytown Auto', category: 'maintenance', day: -3, time: ['09:00', '10:00'], attendees: 'adult' },
  { title: 'Halloween parade', location: 'Main Street', category: 'school', day: 44, time: ['16:00', '17:30'], attendees: 'both' },
  { title: 'Open enrollment closes', category: 'personal', colorToken: 'caution', day: 52, time: { lastDay: 52 }, description: 'Pick the PPO again unless premiums jumped.', attendees: 'owner' },
]

async function ensureEvents(db: Database, { owner, adult, today, timeZone }: RecordsSeedInput): Promise<string> {
  const window = { start: instantInTimeZone(addCalendarDays(today, -400), '00:00', timeZone), end: instantInTimeZone(addCalendarDays(today, 400), '00:00', timeZone) }
  const native = (await queries.listEventsInWindow(owner, db, window)).filter(event => event.externalSource === null)
  if (native.length > 0) return skipped('Calendar')

  for (const demo of EVENTS) {
    const day = addCalendarDays(today, demo.day)
    const times = 'lastDay' in demo.time
      ? allDayRange(day, addCalendarDays(today, demo.time.lastDay))
      : { startsAt: instantInTimeZone(day, demo.time[0], timeZone), endsAt: instantInTimeZone(day, demo.time[1], timeZone) }
    await queries.createEvent(owner, db, {
      title: demo.title,
      description: demo.description ?? null,
      location: demo.location ?? null,
      ...times,
      allDay: 'lastDay' in demo.time,
      rrule: demo.rrule ?? null,
      category: demo.category,
      colorToken: demo.colorToken ?? null,
      attendeeIds: demo.attendees === 'owner' ? [owner.userId] : demo.attendees === 'adult' ? [adult.userId] : [owner.userId, adult.userId],
    })
  }
  return `Calendar: ${String(EVENTS.length)} events, five of them repeating`
}

// Money

async function categoriesByKey(db: Database, ctx: RequestContext): Promise<Named> {
  await queries.ensureDefaultCategories(ctx, db)
  const categories = await queries.listCategories(ctx, db)
  return new Map(categories.flatMap(category => (category.systemKey === null ? [] : [[category.systemKey, category.id] as const])))
}

const BUDGET: [key: string, plannedCents: number][] = [
  ['groceries', 110_000],
  ['restaurants', 45_000],
  ['coffee', 6000],
  ['utilities', 32_000],
  ['fuel', 18_000],
  ['childcare', 185_000],
  ['subscriptions', 6500],
  ['everyday', 25_000],
  ['medical', 15_000],
  ['gifts', 10_000],
]

async function ensureMoneySetup(db: Database, { owner, today }: RecordsSeedInput): Promise<string> {
  const categories = await categoriesByKey(db, owner)
  const periodStart = `${today.slice(0, 7)}-01`
  for (const [key, plannedCents] of BUDGET) {
    const categoryId = categories.get(key)
    if (categoryId === undefined) continue
    await queries.setBudgetLine(owner, db, { periodStart, categoryId, plannedCents, rolloverEnabled: key === 'gifts' })
  }

  if ((await queries.listGoals(owner, db)).length > 0) return `Money: default categories and this month’s budget (${String(BUDGET.length)} lines); goals already there`
  const savings = (await queries.listAccounts(owner, db)).find(account => account.name === 'Rainy day savings')
  await queries.createGoal(owner, db, { name: 'Emergency fund', targetCents: 3_000_000, targetDate: addCalendarMonths(today, 14), notes: 'Six months of fixed costs.', linkedAccountId: savings?.id ?? null })
  await queries.createGoal(owner, db, { name: 'Kitchen renovation', targetCents: 4_500_000, targetDate: addCalendarMonths(today, 30), notes: null, linkedAccountId: null })
  await queries.createGoal(owner, db, { name: 'Japan, spring 2028', targetCents: 1_200_000, targetDate: null, notes: 'Cherry blossom season.', linkedAccountId: null })
  return `Money: default categories, this month’s budget (${String(BUDGET.length)} lines) and 3 goals`
}

// Digest

async function ensureDigestPreferences(db: Database, { adult }: RecordsSeedInput): Promise<string> {
  // Sam wants fewer, earlier emails. Alex keeps the defaults.
  await queries.setDigestPreferences(adult, db, { enabled: true, sections: ['bills', 'upkeep', 'calendar', 'price_drops'], sendHour: 6 })
  return 'Digest: Sam gets a shorter one at 6am, Alex the default'
}
