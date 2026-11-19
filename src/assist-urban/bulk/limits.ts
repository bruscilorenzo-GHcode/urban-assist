/** Bulk upload limits — the field batch is bounded on purpose.
 *
 *  A professional in the field (or a lazy user) can drop many files at once,
 *  but a batch is capped so the browser, the review list and the test suite
 *  stay honest. The story budget (50 MB) stays the publish-time limit; the
 *  batch allows more material because only one candidate is published. */

export const BULK_LIMITS = {
  maxFiles: 40,
  maxFileBytes: 50 * 1024 * 1024,
  maxBatchBytes: 300 * 1024 * 1024,
  maxCandidates: 20,
} as const

export type BulkError = 'too_many' | 'file_too_large' | 'batch_too_large' | 'type'

export interface BulkFileLike {
  name: string
  type: string
  size: number
}

export function bulkKindOf(type: string, name: string): 'image' | 'video' | 'audio' | 'text' | null {
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('text/') || /\.(txt|md|csv)$/i.test(name)) return 'text'
  return null
}

export function validateBulk(files: BulkFileLike[]): BulkError | null {
  if (files.length > BULK_LIMITS.maxFiles) return 'too_many'
  let total = 0
  for (const file of files) {
    if (!bulkKindOf(file.type, file.name)) return 'type'
    if (file.size > BULK_LIMITS.maxFileBytes) return 'file_too_large'
    total += file.size
  }
  return total > BULK_LIMITS.maxBatchBytes ? 'batch_too_large' : null
}
