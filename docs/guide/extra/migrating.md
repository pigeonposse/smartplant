# Migrating from 1.x

**3.0.0 is the first release where the plugin system actually works.**

1.x exported a single class from `src/main.js` that started the interactive CLI on import, so the package could not be used as a library. Its plugins called `getSensor()`, `analyze()` and `registerPlugin()` — none of which existed.

- The CLI moved to `src/cli.js`; importing the package no longer starts it. `src/main.js` remains as a compatibility re-export.
- Those three methods now exist and are tested. All ten plugins run.
- Stored `historicalData` migrates automatically on first load.
- Plugins are ESM and take the kernel: `await plant.use( plugin )`.
