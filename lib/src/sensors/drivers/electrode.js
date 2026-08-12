/**
 * Electrode driver — a waveform source, not a scalar one.
 *
 * Ordinary drivers answer "how wet is the soil". An electrode answers "what is
 * the plant doing electrically", which is a stream, not a number. This driver
 * therefore keeps a ring buffer of samples and exposes `readWaveform()` on top
 * of the normal `read()` contract, which reduces the window to scalar metrics so
 * the rest of the kernel (alerts, memory, AI context) works unchanged.
 *
 * Transports supported: an in-process push API, a serial line of numbers, and a
 * synthetic generator that produces physiologically shaped signals so the whole
 * stack is testable with no hardware.
 */

import { SensorError } from '../../core/errors.js'
import { analyzeTrace } from '../../signals/index.js'
import { matchEvents, siteCoherence } from '../../signals/coherence.js'
import { SensorDriver } from '../driver.js'

export class ElectrodeSensor extends SensorDriver {

	static id       = 'electrode'
	static provides = [ 'voltage', 'activity' ]

	/**
	 * @param {object} [config]              - Options.
	 * @param {number} [config.sampleRate]   - Samples per second. Default 10.
	 * @param {number} [config.bufferSeconds]- Ring buffer length in seconds.
	 * @param {number} [config.mainsHz]      - Mains frequency to notch. 0 disables.
	 * @param {string} [config.transport]    - `'push'` | `'serial'` | `'synthetic'`.
	 * @param {string} [config.path]         - Serial port, when transport is `'serial'`.
	 * @param {number} [config.baudRate]     - Serial baud rate.
	 * @param {number} [config.scale]        - Multiply incoming values (ADC counts → mV).
	 */
	constructor( config = {} ) {

		super( {
			id : ElectrodeSensor.id,
			...config,
		} )

		this.sampleRate    = config.sampleRate ?? 10
		this.bufferSeconds = config.bufferSeconds ?? 600
		this.mainsHz       = config.mainsHz ?? 50
		this.transport     = config.transport || 'push'
		this.scale         = config.scale ?? 1

		this.capacity = Math.max( 16, Math.round( this.sampleRate * this.bufferSeconds ) )
		/** @type {number[]} Primary site. */
		this.buffer   = []

		// Extra electrode sites. Two contacts on the same plant let a signal be
		// verified by its propagation delay, which is the only way to tell the
		// plant from a bad contact. `sites` maps id → { buffer, distanceMm }.
		/** @type {Map<string, {buffer: number[], distanceMm: number}>} */
		this.sites = new Map()
		for ( const site of config.sites || [] ) {

			this.sites.set( site.id, {
				buffer : [],
				distanceMm : site.distanceMm,
			} )

		}
		this.port     = null
		this._synth   = null

	}

	async connect() {

		if ( this.connected ) return this

		if ( this.transport === 'serial' ) await this._connectSerial()
		else if ( this.transport === 'synthetic' ) this._synth = new SyntheticPlantSignal( this.config )

		this.connected = true
		return this

	}

	async _connectSerial() {

		let SerialPort, ReadlineParser
		try {

			( { SerialPort } = await import( 'serialport' ) );
			( { ReadlineParser } = await import( '@serialport/parser-readline' ) )

		}
		catch ( err ) {

			throw new SensorError(
				'The serial electrode transport needs "serialport". Install it with: npm install serialport @serialport/parser-readline',
				{ cause : err.message },
			)

		}

		await new Promise( ( resolve, reject ) => {

			this.port = new SerialPort( {
				path     : this.config.path || '/dev/ttyACM0',
				baudRate : this.config.baudRate || 115200,
			}, err => err ? reject( new SensorError( `Cannot open electrode port: ${err.message}` ) ) : resolve() )

		} )

		this.port.pipe( new ReadlineParser( { delimiter : '\n' } ) ).on( 'data', line => {

			// One number per line, or several comma-separated for multi-channel
			// boards; every finite value is pushed in order.
			for ( const part of String( line ).trim().split( ',' ) ) {

				const v = Number( part )
				if ( Number.isFinite( v ) ) this.push( v )

			}

		} )

	}

