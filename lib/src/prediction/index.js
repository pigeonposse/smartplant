/**
 * Being wrong, on purpose and in public.
 *
 * The learning loop already measures whether an action *worked*: it acts, scores
 * the result, and prefers what scored well. What it never asked is whether the
 * result was the one it **expected**. Those are different questions, and only the
 * second one can tell the system that its model of this plant is wrong.
 *
 * An action can keep producing good outcomes for reasons the model has
 * completely backwards, and outcome-only learning will happily reinforce it. And
 * an action the model rates highly can keep disappointing without anything ever
 * writing down "my estimate for this is consistently too high."
 *
 * It is tempting to read a plant that keeps contradicting its model as
 * *resisting* — sabotaging the system, having preferences of its own. That
 * framing is wrong and it is dangerous. A plant has no model of the system and
 * cannot form an intention to thwart it. What is actually happening is that the
 * system's expectations are wrong, and the mismatch is the single most valuable
 * signal it will ever get. Call it resistance and the natural response is to
 * suppress it. Call it prediction error and the natural response is to fix the
 * model. Same measurement, opposite conclusions.
 *
 * So: every prediction is written down before acting, compared afterwards, and
 * a bias that persists is reported as a fault in the model rather than as a
 * quirk of the plant.
 */

/** How wrong, and in which direction. */
export const BIAS = {
	OPTIMISTIC : 'optimistic',
	PESSIMISTIC: 'pessimistic',
	CALIBRATED : 'calibrated',
	NOISY      : 'noisy',
}

/**
 * A running record of what was predicted against what happened.
 */
export class PredictionLedger {

	/**
	 * @param {object} [opts]              - Options.
	 * @param {number} [opts.window]       - Predictions kept per action. Default 50.
	 * @param {number} [opts.minSamples]   - Before any verdict is offered. Default 6.
	 * @param {number} [opts.biasThreshold]- Mean error that counts as biased. Default 0.15.
	 */
	constructor( opts = {} ) {

		// An explicit null is a different mistake from omitting the argument, and
		// a default only covers the second. Both should land on the same message.
		opts = opts ?? {}


		this.window = opts.window ?? 50
		this.minSamples = opts.minSamples ?? 6
		this.biasThreshold = opts.biasThreshold ?? 0.15

		/** @type {Map<string, object[]>} action → records */
		this.records = new Map()

	}

	/**
	 * Write down a prediction and what actually happened.
	 *
	 * @param   {object} entry            - The pair.
	 * @param   {string} entry.action     - What was chosen.
	 * @param   {number} entry.expected   - What the model thought it was worth.
	 * @param   {number} entry.observed   - What it turned out to be worth.
	 * @param   {object} [entry.context]  - The situation, for grouping later.
	 * @returns {object}                  The stored record.
	 */
	record( { action, expected, observed, context } ) {

		if ( !action ) throw new Error( 'A prediction record needs the action it was about.' )

		// A model with no opinion has not made a prediction, so it cannot be wrong.
		// Storing a null as if it were a forecast of zero would manufacture error
		// out of ignorance, which is the opposite of what this measures.
		if ( !Number.isFinite( expected ) || !Number.isFinite( observed ) ) {

			return {
				action,
				skipped : true,
				why : 'No numeric prediction to compare against; nothing to be right or wrong about.',
			}

		}

		const entry = {
			at       : new Date().toISOString(),
			action,
			expected : Number( expected.toFixed( 4 ) ),
			observed : Number( observed.toFixed( 4 ) ),
			// Positive means the world beat the forecast.
			error    : Number( ( observed - expected ).toFixed( 4 ) ),
			context  : context || {},
		}

		if ( !this.records.has( action ) ) this.records.set( action, [] )
		const list = this.records.get( action )
		list.push( entry )
		if ( list.length > this.window ) list.shift()

		return entry

	}

