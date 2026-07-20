import type { DirectoryEntry } from '../../shared/filesystem.schema'

// One descriptor for the confinement refusal (ADR-0026). A blocked symlink is
// refused on three client surfaces — the tree row's badge, the error strip when
// the user acts on it, and the preview panel — and they must say the same thing
// in the same words. The server's 403 body says the same in its own words for
// API consumers; this module is the client's copy of that message.

// Short enough to ride on a tree row without pushing the name out of view.
export const CONFINEMENT_BADGE_LABEL = 'outside root'

export function isConfinementBlocked(entry: DirectoryEntry): boolean {
  return entry.escapesRoot
}

// Why the entry is refused, addressed to the person who just clicked it: what
// it is, what the rule is, and that the rule is deliberate rather than a fault.
export function confinementRefusalMessage(entryName: string): string {
  return (
    `not allowed: "${entryName}" is a symlink pointing outside the served root. ` +
    'The explorer only opens what lives inside the root it was given, so this entry ' +
    'cannot be opened, listed, or previewed.'
  )
}
