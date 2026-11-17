/** Automatic media assembler — the narrator chooses the montage typology from
 *  the app's filtering categories (channels and relational families), with an
 *  optional theme bias. The plan is deterministic (no model): it orders the
 *  media, assigns roles and durations, writes captions/timelines, and reports
 *  coherence honestly. Preview is a light storyboard player (no encoding). */

import { useEffect, useMemo, useRef, useState } from 'react'
import { MONTAGE_STYLES } from '../core/montage/styles'
import { formatSec, planMontage } from '../core/montage/planner'
import type { MontageItem, MontagePlan, MontageStyleId, MontageWarning } from '../core/montage/types'
import type { Strings, UiLang } from './i18n'

export interface MontagePanelItem {
  key: string
  kind: MontageItem['kind']
  size: number
  caption: string
  timeline: string
  file: File
}

interface Props {
  t: Strings
  ui: UiLang
  items: MontagePanelItem[]
  themes: Array<{ id: string; label: { it: string; en: string } }>
  cell?: string | null
  onApply: (plan: MontagePlan) => void
}

function warningText(t: Strings, warning: MontageWarning): string {
  switch (warning) {
    case 'few_items': return t.montageWarnFewItems
    case 'same_media': return t.montageWarnSameMedia
    case 'no_motion': return t.montageWarnNoMotion
    case 'no_geo': return t.montageWarnNoGeo
    default: return t.montageWarnFewCaptions
  }
}

export default function MontagePanel({ t, ui, items, themes, cell, onApply }: Props) {
  const [styleId, setStyleId] = useState<MontageStyleId>('functional')
  const [themeBias, setThemeBias] = useState<string>('')
  const [playing, setPlaying] = useState(false)
  const [index, setIndex] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const lastUrl = useRef<string | null>(null)

  const plan: MontagePlan | null = useMemo(() => {
    if (items.length < 2) return null
    const montageItems: MontageItem[] = items.map((item) => ({
      key: item.key,
      kind: item.kind,
      size: item.size,
      caption: item.caption,
      cell: cell ?? null,
    }))
    return planMontage({ items: montageItems, styleId, themeBias: themeBias || null })
  }, [items, styleId, themeBias, cell])

  const visualShots = useMemo(() => (plan ? plan.shots.filter((shot) => shot.role !== 'bed') : []), [plan])
  const current = playing ? visualShots[index] : null
  const currentItem = current ? items.find((item) => item.key === current.key) ?? null : null

  // Storyboard player: dwell per shot, no encoding; the tab can idle safely.
  useEffect(() => {
    if (!playing || !plan) return
    if (index >= visualShots.length) { setPlaying(false); return }
    const shot = visualShots[index]!
    const timer = window.setTimeout(() => setIndex((value) => value + 1), Math.max(800, shot.durationSec * 1000))
    return () => window.clearTimeout(timer)
  }, [playing, index, plan, visualShots])

  useEffect(() => {
    if (lastUrl.current) URL.revokeObjectURL(lastUrl.current)
    lastUrl.current = null
    if (!currentItem || currentItem.kind === 'text') { setPreviewUrl(null); return }
    const url = URL.createObjectURL(currentItem.file)
    lastUrl.current = url
    setPreviewUrl(url)
    return () => { if (lastUrl.current === url) { URL.revokeObjectURL(url); lastUrl.current = null } }
  }, [currentItem])

  const startPreview = () => { setIndex(0); setPlaying(true) }
  const stopPreview = () => { setPlaying(false); setIndex(0) }

  const exportPlan = () => {
    if (!plan) return
    const blob = new Blob([JSON.stringify({ document: 'assist-urban.montage-plan.v1', ...plan }, null, 2)], { type: 'application/json' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = `montaggio-${plan.styleId}-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }

  return (
    <div className="au-montage" data-testid="montage-panel">
      <h3>{t.montageTitle}</h3>
      <p className="au-hint">{t.montageHint}</p>
      {items.length < 2 && <p className="au-hint">{t.montageEmpty}</p>}
      {items.length >= 2 && (
        <>
          <div className="au-montage-styles">
            <span className="au-media-label">{t.montageFamilyChannel}</span>
            {MONTAGE_STYLES.filter((style) => style.family === 'channel').map((style) => (
              <button key={style.id} type="button" title={style.description[ui]}
                className={`au-chip${styleId === style.id ? ' on' : ''}`}
                onClick={() => setStyleId(style.id)}>{style.label[ui]}</button>
            ))}
            <span className="au-media-label">{t.montageFamilyRelation}</span>
            {MONTAGE_STYLES.filter((style) => style.family === 'relation').map((style) => (
              <button key={style.id} type="button" title={style.description[ui]}
                className={`au-chip${styleId === style.id ? ' on' : ''}`}
                onClick={() => setStyleId(style.id)}>{style.label[ui]}</button>
            ))}
          </div>
          {themes.length > 0 && (
            <div className="au-montage-themes">
              <span className="au-media-label">{t.montageThemeBias}</span>
              <button type="button" className={`au-chip${themeBias === '' ? ' on' : ''}`} onClick={() => setThemeBias('')}>{t.montageThemeNone}</button>
              {themes.map((theme) => (
                <button key={theme.id} type="button" className={`au-chip${themeBias === theme.id ? ' on' : ''}`}
                  onClick={() => setThemeBias(theme.id)}>{theme.label[ui]}</button>
              ))}
            </div>
          )}
          {plan && (
            <>
              <div className="au-montage-meta">
                <span className="au-media-label">{t.montageCoherence}: <b>{plan.coherence.score}/100</b> · {formatSec(plan.totalSec)}</span>
                {plan.coherence.warnings.map((warning) => (
                  <span key={warning} className="au-montage-warn">{warningText(t, warning)}</span>
                ))}
              </div>
              <ol className="au-montage-board">
                {plan.shots.map((shot) => (
                  <li key={shot.key} className={current?.key === shot.key ? 'on' : ''}>
                    <span className="au-montage-role">{shot.role}</span>
                    <span className="au-montage-kind">{shot.kind}</span>
                    <span className="au-montage-time">{formatSec(shot.startSec)} · {shot.durationSec}s · {shot.transition}</span>
                    <span className="au-montage-caption">{shot.caption}</span>
                  </li>
                ))}
              </ol>
              {current && (
                <div className="au-montage-preview" data-testid="montage-preview">
                  {previewUrl && currentItem?.kind === 'image' && <img src={previewUrl} alt={current.caption} />}
                  {previewUrl && currentItem?.kind === 'video' && <video src={previewUrl} autoPlay muted playsInline />}
                  {currentItem?.kind === 'text' && <p className="au-montage-text">{current.caption}</p>}
                  <p className="au-hint">{current.caption} · {formatSec(current.startSec)}</p>
                </div>
              )}
              <div className="au-row au-tight">
                <button type="button" className="au-chip" onClick={playing ? stopPreview : startPreview}>
                  {playing ? t.montageStop : t.montagePreview}
                </button>
                <button type="button" className="au-chip" onClick={() => onApply(plan)}>{t.montageApply}</button>
                <button type="button" className="au-chip" onClick={exportPlan}>{t.montageExport}</button>
              </div>
              <p className="au-hint">{t.montageOrder}: {plan.order.map((key, position) => `${position + 1}. ${items.find((item) => item.key === key)?.kind ?? '?'}`).join(' · ')}</p>
            </>
          )}
        </>
      )}
    </div>
  )
}