	/**
	 * How wrong the model has been about one action.
	 *
	 * @param   {string} action - Action id.
	 * @returns {object}        `{known, bias, meanError, mae, n, verdict}`.
	 */
	calibration( action ) {

		const list = this.records.get( action ) || []

		if ( list.length < this.minSamples ) {

			return {
				action,
				known  : false,
				n      : list.length,
				verdict: `Only ${list.length} prediction(s) for "${action}"; ${this.minSamples} are needed before calling the model wrong.`,
			}

		}

		const errors = list.map( r => r.error )
		const n = errors.length
		const meanError = errors.reduce( ( a, b ) => a + b, 0 ) / n
		const mae = errors.reduce( ( a, b ) => a + Math.abs( b ), 0 ) / n
		const variance = errors.reduce( ( a, e ) => a + ( e - meanError ) ** 2, 0 ) / n

		// A signed mean that survives its own spread is a real bias. A large
		// average error that averages to nothing is noise, and the fix for the two
		// is not the same: bias means shift the estimate, noise means the model is
		// missing whatever actually drives the outcome.
		const biased = Math.abs( meanError ) > this.biasThreshold
			&& Math.abs( meanError ) > Math.sqrt( variance ) / 2

		let bias = BIAS.CALIBRATED
		if ( biased ) bias = meanError < 0 ? BIAS.OPTIMISTIC : BIAS.PESSIMISTIC
		else if ( mae > this.biasThreshold * 2 ) bias = BIAS.NOISY

		return {
			action,
			known     : true,
			n,
			bias,
			meanError : Number( meanError.toFixed( 4 ) ),
			mae       : Number( mae.toFixed( 4 ) ),
			sd        : Number( Math.sqrt( variance ).toFixed( 4 ) ),
			// The correction to apply to future estimates for this action.
			suggestedShift : biased ? Number( meanError.toFixed( 4 ) ) : 0,
			verdict   : verdictFor( action, bias, meanError, mae, n ),
		}

	}

	/**
	 * Everywhere the model is systematically wrong, worst first.
	 *
	 * @returns {object[]} Calibration reports for actions with a real bias.
	 */
	faults() {

		return [ ...this.records.keys() ]
			.map( a => this.calibration( a ) )
			.filter( c => c.known && c.bias !== BIAS.CALIBRATED )
			.sort( ( a, b ) => b.mae - a.mae )

	}

	/**
	 * Cues for the evidence ledger.
	 *
	 * A model that is reliably wrong about an action is a fact about the *system*,
	 * not about the plant, and it belongs in the record as such.
	 *
	 * @returns {object[]} Cues.
	 */
	cues() {

		return this.faults().map( f => ( {
			claim    : 'model_miscalibrated',
			source   : 'prediction',
			strength : Math.min( 0.7, 0.3 + Math.abs( f.meanError ) ),
			detail   : `"${f.action}": ${f.bias}, mean error ${f.meanError > 0 ? '+' : ''}${f.meanError} over ${f.n} predictions`,
		} ) )

	}

	/** A readable summary of how well the system understands this plant. */
	report() {

		const actions = [ ...this.records.keys() ].map( a => this.calibration( a ) )
		const known = actions.filter( a => a.known )
		const faults = this.faults()

		if ( !known.length ) {

			return {
				known   : false,
				actions,
				verdict : 'Not enough completed predictions yet to say whether the model understands this plant.',
			}

		}

		const mae = known.reduce( ( a, k ) => a + k.mae, 0 ) / known.length

		return {
			known   : true,
			actions,
			faults,
			meanAbsoluteError : Number( mae.toFixed( 4 ) ),
			verdict : faults.length
				? `The model is systematically wrong about ${faults.length} of ${known.length} action(s). Worst: ${faults[ 0 ].verdict}`
				: `The model tracks this plant across all ${known.length} action(s) it has enough data for (mean absolute error ${mae.toFixed( 3 )}).`,
		}

	}

	/** Forget everything about one action, or all of them. */
	reset( action ) {

		if ( action ) this.records.delete( action )
		else this.records.clear()
		return this

	}

}

function verdictFor( action, bias, meanError, mae, n ) {

	const size = Math.abs( meanError ).toFixed( 3 )

	if ( bias === BIAS.OPTIMISTIC ) {

		return `"${action}" keeps doing less than the model expects — over ${n} predictions it overestimates by ${size} on average. The estimate should come down; the plant is not failing to cooperate.`

	}

	if ( bias === BIAS.PESSIMISTIC ) {

		return `"${action}" keeps doing more than the model expects — over ${n} predictions it underestimates by ${size}. This action is worth more here than the model believes.`

	}

	if ( bias === BIAS.NOISY ) {

		return `"${action}" is not biased but is badly predicted (mean absolute error ${mae.toFixed( 3 )} over ${n}). Something that actually drives this outcome is missing from the context the model sees.`

	}

	return `"${action}" is well calibrated over ${n} predictions.`

}
