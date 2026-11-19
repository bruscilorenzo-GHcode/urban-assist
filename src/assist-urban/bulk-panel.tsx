/** BULK upload panel — many files in, reviewable story candidates out.
 *  The multi-agent post-production runs locally and deterministically; the
 *  narrator reviews a candidate and opens it in the composer. Nothing is
 *  uploaded until publish (consent gate unchanged). */

import { useMemo, useRef, useState } from 'react'
import type { City } from './cities.js'
import type { DramaturgicalZone } from './pipeline/dramaturgical-zones.js'
import { runBulkAgents, type BulkCandidate } from './bulk/agents.js'
import { BULK_LIMITS, validateBulk, type BulkError } from './bulk/limits.js'
import type { Strings, UiLang } from './i18n'

interface Props {
  t: Strings
  ui: UiLang
  zones: DramaturgicalZone[]
  cities: City[]
  onOpen: (candidate: BulkCandidate) => void
}

function errorText(t: Strings, error: BulkError): string {
  switch (error) {
    case 'too_many': return t.bulkErrorTooMany
    case 'file_too_large': return t.bulkErrorFileLarge
    case 'batch_too_large': return t.bulkErrorBatchLarge
    default: return t.bulkErrorType
  }
}

function warningText(t: Strings, warning: string): string {
  switch (warning) {
    case 'trimmed': return t.bulkWarnTrimmed
    case 'no_place': return t.bulkWarnNoPlace
    case 'no_date': return t.bulkWarnNoDate
    case 'few_media': return t.bulkWarnFew
    case 'single_kind': return t.bulkWarnSingle
    default: return warning
  }
}

export default function BulkPanel({ t, ui, zones, cities, onOpen }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [tags, setTags] = useState('')
  const [candidates, setCandidates] = useState<BulkCandidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const totalMb = useMemo(() => (files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(1), [files])
  const limits = t.bulkLimits(
    BULK_LIMITS.maxFiles,
    Math.round(BULK_LIMITS.maxFileBytes / 1024 / 1024),
    Math.round(BULK_LIMITS.maxBatchBytes / 1024 / 1024),
  )

  const pick = (list: FileList | null) => {
    const next = list ? Array.from(list) : []
    const invalid = validateBulk(next.map((file) => ({ name: file.name, type: file.type, size: file.size })))
    if (invalid) { setError(errorText(t, invalid)); return }
    setError(null)
    setCandidates(null)
    setFiles(next)
  }

  const analyze = () => {
    if (files.length === 0) { setError(t.bulkEmpty); return }
    const invalid = validateBulk(files.map((file) => ({ name: file.name, type: file.type, size: file.size })))
    if (invalid) { setError(errorText(t, invalid)); return }
    setBusy(true)
    setError(null)
    try {
      const result = runBulkAgents(files, {
        zones,
        cities,
        lang: ui === 'en' ? 'en' : 'it',
        globalTags: tags.split(/[\s,#]+/).filter(Boolean),
      })
      if (result.length === 0) { setError(t.bulkEmpty); setCandidates([]); return }
      setCandidates(result)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="au-bulk" data-testid="bulk-panel">
      <h3>{t.bulkTitle} <em>beta</em></h3>
      <p className="au-hint">{t.bulkHint}</p>
      <input ref={inputRef} type="file" multiple hidden
        accept="image/*,video/*,audio/*,.txt,.md,.csv"
        onChange={(event) => { pick(event.target.files); event.target.value = '' }} />
      <div className="au-bulk-row">
        <button type="button" className="au-chip" onClick={() => inputRef.current?.click()}>{t.bulkChoose}</button>
        {files.length > 0 && (
          <>
            <span className="au-media-label">{t.bulkFiles(files.length, Number(totalMb))}</span>
            <button type="button" className="au-chip" onClick={() => { setFiles([]); setCandidates(null); setError(null) }}>{t.bulkClear}</button>
          </>
        )}
      </div>
      <p className="au-hint">{limits}</p>
      <label className="au-bulk-tags">{t.bulkTags}
        <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t.bulkTagsPh} />
      </label>
      <div className="au-row au-tight">
        <button type="button" className="au-submit" disabled={busy || files.length === 0} onClick={analyze}>
          {busy ? t.bulkAnalyzing : t.bulkAnalyze}
        </button>
      </div>
      {error && <p className="au-error">{error}</p>}
      {candidates && candidates.length > 0 && (
        <ul className="au-bulk-candidates" data-testid="bulk-candidates">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <div className="au-bulk-cand-head">
                <b>{candidate.place ? candidate.place.name : t.bulkNoPlace}</b>
                <span className="au-media-label">
                  {candidate.date ?? '—'} · {candidate.items.length} media · {Math.round(candidate.score)}
                </span>
              </div>
              <p>{candidate.utterance}</p>
              <div className="au-bulk-taglist">
                {candidate.tags.slice(0, 6).map((tag) => <span key={tag}>{tag}</span>)}
              </div>
              {candidate.warnings.length > 0 && (
                <p className="au-hint">{candidate.warnings.map((warning) => warningText(t, warning)).join(' · ')}</p>
              )}
              <div className="au-row au-tight">
                <button type="button" className="au-chip" onClick={() => onOpen(candidate)}>{t.bulkOpen}</button>
                <span className="au-hint">{candidate.montageStyleId} · {candidate.geo ? `${t.bulkGeoFromTag} · ${candidate.geo.index}` : t.bulkNoPlace}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
