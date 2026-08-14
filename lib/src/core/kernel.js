/**
 * SmartPlant kernel — the bridge between AI and plant.
 *
 * Composes the four layers:
 *   sensors  → what the plant is experiencing
 *   memory   → what it has been through
 *   ai       → how to reason about that
 *   voice    → how to say it back to the human
 *
 * Plugins get the kernel instance and use its public surface; they never reach
 * into a provider or a driver directly.
 */

import { AIService } from '../ai/service.js'
import { PlantKnowledge } from '../knowledge/index.js'
import { loadMessages } from '../language/index.js'
import {
	buildContext, deviations, happiness, renderContext, DEFAULT_RANGES,
} from '../memory/context.js'
import { PlantMemory } from '../memory/store.js'
// Loaded statically, unlike the rest of `signals`, which is deferred to keep the
// DSP out of the base import. This module is pure logic with no dependencies,
// and `defense()` has to stay synchronous because the aid layer asks it mid-decision.
import { defenseActivation, defenseCues } from '../signals/defense.js'
import {
	circadianIntegrity, LEVEL, stateCues, stressLoad, stressMemory,
	waterStressInternal,
} from '../states/index.js'
import { SensorDriver } from '../sensors/driver.js'
import { mergeReadings, SensorRegistry } from '../sensors/registry.js'
import {
	DEFAULT_PERSONA, offlineVoice, statusLine, systemPrompt,
} from '../voice/persona.js'
import { ConfigError, PluginError, SensorError } from './errors.js'
import { EventBus, EVENTS } from './events.js'
import { ResolutionLedger } from '../resolutions/index.js'

/**
 * A stand-in for a subsystem that has not been set up yet.
 *
 * `plant.colony.ask()` before joining one used to fail with "cannot read
 * properties of undefined", which tells a person nothing about what they did or
 * how to fix it. Methods on the plant itself already do much better — `listen()`
 * without an electrode names the exact config to add — and a property you reach
 * *through* should not be worse just because of where it sits.
 *
 * The trick is that reads and calls want opposite things. Code all over this
 * library and its plugins does `plant.spectral?.history` and expects `undefined`
 * when there is no spectral system; making the property a plain object breaks
 * every one of those, because optional chaining only short-circuits on `null`
 * and `undefined` — a proxy is neither, so the trap runs and throws where it
 * used to yield nothing.
 *
 * So this distinguishes them. Anything that is not a known method reads as
 * `undefined`, exactly as before. Only the methods return something, and what
 * they return explains itself when called.
 *
 * @param   {string}   name    - The subsystem.
 * @param   {string}   how     - What to call to get a real one.
 * @param   {string[]} methods - Its method names.
 * @returns {Proxy}            A stub that refuses helpfully.
 */
