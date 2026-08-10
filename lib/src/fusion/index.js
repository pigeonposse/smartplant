/**
 * Multirate state fusion.
 *
 * The core problem of giving a plant a body: the plant's signals live on hours
 * and days, the body's decisions live on seconds. Fusing them naively gives you
 * a robot that either jerks at sensor noise or drives into a table because it
 * was busy averaging soil moisture.
 *
 * The answer is to never mix raw fast samples with raw slow samples. Fast
 * channels keep a short ring buffer; slow channels keep running summaries. A
 * decision consumes *the fast buffer plus the slow summary*, never both raw.
 *
 * Every sample carries two clocks: `t` (wall time, for correlating with the
 * plant's history) and `mono` (monotonic, for measuring intervals). Wall time
 * jumps when NTP corrects the Pi; monotonic does not, and interval maths must
 * never use a clock that can go backwards.
 */

export {
	ChangePointDetector, EMA, Kalman1D, slopePerSecond,
} from './filters.js'

import {
	ChangePointDetector, EMA, Kalman1D, slopePerSecond,
} from './filters.js'

/** Default classification of a channel by how fast it moves. */
export const RATE = {
	FAST : 'fast',
	SLOW : 'slow',
}

/** Monotonic milliseconds — immune to wall-clock jumps. */
export function monotonicMs() {

	// performance.now() exists on Node 16+ and in browsers; hrtime is the fallback.
	if ( typeof performance !== 'undefined' && performance.now ) return performance.now()
	const [ s, ns ] = process.hrtime()
	return s * 1000 + ns / 1e6

}

export class MultirateState {

	/**
	 * @param {object} [opts]                - Options.
	 * @param {number} [opts.fastWindowMs]   - How much fast history to keep.
	 * @param {number} [opts.maxFastSamples] - Hard cap per fast channel.
	 * @param {number} [opts.staleFastMs]    - Fast data older than this is untrustworthy.
	 * @param {number} [opts.staleSlowMs]    - Slow data older than this is untrustworthy.
	 */
	constructor( opts = {} ) {

		this.fastWindowMs   = opts.fastWindowMs ?? 30_000
		this.maxFastSamples = opts.maxFastSamples ?? 2000
		this.staleFastMs    = opts.staleFastMs ?? 2000
		this.staleSlowMs    = opts.staleSlowMs ?? 6 * 3600_000

		/** @type {Map<string, object>} */
		this.channels = new Map()

	}

	/**
	 * Declare a channel.
	 *
	 * @param   {string} name             - Channel name, e.g. `'sonar'` or `'soil'`.
	 * @param   {object} [config]         - Options.
	 * @param   {string} [config.rate]    - `'fast'` or `'slow'`.
	 * @param   {number} [config.tauMs]   - EMA time constant, for slow channels.
	 * @param   {object} [config.kalman]  - Kalman options; enables filtering.
	 * @param   {number} [config.weight]  - Trust weight, 0-1, used by the confidence layer.
	 * @returns {MultirateState}          this
	 */
	register( name, config = {} ) {

		const rate = config.rate || RATE.FAST

		this.channels.set( name, {
			name,
			rate,
			weight   : config.weight ?? 1,
			unit     : config.unit || '',
			source   : config.source || null,
			// Fast channels keep raw recent samples; slow channels keep summaries.
			buffer   : [],
			ema      : rate === RATE.SLOW
				? new EMA( { tauMs : config.tauMs ?? 3600_000 } )
				: new EMA( { tauMs : config.tauMs ?? 2000 } ),
			kalman   : config.kalman ? new Kalman1D( config.kalman ) : null,
			changes  : new ChangePointDetector( config.changePoint || {} ),
			lastValue: null,
			lastT    : null,
			lastMono : null,
			count    : 0,
			lastChange : null,
		} )

		return this

	}