	/**
	 * Push samples in. The transport-agnostic entry point: use it from your own
	 * ADC loop, a websocket, an MQTT subscription, anything.
	 *
	 * @param   {number|number[]} samples - Sample or samples in mV (before `scale`).
	 * @returns {number}                  Buffer length after the push.
	 */
	push( samples ) {

		const list = Array.isArray( samples ) ? samples : [ samples ]
		for ( const s of list ) {

			const v = Number( s ) * this.scale
			if ( Number.isFinite( v ) ) this.buffer.push( v )

		}
		if ( this.buffer.length > this.capacity ) {

			this.buffer.splice( 0, this.buffer.length - this.capacity )

		}
		return this.buffer.length

	}

	/**
	 * Push samples into a secondary electrode site.
	 *
	 * @param   {string}          id      - Site id.
	 * @param   {number|number[]} samples - Sample or samples.
	 * @returns {number}                  Buffer length after the push.
	 */
	pushSite( id, samples ) {

		const site = this.sites.get( id )
		if ( !site ) throw new SensorError( `No electrode site "${id}". Declared: ${[ ...this.sites.keys() ].join( ', ' ) || 'none'}.` )

		for ( const s of Array.isArray( samples ) ? samples : [ samples ] ) {

			const v = Number( s ) * this.scale
			if ( Number.isFinite( v ) ) site.buffer.push( v )

		}
		if ( site.buffer.length > this.capacity ) {

			site.buffer.splice( 0, site.buffer.length - this.capacity )

		}
		return site.buffer.length

	}

	/**
	 * Check whether the primary site and a secondary one saw the same event.
	 *
	 * A conclusion resting on one electrode is one bad contact away from
	 * fiction. Two sites with a physically coherent propagation delay is the
	 * strongest electrophysiological evidence this library can produce.
	 *
	 * @param   {string} id      - Secondary site id.
	 * @param   {object} [opts]  - `{ seconds, minCorrelation }`.
	 * @returns {object}         Coherence verdict.
	 */
	coherence( id, opts = {} ) {

		const site = this.sites.get( id )
		if ( !site ) throw new SensorError( `No electrode site "${id}".` )

		const seconds = opts.seconds ?? 300
		const n = Math.round( seconds * this.sampleRate )

		return siteCoherence(
			{
				samples : this.buffer.slice( -n ),
				sampleRate : this.sampleRate,
				id : 'primary',
			},
			{
				samples : site.buffer.slice( -n ),
				sampleRate : this.sampleRate,
				id,
			},
			{
				distanceMm : site.distanceMm,
				...opts,
			},
		)

	}

	/**
	 * Match discrete events between the primary site and a secondary one.
	 *
	 * @param   {string} id     - Secondary site id.
	 * @param   {object} [opts] - `{ seconds, threshold }`.
	 * @returns {object}        Matched events with propagation verdicts.
	 */
	matchSites( id, opts = {} ) {

		const site = this.sites.get( id )
		if ( !site ) throw new SensorError( `No electrode site "${id}".` )

		const n = Math.round( ( opts.seconds ?? 600 ) * this.sampleRate )

		return matchEvents(
			{
				samples : this.buffer.slice( -n ),
				sampleRate : this.sampleRate,
				id : 'primary',
			},
			{
				samples : site.buffer.slice( -n ),
				sampleRate : this.sampleRate,
				id,
			},
			{
				distanceMm : site.distanceMm,
				...opts,
			},
		)

	}

	/**
	 * Trigger an event on the synthetic transport — the software equivalent of
	 * touching or wounding the plant. Lets a demo, a test or a workshop show the
	 * whole pipeline responding without anyone cutting a leaf.
	 *
	 * @param   {string}          kind - `'action_potential'` or `'variation_potential'`.
	 * @returns {ElectrodeSensor}      this
	 */
	stimulate( kind = 'action_potential' ) {

		if ( !this._synth ) {

			throw new SensorError( 'stimulate() only works on the synthetic transport.' )

		}
		this._synth.stimulate( kind )
		return this

	}