function notSetUp( name, how, methods ) {

	return new Proxy( {}, {
		get( _target, prop ) {

			// An explicit, readable way to ask — better than probing for null.
			if ( prop === 'enabled' ) return false
			if ( typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON' ) return undefined
			if ( !methods.includes( prop ) ) return undefined

			return () => {

				throw new ConfigError( `This plant has no ${name} yet. Call ${how} first.` )

			}

		},
	} )

}




/** Thresholds that decide when a reading becomes an event, as comfort scores. */
const ALERT_SCORE   = 60
const CRITICAL_SCORE = 25

export class SmartPlant {

	/**
	 * @param {object} [config]              - Configuration.
	 * @param {string} [config.name]         - Plant name.
	 * @param {string} [config.species]      - Species, e.g. `'Monstera deliciosa'`.
	 * @param {string} [config.type]         - `'indoor'` | `'outdoor'`.
	 * @param {string} [config.language]     - ISO code for messages and AI replies.
	 * @param {string} [config.persona]      - Voice persona id.
	 * @param {object} [config.ai]           - `{ provider, apiKey, model, retries, cacheTTL }`.
	 * @param {string|object} [config.sensor]- Driver id, or `{ driver, ...driverConfig }`.
	 * @param {object} [config.memory]       - `{ path, maxReadings, autosave }`.
	 * @param {object} [config.ranges]       - Comfort range overrides.
	 * @param {number} [config.interval]     - Monitoring interval (ms).
	 */
	constructor( config = {} ) {

		this.config = {
			language : 'en',
			persona  : DEFAULT_PERSONA,
			interval : 60_000,
			...config,
		}

		this.events   = new EventBus()
		this.sensors  = new SensorRegistry()
		this.ai       = new AIService( this.config.ai || {} )
		this.memory   = new PlantMemory( this.config.memory || {} )
		this.messages = loadMessages( this.config.language )

		// Symbolic knowledge + semantic recall. Cheap to construct and useful
		// even with no AI configured, so it is on by default.
		this.knowledge = this.config.knowledge === false
			? null
			: new PlantKnowledge( this.config.knowledge === true ? {} : ( this.config.knowledge || {} ) )

		// Vision, electrode analysis and the body are attached lazily by
		// `useVision()`, the electrode driver and `embody()`: none should cost
		// anything when unused.
		/** @type {object|null} Set by `embody()`. */
		this.body = null
		/** @type {object|null} Set by `useSpectral()`. */
		this.spectral = null
		/** @type {object|null} Set by `useBrain()`. */
		this.brain = notSetUp( 'brain', 'useBrain({ gateway })', [ 'run', 'chat', 'tools', 'models' ] )

		/** @type {object|null} Set by `joinColony()`. */
		this.colony = notSetUp( 'colony', 'joinColony({ transport })', [ 'ask', 'askAll', 'report', 'teach', 'newcomers', 'learnFromColony', 'peers', 'introduce' ] )
		/**
		 * This plant's own electrical normal, learned rather than assumed.
		 * Built lazily on the first `listen()`.
		 * @type {object|null}
		 */
		this.electrome = null

		this.vision = null
		/** Last multimodal perception, kept so `context()` can include it. */
		this.perception = {
			vision : null,
			electro : null,
			spectral : null,
		}

		/** @type {Map<string, object>} */
		this.plugins  = new Map()
		/** @type {SensorDriver[]} */
		this._drivers = []

		this.ranges       = { ...DEFAULT_RANGES, ...this.config.ranges }
		this.isMonitoring = false
		this._timer       = null
		this._initialized = false

	}

	// ── lifecycle ─────────────────────────────────────────────────────────────

	/**
	 * Load memory, attach the sensor, and register identity. Idempotent.
	 *
	 * @returns {Promise<SmartPlant>} this
	 */
	async init() {

		if ( this._initialized ) return this

		await this.memory.load()

		// Config wins over stored identity, but stored identity survives a bare init().
		await this.memory.setPlant( {
			name    : this.config.name ?? this.memory.plant.name,
			species : this.config.species ?? this.memory.plant.species,
			type    : this.config.type ?? this.memory.plant.type,
		} )

		if ( this.memory.profile?.ranges ) {

			this.ranges = {
				...this.ranges,
				...this.memory.profile.ranges,
			}

		}

		// A starting point, before anything has been measured. Never overrides a
		// plant that already has its own record.
		if ( this.config.archetype !== false ) {

			const { applyArchetype } = await import( '../archetypes/index.js' )

			this._archetypeResult = applyArchetype( this, typeof this.config.archetype === 'string'
				? { id : this.config.archetype }
				: this.config.archetype || {} )

		}

		if ( this.config.sensor ) await this.attachSensor( this.config.sensor )

		this._initialized = true
		return this

	}

	/**
	 * Attach a sensor driver.
	 *
	 * @param   {string|object|SensorDriver} spec - Driver id, `{driver, ...config}`, or an instance.
	 * @returns {Promise<SensorDriver>}           The attached driver.
	 */
	async attachSensor( spec ) {

		let driver

		if ( spec instanceof SensorDriver ) driver = spec
		else if ( typeof spec === 'string' ) driver = await this.sensors.get( spec )
		else if ( spec && typeof spec === 'object' ) {

			const { driver : id, ...cfg } = spec
			if ( !id ) throw new ConfigError( 'Sensor config needs a { driver } id.' )
			driver = await this.sensors.get( id, cfg )

		}
		else throw new ConfigError( 'Sensor must be a driver id, a config object, or a SensorDriver instance.' )

		await driver.connect()

		// Let a simulated driver pick up where the last run left off, so state
		// survives short-lived CLI invocations instead of resetting each time.
		if ( typeof driver.restore === 'function' ) driver.restore( this.memory.lastReading )

		if ( !this._drivers.includes( driver ) ) this._drivers.push( driver )
		return driver

	}

	/** Register a custom driver class or instance under an id. */
	registerSensor( id, driver ) {

		this.sensors.register( id, driver )
		return this

	}

	/**
	 * Fetch a driver by id — the 1.x-compatible accessor plugins call.
	 *
	 * @param   {string}       [id] - Driver id. Defaults to the first attached driver.
	 * @returns {SensorDriver}      The driver.
	 */
	getSensor( id ) {

		if ( !id ) {

			if ( !this._drivers.length ) throw new SensorError( 'No sensor attached. Call attachSensor() or pass { sensor } to createPlant().' )
			return this._drivers[ 0 ]

		}
		const found = this.sensors.peek( id )
		if ( !found ) throw new SensorError( `Sensor "${id}" is not attached. Attached: ${this._drivers.map( d => d.id ).join( ', ' ) || 'none'}.` )
		return found

	}

	// ── plugins ───────────────────────────────────────────────────────────────

	/**
	 * Install a plugin.
	 *
	 * A plugin is any object with a `name` and an optional `init(plant, options)`.
	 * It is exposed at `plant.plugin(name)` and on `plant.plugins`.
	 *
	 * @param   {object} plugin    - The plugin.
	 * @param   {object} [options] - Options forwarded to `init`.
	 * @returns {Promise<SmartPlant>} this
	 */
	async use( plugin, options = {} ) {

		if ( !plugin || typeof plugin !== 'object' ) throw new PluginError( 'A plugin must be an object.' )

		const name = plugin.name || plugin.constructor?.pluginName
		if ( !name ) throw new PluginError( 'A plugin must expose a `name`.' )
		if ( this.plugins.has( name ) ) throw new PluginError( `Plugin "${name}" is already installed.` )

		// `definePlugin()` accepts `setup` and `on` and wires them up. A raw object
		// passed straight to `use()` only gets `init`, so a hand-written plugin
		// carrying either of those installs successfully and then does nothing at
		// all — no error, no listener, and a `plugins` list that says it is there.
		// An inert plugin that reports as installed is worse than one that refuses.
		if ( typeof plugin.init !== 'function' && ( plugin.setup || plugin.on ) ) {

			throw new PluginError( `Plugin "${name}" has ${plugin.setup && plugin.on ? '`setup` and `on`' : plugin.setup ? 'a `setup` function' : 'an `on` map'} but no \`init\`, and a plain object handed to use() only gets \`init\` called. As written it would install and do nothing. Wrap it in definePlugin({ ... }), which wires both, or rename it to init( plant, options ).` )

		}

		// A plugin module is a *definition*, not an installation. Installing the
		// shared object directly would make `init` overwrite its `plant` field, so
		// using one plugin on two plants in the same process silently rebinds the
		// first plant's plugin to the second — every later call would then read and
		// act on the wrong plant. Two plants in one process is the normal case for
		// a colony or a migration, so each install gets its own instance over the
		// shared definition: methods are inherited, state is per-plant.
		const instance = Object.create( plugin )
		instance._off = []

		this.plugins.set( name, instance )

		if ( typeof instance.init === 'function' ) {

			try {

				await instance.init( this, options )

			}
			catch ( err ) {

				this.plugins.delete( name )
				throw new PluginError( `Plugin "${name}" failed to initialize: ${err.message}`, { cause : err } )

			}

		}

		await this.events.emit( EVENTS.PLUGIN_LOADED, {
			name,
			plugin : instance,
		} )
		return this

	}

	/** 1.x-compatible alias. */
	registerPlugin( name, plugin ) {

		if ( !this.plugins.has( name ) ) this.plugins.set( name, plugin )
		return this

	}

	/**
	 * Get an installed plugin.
	 *
	 * @param   {string} name - Plugin name.
	 * @returns {object}      The plugin.
	 */
	plugin( name ) {

		const p = this.plugins.get( name )
		if ( !p ) throw new PluginError( `Plugin "${name}" is not installed. Installed: ${[ ...this.plugins.keys() ].join( ', ' ) || 'none'}.` )
		return p

	}

	has( name ) {

		return this.plugins.has( name )

	}

	// ── sensing ───────────────────────────────────────────────────────────────

	/**
	 * Read every attached sensor, store the result, and emit condition events.
	 *
	 * @param   {object}  [opts]                 - Options.
	 * @param   {boolean} [opts.emitConditions]  - Emit `plant:*` events. Default true.
	 * @returns {Promise<import('../sensors/driver.js').Reading>} The merged reading.
	 */
	async read( opts = {} ) {

		if ( !this._drivers.length ) throw new SensorError( 'No sensor attached. Pass { sensor: "mock" } to createPlant() to run without hardware.' )

		const results = await Promise.allSettled( this._drivers.map( d => d.read() ) )

		// Per-driver health, so the maintenance layer can tell a sensor that is
		// merely quiet from one that has been failing for a week. A merged reading
		// hides which driver produced what, and a driver that stops answering
		// simply stops contributing — silently, unless somebody counts.
		results.forEach( ( r, i ) => {

			const driver = this._drivers[ i ]
			driver.health ??= {
				reads : 0,
				failures : 0,
				consecutiveFailures : 0,
				lastOkAt : null,
				lastError : null,
			}

			driver.health.reads++

			if ( r.status === 'fulfilled' ) {

				driver.health.consecutiveFailures = 0
				driver.health.lastOkAt = Date.now()

			}
			else {

				driver.health.failures++
				driver.health.consecutiveFailures++
				driver.health.lastError = r.reason?.message || String( r.reason )

			}

		} )

		const ok      = results.filter( r => r.status === 'fulfilled' ).map( r => r.value )
		const failed  = results.filter( r => r.status === 'rejected' )

		for ( const f of failed ) await this.events.emit( EVENTS.SENSOR_ERROR, { error : f.reason } )

		if ( !ok.length ) {

			throw failed[ 0 ]?.reason || new SensorError( 'All sensors failed to read.' )

		}

		const reading = mergeReadings( ok )
		await this.memory.addReading( reading )
		await this.events.emit( EVENTS.READING, reading )
		if ( opts.emitConditions !== false ) await this._emitConditions( reading )
		return reading

	}

	/** Translate a reading into semantic events plugins can subscribe to. */
	async _emitConditions( reading ) {

		// Re-entrancy guard. A listener that acts on the plant (an auto-waterer
		// calling water(), which reads again) would otherwise re-enter here and
		// recurse until the metric saturates. Conditions are emitted for the
		// outermost read only.
		if ( this._emitting ) return
		this._emitting = true

		try {

			await this._emitConditionsInner( reading )

		}
		finally {

			this._emitting = false

		}

	}

	async _emitConditionsInner( reading ) {

		const devs  = deviations( reading, this.ranges )
		const score = happiness( reading, this.ranges )

		if ( !devs.length ) {

			// Nothing is wrong, so every problem that was open has just stopped.
			// This is what makes an episode an episode rather than a stream of
			// alerts, and it is also the only moment a resolution can be recorded.
			this._closeResolved( [] )

			await this.events.emit( EVENTS.HAPPY, {
				reading,
				happiness : score,
			} )
			return

		}

		const map = {
			soil        : {
				low : EVENTS.THIRSTY,
				high : EVENTS.DROWNING,
			},
			humidity    : {
				low : EVENTS.THIRSTY,
				high : EVENTS.DROWNING,
			},
			temperature : {
				low : EVENTS.TOO_COLD,
				high : EVENTS.TOO_HOT,
			},
			light       : {
				low : EVENTS.TOO_DARK,
				high : EVENTS.TOO_BRIGHT,
			},
		}

		// Several metrics can map to the same semantic event (low soil AND low
		// humidity both mean "thirsty"). Emit each event once per reading, carrying
		// the worst deviation — `devs` is already sorted worst-first.
		const emitted = new Set()
		const standing = []

		for ( const d of devs ) {

			if ( d.score > ALERT_SCORE ) continue // mild drift: not worth waking plugins
			const event = map[ d.metric ]?.[ d.direction ]
			if ( event && !emitted.has( event ) ) {

				emitted.add( event )
				standing.push( event )
				this._openProblem( event, {
					metric : d.metric,
					direction : d.direction,
					happiness : score,
				} )

				await this.events.emit( event, {
					...d,
					reading,
					happiness : score,
				} )

			}
			await this.events.emit( EVENTS.ALERT, {
				...d,
				reading,
				critical : d.score <= CRITICAL_SCORE,
			} )

		}

		// Anything that was open and is no longer among the deviations has cleared.
		this._closeResolved( standing )

		if ( score <= CRITICAL_SCORE ) {

			await this.events.emit( EVENTS.STRESSED, {
				reading,
				happiness : score,
				deviations : devs,
			} )

		}

	}

	// ── context ───────────────────────────────────────────────────────────────

	/**
	 * Current situation: identity, reading, ranges, wellbeing, trends, care log,
	 * plus whatever the vision and electrode layers last perceived.
	 *
	 * @param   {object} [reading] - Reading override.
	 * @returns {object}           Context object.
	 */
	context( reading ) {

		const ctx = buildContext( {
			memory : this.memory,
			reading,
			ranges : this.ranges,
			archetype : this.archetype,
		} )

		if ( this.perception.vision ) ctx.vision = this.perception.vision
		if ( this.perception.electro ) ctx.electro = this.perception.electro
		if ( this.perception.spectral ) ctx.spectral = this.perception.spectral

		return ctx

	}

	// ── multimodal perception ─────────────────────────────────────────────────

	/**
	 * Attach a camera.
	 *
	 * @param   {object}          config - `PlantVision` config, or an instance.
	 * @returns {Promise<object>}        The `PlantVision` instance.
	 */
	async useVision( config ) {

		const { PlantVision } = await import( '../vision/index.js' )
		this.vision = config instanceof PlantVision ? config : new PlantVision( config )
		return this.vision

	}

	/**
	 * Look at the plant.
	 *
	 * @param   {object}          [opts] - Options forwarded to `PlantVision.analyze`.
	 * @returns {Promise<object>}        Vision analysis.
	 */
	async see( opts = {} ) {

		if ( !this.vision ) throw new ConfigError( 'No camera attached. Call useVision({ source: { source: "ffmpeg", input: "/dev/video0" } }) first.' )

		const result = await this.vision.analyze( opts.frame, opts )
		this.perception.vision = result
		await this.events.emit( EVENTS.VISION, result )
		return result

	}

	/**
	 * Analyze the electrical activity of the plant.
	 *
	 * Reads from the attached `electrode` driver and adds the circadian
	 * assessment, which needs the stored history rather than a single window.
	 *
	 * @param   {object}          [opts] - `{ seconds, threshold }`.
	 * @returns {Promise<object>}        Electrophysiology analysis.
	 */
	async listen( opts = {} ) {

		const driver = this.sensors.peek( 'electrode' )
		if ( !driver ) throw new ConfigError( 'No electrode attached. Pass { sensor: { driver: "electrode", transport: "synthetic" } }.' )

		const analysis = driver.readWaveform( opts )

		const {
			circadianHealth, ElectromeBaseline, electromeFingerprint, internalClock,
		} = await import( '../signals/index.js' )

		// Circadian rhythm is a property of days of history, not of a 60-second
		// window, so it comes from stored readings rather than the live buffer.
		const series = this.memory.data.readings
			.filter( r => Number.isFinite( r.voltage ) )
			.map( r => ( {
				t : r.t,
				value : r.voltage,
			} ) )

		// The electrome fingerprint: what this plant's baseline electrical state
		// looks like, and whether it has drifted. Usually the earliest warning
		// there is, because membrane transport reorganizes before bulk water
		// content moves.
		if ( !this.electrome ) {

			this.electrome = new ElectromeBaseline( this.config.electrome || {} )

		}

		const fingerprint = electromeFingerprint( analysis.cleaned, driver.sampleRate, { mainsHz : driver.mainsHz } )
		const shift = this.electrome.push( fingerprint )

		const result = {
			...analysis,
			fingerprint,
			shift,
			circadian : series.length >= 8 ? circadianHealth( series ) : null,
			// What time it is *for the plant*, which is not always what time it is.
			clock     : series.length >= 12 ? internalClock( series, this.config.lightCycle ) : null,
		}

		// Two electrodes verify each other by propagation delay — the only way to
		// tell the plant from a bad contact.
		if ( driver.sites?.size ) {

			result.coherence = {}
			for ( const id of driver.sites.keys() ) {

				try {

					result.coherence[ id ] = driver.coherence( id, opts )

				}
				catch ( err ) {

					result.coherence[ id ] = { error : err.message }

				}

			}

		}

		this.perception.electro = result
		await this.events.emit( EVENTS.ELECTRO, result )

		if ( result.shift?.shifted ) {

			await this.events.emit( EVENTS.ELECTROME_SHIFT, result )

		}

		if ( result.summary?.damageSignal ) {

			await this.events.emit( EVENTS.DAMAGE, result )

		}

		// Fingerprint drift, clock misalignment and two-site coherence are each
		// independent of the ordinary sensor channels, so they enter the ledger
		// as distinct sources rather than reinforcing what soil already said.
		if ( this.body?.evidence ) {

			const { clockCues, coherenceCues, shiftCues } = await import( '../signals/index.js' )

			for ( const cue of shiftCues( result.shift ) ) {

				this.body.evidence.add( {
					source : 'electrome',
					...cue,
				} )

			}
			for ( const cue of clockCues( result.clock ) ) {

				this.body.evidence.add( {
					source : 'clock',
					...cue,
				} )

			}
			for ( const c of Object.values( result.coherence || {} ) ) {

				for ( const cue of coherenceCues( c ) ) {

					this.body.evidence.add( {
						source : 'coherence',
						...cue,
					} )

				}

			}

		}

		await this._ingestLongitudinal( result )

		return result

	}

	/**
	 * Read every configured modality at once.
	 *
	 * @param   {object}          [opts] - Options.
	 * @returns {Promise<object>}        `{reading, vision, electro, context}`.
	 */
	async perceive( opts = {} ) {

		const out = {}

		// Each modality is independent: a broken camera must not cost you the
		// soil reading.
		const results = await Promise.allSettled( [
			this.read( opts ),
			this.vision ? this.see( opts ) : Promise.resolve( null ),
			this.sensors.peek( 'electrode' ) ? this.listen( opts ) : Promise.resolve( null ),
		] )

		const [ reading, vision, electro ] = results
		if ( reading.status === 'fulfilled' ) out.reading = reading.value
		else out.readingError = reading.reason?.message

		if ( vision.status === 'fulfilled' && vision.value ) out.vision = vision.value
		else if ( vision.status === 'rejected' ) out.visionError = vision.reason?.message

		if ( electro.status === 'fulfilled' && electro.value ) out.electro = electro.value
		else if ( electro.status === 'rejected' ) out.electroError = electro.reason?.message

		out.context = this.context()
		return out

	}

	// ── embodiment ────────────────────────────────────────────────────────────

	/**
	 * Give the plant a body.
	 *
	 * Wires the five layers that let a plant occupy and act on physical space:
	 * multirate fusion, an evidence ledger, a safety supervisor, a hierarchical
	 * arbitrator, and per-plant personalization.
	 *
	 * None of this is loaded unless you call it — a plant on a windowsill has no
	 * use for a geofence.
	 *
	 * @param   {object} [config]                 - Options.
	 * @param   {object} [config.fusion]          - `MultirateState` options.
	 * @param   {object} [config.safety]          - `SafetySupervisor` options.
	 * @param   {object} [config.control]         - `Arbitrator` options.
	 * @param   {object} [config.evidence]        - `EvidenceLedger` options.
	 * @param   {object} [config.personalization] - `PlantPersonalization` options.
	 * @returns {Promise<object>}                 `{state, safety, control, evidence, personalization}`.
	 */
	async embody( config = {} ) {

		const [ fusion, safety, control, confidence, personalization ] = await Promise.all( [
			import( '../fusion/index.js' ),
			import( '../safety/index.js' ),
			import( '../control/index.js' ),
			import( '../confidence/index.js' ),
			import( '../personalization/index.js' ),
		] )

		const state = new fusion.MultirateState( config.fusion || {} )
		const supervisor = new safety.SafetySupervisor( config.safety || {} )
		const evidence = new confidence.EvidenceLedger( config.evidence || {} )

		const arbitrator = new control.Arbitrator( {
			safety : supervisor,
			evidence,
			...config.control,
		} )

		const learner = new personalization.PlantPersonalization( {
			plantId : this.memory.plant.name || 'default',
			...config.personalization,
		} )

		// Every sensor reading feeds the slow side of fusion automatically, so the
		// body always has the plant's own story available without extra wiring.
		this.on( EVENTS.READING, reading => state.ingestReading( reading ) )

		this.body = {
			state,
			safety : supervisor,
			control : arbitrator,
			evidence,
			personalization : learner,
		}

		return this.body

	}

	/**
	 * Gather evidence from every modality and decide whether an action is
	 * justified.
	 *
	 * The guard against both failure modes: acting on one noisy reading, and
	 * ignoring a condition that has been true for two days.
	 *
	 * @param   {string} claim    - What is claimed, e.g. `'soil_low'`.
	 * @param   {object} [risk]   - A `RISK` level from the confidence layer.
	 * @returns {object}          `{allowed, score, explanation, missing}`.
	 */
	justifies( claim, risk ) {

		if ( !this.body ) throw new ConfigError( 'Call embody() before justifies().' )

		const ctx = this.context()
		const reasoning = this.knowledge ? this.knowledge.infer( ctx ) : null
		this.body.evidence.ingest( ctx, reasoning )

		return this.body.evidence.isEnough( claim, risk )

	}

	// ── spectral ──────────────────────────────────────────────────────────────

	/**
	 * Attach a spectral light system.
	 *
	 * Wires the lamp to the electrode automatically when one is present, because
	 * a probe with nothing recording it is just a light show.
	 *
	 * @param   {object}          [config] - `SpectralSystem` config.
	 * @returns {Promise<object>}          The `SpectralSystem`.
	 */
	async useSpectral( config = {} ) {

		const { SpectralSystem } = await import( '../spectral/index.js' )

		this.spectral = config instanceof SpectralSystem
			? config
			: new SpectralSystem( {
				electrode : this.sensors.peek( 'electrode' ),
				...config,
			} )

		return this.spectral

	}

	/**
	 * Interrogate the plant with light and read what comes back.
	 *
	 * @param   {object}          [opts] - `SpectralSystem.sweep` options.
	 * @returns {Promise<object>}        The sweep, with cross-band diagnosis.
	 */
	/**
	 * Is now a sensible moment, in the plant's own time, to do this?
	 *
	 * Advisory by default. A probe at subjective night measures a plant that has
	 * closed down, and the response reads as "weak" for reasons that have nothing
	 * to do with health — worth knowing before the measurement, not after.
	 *
	 * @param   {string} action - `'probe'` | `'water'` | `'light'` | `'measure'`.
	 * @returns {Promise<object>} `{good, reason, betterInHours}`.
	 */
	async goodMoment( action ) {

		const { timingAdvice } = await import( '../signals/index.js' )
		const advice = timingAdvice( this.perception?.electro?.clock, action )

		// The inversion. Timing advice is derived from the rhythm, so a degraded
		// rhythm does not make the advice more urgent — it makes it worthless.
		// Handing back a confident hour from a clock that is not keeping time is
		// the failure mode this check exists to prevent.
		const clock = this.states().circadian_integrity

		// Unknown counts too: no clock at all is not a reason to give confident
		// hours, it is a reason to give none.
		const untrusted = clock.level === LEVEL.UNKNOWN || ( clock.acts && clock.trustTiming === false )

		if ( untrusted ) {

			return {
				good : true,
				trusted : false,
				reason : `No timing opinion offered. ${clock.why} Proceeding on the caller's schedule rather than on a clock that is not keeping one.`,
			}

		}

		return {
			...advice,
			trusted : true,
		}

	}

	async interrogate( opts = {} ) {

		if ( !this.spectral ) throw new ConfigError( 'No light attached. Call useSpectral({ light: { driver: "mock" } }) first.' )

		// A sweep is an elective stress: it drives light at the plant to see what
		// comes back. Doing that to a plant already mounting a defence adds load
		// to something busy, and measures the response to the probe on top of
		// whatever else is running. Unlike the clock below, this does block.
		const defense = this.defense()

		if ( !opts.force && defense.posture.hold.includes( 'spectral-probe' ) ) {

			return {
				refused : true,
				defense : defense.level,
				confidence : defense.confidence,
				why : `Not probing. ${defense.statement} ${defense.posture.why} Pass { force: true } to override, which is reasonable if you need the reading more than the plant needs to be left alone.`,
			}

		}

		// Consulted, reported, and deliberately not blocking: the clock is only
		// as good as the history behind it, and refusing a measurement on a weak
		// estimate would be worse than taking one at an awkward hour.
		const timing = await this.goodMoment( 'probe' )

		if ( !timing.good ) {

			await this.events.emit( EVENTS.ALERT, {
				metric : 'timing',
				critical : false,
				message : timing.reason,
				betterInHours : timing.betterInHours,
			} )

		}

		const sweep = await this.spectral.sweep( {
			context : this.context(),
			...opts,
		} )
		this.perception.spectral = sweep

		await this.events.emit( EVENTS.SPECTRAL, sweep )

		// Spectral findings are independent evidence: they come from a controlled
		// excitation, not from the same passive channel everything else reads.
		if ( this.body?.evidence ) {

			for ( const d of sweep.diagnosis ) {

				this.body.evidence.add( {
					source   : 'spectral',
					claim    : d.condition,
					strength : d.confidence,
					detail   : d.because[ 0 ],
				} )

			}

		}

		return sweep

	}

	/**
	 * Give the plant an OpenClaw brain.
	 *
	 * The model stops being a text source and becomes the operator: it gets the
	 * plant's whole control surface as tools and decides what to look at and what
	 * to do. Every acting call still goes through the safety layers.
	 *
	 * This is also the way to have AI with **no API key and no Ollama** — the
	 * Gateway holds the models and the keys.
	 *
	 * @param   {object}          [config] - `OpenClawBrain` config.
	 * @returns {Promise<object>}          The brain.
	 */
	async useBrain( config = {} ) {

		const { OpenClawBrain, openclawProvider } = await import( '../integrations/openclaw/index.js' )

		this.brain = config instanceof OpenClawBrain
			? config.attach( this )
			: new OpenClawBrain( {
				...config,
				plant : this,
			} )

		// The same Gateway also becomes the plant's ordinary AI provider, so
		// `speak()` and `analyze()` stop needing a key of their own.
		if ( config.provider !== false ) {

			this.ai.registerProvider( 'openclaw', openclawProvider( config.gateway || {} ) )
			this.ai.use( 'openclaw' )

		}

		return this.brain

	}

	// ── reasoning ─────────────────────────────────────────────────────────────

	/**
	 * Reason over everything known, symbolically.
	 *
	 * Runs before any AI call and can stand alone: the conclusions come with the
	 * observations that produced them, so they are checkable rather than trusted.
	 *
	 * @param   {object} [opts] - Reasoner options.
	 * @returns {object}        `{conclusions, treatments, explanation}`.
	 */
	diagnose( opts = {} ) {

		if ( !this.knowledge ) throw new ConfigError( 'Knowledge layer is disabled. Remove { knowledge: false } to use diagnose().' )
		return this.knowledge.infer( this.context( opts.reading ), opts )

	}

	/**
	 * Record the current situation in semantic memory, so it can be recalled
	 * later by similarity.
	 *
	 * @param   {string}          [note] - Extra text to store alongside.
	 * @returns {Promise<object>}        The stored episode.
	 */
	async remember( note ) {

		if ( !this.knowledge ) throw new ConfigError( 'Knowledge layer is disabled.' )

		const ctx = this.context()
		const text = [ renderContext( ctx ), note ].filter( Boolean ).join( '\n' )

		return this.knowledge.remember( text, {
			happiness  : ctx.happiness,
			deviations : ctx.deviations.map( d => `${d.metric}_${d.direction}` ),
			at         : new Date().toISOString(),
		} )

	}

	/**
	 * Recall past situations similar to now.
	 *
	 * @param   {string}            [query] - Description. Defaults to the current context.
	 * @param   {object}            [opts]  - `{ k, minScore }`.
	 * @returns {Promise<object[]>}         Matching episodes.
	 */
	async recall( query, opts ) {

		if ( !this.knowledge ) throw new ConfigError( 'Knowledge layer is disabled.' )
		return this.knowledge.recall( query || renderContext( this.context() ), opts )

	}

	/** Wellbeing 0-100 for the latest (or given) reading. */
	happiness( reading ) {

		return happiness( reading || this.memory.lastReading || {}, this.ranges )

	}

	/** One-line emoji status. No AI, no network. */
	status( reading ) {

		return statusLine( this.context( reading ) )

	}

	// ── AI ────────────────────────────────────────────────────────────────────

	/**
	 * Ask the AI about the plant, with full context injected.
	 *
	 * This is the method plugins build on. It returns a structured object, so a
	 * plugin never parses prose.
	 *
	 * @param   {string}          question         - What to ask.
	 * @param   {object}          [opts]           - Options.
	 * @param   {object}          [opts.schema]    - Expected JSON shape (key → default).
	 * @param   {string}          [opts.persona]   - Persona override.
	 * @param   {string}          [opts.language]  - Language override.
	 * @param   {object}          [opts.reading]   - Reading override.
	 * @param   {object}          [opts.extra]     - Extra data appended to the context.
	 * @returns {Promise<object>}                  `{ advice, emoji, ... }`.
	 */
	async analyze( question, opts = {} ) {

		const ctx    = this.context( opts.reading )
		const schema = opts.schema || {
			advice   : '',
			emoji    : '🌿',
			severity : 'low',
		}

		// Ground the model before it speaks: symbolic conclusions give it checked
		// premises, and recalled episodes give it this plant's own precedents.
		// Both are optional — the question still works without them.
		let reasoning = null
		let recalled = []

		if ( this.knowledge && opts.ground !== false ) {

			try {

				reasoning = this.knowledge.infer( ctx )

			}
			catch { /* reasoning is an enhancement, never a precondition */ }

			try {

				recalled = await this.knowledge.recall( renderContext( ctx ), {
					k        : opts.recallK ?? 3,
					minScore : opts.recallMinScore ?? 0.35,
				} )

			}
			catch { /* likewise */ }

		}

		const prompt = [
			'CONTEXT',
			renderContext( ctx ),
			reasoning?.conclusions?.length
				? `\nRULE-BASED FINDINGS (derived from the readings above, not guesses)\n${reasoning.explanation}`
				: '',
			recalled.length
				? `\nSIMILAR PAST SITUATIONS FOR THIS PLANT\n${recalled.map( r => `- (${r.at?.slice( 0, 10 )}, similarity ${r.score}) ${r.text.split( '\n' )[ 0 ]}` ).join( '\n' )}`
				: '',
			opts.extra ? `\nEXTRA\n${typeof opts.extra === 'string' ? opts.extra : JSON.stringify( opts.extra )}` : '',
			'',
			`QUESTION\n${question}`,
		].filter( Boolean ).join( '\n' )

		const system = systemPrompt( {
			persona  : opts.persona || this.config.persona,
			language : opts.language || this.config.language,
			extra    : opts.system,
		} )

		await this.events.emit( EVENTS.AI_REQUEST, {
			question,
			provider : this.ai.provider,
		} )

		try {

			const result = await this.ai.generateStructured( prompt, schema, {
				system,
				signal : opts.signal,
			} )

			const enriched = {
				...result,
				happiness : result.happiness ?? ctx.happiness,
				context   : ctx,
				reasoning,
				recalled,
			}
			await this.events.emit( EVENTS.AI_RESPONSE, enriched )
			return enriched

		}
		catch ( err ) {

			// Degrade rather than fail: a broken key must not break monitoring.
			await this.events.emit( EVENTS.ERROR, {
				stage : 'analyze',
				error : err,
			} )
			return {
				...schema,
				advice    : offlineVoice( ctx ),
				emoji     : '🌿',
				happiness : ctx.happiness,
				context   : ctx,
				offline   : true,
				error     : err.message,
			}

		}

	}

	/**
	 * Talk to the plant. Free-form, in the plant's own voice.
	 *
	 * @param   {string}          [message] - What you want to say or ask.
	 * @param   {object}          [opts]    - Same options as `analyze`.
	 * @returns {Promise<string>}           The plant's reply.
	 */
	async speak( message, opts = {} ) {

		const ctx = this.context( opts.reading )

		if ( !this.ai.ready ) {

			const line = offlineVoice( ctx )
			await this.events.emit( EVENTS.SPOKE, {
				message,
				reply : line,
				offline : true,
			} )
			return line

		}

		const prompt = [
			'CONTEXT',
			renderContext( ctx ),
			'',
			message ? `The person caring for you says: "${message}"` : 'Tell them how you are feeling right now, in one or two sentences.',
		].join( '\n' )

		try {

			const reply = await this.ai.generate( prompt, {
				system : systemPrompt( {
					persona  : opts.persona || this.config.persona,
					language : opts.language || this.config.language,
					// Lets a caller say who is being addressed — the colony layer
					// uses it so a plant knows it is answering another plant.
					extra    : opts.extra,
				} ),
				signal : opts.signal,
			} )
			await this.events.emit( EVENTS.SPOKE, {
				message,
				reply,
			} )
			return reply

		}
		catch ( err ) {

			await this.events.emit( EVENTS.ERROR, {
				stage : 'speak',
				error : err,
			} )
			return offlineVoice( ctx )

		}

	}

	/**
	 * Generate and store a care profile for the species: comfort ranges plus
	 * written guidance. Run once; it is remembered from then on.
	 *
	 * @param   {object}          [opts]         - Options.
	 * @param   {boolean}         [opts.force]   - Regenerate even if one exists.
	 * @returns {Promise<object>}                The profile.
	 */
	async learnSpecies( opts = {} ) {

		if ( this.memory.profile && !opts.force ) return this.memory.profile

		const species = this.memory.plant.species || this.memory.plant.name
		if ( !species ) throw new ConfigError( 'Set a plant name or species before calling learnSpecies().' )

		const schema = {
			summary     : '',
			ranges      : {
				temperature : {
					min : 18,
					max : 26,
				},
				humidity    : {
					min : 40,
					max : 65,
				},
				soil        : {
					min : 35,
					max : 70,
				},
				light       : {
					min : 200,
					max : 800,
				},
			},
			wateringDays : 7,
			difficulty   : 'medium',
			toxicToPets  : false,
			tips         : [],
		}

		const result = await this.ai.generateStructured(
			`Give the care profile for "${species}"${this.memory.plant.type ? ` grown ${this.memory.plant.type}s` : ''}. `
			+ 'Ranges must be realistic numeric comfort bands: temperature in °C, humidity and soil moisture in %, light in lux. '
			+ 'wateringDays is the typical interval between waterings.',
			schema,
			{
				system   : systemPrompt( {
					persona : 'botanist',
					language : this.config.language,
				} ),
				signal   : opts.signal,
			},
		).catch( () => null )

		if ( !result || !result._parsed ) {

			// No AI available: keep the defaults but record that we tried, so the
			// caller can tell "generic ranges" from "researched ranges".
			const fallback = {
				...schema,
				summary : `No AI profile available for ${species}; using generic ranges.`,
				generic : true,
			}
			await this.memory.setProfile( fallback )
			return fallback

		}

		const profile = {
			...result,
			species,
		}
		delete profile.context
		await this.memory.setProfile( profile )

		this.ranges = {
			...this.ranges,
			...sanitizeRanges( profile.ranges ),
		}
		return profile

	}

	// ── care actions ──────────────────────────────────────────────────────────

	/**
	 * Record a watering (and reflect it in the mock driver, so demos behave).
	 *
	 * @param   {object} [detail] - `{ amount, note }`.
	 * @returns {Promise<object>} The stored event.
	 */
	async water( detail = {} ) {

		// The one case where watering is the wrong answer to what looks exactly
		// like thirst: the pot is wet and the plant is stressed anyway. Every
		// cause of that is made worse by more water.
		const internal = this.states().water_stress_internal

		if ( !detail.force && internal.acts && internal.withhold === 'water' ) {

			return {
				refused : true,
				state : internal.name,
				level : internal.level,
				evidence : internal.evidence,
				why : `${internal.why} Pass { force: true } to water anyway.`,
			}

		}

		this._recordAction( 'water' )

		const mock = this.sensors.peek( 'mock' )
		if ( mock?.water ) mock.water( detail.amount ?? 30 )

		const event = await this.memory.addEvent( 'water', detail )

		// Take a reading straight away so the effect is persisted, not just held
		// in memory until the next tick — a one-shot CLI run would otherwise exit
		// before the watering ever reached disk. Conditions are suppressed: this
		// read is a consequence of an action, not an independent observation, and
		// re-emitting from it would feed straight back into whatever triggered it.
		await this.read( { emitConditions : false } ).catch( () => {} )
		return event

	}

	async fertilize( detail = {} ) {

		this._recordAction( 'fertilize' )
		return this.memory.addEvent( 'fertilize', detail )

	}

	/** Log anything else: repotting, pruning, a spotted pest, a move. */
	async log( type, detail = {} ) {

		this._recordAction( type )
		return this.memory.addEvent( type, detail )

	}

	/**
	 * Attribute an action to whatever problems are open.
	 *
	 * Actions taken while nothing is wrong are deliberately not recorded as
	 * treatments. Routine watering on a healthy plant cures nothing, and counting
	 * it is exactly how "watering fixes everything" gets learned.
	 */
	_recordAction( action ) {

		if ( !this._resolutions?.open.size ) return
		this._resolutions.acted( action )

	}

	async note( text ) {

		return this.memory.addNote( text )

	}

	/**
	 * Learn what your own interventions look like electrically.
	 *
	 * The care log already records what was done and exactly when, which is a
	 * labelled dataset nobody had to be asked for. This associates each label
	 * with the electrical response that followed it.
	 *
	 * @param   {object} [opts]      - `{ types, windowMinutes }`.
	 * @returns {Promise<object>}    What was characterised.
	 */
	async learnInterventions( opts = {} ) {

		const { InterventionSignatures } = await import( '../signals/index.js' )

		if ( !this.interventions ) this.interventions = new InterventionSignatures( opts )
		return this.interventions.learnFrom( this, opts )

	}

	/**
	 * Feed the slow measurements into the ledger, and run the ones nothing ran.
	 *
	 * Regime change, continuity drift, response hysteresis, model calibration and
	 * instrument health each produce a cue in the right shape and, until now,
	 * nothing collected any of them. A measurement whose answer reaches no
	 * decision is not a feature, it is a computation the plant pays for and
	 * throws away.
	 *
	 * @param   {object} listened - Result of `listen()`.
	 * @returns {Promise<object>} What was ingested.
	 */
	async _ingestLongitudinal( listened ) {

		const added = {}

		// Recognising an intervention nobody wrote down. The library learns what
		// each action looks like electrically and then never used that to look;
		// the obvious use is the one nobody logs — somebody watered the plant and
		// did not tell the system, and every window that follows is being read as
		// spontaneous.
		// `samples` is a count; `cleaned` is the filtered trace itself.
		if ( this.interventions && listened?.cleaned?.length ) {

			const seen = this.interventions.identify(
				listened.cleaned,
				this.sensors.peek( 'electrode' )?.sampleRate,
			)

			if ( seen.match ) {

				const logged = ( this.memory.data.events || [] )
					.some( e => e.type === seen.match
						&& Date.now() - new Date( e.t ).getTime() < 3_600_000 )

				if ( !logged ) {

					this._unloggedIntervention = seen

					await this.events.emit( EVENTS.ALERT, {
						metric : 'intervention',
						critical : false,
						message : `This looks like "${seen.match}" (${seen.why}), but nothing was logged. If somebody did it without telling the system, the record will read it as spontaneous.`,
					} )

				}

			}

		}

		if ( !this.body?.evidence ) return added

		const signals = await import( '../signals/index.js' )

		// Continuity needs its own history, which nothing was building.
		if ( listened?.fingerprint ) {

			if ( !this.continuity ) {

				const { ContinuityTracker } = signals
				this.continuity = new ContinuityTracker( this.config.continuity )

			}

			this.continuity.push( listened.fingerprint, { site : 'primary' } )

			for ( const site of Object.keys( listened.coherence || {} ) ) {

				const fp = listened.sites?.[ site ]
				if ( fp ) this.continuity.push( fp, { site } )

			}

			for ( const cue of this.continuity.cues() ) {

				this.body.evidence.add( cue )
				added.continuity = ( added.continuity ?? 0 ) + 1

			}

		}

		// A regime change is meant to be an early warning. Running it only inside
		// the weekly review delivered it a week late.
		const history = this.continuity?.sites.get( 'primary' )?.history || []

		if ( history.length >= 10 ) {

			const regime = signals.regimeChange(
				history.map( h => ( {
					at : new Date( h.at ).toISOString(),
					fingerprint : h.fingerprint,
				} ) ),
				this.config.regime,
			)

			this._lastRegime = regime

			for ( const cue of signals.regimeCues( regime ) ) {

				this.body.evidence.add( cue )
				added.regime = ( added.regime ?? 0 ) + 1

			}

		}

		// Hysteresis was measured and reported and never entered the record.
		const events = this.memory.data.events || []
		const responses = signals.responseHistory( this.memory.data.readings, events, 'water' )

		if ( responses.length >= 6 ) {

			const h = signals.hysteresis( responses, new Date( Date.now() - 30 * 86_400_000 ).toISOString() )
			this._lastHysteresis = h

			for ( const cue of signals.hysteresisCues( h, 'watering' ) ) {

				this.body.evidence.add( cue )
				added.hysteresis = ( added.hysteresis ?? 0 ) + 1

			}

		}

		// The model being wrong is a fact about the system, and the ledger is
		// where facts go.
		for ( const cue of this.body.personalization?.predictions?.cues?.() || [] ) {

			this.body.evidence.add( cue )
			added.prediction = ( added.prediction ?? 0 ) + 1

		}

		// Two modalities with no shared failure mode. Nothing ran this at all.
		const watch = signals.infectionWatch( {
			regime : this._lastRegime,
			drift  : this.continuity?.attribute(),
			vision : this.perception?.vision?.findings,
		} )

		this._lastInfectionWatch = watch

		for ( const cue of watch.cues || [] ) {

			this.body.evidence.add( cue )
			added.infection = ( added.infection ?? 0 ) + 1

		}

		// The dimension every other layer here ignores: whether the plant is
		// currently busy defending itself, and therefore a bad candidate for
		// anything elective.
		const defense = this.defense()
		this._lastDefense = defense

		for ( const cue of defenseCues( defense ) ) {

			this.body.evidence.add( cue )
			added.defense = ( added.defense ?? 0 ) + 1

		}

		for ( const [ name, st ] of Object.entries( this.states() ) ) {

			if ( name === 'defense_activation' ) continue

			for ( const cue of stateCues( st ) ) {

				this.body.evidence.add( cue )
				added.states = ( added.states ?? 0 ) + 1

			}

		}

		return added

	}

	/**
	 * Serve this plant's vitals over HTTP.
	 *
	 * Everything this library works out has, until now, only been reachable from
	 * code. This puts it in a browser.
	 *
	 * Loopback and read-only, both deliberately, both explained where the server
	 * is defined. The returned object carries `warnings` — read them if you pass
	 * a host.
	 *
	 * @param   {object} [opts] - `{ port, host, everyMs }`.
	 * @returns {Promise<object>} `{url, close, warnings}`.
	 */
	async serve( opts = {} ) {

		const { serveVitals } = await import( '../dashboard/index.js' )
		const handle = await serveVitals( this, opts )

		this._servers ??= []
		this._servers.push( handle )

		return handle

	}

	/**
	 * The plant's internal states — what it is doing, not what is around it.
	 *
	 * Five qualitative estimates, each built only from measured signals, each
	 * carrying the evidence that raised it, and each declaring what decision it
	 * changes. A state that changed no decision would be decoration, and there is
	 * no such state here.
	 *
	 * Low confidence removes a state's authority rather than merely annotating
	 * it: `acts` is false, and every gate in this library checks `acts`.
	 *
	 * @returns {object} Keyed by state name.
	 */
	states() {

		const readings = this.memory.data.readings
		const last = this.memory.lastReading ?? {}
		const trace = this.perception?.electro

		const shift = this._lastRegime
			? {
				shifted : this._lastRegime.changed,
				baselineReady : this._lastRegime.baselineReady,
				why : this._lastRegime.why,
			}
			: null

		const water = waterStressInternal( {
			soil : last.soil,
			stomata : this._lastInference?.stomata,
			shift,
			hysteresis : this._lastHysteresis,
			ranges : this.ranges,
		} )

		const load = stressLoad( {
			events : trace?.summary,
			drift : this.continuity?.attribute(),
			episodes : ( this.memory.data.events || [] )
				.filter( e => e.type === 'stress' || e.critical )
				.filter( e => Date.now() - new Date( e.at ).getTime() < 30 * 86_400_000 ).length,
			recovery : this._lastRecovery,
		} )

		const memoryState = stressMemory( {
			hysteresis : this._lastHysteresis,
			stimulus : 'watering',
		} )

		const circadian = circadianIntegrity( {
			health : trace?.clock ?? this._lastCircadian,
			lightCycle : this._lightCycle,
		} )

		return {
			defense_activation : this.defense( { readings : readings.slice( -12 ) } ),
			water_stress_internal : water,
			stress_load : load,
			stress_memory : memoryState,
			circadian_integrity : circadian,
		}

	}

	/**
	 * Is this plant mounting a defence?
	 *
	 * A qualitative estimate of whether the jasmonate pathway is running, built
	 * from the electrical evidence, anything visible, and anything recorded as
	 * having been done to the plant — then checked against the weather, which is
	 * the only step that can lower the answer.
	 *
	 * It is not a measurement of methyl jasmonate and never claims to be. What it
	 * is good for is knowing when to leave the plant alone.
	 *
	 * @param   {object} [opts] - `{ readings }` window spanning the event.
	 * @returns {object}        From `defenseActivation`.
	 */
	defense( opts = {} ) {

		const trace = this.perception?.electro
		const rows = opts.readings ?? this.memory.data.readings.slice( -12 )

		// The events carry their classification alongside them rather than in
		// them, depending on where in the pipeline they came from.
		const events = ( trace?.events ?? [] ).map( e => ( {
			...e,
			label : e.label ?? e.classification?.label,
		} ) )

		// A wound is anything in the care log that broke tissue. Pruning counts:
		// the plant does not know it was for its own good.
		const wound = ( this.memory.data.events || [] )
			.filter( e => [ 'prune', 'repot', 'cut', 'wound' ].includes( e.type ) )
			.find( e => Date.now() - new Date( e.at ).getTime() < 48 * 3600_000 )

		return defenseActivation( {
			electrode : Boolean( this.electrode || trace ),
			events,
			shift : this._lastRegime
				? {
					shifted : this._lastRegime.changed,
					baselineReady : this._lastRegime.baselineReady,
					why : this._lastRegime.why,
				}
				: null,
			vision : this.perception?.vision?.findings,
			wound : wound ? {
				at : wound.at,
				what : wound.type,
			} : null,
			readings : rows,
		} )

	}

	/**
	 * What the metrics say together that none of them says alone.
	 *
	 * Each inference either has what it needs or names the sensor that would
	 * unlock it — nothing is estimated from a proxy that fails in exactly the
	 * case the measurement exists to detect.
	 *
	 * @param   {object} [opts]   - `{ hours }`.
	 * @returns {Promise<object>} `{known, blocked, unlock, verdict}`.
	 */
	async infer( opts = {} ) {

		const { inferAll } = await import( '../inference/index.js' )
		const result = inferAll( this, opts )

		// Anything crossed-metric that amounts to a claim belongs in the record.
		if ( this.body?.evidence ) {

			for ( const cue of result.cues ) this.body.evidence.add( cue )

		}

		return result

	}

	/**
	 * The instrument trace: one row per interval, every metric this plant has.
	 *
	 * Distinct from the diary, which is prose. This is the table a spreadsheet or
	 * a researcher wants, where a question nobody thought to ask at the time can
	 * still be answered afterwards.
	 *
	 * @param   {object} [opts]   - `{ hours, everyMinutes, sparse }`.
	 * @returns {Promise<object>} `{columns, rows, coverage}`.
	 */
	async journal( opts = {} ) {

		const { journal } = await import( '../journal/index.js' )
		return journal( this, opts )

	}

	/**
	 * Attach a battery and, optionally, a panel.
	 *
	 * @param   {object} [config]   - `PowerBudget` options.
	 * @returns {Promise<object>}   The budget.
	 */
	async usePower( config = {} ) {

		const { PowerBudget } = await import( '../power/index.js' )

		this.power = new PowerBudget( {
			...config,
			// The archetype decides the night policy, because for a CAM plant
			// sleeping through the dark discards the only readings worth having.
			archetype : config.archetype ?? this.archetype,
		} )

		return this.power

	}

	/**
	 * What should be running right now, given charge, time and the plant.
	 *
	 * @param   {object} [opts]   - `{ moving }`.
	 * @returns {Promise<object>} `{mode, running, asleep, why}`.
	 */
	async powerPlan( opts = {} ) {

		if ( !this.power ) return {
			unlimited : true,
			why : 'No battery configured, so this is a mains plant and everything runs.',
		}

		const hour = new Date().getHours()

		return this.power.report( {
			night : opts.night ?? ( hour >= 21 || hour < 6 ),
			...opts,
		} )

	}

	// ── what worked last time ─────────────────────────────────────────────────

	/** The ledger, created on first use so a plant that never fails never pays. */
	get resolutions() {

		if ( !this._resolutions ) {

			const stored = this.memory.data.resolutions
			this._resolutions = stored
				? ResolutionLedger.from( stored, this.config.resolutions )
				: new ResolutionLedger( this.config.resolutions )

		}

		return this._resolutions

	}

	/** Record that a problem is under way. */
	_openProblem( problem, context ) {

		this.resolutions.opened( problem, { context } )
		// An episode nobody ever closed would sit open forever and quietly stay
		// out of every statistic.
		this.resolutions.expire()

	}

	/** Close every open problem that is no longer among the current ones. */
	_closeResolved( stillWrong ) {

		if ( !this._resolutions ) return

		for ( const problem of this._resolutions.open.keys() ) {

			if ( !stillWrong.includes( problem ) ) {

				this._resolutions.closed( problem, { resolved : true } )

			}

		}

		this.memory.data.resolutions = this._resolutions.toJSON()

	}

	/**
	 * What has actually helped with this problem before, on this plant.
	 *
	 * Weighs every candidate against how often the problem cleared with nothing
	 * done at all, because most of them do, and an action taken during a problem
	 * that was going to pass anyway looks exactly like a cure.
	 *
	 * @param   {string} problem - Claim id, e.g. `'plant:thirsty'`.
	 * @param   {object} [opts]  - Options.
	 * @returns {Promise<object>} `{recommend, action, why}`.
	 */
	async whatWorkedBefore( problem, opts = {} ) {

		const { doseModifier } = await import( '../resolutions/index.js' )
		let dose = null

		// If this plant answers differently than it used to, the amount that used
		// to be right is no longer the amount that is right.
		if ( opts.hysteresis !== false ) {

			const { hysteresis, responseHistory } = await import( '../signals/index.js' )
			const events = this.memory.data.events || []
			const history = responseHistory( this.memory.data.readings, events, opts.stimulus || 'water' )

			if ( history.length >= 6 ) {

				const cut = opts.since || new Date( Date.now() - 30 * 86_400_000 ).toISOString()
				dose = doseModifier( hysteresis( history, cut ) )

			}

		}

		// Match on the conditions this problem is happening in now, not merely on
		// its name: "thirsty at 31°C in dry air" and "thirsty at 17°C in humid
		// air" share a label and very little else.
		const ctx = this.context()
		const like = opts.like ?? {
			temperature : ctx.current?.temperature,
			humidity : ctx.current?.humidity,
			soil : ctx.current?.soil,
			light : ctx.current?.light,
		}

		const own = this.resolutions.recommend( problem, {
			doseModifier : dose,
			like,
		} )

		// This plant's own record always outranks the colony's. Only when it has
		// nothing to say is a neighbour's experience worth asking for.
		if ( own.recommend || opts.colony === false || this.colony?.enabled === false ) return own

		const shared = await this.colony.askColonyWhatWorked( problem, { like } ).catch( () => null )

		if ( !shared?.recommend ) return own

		return {
			...own,
			recommend : true,
			action    : shared.action,
			fromColony: true,
			confidence: shared.confidence,
			why : `This plant's own history says nothing yet — ${own.why} ${shared.why}`,
		}

	}

	/**
	 * Check whether this setup actually works, right now.
	 *
	 * Different from `checkup()` (how the plant is changing) and `maintenance()`
	 * (whether a running instrument can still be believed). This is the first
	 * question of all — does any of this work yet — and it answers on a plant
	 * with no history at all.
	 *
	 * @param   {object} [opts]   - `{ probeAI }`.
	 * @returns {Promise<object>} `{ok, checks, fixes, summary}`.
	 */
	async systemDiagnosis( opts = {} ) {

		const { systemDiagnosis } = await import( '../diagnosis/index.js' )
		return systemDiagnosis( this, opts )

	}

	// ── looking at itself ─────────────────────────────────────────────────────

	/**
	 * Review how this plant has changed over the last week or month.
	 *
	 * Every comparison carries what the *conditions* did over the same span, so a
	 * change the weather already accounts for is marked confounded rather than
	 * reported as something the plant did.
	 *
	 * @param   {object} [opts]        - `{ period: 'weekly' | 'monthly' }`.
	 * @returns {Promise<object>}      The evolution report.
	 */
	async checkup( opts = {} ) {

		const { checkup, narrate } = await import( '../checkup/index.js' )

		const report = await checkup( this, opts )
		report.narration = narrate( report )

		if ( report.known ) {

			await this.events.emit( EVENTS.CHECKUP, report )
			if ( opts.log !== false ) await this.memory.addEvent( `checkup:${report.period}`, { verdict : report.verdict } )

		}

		this._lastCheckup ??= {}
		this._lastCheckup[ opts.period || 'weekly' ] = Date.now()

		return report

	}

	/**
	 * Inspect the instrument: electrodes, sensors, links, storage.
	 *
	 * Separate from `checkup()` on purpose. One asks how the plant is changing;
	 * this asks whether the things measuring it can still be believed.
	 *
	 * @param   {object} [opts]   - Options.
	 * @returns {Promise<object>} `{condition, components, actions, verdict}`.
	 */
	async maintenance( opts = {} ) {

		const { inspect } = await import( '../maintenance/index.js' )
		const report = await inspect( this, opts )

		// A broken instrument is a claim about the instrument, and the ledger has
		// per-source weights precisely so a conclusion can be discounted when the
		// thing that produced it is unreliable. The two knew about each other and
		// never spoke.
		if ( this.body?.evidence ) {

			const { maintenanceCues } = await import( '../maintenance/index.js' )
			for ( const cue of maintenanceCues( report ) ) this.body.evidence.add( cue )

		}

		await this.events.emit( EVENTS.MAINTENANCE, report )

		for ( const c of report.components ) {

			if ( c.condition === 'failed' || c.condition === 'degraded' ) {

				await this.events.emit( EVENTS.COMPONENT_BAD, c )

			}

		}

		this._lastMaintenance = Date.now()
		return report

	}

	/**
	 * Run whichever periodic reviews are due.
	 *
	 * Called from the monitoring loop, so a long-running plant reviews itself
	 * without anybody remembering to ask.
	 *
	 * @param   {object} [opts] - Options.
	 * @returns {Promise<object>} What ran.
	 */
	async runDueReviews( opts = {} ) {

		const now = Date.now()
		const ran = {}

		const due = ( last, days ) => !last || now - last >= days * 86_400_000

		if ( opts.maintenance !== false && due( this._lastMaintenance, this.config.maintenanceDays ?? 1 ) ) {

			ran.maintenance = await this.maintenance( opts ).catch( err => ( { error : err.message } ) )

		}

		for ( const [ period, days ] of [ [ 'weekly', 7 ], [ 'monthly', 30 ] ] ) {

			if ( due( this._lastCheckup?.[ period ], days ) ) {

				ran[ period ] = await this.checkup( {
					...opts,
					period,
				} ).catch( err => ( { error : err.message } ) )

			}

		}

		return ran

	}

	// ── colony ────────────────────────────────────────────────────────────────

	/**
	 * Join a colony so this plant can talk to others.
	 *
	 * @param   {object} config           - Options.
	 * @param   {object} config.transport - A `ColonyTransport`.
	 * @returns {Promise<object>}         The `ColonyMember`.
	 */
	async joinColony( config = {} ) {

		const { ColonyMember } = await import( '../colony/index.js' )

		this.colony = new ColonyMember( this, config )
		await this.colony.transport.connect()
		if ( config.introduce !== false ) await this.colony.introduce()

		return this.colony

	}

	/** Leave the colony and stop listening. */
	async leaveColony() {

		// `enabled` rather than a null check: the slot always holds something now.
		if ( this.colony.enabled === false ) return null
		await this.colony.transport.disconnect()
		this.colony._off?.()
		this.colony = notSetUp( 'colony', 'joinColony({ transport })', [ 'ask', 'askAll', 'report', 'teach', 'newcomers', 'learnFromColony', 'peers', 'introduce' ] )
		return null

	}

	// ── inheritance ───────────────────────────────────────────────────────────

	/**
	 * Package what this plant has learned, for a new plant of the same species.
	 *
	 * Only regularities that held across changing conditions are exportable. A
	 * policy learned in one unvarying spot describes that spot, not the plant,
	 * and is reported as withheld rather than shipped.
	 *
	 * @param   {object} [opts] - See `migration.exportBundle`.
	 * @returns {Promise<object>} The inheritance bundle.
	 */
	async exportInheritance( opts = {} ) {

		const { exportBundle } = await import( '../migration/index.js' )
		return exportBundle( this, opts )

	}

	/**
	 * Receive an inheritance from another plant of the same species.
	 *
	 * Comfort ranges shift part of the way immediately. Policies arrive as
	 * advisory priors, weighted by how well the two environments match, and fade
	 * as this plant accumulates outcomes of its own.
	 *
	 * @param   {object} bundle - A bundle from `exportInheritance()`.
	 * @param   {object} [opts] - See `migration.importBundle`.
	 * @returns {Promise<object>} `{inheritance, compatibility, ranges}`.
	 */
	async inherit( bundle, opts = {} ) {

		const { importBundle } = await import( '../migration/index.js' )
		return importBundle( this, bundle, opts )

	}

	// ── monitoring ────────────────────────────────────────────────────────────

	/**
	 * Start the monitoring loop. Reads immediately, then every `interval` ms.
	 *
	 * @param   {object}   [opts]          - Options.
	 * @param   {number}   [opts.interval] - Override the configured interval.
	 * @returns {Promise<SmartPlant>}      this
	 */
	async startMonitoring( opts = {} ) {

		if ( this.isMonitoring ) return this
		await this.init()

		const interval = opts.interval ?? this.config.interval
		this.isMonitoring = true

		const tick = async () => {

			try {

				await this.read()

				// A review that only happens when somebody remembers to ask is a
				// review that never happens. These are cheap and skip themselves
				// when nothing is due.
				if ( opts.reviews !== false && this.config.reviews !== false ) {

					await this.runDueReviews( opts.reviewOptions )

				}

			}
			catch ( err ) {

				await this.events.emit( EVENTS.ERROR, {
					stage : 'monitor',
					error : err,
				} )

			}

		}

		await tick()
		this._timer = setInterval( tick, interval )
		// Never hold the process open just to poll a sensor.
		this._timer.unref?.()
		return this

	}

	stopMonitoring() {

		if ( this._timer ) clearInterval( this._timer )
		this._timer = null
		this.isMonitoring = false
		return this

	}

	/** Stop everything and release transports. */
	async destroy() {

		// A dashboard left listening keeps a port bound and a timer alive long
		// after the plant it describes has gone.
		for ( const s of this._servers ?? [] ) await s.close().catch( () => {} )
		this._servers = []

		this.stopMonitoring()
		for ( const p of this.plugins.values() ) {

			if ( typeof p.destroy === 'function' ) await p.destroy().catch( () => {} )

		}

		// Leave the colony explicitly. Without this the socket stays open, the
		// neighbours keep this plant on their roster forever, and every reading of
		// "who is here" — including the maintenance report on link health — is
		// about a plant that no longer exists.
		await this.leaveColony().catch( () => {} )

		// The lamp is an actuator on a living thing; it must not be left on
		// because a process ended.
		await this.spectral?.allOff?.().catch( () => {} )

		await this.sensors.disconnectAll()
		await this.memory.save()
		this.events.removeAll()
		return this

	}

	// ── conveniences ──────────────────────────────────────────────────────────

	on( event, fn ) {

		return this.events.on( event, fn )

	}

	once( event, fn ) {

		return this.events.once( event, fn )

	}

	async setLanguage( lang ) {

		this.config.language = lang
		this.messages = loadMessages( lang )
		return this

	}

	setPersona( persona ) {

		this.config.persona = persona
		return this

	}

}

/** Drop malformed range entries so a bad AI reply can't corrupt alerting. */
function sanitizeRanges( ranges ) {

	const out = {}
	for ( const [ k, v ] of Object.entries( ranges || {} ) ) {

		const min = Number( v?.min ), max = Number( v?.max )
		if ( Number.isFinite( min ) && Number.isFinite( max ) && max > min ) out[ k ] = {
			min,
			max,
		}

	}
	return out

}

/**
 * Create and initialize a plant in one call.
 *
 * @param   {object} [config]         - Same config as the `SmartPlant` constructor.
 * @returns {Promise<SmartPlant>}     An initialized instance.
 */
export async function createPlant( config = {} ) {

	const plant = new SmartPlant( config )
	await plant.init()
	return plant

}
