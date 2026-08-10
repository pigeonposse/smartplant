/**
 * Compatibility entry point.
 *
 * 1.x published `src/main.js` as the package main and it both exported
 * `SmartPlant` and auto-started the interactive CLI on import — which made the
 * library unusable as a library. The CLI now lives in `cli.js`; this file stays
 * so `import { SmartPlant } from 'smartplant/src/main.js'` keeps resolving.
 *
 * @deprecated Import from the package root instead: `import { createPlant } from 'smartplant'`.
 */

export * from './index.js'