	/**
	 * Publish a sample.
	 *
	 * @param   {string} name    - Channel name.
	 * @param   {number} value   - Sample value.
	 * @param   {object} [meta]  - `{ t, mono, source }`.
	 * @returns {object|null}    The channel state, or null if unknown.
	 */
	push( name, value, meta = {} ) {

		let ch = this.channels.get( name )
		// Auto-register unknown channels as fast: dropping data because someone
		// forgot a declaration is worse than a slightly wrong default.
		if ( !ch ) {

			this.register( name, { rate : RATE.FAST } )
			ch = this.channels.get( name )

		}

		if ( !Number.isFinite( value ) ) return ch

		const t = meta.t ?? Date.now()
		const mono = meta.mono ?? monotonicMs()

		const filtered = ch.kalman ? ch.kalman.push( value ) : value
		ch.ema.push( filtered, t )

		const change = ch.changes.push( filtered )
		if ( change.changed ) ch.lastChange = {
			...change,
			t,
		}

		ch.lastValue = filtered
		ch.lastT = t
		ch.lastMono = mono
		ch.count++

		if ( ch.rate === RATE.FAST ) {

			ch.buffer.push( {
				t,
				mono,
				v : filtered,
			} )
			this._trim( ch, mono )

		}
		else {

			// Slow channels keep a coarse trail for trend maths, not for control.
			ch.buffer.push( {
				t,
				mono,
				v : filtered,
			} )
			if ( ch.buffer.length > 512 ) ch.buffer.shift()

		}

		return ch

	}

	_trim( ch, nowMono ) {

		const cutoff = nowMono - this.fastWindowMs
		let drop = 0
		while ( drop < ch.buffer.length && ch.buffer[ drop ].mono < cutoff ) drop++
		if ( drop ) ch.buffer.splice( 0, drop )
		if ( ch.buffer.length > this.maxFastSamples ) {

			ch.buffer.splice( 0, ch.buffer.length - this.maxFastSamples )

		}

	}

	/**
	 * Current value of a channel.
	 *
	 * @param   {string} name - Channel name.
	 * @returns {number|null} Latest filtered value.
	 */
	value( name ) {

		return this.channels.get( name )?.lastValue ?? null

	}

	/**
	 * Fast view: raw recent samples plus their immediate statistics.
	 *
	 * This is what a reflex consumes. It deliberately contains no slow data.
	 *
	 * @param   {object} [opts]         - Options.
	 * @param   {number} [opts.windowMs]- Restrict to the last N ms.
	 * @returns {object}                Channel → `{value, min, max, slope, n, ageMs, stale}`.
	 */
	fast( opts = {} ) {

		const nowMono = monotonicMs()
		const windowMs = opts.windowMs ?? this.fastWindowMs
		const out = {}

		for ( const ch of this.channels.values() ) {

			if ( ch.rate !== RATE.FAST ) continue

			const pts = ch.buffer.filter( p => nowMono - p.mono <= windowMs )
			const ageMs = ch.lastMono === null ? Infinity : nowMono - ch.lastMono

			out[ ch.name ] = {
				value : ch.lastValue,
				n     : pts.length,
				min   : pts.length ? Math.min( ...pts.map( p => p.v ) ) : null,
				max   : pts.length ? Math.max( ...pts.map( p => p.v ) ) : null,
				// Monotonic, not wall time. Fast samples can share a millisecond of
				// `t` — and an NTP correction can move it backwards — either of which
				// turns a rate into nonsense.
				slope : slopePerSecond( pts.map( p => ( {
					t : p.mono,
					v : p.v,
				} ) ) ),
				ageMs : Math.round( ageMs ),
				stale : ageMs > this.staleFastMs,
				unit  : ch.unit,
			}

		}

		return out

	}

