import { arrivalExtractSchema, type ArrivalExtract } from '@ghar/core/trip-arrivals'
import { ArrivalExtractionError, type ArrivalExtractor, type ArrivalText } from './types'

// A reader for local development and tests that needs no API key. It understands only labelled
// lines ("Mode: flight", "Arrives: 2027-03-12T09:40"). Text without a Mode line isn't travel.

const LABELS: Record<string, keyof ArrivalExtract> = {
  mode: 'mode',
  arrives: 'arrivalAt',
  'arrives at': 'arrivalPlace',
  'arrival number': 'arrivalNumber',
  leaves: 'departureAt',
  'leaves from': 'departurePlace',
  'departure number': 'departureNumber',
}

export const NOT_TRAVEL: ArrivalExtract = {
  isTravel: false,
  mode: null,
  arrivalPlace: null,
  arrivalAt: null,
  arrivalNumber: null,
  departurePlace: null,
  departureAt: null,
  departureNumber: null,
}

export function createFakeArrivalExtractor(): ArrivalExtractor {
  return {
    extract({ text }: ArrivalText) {
      const found: Partial<Record<keyof ArrivalExtract, string>> = {}
      for (const line of text.split('\n')) {
        const match = /^([A-Za-z ]+):\s*(.+)$/.exec(line.trim())
        const field = match ? LABELS[(match[1] ?? '').trim().toLowerCase()] : undefined
        if (match && field && found[field] === undefined) found[field] = (match[2] ?? '').trim()
      }
      if (found.mode === undefined) return Promise.resolve(NOT_TRAVEL)
      const parsed = arrivalExtractSchema.safeParse({ ...NOT_TRAVEL, ...found, isTravel: true })
      if (!parsed.success) return Promise.reject(new ArrivalExtractionError('The sample reader couldn’t read that.'))
      return Promise.resolve(parsed.data)
    },
  }
}
