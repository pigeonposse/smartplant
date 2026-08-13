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
import { SensorDriver } from '../sensors/driver.js'
import { mergeReadings, SensorRegistry } from '../sensors/registry.js'
import {
	DEFAULT_PERSONA, offlineVoice, statusLine, systemPrompt,
} from '../voice/persona.js'
import { ConfigError, PluginError, SensorError } from './errors.js'
import { EventBus, EVENTS } from './events.js'

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

		for ( const d of devs ) {

			if ( d.score > ALERT_SCORE ) continue // mild drift: not worth waking plugins
			const event = map[ d.metric ]?.[ d.direction ]
			if ( event && !emitted.has( event ) ) {

				emitted.add( event )
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
	async interrogate( opts = {} ) {

		if ( !this.spectral ) throw new ConfigError( 'No light attached. Call useSpectral({ light: { driver: "mock" } }) first.' )

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

		return this.memory.addEvent( 'fertilize', detail )

	}

	/** Log anything else: repotting, pruning, a spotted pest, a move. */
	async log( type, detail = {} ) {

		return this.memory.addEvent( type, detail )

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
