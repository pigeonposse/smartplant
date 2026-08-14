/**
 * Knowing whether anybody is in the room, from the WiFi that is already there.
 *
 * A body between two radios changes the signal that arrives. Channel State
 * Information — the per-subcarrier amplitude and phase a WiFi receiver already
 * computes in order to demodulate — carries that change, and the variance of it
 * over a few seconds separates an empty room from an occupied one. It works in
 * the dark, through a wall, with no camera and nothing worn.
 *
 * This is a real and well-studied technique. It is also one where the marketing
 * runs far ahead of the hardware, so it is worth being precise about what is
 * being claimed here.
 *
 * ## What this does and does not attempt
 *
 * **Occupancy and motion.** Is somebody in the room, and did something move near
 * this plant in the last few seconds. Both are reliable enough to act on, and
 * both are exactly what this library is short of.
 *
 * **Not pose, not identity, not breathing, not counting people.** Those are
 * possible with CSI and they need an array of receivers, a trained model, and a
 * calibration for the specific room. A single ESP32 gives coarse presence — the
 * projects working on more say so themselves. Estimating a skeleton from one
 * radio and reporting it as a fact would be inventing the link this library
 * spends most of its refusals avoiding.
 *
 * ## RSSI is not CSI, and the difference decides what you get
 *
 * Every WiFi device reports RSSI: one number for the whole signal. It moves when
 * somebody walks through the path and it is enough for "something changed".
 *
 * CSI is a value per subcarrier — tens of numbers describing how the channel is
 * shaped across frequency — and it is what makes fine motion legible. Consumer
 * hardware almost never exposes it. An ESP32-S3 does with the right firmware;
 * so do a few old research NICs.
 *
 * So the driver declares which it has, and everything downstream is gated on
 * that rather than on the marketing.
 *
 * ## Why a plant cares at all
 *
 * Two things, and neither is about watching people.
 *
 * The UV-B interlock refuses to emit while the room is occupied, because UV-B
 * burns skin and eyes and a plant on a shelf is at eye height. Until now the
 * library could only know that if somebody told it.
 *
 * And motion is the commonest cause of an electrical event that is not a wound.
 * Brushing past a plant produces an action potential; so does the draught from a
 * door. The defence estimate already discounts an event the weather explains,
 * and "somebody walked past at that exact moment" belongs in the same column.
 */

import { SensorError } from '../../core/errors.js'
import { SensorDriver } from '../driver.js'

/** What the radio can actually tell you. */
export const SENSING = {
	CSI  : 'csi',
	RSSI : 'rssi',
}

/**
 * What each kind of radio supports.
 *
 * Kept as a table rather than as a boolean so a refusal can name the hardware
 * that would lift it.
 */
export const CAPABILITY = {
	[ SENSING.CSI ] : {
		occupancy : true,
		motion : true,
		direction : false,
		pose : false,
		why : 'Per-subcarrier amplitude and phase. Enough for presence and for motion fine enough to notice somebody reaching past the plant.',
	},
	[ SENSING.RSSI ] : {
		occupancy : true,
		motion : true,
		direction : false,
		pose : false,
		why : 'One number for the whole signal. It moves when a body crosses the path, so presence and gross motion are legible and nothing finer is.',
	},
}

const finite = Number.isFinite

/**
 * Variance of a series, which is what carries the signal here.
 *
 * A still room gives a nearly flat channel; a person moving through it makes it
 * wander. The absolute level says almost nothing — two rooms with identical
 * occupancy read completely different RSSI — so everything is judged against
 * this radio's own quiet baseline rather than against a threshold from a table.
 *
 * @param   {number[]} xs - Samples.
 * @returns {number}      Variance.
 */
export function variance( xs ) {

	const v = ( xs ?? [] ).filter( finite )
	if ( v.length < 2 ) return 0

	const mean = v.reduce( ( a, b ) => a + b, 0 ) / v.length
	return v.reduce( ( a, b ) => a + ( b - mean ) ** 2, 0 ) / v.length

}