	/**
	 * Advance the synthetic simulation by a stretch of time.
	 *
	 * Separate from `readWaveform` so a caller controls *when* time passes
	 * independently of *how much* of it gets analyzed — which is what a real
	 * continuous recording gives you, and what an event needs in order to sit
	 * inside a window with baseline on both sides.
	 *
	 * @param   {number}          seconds - How much time to generate.
	 * @returns {ElectrodeSensor}         this
	 */
	advance( seconds ) {

		if ( !this._synth ) throw new SensorError( 'advance() only works on the synthetic transport.' )

		const samples = this._synth.generate( seconds, this.sampleRate )
		this.push( samples )

		// Secondary sites see the same signal delayed by its travel time, so the
		// coherence machinery has something physically sensible to verify.
		for ( const [ , site ] of this.sites ) {

			const delayS  = ( site.distanceMm || 0 ) / 10   // ~10mm/s, a typical AP
			const shift   = Math.round( delayS * this.sampleRate )
			const delayed = Array.from( { length : shift }, () => samples[ 0 ] ?? 0 )
				.concat( samples.slice( 0, samples.length - shift ) )

			for ( const v of delayed ) {

				site.buffer.push( v * 0.8 )   // amplitude decays with distance

			}
			if ( site.buffer.length > this.capacity ) {

				site.buffer.splice( 0, site.buffer.length - this.capacity )

			}

		}

		return this

	}

	/**
	 * The most recent window of raw samples.
	 *
	 * @param   {number}   [seconds] - Window length. Defaults to the whole buffer.
	 * @returns {number[]}           Samples, oldest first.
	 */
	window( seconds ) {

		if ( !seconds ) return [ ...this.buffer ]
		const n = Math.round( seconds * this.sampleRate )
		return this.buffer.slice( -n )

	}

	/**
	 * Full electrophysiological analysis of the most recent window.
	 *
	 * @param   {object} [opts]         - Options.
	 * @param   {number} [opts.seconds] - Window length.
	 * @returns {object}                `{features, events, summary, baseline}`.
	 */
	readWaveform( opts = {} ) {

		const wanted = opts.seconds ?? 60

		if ( this.transport === 'synthetic' && this._synth ) {

			// Generate only enough to fill the requested window. Generating a full
			// window on every call would push each event straight to the leading
			// edge of the next analysis, where detrending mistakes a slow variation
			// potential for a baseline trend. Use `advance()` to move time forward
			// deliberately.
			const needed = Math.round( wanted * this.sampleRate ) - this.buffer.length
			if ( needed > 0 ) this.advance( needed / this.sampleRate )

		}

		const samples = this.window( wanted )
		if ( samples.length < 8 ) {

			throw new SensorError( `Not enough electrode samples yet (${samples.length}). Push more data or wait for the buffer to fill.` )

		}

		const analysis = analyzeTrace( samples, this.sampleRate, {
			mainsHz   : this.mainsHz,
			threshold : opts.threshold ?? 4,
		} )

		return {
			...analysis,
			samples : samples.length,
			source  : this.id,
		}

	}

	/**
	 * Scalar reduction, so an electrode participates in normal monitoring.
	 *
	 * `voltage` is the current baseline level; `activity` is a 0-100 index of how
	 * electrically busy the plant is — the number a rule or an alert can use.
	 *
	 * @returns {Promise<object>} Reading.
	 */
	async read() {

		if ( !this.connected ) await this.connect()

		let analysis
		try {

			analysis = this.readWaveform( { seconds : 60 } )

		}
		catch {

			// Not enough data yet is a normal startup state, not a failure.
			return {
				timestamp : new Date(),
				source    : this.id,
			}

		}

		const t = analysis.features.time
		return {
			timestamp : new Date(),
			source    : this.id,
			voltage   : t.median,
			activity  : Math.round( analysis.features.complexity * 100 ),

		}

	}

	async disconnect() {

		if ( this.port?.isOpen ) await new Promise( r => this.port.close( r ) )
		this.connected = false
		return this

	}

}

/**
 * Synthetic plant electrophysiology.
 *
 * Superimposes the components a real recording contains: a slow circadian drift,
 * pink-ish background fluctuation, mains hum, and occasional action and
 * variation potentials with realistic shapes and timescales. It exists so the
 * DSP, the event classifier and the rhythm detector can all be exercised — and
 * tested — with no electrode attached.
 */
export class SyntheticPlantSignal {

