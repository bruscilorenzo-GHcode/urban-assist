/** Deterministic montage planner: media → a coherent georeferenced utterance.
 *
 *  The user picks a **montage typology from the filtering categories** the app
 *  already uses (the two channels, the relational families), optionally biased
 *  by a theme of the active pack. The planner never calls a model: ordering,
 *  roles, durations, captions and the coherence report are pure functions.
 *  The plan is rendered by the client (storyboard preview) and stored on the
 *  published media as per-item timeline/caption metadata — SOR-friendly. */

import type { Localized } from '../types.js'

export type MontageStyleId =
  | 'functional'
  | 'fictional'
  | 'proximity'
  | 'place'
  | 'topic'
  | 'community'

export type MontageFamily = 'channel' | 'relation'

export interface MontageStyle {
  id: MontageStyleId
  family: MontageFamily
  label: Localized
  description: Localized
  /** Preferred shot length in seconds (before clamping). */
  cadenceSec: number
  /** Dissolve between shots when the style is atmospheric. */
  dissolve: boolean
  maxShotSec: number
}

export type MontageKind = 'image' | 'video' | 'audio' | 'text'

export interface MontageItem {
  key: string
  kind: MontageKind
  size: number
  /** Known duration for video/audio (seconds). */
  durationSec?: number
  capturedAt?: string
  /** Anonymous cell (gr_…) or null. */
  cell?: string | null
  caption?: string
  /** Theme id the narrator (or extraction) assigned. */
  theme?: string
}

export type MontageRole = 'open' | 'develop' | 'close' | 'bed' | 'intertitle'

export interface PlannedShot {
  key: string
  kind: MontageKind
  role: MontageRole
  order: number
  startSec: number
  durationSec: number
  transition: 'cut' | 'dissolve'
  caption: string
  /** Template reason: why this shot, in this place, in this order. */
  reason: string
}

export type MontageWarning =
  | 'few_items'
  | 'same_media'
  | 'no_motion'
  | 'no_geo'
  | 'few_captions'

export interface MontageCoherence {
  score: number
  balance: number
  diversity: number
  warnings: MontageWarning[]
}

export interface MontagePlan {
  styleId: MontageStyleId
  themeBias: string | null
  shots: PlannedShot[]
  totalSec: number
  coherence: MontageCoherence
  /** Stable order of media keys to apply in the composer. */
  order: string[]
  captions: Record<string, string>
  timelines: Record<string, string>
}

export interface PlanInput {
  items: MontageItem[]
  styleId: MontageStyleId
  themeBias?: string | null
}
