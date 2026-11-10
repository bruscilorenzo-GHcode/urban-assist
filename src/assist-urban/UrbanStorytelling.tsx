import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  loadActiveZoneId,
  loadPilotMode,
  loadPilotZones,
  mergeZones,
  saveActiveZoneId,
  savePilotMode,
  savePilotZones,
  validateZoneInput,
  zoneById,
  type DramaturgicalZone,
  type PilotZoneInput,
} from './pipeline/dramaturgical-zones'
import type { PublishedStory } from './story.js'
import { MEDIA_TOTAL_BUDGET, totalSize, uploadAll, validateBudget } from './media-upload'
import { loadUiLang, storeUiLang, STR, type UiLang } from './i18n'
import { loadMyStories, saveMyStories, type MyStories } from './my-stories'
import { loadZoneTokens, saveZoneTokens, type ZoneTokens } from './my-zones'
import { geocodePlace, geocodePlaceInCity } from './geocode'
import type { City } from './cities'
import './urban-storytelling.css'

const ARC_COLORS: Record<string, string> = {
  photo: '#4fb5ae', video: '#c46bff', audio: '#e1a33d', text: '#7c9dff',
  image: '#4fb5ae',
}

let zoneSyncStarted = false

interface PendingMedia {
  file: File
  timeline: string
  caption: string
}

const EMPTY_DRAFT: PilotZoneInput = {
  name: '', city: '', focusIt: '', focusEn: '', themeIt: '', themeEn: '',
  lat: '', lon: '', zoom: 14,
}

function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function isStory(value: unknown): value is PublishedStory {
  if (!value || typeof value !== 'object') return false
  const story = value as Partial<PublishedStory>
  return typeof story.id === 'string'
    && typeof story.text === 'string'
    && typeof story.ts === 'string'
    && (story.dz === null || typeof story.dz === 'string')
    && Array.isArray(story.media)
}

function MediaThumb({ media, alt }: { media: PublishedStory['media'][number]; alt: string }) {
  const src = `/api/media?id=${media.id}`
  if (media.kind === 'image') return <img src={src} alt={alt} loading="lazy" />
  if (media.kind === 'video') return <video src={src} controls preload="metadata" />
  if (media.kind === 'audio') return <audio src={src} controls preload="metadata" />
  return <a className="au-wall-id" href={src} target="_blank" rel="noreferrer">text ↗</a>
}

function storyPoint(story: PublishedStory, fallback: [number, number]): [number, number] {
  if (!story.geo || !story.geo.index.startsWith('gr_')) return fallback
  const parts = story.geo.index.split('_')
  const lat = Number.parseFloat(parts[2] ?? '')
  const lon = Number.parseFloat(parts[3] ?? '')
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : fallback
}

