import type { MontageStyle, MontageStyleId } from './types.js'

/** Typologies are the app's own filtering categories: the two channels and
 *  the relational families. Declared data, never inferred. */
export const MONTAGE_STYLES: MontageStyle[] = [
  {
    id: 'functional',
    family: 'channel',
    label: { it: 'funzionale · cronaca', en: 'functional · report' },
    description: {
      it: 'Ordine cronologico, tagli netti, didascalie fattuali: il racconto come misura.',
      en: 'Chronological order, hard cuts, factual captions: the story as measurement.',
    },
    cadenceSec: 4,
    dissolve: false,
    maxShotSec: 8,
  },
  {
    id: 'fictional',
    family: 'channel',
    label: { it: 'fictional · scena', en: 'fictional · scene' },
    description: {
      it: 'Respiro più lungo, dissolvenze, alternanza largo/dettaglio: il racconto come scena.',
      en: 'Longer breath, dissolves, wide/detail alternation: the story as a scene.',
    },
    cadenceSec: 6,
    dissolve: true,
    maxShotSec: 10,
  },
  {
    id: 'proximity',
    family: 'relation',
    label: { it: 'prossimità', en: 'proximity' },
    description: {
      it: 'I media si raggruppano per cella anonima: prima ciò che accade vicino.',
      en: 'Media group by anonymous cell: first what happens nearby.',
    },
    cadenceSec: 4,
    dissolve: true,
    maxShotSec: 8,
  },
  {
    id: 'place',
    family: 'relation',
    label: { it: 'luogo', en: 'place' },
    description: {
      it: 'Un luogo alla volta, celle in ordine: il montaggio come attraversamento.',
      en: 'One place at a time, cells in order: montage as a crossing.',
    },
    cadenceSec: 5,
    dissolve: false,
    maxShotSec: 8,
  },
  {
    id: 'topic',
    family: 'relation',
    label: { it: 'argomento', en: 'topic' },
    description: {
      it: 'Il tema scelto guida l’ordine; il resto resta come contesto.',
      en: 'The chosen theme leads the order; the rest stays as context.',
    },
    cadenceSec: 4,
    dissolve: false,
    maxShotSec: 8,
  },
  {
    id: 'community',
    family: 'relation',
    label: { it: 'comunità', en: 'community' },
    description: {
      it: 'Alternanza dei tipi di media per dare voce a materiali diversi.',
      en: 'Alternate media kinds so different materials speak in turn.',
    },
    cadenceSec: 5,
    dissolve: true,
    maxShotSec: 8,
  },
]

export function styleById(id: MontageStyleId): MontageStyle {
  return MONTAGE_STYLES.find((style) => style.id === id) ?? MONTAGE_STYLES[0]!
}
