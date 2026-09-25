import type { HealthScan } from '@ghar/core/health-scan'
import type { FileForScan } from '../document-scan/types'

// Reading a vaccine card or a visit summary into healthScanSchema. What comes back is only ever a
// suggestion for a person to check, and never includes a result, a diagnosis, a name or an ID number.

export interface HealthRecordScanner {
  /** Throws ScanError when there's no answer that fits the schema. */
  scan(file: FileForScan): Promise<HealthScan>
}
