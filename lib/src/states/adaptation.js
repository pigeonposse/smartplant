/**
 * Rewriting this plant's own thresholds, slowly, and being able to take it back.
 *
 * The system already learns in pieces. It records what resolved a problem, it
 * measures how wrong its forecasts were, it notices when a response has changed.
 * What it has never done is close the loop: take a systematic, repeated error
 * and *change the number that produced it*.
 *
 * This does, and it is the most dangerous thing in the library, so most of it is
 * refusal.
 *
 * ## Why this comes last
 *
 * A system that rewrites its own thresholds from its own conclusions adapts
 * toward whatever it already believed. It decides a plant is stressed, acts on
 * that, records the action as justified, and shifts the threshold that made it
 * decide — and every step is locally reasonable.
 *
 * The only thing that breaks the circle is an outside signal about whether the
 * system was *wrong*, and there is exactly one: the calibration record, built
 * from occasions when somebody overrode a refusal and nothing bad happened.
 * So adaptation is gated on that record existing. A plant nobody has ever
 * overridden gets no adaptation at all, and that is the correct answer rather
 * than a limitation — nothing has told it it was wrong about anything.
 *
 * ## Systematic, not merely large
 *
 * A threshold moves on bias, never on error. Ten forecasts that were each wrong
 * by a lot in different directions is a noisy plant and a fine threshold; ten
 * that were each wrong by a little in the *same* direction is a threshold set in
 * the wrong place. The second is rare and the first is constant, and a system
 * that cannot tell them apart chases noise forever.
 *
 * ## Everything is versioned and everything can be taken back
 *
 * Each change records what it was before, what evidence moved it, and when. A
 * plant that starts doing worse after an adaptation can be walked back to what
 * it was — which matters because the failure mode here is slow, and by the time
 * it is visible nobody remembers what the number used to be.
 */

/** Why a proposed change was refused. */
export const REFUSED = {
	NO_CALIBRATION : 'no-calibration',
	NOT_SYSTEMATIC : 'not-systematic',
	TOO_LITTLE     : 'too-little-evidence',
	TOO_FAR        : 'too-far',
	CAPPED         : 'already-moved-enough',
}

/** How much of the original a threshold may ever drift, in total. */
export const MAX_DRIFT = 0.25

/** Observations before a bias is worth acting on. */
export const MIN_OBSERVATIONS = 20

/** Fraction of the gap closed per adaptation. Deliberately small. */
export const STEP = 0.2

const finite = Number.isFinite

/**
 * Is this a bias or is it noise?
 *
 * @param   {number[]} errors - Signed errors, prediction minus outcome.
 * @param   {object}   [opts] - `{ min }`.
 * @returns {object}          `{systematic, bias, why}`.
 */
export function bias( errors, opts = {} ) {

	const xs = Array.isArray( errors ) ? errors.filter( finite ) : []
	const min = opts?.min ?? MIN_OBSERVATIONS

	if ( xs.length < min ) {

		return {
			systematic : false,
			reason : REFUSED.TOO_LITTLE,
			n : xs.length,
			why : `${xs.length} of ${min} observations. Below that a run of errors in one direction is what randomness looks like, and a threshold moved on it would be chasing noise.`,
		}

	}

	const mean = xs.reduce( ( a, b ) => a + b, 0 ) / xs.length
	const sd = Math.sqrt( xs.reduce( ( a, b ) => a + ( b - mean ) ** 2, 0 ) / xs.length )

	// The whole distinction: is the average error large compared to the spread?
	// Ten errors of ±10 averaging 1 is a noisy plant. Ten of ±2 averaging 1.8 is
	// a threshold in the wrong place.
	const ratio = sd > 0 ? Math.abs( mean ) / sd : ( mean === 0 ? 0 : Infinity )

	if ( ratio < 0.5 ) {

		return {
			systematic : false,
			reason : REFUSED.NOT_SYSTEMATIC,
			bias : Number( mean.toFixed( 3 ) ),
			spread : Number( sd.toFixed( 3 ) ),
			n : xs.length,
			why : `The errors average ${mean.toFixed( 2 )} with a spread of ${sd.toFixed( 2 )}. Wrong by a lot in different directions is a noisy plant and a fine threshold; wrong by a little in the same direction is a threshold in the wrong place. This is the first.`,
		}

	}

	return {
		systematic : true,
		bias : Number( mean.toFixed( 3 ) ),
		spread : Number( sd.toFixed( 3 ) ),
		ratio : Number( ratio.toFixed( 2 ) ),
		n : xs.length,
		why : `${xs.length} observations averaging ${mean.toFixed( 2 )} against a spread of ${sd.toFixed( 2 )}. The errors lean the same way often enough that the number producing them is in the wrong place, rather than the plant being noisy.`,
	}

}

/**
 * The record of every threshold this plant has moved.
 */
export class Adaptation {

	/**
	 * @param {object} [opts] - `{ maxDrift, step, calibration }`.
	 */
	constructor( opts = {} ) {

		this.maxDrift = opts.maxDrift ?? MAX_DRIFT
		this.step = opts.step ?? STEP
		/** key → { original, current, history } */
		this.thresholds = new Map()

	}