	/**
	 * @param {object}  [config]             - Options.
	 * @param {number}  [config.seed]        - PRNG seed.
	 * @param {number}  [config.baselineMv]  - Resting potential.
	 * @param {number}  [config.noiseMv]     - Background noise amplitude.
	 * @param {number}  [config.mainsHz]     - Hum frequency. 0 disables.
	 * @param {number}  [config.mainsMv]     - Hum amplitude.
	 * @param {number}  [config.apPerHour]   - Action potentials per hour.
	 * @param {number}  [config.vpPerHour]   - Variation potentials per hour.
	 * @param {number}  [config.circadianMv] - Circadian swing amplitude.
	 */
	constructor( config = {} ) {

		this.seed        = config.seed ?? 1234
		this.baselineMv  = config.baselineMv ?? -60
		this.noiseMv     = config.noiseMv ?? 0.8
		this.mainsHz     = config.mainsHz ?? 50
		this.mainsMv     = config.mainsMv ?? 1.5
		this.apPerHour   = config.apPerHour ?? 6
		this.vpPerHour   = config.vpPerHour ?? 0
		this.circadianMv = config.circadianMv ?? 4
		this.t           = 0

		/** @type {{start: number, kind: string, amp: number, dur: number}[]} */
		this._pending = []

	}

	_rand() {

		this.seed = ( this.seed + 0x6D2B79F5 ) | 0
		let t = this.seed
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 )
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 )
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296

	}

	/** Trigger an event now — models touching, wounding or chilling the plant. */
	stimulate( kind = 'action_potential' ) {

		const spec = kind === 'variation_potential'
			? {
				amp : -12 - this._rand() * 8,
				dur : 120 + this._rand() * 300,
			}
			: {
				amp : 25 + this._rand() * 20,
				dur : 3 + this._rand() * 8,
			}

		this._pending.push( {
			start : this.t,
			kind,
			...spec,
		} )
		return this

	}

	/**
	 * Generate the next stretch of signal.
	 *
	 * @param   {number}   seconds    - How much to generate.
	 * @param   {number}   sampleRate - Samples per second.
	 * @returns {number[]}            Samples in mV.
	 */
	generate( seconds, sampleRate ) {

		const n   = Math.max( 1, Math.round( seconds * sampleRate ) )
		const dt  = 1 / sampleRate
		const out = Array.from( { length : n } )

		// Poisson-ish spontaneous events over this stretch.
		const pAp = ( this.apPerHour / 3600 ) * dt
		const pVp = ( this.vpPerHour / 3600 ) * dt

		for ( let i = 0; i < n; i++ ) {

			const t = this.t + i * dt

			if ( this._rand() < pAp ) this._pending.push( {
				start : t,
				kind  : 'action_potential',
				amp   : 25 + this._rand() * 20,
				dur   : 3 + this._rand() * 8,
			} )
			if ( this._rand() < pVp ) this._pending.push( {
				start : t,
				kind  : 'variation_potential',
				amp   : -12 - this._rand() * 8,
				dur   : 120 + this._rand() * 300,
			} )

			let v = this.baselineMv

			// Circadian drift, peaking mid-day.
			v += this.circadianMv * Math.sin( ( 2 * Math.PI * t ) / 86_400 )

			// Background noise.
			v += ( this._rand() - 0.5 ) * 2 * this.noiseMv

			// Mains hum.
			if ( this.mainsHz > 0 ) v += this.mainsMv * Math.sin( 2 * Math.PI * this.mainsHz * t )

			// Active events.
			for ( const e of this._pending ) {

				const age = t - e.start
				if ( age < 0 || age > e.dur ) continue
				v += e.amp * shape( age, e.dur, e.kind )

			}

			out[ i ] = Number( v.toFixed( 4 ) )

		}

		this.t += n * dt
		// Drop events that have fully decayed.
		this._pending = this._pending.filter( e => this.t - e.start <= e.dur )

		return out

	}

}

/**
 * Event waveform shape, normalized to a 0-1 peak.
 *
 * An action potential rises fast and repolarizes slowly; a variation potential
 * is a slow, smooth, long-tailed depression. The distinction is what the
 * classifier keys on, so the synthesizer has to get it right.
 */
function shape( age, duration, kind ) {

	const frac = age / duration

	if ( kind === 'variation_potential' ) {

		// Smooth rise over the first fifth, then a long exponential decay.
		if ( frac < 0.2 ) return frac / 0.2
		return Math.exp( -( frac - 0.2 ) * 3 )

	}

	// Action potential: sharp leading edge, slower repolarization.
	if ( frac < 0.1 ) return frac / 0.1
	return Math.exp( -( frac - 0.1 ) * 5 )

}