/**
 * Presence from a WiFi radio.
 *
 * The driver does not talk to a radio itself — there is no portable way to, and
 * the hardware that exposes CSI does so through its own firmware. It takes
 * samples from a callback, which is the same shape the callback sensor and the
 * callback vision source use.
 */
export class PresenceSensor extends SensorDriver {

	static id       = 'presence'
	static provides = [ 'occupancy', 'motion' ]

	/**
	 * @param {object}   [config]          - Options.
	 * @param {string}   [config.sensing]  - `'csi'` or `'rssi'`. No default: it has to be stated.
	 * @param {Function} [config.sample]   - `async () => number | number[]`. One reading from the radio.
	 * @param {number}   [config.windowMs] - How much history to judge against. Default 20s.
	 * @param {number}   [config.settleSamples] - Samples before it will answer at all. Default 40.
	 */
	constructor( config = {} ) {

		super( {
			id : PresenceSensor.id,
			...config,
		} )

		if ( !config.sensing ) {

			throw new SensorError( 'The presence driver needs { sensing: "csi" | "rssi" }. It is not a detail: RSSI is one number for the whole signal and CSI is a value per subcarrier, and what can honestly be reported differs between them. Stating it is what stops this reporting more than the radio can support.' )

		}

		if ( !CAPABILITY[ config.sensing ] ) {

			throw new SensorError( `Unknown sensing kind "${config.sensing}". Use "csi" or "rssi".` )

		}

		if ( typeof config.sample !== 'function' ) {

			throw new SensorError( 'The presence driver needs a { sample } function returning a number (RSSI) or an array of numbers (CSI subcarriers). There is no portable way to read a radio from here — an ESP32-S3 with CSI firmware, or anything that can report RSSI, feeds this.' )

		}

		this.sensing = config.sensing
		this.capability = CAPABILITY[ config.sensing ]
		this.sample = config.sample
		this.windowMs = config.windowMs ?? 20_000
		this.settleSamples = config.settleSamples ?? 40

		this._history = []
		/** The quietest variance seen once settled — this room's empty baseline. */
		this._quiet = null

	}

	async connect() {

		this.connected = true
		return this

	}

	async disconnect() {

		this.connected = false
		this._history = []
		return this

	}

	/**
	 * Take one sample and fold it in.
	 *
	 * @returns {Promise<object>} `{occupancy, motion, ...}`.
	 */
	async read() {

		const raw = await this.sample()
		const at = Date.now()

		// A CSI frame is a vector; its spread across subcarriers is the useful
		// scalar. An RSSI reading is already one.
		const value = Array.isArray( raw ) ? variance( raw ) : raw

		if ( !finite( value ) ) {

			throw new SensorError( 'The presence sample returned nothing usable. Expected a number (RSSI) or an array of numbers (CSI subcarriers).' )

		}

		this._history.push( {
			at,
			value,
		} )
		const cutoff = at - this.windowMs
		while ( this._history.length && this._history[ 0 ].at < cutoff ) this._history.shift()

		return this.state()

	}

