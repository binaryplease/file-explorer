import { config } from '../config'
import { createFilesystemService } from './filesystem'
import { createPreviewService } from './preview'

// Composition root for the server's services (`factory-services`, wired once).
// Created at startup so a bad EXPLORER_ROOT crashes the boot, not a request.
export const filesystemService = createFilesystemService({
  rootAbsolutePath: config.EXPLORER_ROOT,
  confine: config.EXPLORER_CONFINE,
})

// Preview borrows the filesystem service's path resolution rather than
// re-implementing it: every path it reads has been resolved through the same
// root guard, so it inherits whichever confinement mode is configured.
export const previewService = createPreviewService({ filesystemService })
