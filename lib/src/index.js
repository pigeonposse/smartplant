/**
 * SmartPlant — a bridge between AI and plants.
 *
 * Public API. Everything a user or plugin author needs is exported here; nothing
 * else is considered stable.
 *
 * @example
 * import { createPlant } from 'smartplant'
 *
 * const plant = await createPlant( {
 *   name    : 'Rosa',
 *   species : 'Monstera deliciosa',
 *   sensor  : 'mock',            // no hardware required
 *   ai      : { provider: 'ollama' },
 *   memory  : { path: './rosa.json' },
 * } )
 *
 * await plant.read()
 * console.log( plant.status() )
 * console.log( await plant.speak( 'how are you today?' ) )
 */

// ── core ─────────────────────────────────────────────────────────────────────
export {
	SmartPlant, createPlant,
} from './core/kernel.js'
export {
	EventBus, EVENTS,
} from './core/events.js'
export {
	SmartPlantError, SensorError, AIError, PluginError, ConfigError,
} from './core/errors.js'

// ── ai ───────────────────────────────────────────────────────────────────────
export {
	AIService, parseJSONLoose,
} from './ai/service.js'
export {
	builtinProviders, openAICompatible,
} from './ai/providers.js'

// ── sensors ──────────────────────────────────────────────────────────────────
export {
	SensorDriver, METRICS, METRIC_KEYS,
} from './sensors/driver.js'
export {
	SensorRegistry, mergeReadings,
} from './sensors/registry.js'
export { MockSensor } from './sensors/drivers/mock.js'
export { ManualSensor } from './sensors/drivers/manual.js'
export { HttpSensor } from './sensors/drivers/http.js'
export { HomeAssistantSensor } from './sensors/drivers/homeassistant.js'
// Serial and MQTT are intentionally not re-exported: they carry optional
// dependencies and are loaded on demand by the registry (`sensor: 'serial'`).

// ── memory ───────────────────────────────────────────────────────────────────
export {
	PlantMemory, linearTrend,
} from './memory/store.js'
export {
	buildContext, renderContext, comfortScore, happiness, deviations, DEFAULT_RANGES,
} from './memory/context.js'

// ── voice ────────────────────────────────────────────────────────────────────
export {
	PERSONAS, systemPrompt, statusLine, happinessEmoji, metricEmoji, offlineVoice,
} from './voice/persona.js'

// ── i18n ─────────────────────────────────────────────────────────────────────
export {
	LANGUAGES, LANGUAGE_NAMES, loadMessages, t,
} from './language/index.js'

// ── signals: plant electrophysiology ─────────────────────────────────────────
export {
	analyzeTrace, autocorrelation, bandPass, circadianHealth, classifyEvent,
	complexity, describeFeatures, detectSpikes, detrend, dominantFrequency,
	extractFeatures, findRhythm, highPass, lowPass, medianFilter, notch,
	spectrum, summarizeEvents, zscore,
} from './signals/index.js'

// ── knowledge: symbolic + semantic memory ────────────────────────────────────
export {
	ANY, ApiEmbedder, cosine, DEFAULT_RULES, explainCondition, HashEmbedder,
	loadOntology, PlantKnowledge, PREDICATES, Reasoner, RemoteVectorStore,
	resolveConflicts, TripleStore, VectorMemory,
} from './knowledge/index.js'

// ── federated learning ───────────────────────────────────────────────────────
export {
	aggregate, applyProfile, computeLocalUpdate, FederatedRegistry,
} from './federated/index.js'

// Vision, integrations and firmware are reached through their subpaths
// (`smartplant/vision`, `/integrations`, `/firmware`). They pull in child_process
// and optional native packages, so they stay out of the root import.

// ── embodiment: fusion, control, safety, personalization ─────────────────────
export {
	ChangePointDetector, EMA, Kalman1D, monotonicMs, MultirateState, RATE,
	slopePerSecond,
} from './fusion/index.js'

export {
	Arbitrator, collisionReflex, lostLocalizationReflex, PRIORITY,
} from './control/index.js'

export {
	EnergyManager, Geofence, pointInPolygon, SafetySupervisor, VERDICT, Watchdog,
} from './safety/index.js'

export {
	EvidenceLedger, RISK, ShadowMode,
} from './confidence/index.js'

export {
	ContextualBandit, EpisodicMemory, Experiment, PlantPersonalization,
	wellbeingReward,
} from './personalization/index.js'

// Hardware autodetection, integrations, vision, firmware and the OpenClaw
// adapter live behind subpaths: they touch child_process, the filesystem and
// optional native packages, so they stay out of the root import.

// ── plugin authoring ─────────────────────────────────────────────────────────
export { definePlugin } from './plugin.js'
