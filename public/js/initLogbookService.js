/**
 * Exposes logbookService to window so classic scripts (e.g. logbook-page.js) can use it
 * without converting to ES modules.
 */
import { getRoutes, saveRoutes, clearRoutes } from './services/logbookService.js';
window.logbookService = { getRoutes, saveRoutes, clearRoutes };