export default function UrbanStorytelling() {
  useEffect(() => {
    document.documentElement.classList.add('urban-route')
    const viewport = document.querySelector('meta[name="viewport"]')
    const previous = viewport?.getAttribute('content') ?? null
    // Journalists on phones need pinch-zoom; the music forks keep their locked
    // viewport (the meta is restored when this route unmounts).
    viewport?.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover')
    return () => {
      document.documentElement.classList.remove('urban-route')
      if (viewport && previous !== null) viewport.setAttribute('content', previous)
    }
  }, [])

  const storage = browserStorage()
  const mapDiv = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const pinRef = useRef<L.CircleMarker | null>(null)
  const storyLayer = useRef<L.LayerGroup | null>(null)
  const locationMarkerRef = useRef<L.CircleMarker | null>(null)
  const accuracyCircleRef = useRef<L.Circle | null>(null)
  const watchRef = useRef<number | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const [ui, setUi] = useState<UiLang>(() => loadUiLang(storage))
  const [pilotZones, setPilotZones] = useState<DramaturgicalZone[]>(() => loadPilotZones(storage))
  const zones = useMemo(() => mergeZones(pilotZones), [pilotZones])
  const [zoneId, setZoneId] = useState(() => loadActiveZoneId(storage, zones) ?? zones[0]!.id)
  const zone = zoneById(zones, zoneId)
  const zoneIdRef = useRef(zoneId)
  zoneIdRef.current = zoneId

  const [pilotMode, setPilotMode] = useState(() => loadPilotMode(storage))
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState<PilotZoneInput>(EMPTY_DRAFT)
  const [zoneError, setZoneError] = useState<string | null>(null)
  const [zoneSaving, setZoneSaving] = useState(false)
  const [zoneTokens, setZoneTokens] = useState<ZoneTokens>(() => loadZoneTokens(storage))
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)
  const [regeocodingId, setRegeocodingId] = useState<string | null>(null)
  const [zoneNotice, setZoneNotice] = useState<string | null>(null)
  const [cities, setCities] = useState<City[]>([])
  const [cityEditorOpen, setCityEditorOpen] = useState(false)
  const [cityDraft, setCityDraft] = useState('')
  const [citySaving, setCitySaving] = useState(false)
  const [cityError, setCityError] = useState<string | null>(null)
  const [cityNotice, setCityNotice] = useState<string | null>(null)
  const cityOptions = useMemo(() => {
    const names = new Set<string>()
    for (const candidate of zones) if (candidate.city.trim()) names.add(candidate.city.trim())
    for (const city of cities) if (city.name.trim()) names.add(city.name.trim())
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [cities, zones])

  const [point, setPoint] = useState<[number, number]>(zone.center)
  const [currentLocation, setCurrentLocation] = useState<[number, number] | null>(null)
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [follow, setFollow] = useState(false)
  const [text, setText] = useState('')
  const [lang, setLang] = useState<string>(ui)
  const [geoMode, setGeoMode] = useState<'grid' | 'none'>('grid')
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([])
  const [comparative, setComparative] = useState(false)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stories, setStories] = useState<PublishedStory[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [myStories, setMyStories] = useState<MyStories>(() => loadMyStories(storage))
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const t = STR[ui]

  const focusZone = useCallback((next: DramaturgicalZone) => {
    setZoneId(next.id)
    saveActiveZoneId(next.id, storage)
    setPoint(next.center)
    setSelected(null)
    mapRef.current?.setView(next.center, next.zoom)
    if (next.presets.length) {
      setText(next.presets[0]!.text)
      setLang(next.presets[0]!.lang)
    } else {
      setText('')
    }
  }, [storage])

  const switchUi = useCallback((next: UiLang) => {
    setUi(next)
    storeUiLang(next, storage)
  }, [storage])

  const togglePilot = useCallback(() => {
    setPilotMode((on) => {
      const next = !on
      savePilotMode(next, storage)
      if (!next) { setEditorOpen(false); setZoneError(null) }
      return next
    })
  }, [storage])

  const switchZone = useCallback((id: string) => {
    const next = zones.find((candidate) => candidate.id === id)
    if (!next || next.status === 'coming') return
    focusZone(next)
  }, [focusZone, zones])

  const locationErrorMessage = useCallback((error: GeolocationPositionError) => {
    if (error.code === error.PERMISSION_DENIED) return t.locationDenied
    if (error.code === error.POSITION_UNAVAILABLE) return t.locationUnavailable
    return t.locationTimeout
  }, [t])

  const applyPosition = useCallback((position: GeolocationPosition) => {
    const next: [number, number] = [position.coords.latitude, position.coords.longitude]
    setCurrentLocation(next)
    setLocationAccuracy(Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null)
    setPoint(next)
    setGeoMode('grid')
    setLocationError(null)
    const map = mapRef.current
    if (map) map.setView(next, Math.max(map.getZoom(), 15))
  }, [])

  const locateMe = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setLocationError(t.locationUnavailable)
      return
    }
    setLocating(true)
    setLocationError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => { applyPosition(position); setLocating(false) },
      (error) => { setLocationError(locationErrorMessage(error)); setLocating(false) },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 3_000 },
    )
  }, [applyPosition, locationErrorMessage, t])

  const toggleFollow = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setLocationError(t.locationUnavailable)
      return
    }
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = null
      setFollow(false)
      return
    }
    setLocationError(null)
    setFollow(true)
    watchRef.current = navigator.geolocation.watchPosition(
      (position) => applyPosition(position),
      (error) => {
        setLocationError(locationErrorMessage(error))
        if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current)
        watchRef.current = null
        setFollow(false)
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 2_000 },
    )
  }, [applyPosition, locationErrorMessage, t])

  useEffect(() => () => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current)
  }, [])

  useEffect(() => {
    if (!zones.some((candidate) => candidate.id === zoneId)) setZoneId(zones[0]!.id)
  }, [zones, zoneId])

  // Shared DZ store: fetch the pilot zones every collaborator created, and
  // migrate the zones that this browser still has only in localStorage (from
  // before the shared store existed) so the team finally sees them.
  useEffect(() => {
    if (zoneSyncStarted) return
    zoneSyncStarted = true
    void (async () => {
      try {
        const res = await fetch('/api/zones')
        if (!res.ok) return
        const body = await res.json() as { zones?: DramaturgicalZone[] }
        const remote = Array.isArray(body.zones) ? body.zones : []
        const remoteIds = new Set(remote.map((candidate) => candidate.id))
        const local = loadPilotZones(storage).filter((candidate) => !remoteIds.has(candidate.id))
        const migrated: DramaturgicalZone[] = []
        const failed: DramaturgicalZone[] = []
        const tokenMap = loadZoneTokens(storage)
        let activeMigrated: DramaturgicalZone | null = null

        for (const legacy of local) {
          try {
            const input = {
              name: legacy.name,
              city: legacy.city,
              focusIt: legacy.focus.it,
              focusEn: legacy.focus.en,
              themeIt: legacy.themeHint.it,
              themeEn: legacy.themeHint.en,
              lat: legacy.center[0],
              lon: legacy.center[1],
              zoom: legacy.zoom,
            }
            const post = await fetch('/api/zones', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ zone: input }),
            })
            const data = await post.json().catch(() => ({})) as { zone?: DramaturgicalZone; editToken?: string }
            if (!post.ok || !data.zone) { failed.push(legacy); continue }
            migrated.push(data.zone)
            if (data.editToken) {
              tokenMap[data.zone.id] = data.editToken
              saveZoneTokens(tokenMap, storage)
            }
            if (zoneIdRef.current === legacy.id) activeMigrated = data.zone
          } catch {
            failed.push(legacy)
          }
        }

        savePilotZones(failed, storage)
        const combined = [...remote, ...migrated, ...failed]
        setPilotZones(combined)
        setZoneTokens(loadZoneTokens(storage))

        const merged = mergeZones(combined)
        const savedId = loadActiveZoneId(storage, merged)
        const target = activeMigrated
          ?? (savedId ? merged.find((candidate) => candidate.id === savedId) : undefined)
          ?? merged.find((candidate) => candidate.id === zoneIdRef.current)
        if (target) focusZone(target)
      } catch {
        // Offline: keep the legacy local zones and retry after a reload.
      }
    })()
  }, [focusZone, storage])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/cities')
        if (!res.ok) return
        const body = await res.json() as { cities?: City[] }
        if (!cancelled) setCities(Array.isArray(body.cities) ? body.cities : [])
      } catch {
        // Offline: the city list also derives from the zones.
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Keep the shared zones fresh while a collaborator has the page open: new
  // pilot DZs appear without a reload, and deleted ones disappear.
  useEffect(() => {
    const refresh = async () => {
      try {
        const [zonesRes, citiesRes] = await Promise.all([fetch('/api/zones'), fetch('/api/cities')])
        if (zonesRes.ok) {
          const body = await zonesRes.json() as { zones?: DramaturgicalZone[] }
          const remote = Array.isArray(body.zones) ? body.zones : []
          setPilotZones((prev) => {
            const remoteIds = new Set(remote.map((candidate) => candidate.id))
            const tokens = loadZoneTokens(storage)
            const localOnly = prev.filter((candidate) => !remoteIds.has(candidate.id) && !tokens[candidate.id])
            return [...remote, ...localOnly]
          })
        }
        if (citiesRes.ok) {
          const body = await citiesRes.json() as { cities?: City[] }
          if (Array.isArray(body.cities)) setCities(body.cities)
        }
      } catch {
        // Offline: leave the current zones.
      }
    }
    const timer = window.setInterval(() => { void refresh() }, 30_000)
    return () => window.clearInterval(timer)
  }, [storage])

  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return
    const map = L.map(mapDiv.current, { center: zone.center, zoom: zone.zoom })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    storyLayer.current = L.layerGroup().addTo(map)
    map.on('click', (e: L.LeafletMouseEvent) => setPoint([e.latlng.lat, e.latlng.lng]))
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null; storyLayer.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    pinRef.current?.remove()
    pinRef.current = L.circleMarker(point, {
      radius: 9, color: '#ffffff', weight: 2, fillColor: '#1d6f6a', fillOpacity: 0.9,
    }).addTo(map).bindTooltip(t.mapHint)
  }, [point, t])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    locationMarkerRef.current?.remove()
    accuracyCircleRef.current?.remove()
    if (!currentLocation) return
    const color = '#2b7fff'
    if (locationAccuracy && locationAccuracy > 0) {
      accuracyCircleRef.current = L.circle(currentLocation, {
        radius: locationAccuracy, color, weight: 1, fillColor: color, fillOpacity: 0.08,
      }).addTo(map)
    }
    locationMarkerRef.current = L.circleMarker(currentLocation, {
      radius: 7, color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 1,
    }).addTo(map).bindTooltip('GPS')
    return () => {
      locationMarkerRef.current?.remove()
      accuracyCircleRef.current?.remove()
    }
  }, [currentLocation, locationAccuracy])

  const zoneStories = useMemo(
    () => stories.filter((story) => story.dz === zone.id),
    [stories, zone.id],
  )

  // Load the persisted wall of the active DZ. On a static-only deploy (or
  // offline) the fetch fails quietly and the in-session wall still works.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/story?dz=${encodeURIComponent(zone.id)}`)
        if (!res.ok) return
        const body = await res.json() as { stories?: unknown }
        const remote = Array.isArray(body.stories) ? body.stories.filter(isStory) : []
        if (cancelled) return
        setStories((prev) => {
          const remoteIds = new Set(remote.map((story) => story.id))
          const localZone = prev.filter((story) => story.dz === zone.id && !remoteIds.has(story.id))
          const others = prev.filter((story) => story.dz !== zone.id)
          return [...remote, ...localZone, ...others].slice(0, 144)
        })
      } catch {
        // Static-only deploy or network hiccup: keep the local session.
      }
    })()
    return () => { cancelled = true }
  }, [zone.id])

  useEffect(() => {
    const layer = storyLayer.current
    if (!layer) return
    layer.clearLayers()
    for (const story of zoneStories) {
      const color = ARC_COLORS[story.media[0]?.kind ?? 'text'] ?? '#e66c52'
      L.circleMarker(storyPoint(story, zone.center), {
        radius: 8 + Math.min(story.media.length, 4),
        color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 0.85,
      }).addTo(layer).on('click', () => setSelected(story.id))
    }
  }, [zoneStories, zone.center])

  const createZone = useCallback(async () => {
    const query = draft.city.trim() || draft.name.trim()
    if (!query) { setZoneError(t.zoneErrorName); return }
    const editingToken = editingZoneId ? loadZoneTokens(storage)[editingZoneId] ?? '' : ''
    setZoneSaving(true)
    setZoneError(null)
    try {
      let geo: { lat: number; lon: number } | null = null
      try { geo = await geocodePlaceInCity(draft.name, draft.city) } catch { geo = null }
      if (!geo) { setZoneError(t.zoneGeoError); return }

      const input: PilotZoneInput = { ...draft, lat: geo.lat, lon: geo.lon, zoom: 14 }
      const invalid = validateZoneInput(input)
      if (invalid) {
        setZoneError(invalid === 'name' || invalid === 'city' ? t.zoneErrorName
          : invalid === 'focus' ? t.zoneErrorFocus
          : t.zoneGeoError)
        return
      }

      const res = await fetch('/api/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone: input, ...(editingZoneId ? { id: editingZoneId, ...(editingToken ? { token: editingToken } : {}) } : {}) }),
      })
      const body = await res.json().catch(() => ({})) as { zone?: DramaturgicalZone; editToken?: string; error?: string }
      if (!res.ok || !body.zone) throw new Error(body.error ?? `HTTP ${res.status}`)
      const zone = body.zone
      const token = typeof body.editToken === 'string' ? body.editToken : ''
      setPilotZones((prev) => editingZoneId
        ? prev.map((candidate) => candidate.id === zone.id ? zone : candidate)
        : [...prev.filter((candidate) => candidate.id !== zone.id), zone])
      if (token) {
        const next = { ...loadZoneTokens(storage), [zone.id]: token }
        saveZoneTokens(next, storage)
        setZoneTokens(next)
      }
      setDraft(EMPTY_DRAFT)
      setZoneError(null)
      setZoneNotice(null)
      setEditorOpen(false)
      setEditingZoneId(null)
      focusZone(zone)
    } catch {
      setZoneError(t.zoneSaveFailed)
    } finally {
      setZoneSaving(false)
    }
  }, [draft, editingZoneId, focusZone, storage, t])

  const startEditZone = useCallback((target: DramaturgicalZone) => {
    setDraft({
      name: target.name,
      city: target.city,
      focusIt: target.focus.it,
      focusEn: target.focus.en,
      themeIt: target.themeHint.it,
      themeEn: target.themeHint.en,
      lat: target.center[0],
      lon: target.center[1],
      zoom: target.zoom,
    })
    setEditingZoneId(target.id)
    setZoneError(null)
    setEditorOpen(true)
  }, [])

  const createCity = useCallback(async () => {
    const name = cityDraft.trim()
    if (name.length < 2) { setCityError(t.cityErrorName); return }
    const existing = cityOptions.find((candidate) => candidate.toLowerCase() === name.toLowerCase())
    setCityError(null)
    setCityNotice(null)
    if (existing) {
      setDraft((prev) => ({ ...prev, city: existing }))
      setCityNotice(t.cityAlready.replace('{name}', existing))
      setCityEditorOpen(false)
      setEditorOpen(true)
      return
    }
    setCitySaving(true)
    try {
      let geo: { lat: number; lon: number; label: string } | null = null
      try { geo = await geocodePlace(name) } catch { geo = null }
      if (!geo) { setCityError(t.zoneGeoError); return }
      const res = await fetch('/api/cities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city: { name, lat: geo.lat, lon: geo.lon, zoom: 12 } }),
      })
      const body = await res.json().catch(() => ({})) as { city?: City; error?: string }
      if (!res.ok || !body.city) throw new Error(body.error ?? `HTTP ${res.status}`)
      const city = body.city
      setCities((prev) => [...prev.filter((candidate) => candidate.name.toLowerCase() !== city.name.toLowerCase()), city])
      setDraft((prev) => ({ ...prev, city: city.name }))
      setCityNotice(t.cityReady.replace('{name}', city.name))
      setCityEditorOpen(false)
      setEditorOpen(true)
    } catch {
      setCityError(t.zoneSaveFailed)
    } finally {
      setCitySaving(false)
    }
  }, [cityDraft, cityOptions, t])

  const regeolocateZone = useCallback(async (target: DramaturgicalZone) => {
    const query = target.city.trim() || target.name.trim()
    if (!query) { setZoneError(t.zoneGeoError); return }
    setRegeocodingId(target.id)
    setZoneError(null)
    setZoneNotice(null)
    try {
      let geo: { lat: number; lon: number; label: string } | null = null
      try { geo = await geocodePlaceInCity(draft.name, draft.city) } catch { geo = null }
      if (!geo) { setZoneError(t.zoneGeoError); return }
      const token = loadZoneTokens(storage)[target.id] ?? ''
      const input: PilotZoneInput = {
        name: target.name, city: target.city,
        focusIt: target.focus.it, focusEn: target.focus.en,
        themeIt: target.themeHint.it, themeEn: target.themeHint.en,
        lat: geo.lat, lon: geo.lon, zoom: target.zoom,
      }
      const res = await fetch('/api/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone: input, id: target.id, ...(token ? { token } : {}) }),
      })
      const body = await res.json().catch(() => ({})) as { zone?: DramaturgicalZone; error?: string }
      if (!res.ok || !body.zone) throw new Error(body.error ?? `HTTP ${res.status}`)
      const updated = body.zone
      setPilotZones((prev) => prev.map((candidate) => candidate.id === updated.id ? updated : candidate))
      if (editingZoneId === updated.id) {
        setDraft({ ...input, lat: updated.center[0], lon: updated.center[1], zoom: updated.zoom })
      }
      if (zoneId === updated.id) {
        setPoint(updated.center)
        mapRef.current?.setView(updated.center, updated.zoom)
      }
      setZoneNotice(t.zoneRegeolocated.replace('{place}', geo.label || query))
    } catch {
      setZoneError(t.zoneRegeolocateFailed)
    } finally {
      setRegeocodingId(null)
    }
  }, [editingZoneId, storage, t, zoneId])

  const deleteZone = useCallback(async (id: string) => {
    if (!pilotZones.some((candidate) => candidate.id === id)) return
    if (!window.confirm(t.zoneDeleteConfirm)) return
    const token = loadZoneTokens(storage)[id] ?? ''
    try {
      const res = await fetch('/api/zones', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...(token ? { token } : {}) }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
    } catch {
      setZoneError(t.zoneDeleteFailed)
      return
    }
    const updated = pilotZones.filter((candidate) => candidate.id !== id)
    setPilotZones(updated)
    savePilotZones(loadPilotZones(storage).filter((candidate) => candidate.id !== id), storage)
    const tokens = loadZoneTokens(storage)
    delete tokens[id]
    saveZoneTokens(tokens, storage)
    setZoneTokens(tokens)
    if (editingZoneId === id) {
      setEditingZoneId(null)
      setDraft(EMPTY_DRAFT)
      setEditorOpen(false)
    }
    if (zoneId === id) {
      const fallback = mergeZones(updated)[0]!
      setText('')
      focusZone(fallback)
    }
  }, [editingZoneId, focusZone, pilotZones, storage, t, zoneId])

  const pickFiles = useCallback((list: FileList | null) => {
    const files = list ? Array.from(list) : []
    const invalid = validateBudget(files)
    setError(invalid === 'budget' ? t.budgetErr : invalid === 'type' ? t.typeErr : null)
    if (!invalid) setPendingMedia(files.map((file) => ({ file, timeline: '', caption: '' })))
  }, [t])

  const publish = useCallback(async () => {
    if (text.trim().length === 0) { setError(t.errorEmpty); return }
    if (comparative) {
      const timelines = new Set(pendingMedia.map((item) => item.timeline.trim().toLowerCase()).filter(Boolean))
      if (pendingMedia.length < 2 || timelines.size < 2) { setError(t.comparativeError); return }
    }
    setBusy(true)
    setError(null)
    let media: PublishedStory['media'] | undefined
    try {
      if (pendingMedia.length > 0) {
        setUploadPct(0)
        const uploaded = await uploadAll(pendingMedia.map((item) => item.file), (pct) => setUploadPct(pct))
        media = uploaded.map((result, index) => {
          const item = pendingMedia[index]
          return {
            ...result,
            ...(item?.timeline.trim() ? { timeline: item.timeline.trim() } : {}),
            ...(item?.caption.trim() ? { caption: item.caption.trim() } : {}),
          }
        })
        setUploadPct(null)
      }
      const res = await fetch('/api/story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: {
            text, ts: new Date().toISOString(), lang, dz: zone.id,
            lat: geoMode === 'grid' ? point[0] : null,
            lon: geoMode === 'grid' ? point[1] : null,
            comparative,
            media,
          },
          consent: { geo_mode: geoMode, allow_dispatch: true },
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      const story = body.story as PublishedStory
      const editToken = typeof body.editToken === 'string' ? body.editToken : ''
      if (editToken) {
        setMyStories((prev) => {
          const next = { ...prev, [story.id]: editToken }
          saveMyStories(next, storage)
          return next
        })
      }
      setStories((prev) => [story, ...prev].slice(0, 48))
      setSelected(story.id)
      setPendingMedia([])
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : t.typeErr)
    } finally {
      setUploadPct(null)
      setBusy(false)
    }
  }, [text, pendingMedia, comparative, lang, geoMode, point, zone.id, t])

  const deleteStory = useCallback(async (story: PublishedStory) => {
    const token = myStories[story.id]
    if (!token) return
    if (!window.confirm(t.deleteConfirm)) return
    setDeletingId(story.id)
    setError(null)
    try {
      const res = await fetch('/api/story', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: story.id, dz: story.dz, token }),
      })
      const body = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setStories((prev) => prev.filter((candidate) => candidate.id !== story.id))
      setMyStories((prev) => {
        const next = { ...prev }
        delete next[story.id]
        saveMyStories(next, storage)
        return next
      })
      if (selected === story.id) setSelected(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.deleteFailed)
    } finally {
      setDeletingId(null)
    }
  }, [myStories, selected, storage, t])

  const deleteButton = (story: PublishedStory) => myStories[story.id] ? (
    <button
      className="au-chip au-delete"
      disabled={deletingId === story.id}
      onClick={(event) => { event.stopPropagation(); void deleteStory(story) }}
    >
      {deletingId === story.id ? t.deleting : t.deleteStory}
    </button>
  ) : null

  const zonesByCity = useMemo(() => {
    const groups = new Map<string, DramaturgicalZone[]>()
    for (const candidate of pilotZones) {
      const key = candidate.city.trim() || candidate.name.trim()
      const list = groups.get(key) ?? []
      list.push(candidate)
      groups.set(key, list)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [pilotZones])

  const selectedStory = zoneStories.find((story) => story.id === selected) ?? null
  const draftError = zoneError

  return (
    <main className="au">
      <header className="au-head">
        <div className="au-brandrow">
          <span className="au-brand">{t.brand}</span>
          <span className="au-brand-name">{t.brandName}</span>
          <a className="au-suite-link" href="/control">SUITE ↗</a>
          <span className="au-langswitch" role="group" aria-label={t.langLabel}>
            {(['it', 'en'] as UiLang[]).map((l) => (
              <button key={l} className={ui === l ? 'on' : ''} onClick={() => switchUi(l)}>{l.toUpperCase()}</button>
            ))}
          </span>
        </div>
        <h1>{t.title}</h1>
        <p className="au-lede">{t.subtitle}</p>
        <div className="au-modes">
          <span className="au-media-label">{t.zoneLabel}</span>
          {zones.map((candidate) => {
            const coming = candidate.status === 'coming'
            const origin = candidate.origin === 'pilot' ? t.pilotZone : t.curatedZone
            return (
              <button key={candidate.id}
                data-testid="dz-chip"
                data-zone-id={candidate.id}
                data-zone-origin={candidate.origin}
                className={`au-chip${zoneId === candidate.id ? ' on' : ''}${coming ? ' coming' : ''}${candidate.origin === 'pilot' ? ' pilot' : ''}`}
                onClick={() => switchZone(candidate.id)}
                title={coming ? `${candidate.focus[ui]} — ${t.comingSoon}` : `${origin} · ${candidate.focus[ui]}`}>
                {candidate.label}{coming ? ` · ${t.comingSoon}` : ''}
              </button>
            )
          })}
          <button
            className={`au-chip au-chip-pilot${pilotMode ? ' on' : ''}`}
            data-testid="pilot-toggle"
            aria-pressed={pilotMode}
            onClick={togglePilot}>
            {t.pilotMode}{pilotMode ? ` · ${t.pilotOn}` : ''}
          </button>
          {pilotMode && (
            <button
              className="au-chip au-chip-add"
              data-testid="new-dz"
              onClick={() => {
                if (editingZoneId) {
                  setEditingZoneId(null)
                  setDraft(EMPTY_DRAFT)
                  setZoneError(null)
                  setEditorOpen(true)
                } else {
                  setEditorOpen((open) => !open)
                }
              }}
            >
              {t.newZone}
            </button>
          )}
          {pilotMode && (
            <button
              className="au-chip au-chip-add"
              data-testid="new-city"
              onClick={() => {
                setCityEditorOpen((open) => !open)
                setCityError(null)
                setCityNotice(null)
              }}
            >
              {t.newCity}
            </button>
          )}
        </div>
        <p className="au-hint">{zone.focus[ui]}</p>
        {pilotMode && <p className="au-hint au-pilot-hint">{t.pilotHint}</p>}
      </header>

      {pilotMode && pilotZones.length > 0 && (
        <section className="au-zone-manage" data-testid="dz-manage">
          <div className="au-zone-manage-head">
            <span className="au-media-label">{t.manageZones}</span>
            <small>{t.manageZonesHint}</small>
          </div>
          {zonesByCity.map(([cityName, cityZones]) => (
            <div key={cityName} className="au-zone-city">
              <div className="au-zone-city-name">{cityName}</div>
              {cityZones.map((candidate) => (
                <div key={candidate.id} className="au-zone-manage-row">
                  <button type="button" className="au-zone-manage-name" onClick={() => switchZone(candidate.id)}>
                    {candidate.label}{candidate.city ? ` · ${candidate.city}` : ''}
                  </button>
                  <div className="au-zone-actions">
                    {zoneTokens[candidate.id] && <em className="au-zone-own">{t.myZone}</em>}
                    <button type="button" className="au-chip" disabled={regeocodingId === candidate.id} onClick={() => void regeolocateZone(candidate)}>
                      {regeocodingId === candidate.id ? t.zoneGeoLoading : t.regeolocate}
                    </button>
                    <button type="button" className="au-chip" onClick={() => startEditZone(candidate)}>{t.editZone}</button>
                    <button type="button" className="au-chip au-delete-zone" onClick={() => void deleteZone(candidate.id)}>{t.deleteZone}</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {zoneNotice && <p className="au-hint au-zone-notice">{zoneNotice}</p>}
          {zoneError && !editorOpen && <p className="au-error">{zoneError}</p>}
        </section>
      )}

      {pilotMode && cityEditorOpen && (
        <section className="au-card au-city-editor" data-testid="city-editor">
          <h2>{t.newCityTitle}</h2>
          <p className="au-hint">{t.newCityHint}</p>
          <div className="au-zone-form">
            <label>{t.cityName}
              <input value={cityDraft} onChange={(event) => setCityDraft(event.target.value)} />
            </label>
          </div>
          <div className="au-row au-tight">
            <button className="au-submit" disabled={citySaving} onClick={() => void createCity()}>
              {citySaving ? t.zoneGeoLoading : t.createCity}
            </button>
            <button className="au-chip" onClick={() => { setCityEditorOpen(false); setCityError(null) }}>{t.cancel}</button>
          </div>
          {cityError && <p className="au-error">{cityError}</p>}
          {cityNotice && <p className="au-hint au-zone-notice">{cityNotice}</p>}
          {cityOptions.length > 0 && (
            <div className="au-city-options">
              <span className="au-media-label">{t.cities}</span>
              {cityOptions.map((name) => (
                <button
                  key={name}
                  className={`au-chip${draft.city === name ? ' on' : ''}`}
                  onClick={() => {
                    setDraft((prev) => ({ ...prev, city: name }))
                    setCityEditorOpen(false)
                    setEditorOpen(true)
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {pilotMode && editorOpen && (
        <section className="au-card au-zone-editor" data-testid="dz-editor">
          <h2>{editingZoneId ? t.editZoneTitle : t.newZoneTitle}</h2>
          <p className="au-hint">{t.newZoneHint}</p>
          <div className="au-zone-form">
            <label>{t.zoneName}
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label>{t.zoneCity}
              <input list="au-city-options" value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
              <datalist id="au-city-options">
                {cityOptions.map((name) => <option key={name} value={name} />)}
              </datalist>
              <small className="au-hint">{t.cityHint}</small>
            </label>
            <label>{t.focusIt}
              <input value={draft.focusIt} onChange={(e) => setDraft({ ...draft, focusIt: e.target.value })} />
            </label>
            <label>{t.focusEn}
              <input value={draft.focusEn} onChange={(e) => setDraft({ ...draft, focusEn: e.target.value })} />
            </label>
            <label>{t.themeIt}
              <input value={draft.themeIt} onChange={(e) => setDraft({ ...draft, themeIt: e.target.value })} />
            </label>
            <label>{t.themeEn}
              <input value={draft.themeEn} onChange={(e) => setDraft({ ...draft, themeEn: e.target.value })} />
            </label>
          </div>
          <div className="au-row au-tight">
            <button className="au-submit" disabled={zoneSaving} onClick={() => void createZone()}>
              {zoneSaving ? t.zoneGeoLoading : editingZoneId ? t.saveZone : t.createZone}
            </button>
            <button
              className="au-chip"
              onClick={() => {
                setEditorOpen(false)
                setZoneError(null)
                setEditingZoneId(null)
                setDraft(EMPTY_DRAFT)
              }}
            >
              {t.cancel}
            </button>
          </div>
          {draftError && <p className="au-error">{draftError}</p>}
          {zoneNotice && <p className="au-hint au-zone-notice">{zoneNotice}</p>}
        </section>
      )}

      <nav className="au-sectionnav" aria-label={t.sections}>
        <a href="#au-map">{t.mapTitle}</a>
        <a href="#au-story">{t.storyTitle}</a>
        <a href="#au-wall">{t.wallTitle}</a>
      </nav>

      <section className="au-grid">
        <div className="au-col">
          <div className="au-card" id="au-map">
            <h2>{t.mapTitle}</h2>
            <div ref={mapDiv} className="au-map" />
            <div className="au-geo-actions">
              <button type="button" className="au-chip" data-testid="au-locate" disabled={locating} onClick={locateMe}>
                {locating ? t.locating : t.locateMe}
              </button>
              <button type="button" className={`au-chip${follow ? ' on' : ''}`} data-testid="au-follow" aria-pressed={follow} onClick={toggleFollow}>
                {follow ? t.following : t.followMe}
              </button>
            </div>
            {locationError && <p className="au-error" data-testid="au-location-error">{locationError}</p>}
            {currentLocation && <p className="au-hint" data-testid="au-location-status">{t.locationPrivacy}</p>}
            <p className="au-hint">{t.mapHint}</p>
          </div>

          <div className="au-card" id="au-story">
            <h2>{t.storyTitle}</h2>
            <div className="au-presets">
              {zone.presets.map((preset) => (
                <button key={preset.label} className="au-chip" onClick={() => { setText(preset.text); setLang(preset.lang) }}>{preset.label}</button>
              ))}
            </div>
            <textarea className="au-text" value={text} rows={5} placeholder={t.storyPh}
              onChange={(e) => setText(e.target.value)} />
            <div className="au-row au-tight">
              <input ref={fileInput} type="file" multiple hidden
                accept="image/*,video/*,audio/*,.txt,.md,.csv"
                onChange={(e) => { pickFiles(e.target.files); e.target.value = '' }} />
              <button className="au-chip" onClick={() => fileInput.current?.click()}>{t.uploadBtn}</button>
              <button
                className={`au-chip${comparative ? ' on' : ''}`}
                aria-pressed={comparative}
                data-testid="au-comparative"
                onClick={() => setComparative((value) => !value)}
              >
                {t.comparative}
              </button>
              <label>{t.storyLang}
                <select value={lang} onChange={(e) => setLang(e.target.value)}>
                  <option value="it">it</option><option value="en">en</option><option value="fr">fr</option>
                </select>
              </label>
            </div>
            {comparative && <p className="au-hint au-comparative-hint">{t.comparativeHint}</p>}
            {pendingMedia.length > 0 && (
              <div className="au-files">
                <span className="au-media-label">{(totalSize(pendingMedia.map((item) => item.file)) / 1024 / 1024).toFixed(2)} / 50 MB</span>
                <ul>
                  {pendingMedia.map((item, index) => (
                    <li key={`${item.file.name}-${index}`} className="au-file-row">
                      <span className="au-wall-mood">{item.file.type || 'file'} · {(item.file.size / 1024).toFixed(0)} kB</span>
                      {comparative && (
                        <input
                          className="au-media-input"
                          value={item.timeline}
                          maxLength={40}
                          placeholder={t.timelineLabel}
                          aria-label={t.timelineLabel}
                          onChange={(event) => setPendingMedia((prev) => prev.map((candidate, i) => i === index ? { ...candidate, timeline: event.target.value } : candidate))}
                        />
                      )}
                      <input
                        className="au-media-input"
                        value={item.caption}
                        maxLength={80}
                        placeholder={t.captionLabel}
                        aria-label={t.captionLabel}
                        onChange={(event) => setPendingMedia((prev) => prev.map((candidate, i) => i === index ? { ...candidate, caption: event.target.value } : candidate))}
                      />
                      <button className="au-chip" onClick={() => setPendingMedia((prev) => prev.filter((_, i) => i !== index))}>{t.remove}</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="au-hint">{t.uploadHint}</p>

            <h3>{t.consentTitle}</h3>
            <div className="au-consent">
              <label className={geoMode === 'grid' ? 'on' : ''}>
                <input type="radio" name="geo" checked={geoMode === 'grid'} onChange={() => setGeoMode('grid')} />
                <span><b>{t.consentGrid}</b> — {t.consentGridHint}</span>
              </label>
              <label className={geoMode === 'none' ? 'on' : ''}>
                <input type="radio" name="geo" checked={geoMode === 'none'} onChange={() => setGeoMode('none')} />
                <span><b>{t.consentNone}</b> — {t.consentNoneHint}</span>
              </label>
            </div>
            <p className="au-hint">{t.localPoint(point)}</p>

            <div className="au-row">
              <button className="au-submit" disabled={busy || totalSize(pendingMedia.map((item) => item.file)) > MEDIA_TOTAL_BUDGET} onClick={publish}>
                {busy ? (uploadPct !== null ? `${t.uploaded} ${uploadPct}%` : t.submitting) : t.submit}
              </button>
            </div>
            {error && <p className="au-error">{error}</p>}
          </div>
        </div>

        <div className="au-col">
          <div className="au-card" id="au-wall">
            <h2>{t.wallTitle} ({zoneStories.length})</h2>
            {zoneStories.length === 0 && <p className="au-hint">{t.wallEmpty}</p>}
            <ul className="au-wall">
              {zoneStories.map((story) => (
                <li key={story.id} className={selected === story.id ? 'sel' : ''} onClick={() => setSelected(story.id)}>
                  <span className="au-wall-dim" style={{ background: ARC_COLORS[story.media[0]?.kind ?? 'text'] }}>{story.media[0]?.kind ?? 'text'}</span>
                  <span className="au-wall-mood">{story.geo ? story.geo.index : t.noGeo}</span>
                  <span className="au-wall-id">{story.author_pseudonym} · {story.ts.slice(0, 16).replace('T', ' ')}</span>
                  <p className="au-wall-text">{story.text.length > 220 ? story.text.slice(0, 220) + '…' : story.text}</p>
                  {story.comparative && <span className="au-compare-badge">{t.comparative}</span>}
                  {story.media.length > 0 && (
                    <div className={`au-wall-media${story.comparative ? ' comparative' : ''}`}>
                      {story.media.map((m) => (
                        <figure key={m.id} className="au-media-card">
                          {(m.timeline || m.caption) && (
                            <figcaption>
                              {m.timeline && <b>{m.timeline}</b>}
                              {m.caption && <small>{m.caption}</small>}
                            </figcaption>
                          )}
                          <MediaThumb media={m} alt="story media" />
                        </figure>
                      ))}
                    </div>
                  )}
                  {deleteButton(story)}
                </li>
              ))}
            </ul>
          </div>

          {selectedStory && (
            <div className="au-card">
              <h2>{t.wallTitle} · {selectedStory.id}</h2>
              <p className="au-wall-text">{selectedStory.text}</p>
              {selectedStory.comparative && <span className="au-compare-badge">{t.comparative}</span>}
              {selectedStory.media.length > 0 && (
                <div className={`au-wall-media${selectedStory.comparative ? ' comparative' : ''}`}>
                  {selectedStory.media.map((m) => (
                    <figure key={m.id} className="au-media-card">
                      {(m.timeline || m.caption) && (
                        <figcaption>
                          {m.timeline && <b>{m.timeline}</b>}
                          {m.caption && <small>{m.caption}</small>}
                        </figcaption>
                      )}
                      <MediaThumb media={m} alt="story media" />
                    </figure>
                  ))}
                </div>
              )}
              <p className="au-meta">{selectedStory.geo ? selectedStory.geo.index : t.noGeo} · {t.anonymous}: {selectedStory.author_pseudonym}</p>
              <p className="au-hint">{t.privacy}</p>
              {deleteButton(selectedStory)}
            </div>
          )}
        </div>
      </section>

      <footer className="au-foot">
        <span>{t.privacy}</span>
        <span>{t.footRight}</span>
      </footer>
    </main>
  )
}