	/**
	 * Register a threshold so it can be adapted and taken back.
	 *
	 * @param   {string} key   - What it is.
	 * @param   {number} value - Its original value.
	 * @returns {object}       The entry.
	 */
	register( key, value ) {

		if ( !this.thresholds.has( key ) && finite( value ) ) {

			this.thresholds.set( key, {
				key,
				original : value,
				current : value,
				history : [],
			} )

		}

		return this.thresholds.get( key )

	}

	/** What a threshold is now. */
	get( key ) {

		return this.thresholds.get( key )?.current ?? null

	}

	/**
	 * Move a threshold, if everything says it should move.
	 *
	 * @param   {string} key    - The threshold.
	 * @param   {object} signal - From `bias`.
	 * @param   {object} [opts] - `{ calibration, state }`.
	 * @returns {object}        `{changed, from, to, why}`.
	 */
	adapt( key, signal, opts = {} ) {

		const entry = this.thresholds.get( key )

		if ( !entry ) return {
			changed : false,
			why : `"${key}" was never registered, so there is no original to measure drift against and no way back. Register it before adapting it — the way back is the point.`,
		}

		// The gate that stops the circle. Without an outside signal about being
		// wrong, a system adapting from its own conclusions adapts toward what it
		// already believed, and every step of that is locally reasonable.
		const record = opts.calibration?.report?.()
		const grounded = record?.states?.some( s => s.known )

		if ( !grounded ) {

			return {
				changed : false,
				reason : REFUSED.NO_CALIBRATION,
				why : 'Nothing has ever told this system it was wrong. Adaptation runs on the calibration record — occasions when a refusal was overridden and nothing bad happened — and with none of that, changing a threshold means moving toward its own conclusions. A plant nobody has ever overridden gets no adaptation, and that is the right answer rather than a limitation.',
			}

		}

		if ( !signal?.systematic ) {

			return {
				changed : false,
				reason : signal?.reason ?? REFUSED.NOT_SYSTEMATIC,
				why : signal?.why ?? 'No systematic bias to correct.',
			}

		}

		const target = entry.current - signal.bias
		const step = entry.current + ( target - entry.current ) * this.step

		const drift = Math.abs( step - entry.original ) / Math.abs( entry.original || 1 )

		if ( drift > this.maxDrift ) {

			return {
				changed : false,
				reason : REFUSED.CAPPED,
				drift : Number( drift.toFixed( 3 ) ),
				why : `That would put "${key}" ${Math.round( drift * 100 )}% away from where it started, past the ${Math.round( this.maxDrift * 100 )}% ceiling. A threshold that has moved this far is not being tuned — either the original was badly wrong, which is worth a person looking at, or the adaptation is following something that is not the plant.`,
			}

		}

		const from = entry.current
		entry.current = Number( step.toFixed( 4 ) )
		entry.history.push( {
			at : Date.now(),
			from,
			to : entry.current,
			bias : signal.bias,
			observations : signal.n,
		} )

		return {
			changed : true,
			key,
			from,
			to : entry.current,
			drift : Number( drift.toFixed( 3 ) ),
			why : `"${key}" moves ${from} → ${entry.current}, a fifth of the way toward what ${signal.n} observations suggest. ${signal.why} Small on purpose: a threshold that jumps to where the evidence points has overfitted the last month.`,
		}

	}

	/**
	 * Put a threshold back.
	 *
	 * @param   {string} key    - The threshold, or omit for all of them.
	 * @param   {object} [opts] - `{ steps }` to walk back rather than reset.
	 * @returns {object}        `{reverted, why}`.
	 */
	revert( key, opts = {} ) {

		const keys = key ? [ key ] : [ ...this.thresholds.keys() ]
		const reverted = []

		for ( const k of keys ) {

			const entry = this.thresholds.get( k )
			if ( !entry || !entry.history.length ) continue

			if ( finite( opts.steps ) ) {

				for ( let i = 0; i < opts.steps && entry.history.length; i++ ) {

					entry.current = entry.history.pop().from

				}

			}
			else {

				entry.current = entry.original
				entry.history.push( {
					at : Date.now(),
					reset : true,
				} )

			}

			reverted.push( {
				key : k,
				now : entry.current,
			} )

		}

		return {
			reverted,
			why : reverted.length
				? `${reverted.map( r => `${r.key} → ${r.now}` ).join( ', ' )}. The failure mode of adaptation is slow, and by the time it is visible nobody remembers what the number used to be — which is the whole reason for keeping the original.`
				: 'Nothing had been adapted, so there was nothing to take back.',
		}

	}

	/** Everything that has moved, and how far. */
	report() {

		const moved = [ ...this.thresholds.values() ].filter( e => e.current !== e.original )

		return {
			registered : this.thresholds.size,
			adapted : moved.map( e => ( {
				key : e.key,
				original : e.original,
				current : e.current,
				changes : e.history.filter( h => !h.reset ).length,
				drift : Number( ( Math.abs( e.current - e.original ) / Math.abs( e.original || 1 ) ).toFixed( 3 ) ),
			} ) ),
			why : moved.length
				? `${moved.length} of ${this.thresholds.size} thresholds have moved from where they started. Each one can be put back.`
				: `${this.thresholds.size} thresholds registered and none has moved. Which is the ordinary case: adaptation needs a systematic bias and a record of having been wrong, and most plants provide neither.`,
		}

	}

	toJSON() {

		return { thresholds : [ ...this.thresholds.values() ] }

	}

}
