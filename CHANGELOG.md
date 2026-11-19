# CHANGELOG

All notable changes to the URBAN ASSIST reference. Tags mark fork baselines.

## v1.3.0 — 2026-11-19

**Post-production for the field: BULK ingest and the automatic assembler.**

- **BULK upload** (composer, beta): many media at once, batch tags, deterministic
  multi-agent post-production — TaggerAgent (tags/date/day-part from names + batch
  tags), TimeAgent (day type, service period), **GeoAgent (place from tags only**,
  exact tokens against curated/pilot zones and cities, anonymous cell, source and
  confidence declared), UtteranceAgent (one de-identified sentence, no invention),
  MontageAgent (typology from the filtering categories), CoherenceAgent (groups by
  place+date, warnings, trim beyond 8 media). Review list → “open in the composer”.
- **Automatic assembler** always available on the composer media: filtering-category
  typologies (functional, fictional, proximity, place, topic, community), theme bias,
  coherence report, storyboard, preview, apply captions/timelines, export plan JSON.
- **Limited video export (beta)**: the collaborators' beat-aligned renderer, bounded
  (≤15 s, ≤8 clips, ≤20 MB), gated behind `?exp`, cancellable; pure-part tests.
- **Bulk test limits**: max 40 files · 50 MB/file · 300 MB/batch; explicit errors.
- Empty-city state: a city without DZs no longer shows the previous city's content;
  the map centres on the city and opens the first-DZ editor.
- Design: Space Grotesk, bluer night ground, map-first layout with filters under the
  map, selected-story media beside the map, mobile publish bar.
- Median metadata fix; symbolic media icons; pilot scoping per city.

## v1.1.0 — 2026-11-16

**Map-first layout and the urban identity.**

- Map at the top-left, right below the intro; state/filters moved to the right.
- Poetic intro (IT/EN) on the relational power of stories and dramaturgical
  intelligence — the human–AI *co-learning factor* (Lorenzo Brusci).
- Type: **Archivo** (urban signage grotesque) for the interface, Newsreader for
  the narratives; light paper grain.
- Urban night ground: deeper backdrop with a blurred city-block grid, duotone
  glows and fine grain; floating paper cards, light header.
- Symbolic story icons: the marker encodes the shared media (image, video,
  audio, text, mixed).
- Pilot mode: **NEW CITY first**, then **NEW DZ** (prefilled with the last
  selected city); zone management scoped to the active city — no other city's
  zones while you work in one.

## v1.0.1 — 2026-11-14

- Restore the city/zone helpers (`cityNamesOf`, `zonesInCity`, `zoneCityKey`)
  used by the city switcher and by the fork-parity tests.

## v1.0.0 — 2026-11-14

**Emergent map state, recurring-event calendar, additive fabric, project packs.**

- `src/core/state/`: one `Query` model (theme / free text / recurring event /
  combined), one `State` with `resolvedFilter`, relevance-weighted stories,
  fabric snapshot, template `explanation` and declared `coverage.sparse`.
- Server-side computation: `GET /api/state` (Netlify Function); the browser
  never computes semantic relevance. Lexical + entities fallback declared in
  `resolvedFilter.matchMode`.
- Non-destructive corpus: non-relevant stories stay visible, attenuated.
- Search: themes (from pack), free text, combination (AND), removable chips,
  empty search = ordinary state, zero results = explicit state with suggestions.
- URL state: `?theme=&q=&event=&from=&to=&dz=&pack=` — shareable and reproducible.
- Recurring event calendar: templates + annual instances with `source`,
  `confidence` (`verified|approximate|client`), `status` including `tbd`
  (Beirut Marathon and the 2026 national festival editions are flagged, not
  presented as certain). Scicli, Beirut and national datasets included.
- Meta-relations: proximity, place, cooccurrence, topic, semantic (when
  available), author_community; toggle, inspectable justifications (templates).
- Additive fabric layer: opacity 0–100, `filaments` / `field` modes (no
  `weave`), pack-driven palette/curvature/width/halo, hover labels,
  `prefers-reduced-motion` respected, graceful degradation with few stories.
- Project packs (`?pm=1`): pack selection, colour-blind-safe palette presets,
  opacity/curvature, default theme, copy current URL, export/import JSON,
  bounded and validated parameters.
- Genericity: any city/DZ works from configuration — pilot zones get a default
  pack; `testville` fixture test guards against hardcoding any territory.
- Robustness: persistent capture draft, resumable chunked media queue with
  per-item state, offline consultation of the last wall, visible build version,
  technical telemetry without story text, "report a problem" with technical
  context.
- Fix: media functions read `{etag, metadata}` from `@netlify/blobs` and serve
  the correct `Content-Type` (previously always `application/octet-stream`).
- Live reference: https://urban-assist-982.netlify.app