	/**
	 * What the radio currently says.
	 *
	 * @returns {object} `{occupancy, motion, settled, why}`.
	 */
	state() {

		const n = this._history.length

		if ( n < this.settleSamples ) {

			return {
				occupancy : null,
				motion : null,
				settled : false,
				samples : n,
				sensing : this.sensing,
				why : `${n} of ${this.settleSamples} samples. Presence here is a departure from this room's own quiet, and until there is a quiet to depart from there is nothing to compare against. An absolute threshold would be a number from somebody else's room.`,
			}

		}

		const values = this._history.map( h => h.value )
		const now = variance( values.slice( -Math.max( 5, Math.round( n / 8 ) ) ) )
		const overall = variance( values )

		// The floor is the calmest the room has been. It only ever goes down, so
		// an empty room reasserts the baseline and an occupied one cannot raise it.
		this._quiet = this._quiet === null ? overall : Math.min( this._quiet, overall )

		// A radio returning the same number every time is the stuck-sensor case in
		// a different costume, and dividing by its floor of zero turns any change
		// at all into a ratio in the thousands, which reads as certainty.
		//
		// Detected by exact repetition rather than by a small threshold: what
		// counts as "small" depends entirely on whether these are RSSI decibels
		// or CSI amplitudes, and an absolute number here would be the same
		// mistake as an absolute presence threshold. Real measurement carries
		// noise in its last digit even in an empty room; a latched one does not.
		if ( values.every( v => v === values[ 0 ] ) ) {

			return {
				occupancy : null,
				motion : null,
				settled : true,
				stuck : true,
				samples : n,
				sensing : this.sensing,
				why : 'The radio has not varied at all across the whole window. Real measurement carries noise in its last digit even in an empty room, so this is a sample function returning a constant rather than a very still house. Nothing can be concluded about presence until it is reporting.',
			}

		}

		const floor = Math.max( this._quiet, 1e-6 )
		const ratio = now / floor

		// Deliberately coarse. Two bands, and no attempt at a person count.
		const motion = ratio > 6
		const occupancy = ratio > 2.5

		return {
			occupancy,
			motion,
			settled : true,
			ratio : Number( ratio.toFixed( 2 ) ),
			samples : n,
			sensing : this.sensing,
			capability : this.capability,
			why : motion
				? `The channel is ${ratio.toFixed( 1 )}× as unsettled as this room's quietest, which is somebody moving rather than somebody sitting still.`
				: occupancy
					? `The channel is ${ratio.toFixed( 1 )}× the quiet floor — consistent with somebody in the room and not moving much.`
					: `The channel is close to its quietest. Nobody detected, which on ${this.sensing.toUpperCase()} means nobody moving; a person sitting perfectly still is the case this cannot see.`,
		}

	}

}

/**
 * Did something move at the moment an electrical event happened?
 *
 * The negative control that belongs beside the weather one. Brushing past a
 * plant produces an action potential, and so does the draught from a door — both
 * look like the opening of a wound response for the first few minutes. The
 * defence estimate already discounts what the room explains; a body walking past
 * belongs in the same column.
 *
 * @param   {object[]} history - Presence states, newest last, each `{at, motion}`.
 * @param   {number}   at      - When the electrical event happened.
 * @param   {object}   [opts]  - `{ windowMs }`. Default ±30s.
 * @returns {object}           `{explains, why}`.
 */
export function motionExplains( history, at, opts = {} ) {

	if ( !Array.isArray( history ) || !history.length ) {

		return {
			explains : null,
			why : 'No presence history, so whether somebody touched this plant at that moment is unknown. It is the commonest cause of an action potential that is not a wound, and without it the defence estimate is missing a control it could have had.',
		}

	}

	if ( !finite( at ) ) {

		return {
			explains : null,
			why : 'The electrical event carries no time, so nothing can be lined up against it.',
		}

	}

	const window = opts.windowMs ?? 30_000
	const near = history.filter( h => finite( h?.at ) && Math.abs( h.at - at ) <= window )

	if ( !near.length ) {

		return {
			explains : null,
			why : `Nothing was sampled within ${Math.round( window / 1000 )}s of the event, so the radio has no opinion about that moment.`,
		}

	}

	const moved = near.filter( h => h.motion === true )

	return {
		explains : moved.length > 0,
		samples : near.length,
		why : moved.length
			? `Somebody was moving nearby within ${Math.round( window / 1000 )}s of the event. Brushing a leaf produces an action potential that looks exactly like the start of a wound response, and this is the most ordinary explanation for one.`
			: `The room was still within ${Math.round( window / 1000 )}s of the event, so nobody walking past accounts for it.`,
	}

}
