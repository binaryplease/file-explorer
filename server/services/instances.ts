import { config } from '../config'
import { createFilesystemService } from './filesystem'
import { createPreviewService } from './preview'

// Composition root for the server's services (ADR-0007 factories, wired once).
// Created at startup so a bad EXPLORER_ROOT crashes the boot, not a request.
export const filesystemService = createFilesystemService({
  rootAbsolutePath: config.EXPLORER_ROOT,
})

// Preview borrows the filesystem service's confinement rather than
// re-implementing it: every path it reads has been resolved through the root
// guard first.
export const previewService = createPreviewService({ filesystemService })
