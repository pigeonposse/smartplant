# smartplant

## 3.0.1

### Minor Changes

- **OpenClaw as the plant's brain, not a messaging bridge.** `OpenClawBrain` hands
  the model the plant's whole control surface — 12 reading tools and 7 acting
  ones — and lets it decide what to look at and what to do. `plant.useBrain()`
  attaches it and switches the plant's ordinary AI to the Gateway at the same
  time, so SmartPlant needs no API key and no Ollama install.

  The brain never acts directly. Every acting tool passes three gates: the
  evidence ledger, an optional human confirmation hook, and the subsystem itself.
  A refusal comes back as a tool result with its reasons rather than an
  exception, so the model reasons about the constraint inside the run. The brain
  decides *whether*; the subsystem decides *how much*.

  Also: `openclawEmbedder()` so semantic memory works through the Gateway with no
  key, `brain.supervise()` for standing watch, `brain.stats()` reporting which
  gate stopped what, and `smartplant brain "<goal>"`.

- **Spectral probing: light as a diagnostic instrument.** 🔵 blue reads stomatal
  competence (hydration), 🔴 red reads Photosystem II (photosynthetic capacity),
  🟢 green penetrates to the deep mesophyll. Blue weak with red strong is water
  stress; blue strong with red weak is nutrient deficiency — a distinction no
  single passive electrode can make.

  Measurement follows the LIRB method: a periodic light/dark carrier, with the
  plant's state appearing as modulation. Phase locking with an SNR against the
  noise floor, cycle folding that averages noise down as 1/√N, harmonic
  distortion as an early marker of ionic imbalance, all relative to an 🟠 amber
  control channel.

  Timescales are enforced: stomatal opening takes 5-30 minutes, so the blue probe
  runs on a 16-minute period. A probe faster than its pathway is refused with an
  explanation rather than returning a confident-looking zero.

  Treatment is gated by arithmetic. Blue is refused on dry soil — the plant
  closed its stomata via ABA to conserve water, and forcing them open accelerates
  dehydration. Missing data blocks rather than permits. UV-B and far-red need
  explicit human authorization.

### Patch Changes

- OpenClaw Gateway defaults corrected against its documentation: port **18789**
  (was 4747), auth variable `OPENCLAW_GATEWAY_TOKEN`, and auth required by
  default with an error that says so. Added `/v1/models` and `/v1/embeddings`.
- A `GET` request no longer carries a `body` key.
- `smartplant/integrations/openclaw` is now a directory module; the import path
  is unchanged.

## 3.0.0

### Major Changes

- **The plugin system now exists.** In 1.x every plugin called `smartplant.getSensor()`,
  `smartplant.analyze()` and `smartplant.registerPlugin()`; none of those functions were
  ever implemented, and the CJS plugins could not import the ESM core. All three exist,
  are tested, and all ten plugins run.

- **The library is usable as a library.** `src/main.js` started the interactive CLI on
  import, so importing the package hijacked the process. The CLI moved to `src/cli.js`;
  `src/main.js` remains as a compatibility re-export.

- **Sensors are pluggable.** A driver contract with seven built-ins — `mock`, `manual`,
  `serial`, `mqtt`, `http`, `homeassistant`, `electrode` — and `registerSensor()` for your
  own. `mock` and `manual` need no hardware.

- **The plant has memory.** Readings, care log, notes and an AI-generated species profile
  persist to a single JSON file, with atomic writes and automatic migration from the 1.x
  `historicalData` shape.

- **AI is a real layer.** Provider registry, retries with backoff, response caching, and
  structured JSON output with schema coercion. Every AI path degrades to a deterministic
  offline voice instead of throwing.

- **The plant speaks.** Five personas and `plant.speak()` for first-person conversation,
  in ten languages.

- **Semantic events.** `plant:thirsty`, `plant:stressed`, `plant:damaged` and others let
  code react to conditions rather than poll numbers.

### Minor Changes

- **Electrophysiology** (`smartplant/signals`, `electrode` driver) — pure-JS DSP: zero-phase
  filters, a biquad mains notch, radix-2 FFT, MAD-based spike detection with duration-based
  classification (action vs variation potential), and autocorrelation circadian analysis.

- **Vision** (`smartplant/vision`) — three tiers over one API: classical phenotyping in pure
  JS, ONNX Runtime on the edge, and a persistent Python bridge to PlantCV, Ultralytics,
  detectron2 and mmdetection. Frames via ffmpeg, which covers every camera.

- **Knowledge** (`smartplant/knowledge`) — an RDF-style triple store with a plant-care
  ontology, a forward-chaining reasoner, treatment conflict resolution, and semantic memory
  with adapters for Qdrant, Weaviate and Milvus. `analyze()` is grounded with both.

- **Symbiosis** — the layers that let a plant occupy and act on physical space:
  multirate fusion (`/fusion`), hierarchical control (`/control`), a safety supervisor
  (`/safety`), an evidence ledger (`/confidence`) and per-plant personalization
  (`/personalization`). `plant.embody()` wires all five.

- **Hardware autodetection** (`smartplant/hardware`) — identifies the board, serial devices
  by USB vendor id, I2C sensors by address and cameras, then recommends a config with its
  reasoning. `smartplant hardware`.

- **Firmware generation** (`smartplant/firmware`) — complete compiling projects for Arduino,
  PlatformIO and ESP-IDF from a sensor list.

- **Integrations** (`smartplant/integrations`) — InfluxDB, Home Assistant MQTT discovery,
  Node-RED flow generation, Prometheus, and an **OpenClaw** adapter that exposes the plant
  as seven assistant tools and can use an OpenClaw gateway as its AI provider.

- **Federated learning** (`smartplant/federated`) — FedAvg over species profiles. Only
  statistics leave the device; raw histories never move.

### Patch Changes

- Wellbeing scoring penalized only low readings — a soaked plant scored 100%. It now falls
  off on both sides of the comfort band.
- `checkAlerts()` crashed on every call: it indexed `messages.alerts.humidity`, but the
  catalogues define `moisture`.
- Dutch shipped a full translation that was missing from the lookup map.
- The Gemini API key was passed in the query string; it now goes in a header.
- Ollama prompts were interpolated into a shell string via `execSync`. Now `execFile` with
  no shell, preferring the HTTP API.
- `EventBus.emit` let a synchronous throw in a listener escape `Promise.allSettled`.
- `plant:thirsty` fired twice per reading when both soil and humidity were low.
- `water()` triggered a read that re-emitted `plant:thirsty`, so an auto-watering plugin
  recursed until the soil saturated.
- The mock sensor reset on every process start, so a one-shot CLI command always reported
  the same numbers.
- Fast-channel slope was computed from wall time; it now uses the monotonic clock.
- Zero runtime dependencies in the core.

## 1.0.1

### Patch Changes

- refactor repository
