import { healthScanSchema, NOT_A_HEALTH_RECORD, type HealthScan } from '@ghar/core/health-scan'
import { ScanError, type FileForScan } from '../document-scan/types'
import type { HealthRecordScanner } from './types'

// A reader for local development and tests that needs no API key. It can't see a photo. It finds
// labelled lines in the file's bytes, which a plain text fixture or a simple PDF has:
//
//   Record: Vaccination record
//   Vaccine: Flu shot on 2025-10-14
//   Dental: Cleaning on unknown
//
// A file without a Record line isn't a health record.

const KINDS: Record<string, HealthScan['events'][number]['kind']> = {
  vaccine: 'vaccine',
  checkup: 'checkup',
  dental: 'dental',
  eye: 'eye',
  visit: 'visit',
  test: 'test',
}

export function createFakeHealthScanner(): HealthRecordScanner {
  return {
    scan(file: FileForScan) {
      const text = new TextDecoder('latin1').decode(file.bytes)
      const record = /\bRecord:[ \t]*([^\n\r()]+)/.exec(text)
      if (record === null) return Promise.resolve(NOT_A_HEALTH_RECORD)
      const events = [...text.matchAll(/\b(Vaccine|Checkup|Dental|Eye|Visit|Test):[ \t]*([^\n\r()]*?)[ \t]+on[ \t]+(\S+)/g)].map(match => ({
        kind: KINDS[(match[1] ?? '').toLowerCase()] ?? 'visit',
        title: (match[2] ?? '').trim() || null,
        occurredOn: match[3] === 'unknown' ? null : (match[3] ?? null),
      }))
      const parsed = healthScanSchema.safeParse({ isHealthRecord: true, documentTitle: (record[1] ?? '').trim() || null, events })
      if (!parsed.success) return Promise.reject(new ScanError('The sample reader couldn’t read this file.'))
      return Promise.resolve(parsed.data)
    },
  }
}
