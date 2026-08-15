# Plugins

Eighteen official plugins, each installable on any plant:

```js
import watering from '@smartplant/watering'

await plant.use( watering )
const { advice, daysUntilWater } = await plant.plugin( 'watering' ).predictWatering()
```

| Plugin | Method | Also does locally, with no AI |
| --- | --- | --- |
| 💧 `@smartplant/watering` | `predictWatering()` | Reacts to `plant:thirsty` |
| ⚠️ `@smartplant/alerts` | `checkAlerts()` | Stays silent — and free — when nothing is wrong |
| 📈 `@smartplant/history` | `analyzeTrends()` | `stats()`, `series()`; reports "unknown" rather than inventing a trend |
| ☀️ `@smartplant/lighting` | `optimizeLight()` | `dailyLightHours()` |
| 💨 `@smartplant/ventilation` | `adjustVentilation()` | `vpd()` — vapour pressure deficit via the Tetens equation |
| 😟 `@smartplant/stress` | `detectStress()` | `chronicScore()` — fraction of 48h spent below comfort |
| 🐛 `@smartplant/pests` | `monitorPests()` | `identify( symptoms )`, logged to care history |
| 🌱 `@smartplant/fertilizer` | `guideFertilization()` | Errs toward underfeeding — burn is harder to undo than deficiency |
| 📔 `@smartplant/diary` | `logAndSummarize()` | The plant writes its own journal, stored in memory |
| 🔮 `@smartplant/simulator` | `simulateConditions()` | `score()`, `sweep()` — find where tolerance breaks, instantly |
| 🔬 `@smartplant/spectrum` | `diagnose()` | `probe()`, `treat()`, `doses()` — 🔵🟢🔴 interrogation with hard interlocks |
| 🧬 `@smartplant/migration` | `bequeath()` | `receive()`, `wouldSuit()`, `outcome()` — inheritance between plants of one species |
| 🗨 `@smartplant/colony` | `askPeer()` | `askAll()`, `report()`, `corroborate()` — a channel between plants a person can watch but not enter |
| 🪴 `@smartplant/transplant` | `plan()` | `space()`, `settling()` — notices the pot filling up months before a person does, and never repots anything |
| 🌡 `@smartplant/thermal` | `stress()` | `evenness()`, `map()` — the whole canopy at once, which one leaf clip cannot see |
| 📡 `@smartplant/presence` | `uvbAllowed()` | `room()`, `explains()` — the UV-B interlock, and motion as a control on electrical events |
| 🍂 `@smartplant/season` | `ranges()` | `now()`, `lastYear()` — bends care to the time of year, and fades as the plant learns its own |
| 🔋 `@smartplant/energy` | `forecast()` | `plan()`, `canTravel()` — what runs off a panel and a battery, and what sleeps |

Writing your own takes one function:

```js
import { definePlugin } from 'smartplant'

export default definePlugin( {
  name    : 'repotting',
  persona : 'botanist',
  schema  : { advice : '', urgency : 'low' },

  on : {
    async 'plant:stressed'( event ) {
      console.log( await this.whenToRepot() )
    },
  },

  methods : {
    async whenToRepot( input = {} ) {
      return this.ask( 'Is this plant root-bound?', { extra : input } )
    },
  },
} )
```

Inside a plugin, `this.plant` is the kernel, `this.ask()` runs a context-injected structured AI call, and listeners detach automatically on `destroy()`.
