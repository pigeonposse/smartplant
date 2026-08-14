
# smartplant

[![HEADER](https://github.com/pigeonposse/smartplant/blob/main/docs/banner.png?raw=true)](https://github.com/pigeonposse)

**A bridge between AI and plants.** Pluggable sensors, persistent plant memory, multi-provider AI, and a first-person plant voice.

Node.js 18+. Zero runtime dependencies in the core.

Its habit, everywhere: **it refuses rather than guesses.** A layer that lacks what it needs says so and names the sensor that would unlock it, instead of substituting a plausible number. That is why a plant with four sensors says little and means all of it.

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

```js
await plant.systemDiagnosis()   // 25 checks: what is wired, what is not, what to fix
await plant.serve()             // the whole thing in a browser, read-only
```

## Beyond the basics

Every layer works alone and they compose. The full write-up is in the [main README](https://github.com/pigeonposse/smartplant); this is what exists and what each is for.

| | |
| --- | --- |
| **Electrophysiology** | Action and variation potentials, circadian rhythm, an electrome fingerprint that is this plant's rather than the species' |
| **Internal states** | Five estimates of what the plant is *doing* — defence activation, internal water stress, accumulated load, stress memory, circadian integrity. Low confidence removes a state's authority rather than annotating it |
| **Spectral** | LED as a probe rather than illumination, with dose ledgers and interlocks |
| **Vision** | Classical phenotyping, ONNX models, a PlantCV bridge |
| **Colony** | Plants talking to plants over a channel closed to people, with delivery that survives a link failing |
| **Space** | WiFi presence and a lidar scan — is anybody in the room, and how far away is the neighbour really |
| **Body** | Multirate fusion, reflexes, safety limits, personalization |
| **Navigation** | The constraints a robot stack cannot know, over a planner it delegates to |
| **Dashboard** | `plant.serve()` — a dark terminal on localhost, read-only |
| **Co-adaptation** | One door every action goes through, and a record of when its own refusals turned out to have been unnecessary |

### Reading the space

```js
await plant.attachSensor( {
  driver : 'presence',           // WiFi. `sensing` has no default:
  sensing: 'csi',                // RSSI is one number, CSI is one per subcarrier,
  sample : readRadio,            // and what can honestly be reported differs
} )

await plant.attachSensor( { driver: 'lidar', scan: readRplidar } )
```

Presence answers two things the library was short of: whether the room is occupied, which is what the UV-B interlock needs, and whether anybody moved at the moment of an electrical event — brushing a leaf produces an action potential that looks exactly like the start of a wound response.

One lidar scan measures the distance between two plants, which every shared-humidity and CO₂ conclusion had been resting on and which a person had been typing in. Mapping is delegated: Nav2 does it properly.

**Not claimed:** pose, identity, breathing, counting people, or a map of your flat.

### Being wrong about itself

```js
plant.mayI( 'probe' )          // { allowed: false, blockedBy: [ … ] }
plant.posture()                // every action, and what the states make of it
plant.trajectory()             // is the coupling deepening or degrading
await plant.exportIdentity()   // the same plant, into its next body
```

Every action goes through one door, and care is never blocked. An internal state that refuses things is making a claim nothing had ever checked, and there is exactly one place the other arm of that experiment exists: **an override is a natural experiment.** Somebody who passes `{ force: true }` has run the trial the system declined to run, and if nothing went wrong, that is a false positive observed rather than inferred.

### A colony that does not go quiet

```js
plant.colony.addLink( backup, { name: 'backup', priority: 20 } )
plant.colony.deliveryHealth()
```

A message goes out over every link worth trying and is spooled if none took it. Messages have a shelf life, because *"I am thirsty"* delivered two hours late waters a plant that was watered ninety minutes ago; what survives the wait arrives flagged as late. Design taken from [Maskpert](https://github.com/AlejoMalia/lecc).

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
import { internalStates } from 'smartplant/states'
import { planMove }       from 'smartplant/navigation'
import { serveVitals }    from 'smartplant/dashboard'
import { readSpace }      from 'smartplant/spatial'
import { PresenceSensor } from 'smartplant/sensors/presence'
import { LidarSensor }    from 'smartplant/sensors/lidar'
import { couplingState } from 'smartplant/colony'
```

## Migrating from 1.x

1.x exported a single `SmartPlant` class from `src/main.js` that started an interactive CLI on import, so it could not be used as a library. The plugins called `smartplant.getSensor()`, `smartplant.analyze()` and `smartplant.registerPlugin()`, none of which existed.

* The CLI now lives in `src/cli.js`; importing the package no longer starts it.
* `getSensor()`, `analyze()` and `registerPlugin()` exist and are tested.
* `import { SmartPlant } from 'smartplant/src/main.js'` still resolves.
* Stored `historicalData` from 1.x is migrated automatically on first load.
* Plugins are ESM and take the kernel: `await plant.use( plugin )`.

## What has and has not touched hardware

Worth knowing before trusting any of it with a plant you care about.

**Exercised against something real.** Serial, over a pseudo-terminal the `serialport` package cannot distinguish from a port with an Arduino on it — JSON frames, CSV frames, rubbish on the line, and a device that stops talking going stale rather than serving its last value forever. MQTT, against a real broker over a real socket using the same `mqtt` package you would install, including a retained message published before subscribing and wildcard topics. The electrode over that same real serial transport rather than its simulator.

**Never touched a device.** Everything else. No ESP32-S3 with CSI firmware has fed the presence driver, no RPLIDAR has fed the lidar one, no real Home Assistant has answered the integration — that was a stand-in server speaking its API, which proves the library speaks the language and not that Home Assistant accepts it. The seven AI providers are exercised through their timeout paths and never really called.

The physiology rests on published work rather than on validation with plants. That low red:far-red suppresses jasmonate signalling is well established; that this code produces that response in a living plant is not something anybody has checked.

## Testing

```bash
npm test
```

The `mock` sensor and `mock` AI provider are deterministic, so the whole library is testable offline.

## 📜 License

MIT — see [LICENSE](https://github.com/pigeonposse/smartplant/blob/main/LICENSE).
