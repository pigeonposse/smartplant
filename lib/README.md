
# smartplant

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

**A bridge between AI and plants.** Pluggable sensors, persistent plant memory, multi-provider AI, and a first-person plant voice.

Node.js 18+. Zero runtime dependencies in the core.

```bash
npm install smartplant
```

## Quick start

```js
import { createPlant } from 'smartplant'

const plant = await createPlant( {
  name    : 'Rosa',
  species : 'Monstera deliciosa',
  sensor  : 'mock',
  ai      : { provider : 'mock' },
} )

await plant.read()
console.log( plant.status() )
```

That runs with no hardware, no API key and no network.

## Configuration

```js
createPlant( {
  name     : 'Rosa',                  // plant name
  species  : 'Monstera deliciosa',    // improves AI advice
  type     : 'indoor',                // 'indoor' | 'outdoor'
  language : 'es',                    // en es fr de it pt nl ru zh ja
  persona  : 'plant',                 // plant | botanist | poet | scientist | child
  interval : 60_000,                  // monitoring interval (ms)

  sensor : 'mock',                    // or { driver: 'serial', path: '/dev/ttyACM0' }

  ai : {
    provider    : 'ollama',           // gemini openai claude grok ollama mock
    apiKey      : undefined,          // falls back to the provider's env var
    model       : undefined,
    retries     : 2,
    cacheTTL    : 30_000,             // dedupes identical requests
    temperature : 0.7,
  },

  memory : {
    path        : './rosa.json',      // omit for in-memory only
    maxReadings : 2000,
    autosave    : true,
  },

  ranges : {                          // comfort bands (AI-generated if omitted)
    soil : { min : 35, max : 70 },
  },
} )
```

## API

### Sensing

| Method | Returns | Notes |
| --- | --- | --- |
| `read()` | `Reading` | Reads every attached sensor, stores it, emits events |
| `attachSensor(spec)` | `SensorDriver` | Id, `{driver, ...config}`, or an instance |
| `registerSensor(id, driver)` | `this` | Register a custom driver class or instance |
| `getSensor(id?)` | `SensorDriver` | Defaults to the first attached driver |
| `status(reading?)` | `string` | One-line emoji status. No AI, no network |
| `happiness(reading?)` | `number` | Wellbeing 0-100 |
| `context(reading?)` | `object` | Full situation: identity, reading, ranges, trends, care log |

### AI

| Method | Returns | Notes |
| --- | --- | --- |
| `analyze(question, opts?)` | `object` | Structured answer with your `schema` keys guaranteed |
| `speak(message?, opts?)` | `string` | Free-form reply in the plant's voice |
| `learnSpecies(opts?)` | `object` | Generates and stores the species care profile. Run once |

Both degrade gracefully: if the AI is unreachable or unconfigured, they return the deterministic offline voice rather than throwing.

```js
const result = await plant.analyze( 'Does this plant need repotting?', {
  schema : { advice : '', urgency : 'low', potSizeCm : 0 },
} )
// result.advice, result.urgency, result.potSizeCm are always present
```

### Memory & care

| Method | Notes |
| --- | --- |
| `water(detail?)` | Records a watering and takes a reading |
| `fertilize(detail?)` | Records a feeding |
| `log(type, detail?)` | Any other event: repotting, pruning, a spotted pest |
| `note(text)` | Free-text observation |
| `memory.stats(hours)` | Per-metric `{min, max, avg, trend, n}` |
| `memory.daysSince(type)` | Whole days since an event, or `null` |
| `memory.forget()` | Erase stored history |

### Lifecycle

| Method | Notes |
| --- | --- |
| `init()` | Loads memory and attaches the sensor. Idempotent |
| `startMonitoring(opts?)` | Reads immediately, then on an interval |
| `stopMonitoring()` | Stops the loop |
| `destroy()` | Stops everything, disconnects transports, saves memory |

### Events

```js
import { EVENTS } from 'smartplant'

plant.on( EVENTS.THIRSTY, e => console.log( e.metric, e.value, e.range ) )
plant.on( '*', ( payload, name ) => console.log( name ) )
```

`sensor:reading` · `sensor:error` · `plant:thirsty` · `plant:drowning` · `plant:too-hot` · `plant:too-cold` · `plant:too-dark` · `plant:too-bright` · `plant:stressed` · `plant:happy` · `plant:spoke` · `alert` · `plugin:loaded` · `ai:request` · `ai:response` · `error`

Listeners may be async — `emit` awaits them. One listener throwing never stops the others or the monitoring loop.

## Custom sensors

```js
import { SensorDriver } from 'smartplant'

class MyProbe extends SensorDriver {
  static id = 'my-probe'

  async connect() { /* open transport */ this.connected = true; return this }

  async read() {
    // normalize() drops non-numeric values and stamps the timestamp
    return this.normalize( { soil : 42, temperature : 21.5 } )
  }
}

plant.registerSensor( 'my-probe', MyProbe )
await plant.attachSensor( 'my-probe' )
```

Recognized metrics: `temperature` (°C), `humidity` (%), `soil` (%), `light` (lux), `ph`, `conductivity` (µS/cm).

## Custom AI providers

```js
plant.ai.registerProvider( 'my-llm', {
  label    : 'My LLM',
  needsKey : false,
  generate : async ( { prompt, system } ) => callMyModel( system, prompt ),
} )

plant.ai.use( 'my-llm' )
```

## Plugins

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
      return this.ask( 'Is this plant root-bound and ready for a bigger pot?', { extra : input } )
    },
  },
} )
```

Inside a plugin, `this.plant` is the kernel, `this.ask()` runs a context-injected structured AI call, and `this.context()` is the current situation. Event listeners are detached automatically on `destroy()`.

## Subpath exports

```js
import { PlantMemory }   from 'smartplant/memory'
import { SerialSensor }  from 'smartplant/sensors/serial'
import { MqttSensor }    from 'smartplant/sensors/mqtt'
import { statusLine }    from 'smartplant/voice'
import { definePlugin }  from 'smartplant/plugin'
```

## Migrating from 1.x

1.x exported a single `SmartPlant` class from `src/main.js` that started an interactive CLI on import, so it could not be used as a library. The plugins called `smartplant.getSensor()`, `smartplant.analyze()` and `smartplant.registerPlugin()`, none of which existed.

* The CLI now lives in `src/cli.js`; importing the package no longer starts it.
* `getSensor()`, `analyze()` and `registerPlugin()` exist and are tested.
* `import { SmartPlant } from 'smartplant/src/main.js'` still resolves.
* Stored `historicalData` from 1.x is migrated automatically on first load.
* Plugins are ESM and take the kernel: `await plant.use( plugin )`.

## Testing

```bash
npm test
```

The `mock` sensor and `mock` AI provider are deterministic, so the whole library is testable offline.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
