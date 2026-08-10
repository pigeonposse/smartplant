/**
 * Filters for multirate fusion.
 *
 * A plant's soil moisture moves over hours; a wheel about to hit a table leg
 * moves over milliseconds. Mixing them raw produces a system that either lurches
 * at noise or ignores a real trend. These are the primitives that let each
 * timescale be summarized honestly before the two ever meet.
 */

/**
 * Exponential moving average with an explicit time constant.
 *
 * Unlike a fixed-N average, this is correct for irregular sampling: the weight
 * of a new sample depends on how much time actually passed, so a sensor that
 * stalls for an hour does not get treated as if it reported continuously.
 */
export class EMA {

	/**
	 * @param {object} [opts]        - Options.
	 * @param {number} [opts.tauMs]  - Time constant in ms. Larger = smoother.
	 * @param {number} [opts.value]  - Seed value.
	 */
	constructor( opts = {} ) {

		this.tauMs = opts.tauMs ?? 60_000
		this.value = opts.value ?? null
		this.lastAt = null
		this.samples = 0

	}

	/**
	 * Fold in a sample.
	 *
	 * @param   {number} x    - Sample.
	 * @param   {number} [at] - Timestamp in ms. Defaults to now.
	 * @returns {number}      Current average.
	 */
	push( x, at = Date.now() ) {

		if ( !Number.isFinite( x ) ) return this.value

		if ( this.value === null ) {

			this.value = x

		}
		else {

			const dt = Math.max( 0, at - ( this.lastAt ?? at ) )
			// alpha → 1 as dt grows: a very old average carries no information.
			const alpha = 1 - Math.exp( -dt / this.tauMs )
			this.value = this.value + alpha * ( x - this.value )

		}

		this.lastAt = at
		this.samples++
		return this.value

	}

	/** Age of the last sample in ms, or Infinity if never fed. */
	ageMs( now = Date.now() ) {

		return this.lastAt === null ? Infinity : now - this.lastAt

	}

	reset() {

		this.value = null
		this.lastAt = null
		this.samples = 0
		return this

	}

}

/**
 * Scalar Kalman filter with a random-walk model.
 *
 * Used where a sensor is noisy but the underlying quantity is smooth — soil
 * moisture read through a cheap capacitive probe, or a battery voltage under a
 * varying load. It reports its own variance, which the confidence layer consumes
 * rather than guessing.
 */
export class Kalman1D {

	/**
	 * @param {object} [opts]                  - Options.
	 * @param {number} [opts.processVariance]  - How fast the truth can drift.
	 * @param {number} [opts.measurementVariance] - How noisy the sensor is.
	 * @param {number} [opts.value]            - Seed estimate.
	 */
	constructor( opts = {} ) {

		this.q = opts.processVariance ?? 1e-4
		this.r = opts.measurementVariance ?? 1e-2
		this.value = opts.value ?? null
		this.variance = opts.variance ?? 1
		this.samples = 0

	}

	/**
	 * Fold in a measurement.
	 *
	 * @param   {number} z - Measurement.
	 * @returns {number}   Posterior estimate.
	 */
	push( z ) {

		if ( !Number.isFinite( z ) ) return this.value

		if ( this.value === null ) {

			this.value = z
			this.variance = this.r
			this.samples = 1
			return this.value

		}

		// Predict: the estimate stays put, uncertainty grows by the process noise.
		const predictedVariance = this.variance + this.q

		// Update: blend prediction and measurement by their relative confidence.
		const gain = predictedVariance / ( predictedVariance + this.r )
		this.value = this.value + gain * ( z - this.value )
		this.variance = ( 1 - gain ) * predictedVariance
		this.samples++

		return this.value

	}

	/** Standard deviation of the current estimate. */
	get sd() {

		return Math.sqrt( this.variance )

	}

}

/**
 * Online change-point detection (CUSUM).
 *
 * Answers "did something actually change, or is this noise?" — the question that
 * separates a plant genuinely drying out from a probe wobbling. It is what stops
 * the system reacting to every fluctuation, and what flags a model whose output
 * jumped without its inputs moving.
 */
export class ChangePointDetector {

	/**
	 * @param {object} [opts]            - Options.
	 * @param {number} [opts.threshold]  - Cumulative deviation that counts as a change.
	 * @param {number} [opts.drift]      - Allowance absorbed as normal drift.
	 */
	constructor( opts = {} ) {

		this.threshold = opts.threshold ?? 5
		this.drift = opts.drift ?? 0.5
		this.reference = null
		this.up = 0
		this.down = 0
		this.samples = 0

	}

	/**
	 * Fold in a sample.
	 *
	 * @param   {number} x - Sample.
	 * @returns {{changed: boolean, direction: string|null, magnitude: number}} Verdict.
	 */
	push( x ) {

		if ( !Number.isFinite( x ) ) return this._verdict( false, null )

		if ( this.reference === null ) {

			this.reference = x
			this.samples = 1
			return this._verdict( false, null )

		}

		const deviation = x - this.reference
		this.up = Math.max( 0, this.up + deviation - this.drift )
		this.down = Math.max( 0, this.down - deviation - this.drift )
		this.samples++

		if ( this.up > this.threshold ) {

			const magnitude = this.up
			this._rebase( x )
			return this._verdict( true, 'up', magnitude )

		}
		if ( this.down > this.threshold ) {

			const magnitude = this.down
			this._rebase( x )
			return this._verdict( true, 'down', magnitude )

		}

		// Track slow legitimate drift so it does not accumulate into a false alarm.
		this.reference += deviation * 0.01
		return this._verdict( false, null )

	}

	_rebase( x ) {

		this.reference = x
		this.up = 0
		this.down = 0

	}

	_verdict( changed, direction, magnitude = 0 ) {

		return {
			changed,
			direction,
			magnitude : Number( magnitude.toFixed( 3 ) ),
		}

	}

	reset() {

		this.reference = null
		this.up = 0
		this.down = 0
		this.samples = 0
		return this

	}

}

/**
 * Least-squares slope per second over timestamped samples.
 *
 * Reported per second rather than per sample so a trend means the same thing
 * whether the sensor ran at 1 Hz or once an hour.
 *
 * @param   {{t: number, v: number}[]} points - Samples.
 * @returns {number}                          Slope in units per second.
 */
export function slopePerSecond( points ) {

	const n = points.length
	if ( n < 2 ) return 0

	const t0 = points[ 0 ].t
	let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0

	for ( const p of points ) {

		const x = ( p.t - t0 ) / 1000
		sumX += x
		sumY += p.v
		sumXY += x * p.v
		sumXX += x * x

	}

	const denom = n * sumXX - sumX * sumX
	if ( denom === 0 ) return 0
	return Number( ( ( n * sumXY - sumX * sumY ) / denom ).toFixed( 6 ) )

}