	/**
	 * Slow view: summaries only, never raw samples.
	 *
	 * This is what a planner consumes, and what gets concatenated onto a fast
	 * snapshot when a reflex needs to know the plant's longer story.
	 *
	 * @param   {object} [opts]         - Options.
	 * @param   {number} [opts.windowMs]- Trend window. Default 24h.
	 * @returns {object}                Channel → summary.
	 */
	slow( opts = {} ) {

		const now = Date.now()
		const windowMs = opts.windowMs ?? 24 * 3600_000
		const out = {}

		for ( const ch of this.channels.values() ) {

			if ( ch.rate !== RATE.SLOW ) continue

			const pts = ch.buffer.filter( p => now - p.t <= windowMs )
			const ageMs = ch.lastT === null ? Infinity : now - ch.lastT

			out[ ch.name ] = {
				value      : ch.lastValue,
				average    : ch.ema.value === null ? null : Number( ch.ema.value.toFixed( 4 ) ),
				min        : pts.length ? Math.min( ...pts.map( p => p.v ) ) : null,
				max        : pts.length ? Math.max( ...pts.map( p => p.v ) ) : null,
				// Per hour reads better than per second at this timescale.
				trendPerHour : Number( ( slopePerSecond( pts.map( p => ( {
					t : p.t,
					v : p.v,
				} ) ) ) * 3600 ).toFixed( 4 ) ),
				n          : pts.length,
				ageMs      : Math.round( ageMs ),
				stale      : ageMs > this.staleSlowMs,
				uncertainty: ch.kalman ? Number( ch.kalman.sd.toFixed( 4 ) ) : null,
				lastChange : ch.lastChange,
				unit       : ch.unit,
			}

		}

		return out

	}

	/**
	 * The snapshot a decision actually consumes: fast raw + slow summarized,
	 * with an explicit coherence report.
	 *
	 * `coherence` is the honest part. It says how fresh the inputs were and which
	 * were stale, so a controller can refuse to act on a snapshot that looks
	 * complete but is half an hour old.
	 *
	 * @param   {object} [opts] - Options forwarded to `fast` and `slow`.
	 * @returns {object}        `{at, fast, slow, coherence}`.
	 */
	snapshot( opts = {} ) {

		const fast = this.fast( opts )
		const slow = this.slow( opts )

		const staleFast = Object.entries( fast ).filter( ( [ , v ] ) => v.stale ).map( ( [ k ] ) => k )
		const staleSlow = Object.entries( slow ).filter( ( [ , v ] ) => v.stale ).map( ( [ k ] ) => k )

		const ages = [
			...Object.values( fast ).map( v => v.ageMs ),
			...Object.values( slow ).map( v => v.ageMs ),
		].filter( Number.isFinite )

		return {
			at       : Date.now(),
			mono     : monotonicMs(),
			fast,
			slow,
			coherence : {
				fastChannels : Object.keys( fast ).length,
				slowChannels : Object.keys( slow ).length,
				staleFast,
				staleSlow,
				oldestMs     : ages.length ? Math.round( Math.max( ...ages ) ) : null,
				// A snapshot with any stale fast channel is not safe for control.
				usableForControl : staleFast.length === 0 && Object.keys( fast ).length > 0,
			},
		}

	}

	/**
	 * Mirror a plant reading into the slow channels, so the plant's own metrics
	 * participate in fusion without the caller wiring each one by hand.
	 *
	 * @param   {object}         reading - A SmartPlant reading.
	 * @returns {MultirateState}         this
	 */
	ingestReading( reading ) {

		const t = new Date( reading?.timestamp || Date.now() ).getTime()

		for ( const [ key, value ] of Object.entries( reading || {} ) ) {

			if ( key === 'timestamp' || key === 'source' ) continue
			if ( !Number.isFinite( value ) ) continue

			if ( !this.channels.has( key ) ) {

				this.register( key, {
					rate   : RATE.SLOW,
					source : reading.source,
				} )

			}
			this.push( key, value, { t } )

		}

		return this

	}

	/** Channels that have gone quiet. */
	staleChannels( now = Date.now() ) {

		const out = []
		for ( const ch of this.channels.values() ) {

			const limit = ch.rate === RATE.FAST ? this.staleFastMs : this.staleSlowMs
			const age = ch.lastT === null ? Infinity : now - ch.lastT
			if ( age > limit ) out.push( {
				name : ch.name,
				rate : ch.rate,
				ageMs : Number.isFinite( age ) ? Math.round( age ) : null,
			} )

		}
		return out

	}

}
