/**
 * Detection of discrete electrical events in a plant trace.
 *
 * Three phenomena are worth separating, because they mean different things:
 *
 *   Action potential (AP)     fast, self-propagating, all-or-nothing. Follows a
 *                             non-damaging stimulus (touch, cold, light change).
 *   Variation potential (VP)  slower, graded, amplitude decays with distance.
 *                             Follows *damage* — wounding, burning, herbivory.
 *   System potential (SP)     very slow, sustained shift in baseline.
 *
 * Distinguishing an AP from a VP is the difference between "something touched
 * me" and "something is eating me", which is exactly the kind of message this
 * library exists to carry.
 */

import {
	detrend, medianFilter, movingAverage,
} from './dsp.js'

/**
 * Detect spikes by adaptive threshold on a detrended, de-noised trace.
 *
 * The threshold is built from the median absolute deviation rather than the
 * standard deviation, because a few large spikes inflate the SD enough to hide
 * themselves.
 *
 * @param   {number[]} x                  - Samples.
 * @param   {number}   sampleRate         - Samples per second.
 * @param   {object}   [opts]             - Options.
 * @param   {number}   [opts.threshold]   - Threshold in MADs. Default 4.
 * @param   {number}   [opts.minWidthS]   - Minimum event width in seconds.
 * @param   {number}   [opts.refractoryS] - Minimum gap between events.
 * @returns {object[]}                    Detected events.
 */
export function detectSpikes( x, sampleRate, opts = {} ) {

	const {
		threshold = 4, minWidthS = 0, refractoryS = 0,
	} = opts

	if ( x.length < 8 ) return []

	const clean = medianFilter( detrend( x ), 3 )
	const med   = median( clean )
	const mad   = median( clean.map( v => Math.abs( v - med ) ) ) || 1e-9
	// 1.4826 makes the MAD a consistent estimator of sigma for normal data.
	const sigma = mad * 1.4826
	const limit = threshold * sigma

	const events    = []
	const minWidth  = Math.max( 1, Math.round( minWidthS * sampleRate ) )
	const refractory= Math.round( refractoryS * sampleRate )

	let i = 0
	while ( i < clean.length ) {

		const deviation = clean[ i ] - med
		if ( Math.abs( deviation ) < limit ) {

			i++
			continue

		}

		const polarity = Math.sign( deviation )
		const start = i
		let peakIdx = i
		let peakVal = deviation

		while ( i < clean.length && Math.sign( clean[ i ] - med ) === polarity && Math.abs( clean[ i ] - med ) >= limit * 0.3 ) {

			if ( Math.abs( clean[ i ] - med ) > Math.abs( peakVal ) ) {

				peakVal = clean[ i ] - med
				peakIdx = i

			}
			i++

		}

		const width = i - start
		if ( width >= minWidth ) {

			const last = events.at( -1 )
			if ( !last || start - last.endIndex >= refractory ) {

				events.push( {
					startIndex : start,
					endIndex   : i,
					peakIndex  : peakIdx,
					startTimeS : round( start / sampleRate, 3 ),
					peakTimeS  : round( peakIdx / sampleRate, 3 ),
					durationS  : round( width / sampleRate, 3 ),
					amplitude  : round( peakVal, 4 ),
					polarity   : polarity > 0 ? 'depolarizing' : 'hyperpolarizing',
					snr        : round( Math.abs( peakVal ) / sigma, 2 ),
				} )

			}

		}

		i = Math.max( i, start + 1 )

	}

	return events.map( e => ( {
		...e,
		type : classifyEvent( e ),
	} ) )

}

/**
 * Label an event by its duration and shape.
 *
 * The boundaries are deliberately conservative and reported with a confidence,
 * because electrode placement and species shift them; this is a hypothesis for
 * the reasoner, not a diagnosis.
 *
 * @param   {object} event - Detected event.
 * @returns {{label: string, confidence: number}} Classification.
 */
export function classifyEvent( event ) {

	const d = event.durationS

	if ( d < 0.05 ) return {
		label      : 'artifact',
		confidence : 0.7,
		note       : 'Too fast for plant physiology — likely electrical interference.',
	}

	if ( d <= 30 ) return {
		label      : 'action_potential',
		confidence : d <= 15 ? 0.8 : 0.6,
		note       : 'Fast all-or-nothing event. Typically a non-damaging stimulus: touch, cold shock, light change.',
	}

	if ( d <= 900 ) return {
		label      : 'variation_potential',
		confidence : 0.7,
		note       : 'Slow graded event. Typically follows tissue damage: wounding, burning, herbivory.',
	}

	return {
		label      : 'system_potential',
		confidence : 0.5,
		note       : 'Very slow sustained shift. Systemic state change or electrode drift — check the baseline.',
	}

}

/**
 * Summarize a set of events into the shape the reasoner and the AI consume.
 *
 * @param   {object[]} events     - Detected events.
 * @param   {number}   durationS  - Length of the analyzed window.
 * @returns {object}              Summary.
 */
export function summarizeEvents( events, durationS ) {

	const counts = {}
	for ( const e of events ) counts[ e.type.label ] = ( counts[ e.type.label ] || 0 ) + 1

	const physiological = events.filter( e => e.type.label !== 'artifact' )
	const strongest = physiological.reduce(
		( best, e ) => ( !best || Math.abs( e.amplitude ) > Math.abs( best.amplitude ) ? e : best ),
		null,
	)

	return {
		total        : events.length,
		physiological: physiological.length,
		counts,
		ratePerHour  : durationS > 0 ? round( ( physiological.length / durationS ) * 3600, 2 ) : 0,
		strongest,
		// The signal that matters most for care: damage response.
		damageSignal : ( counts.variation_potential || 0 ) > 0,
	}

}

/**
 * Detect a sustained baseline shift — the slow story under the spikes.
 *
 * @param   {number[]} x           - Samples.
 * @param   {number}   sampleRate  - Samples per second.
 * @param   {object}   [opts]      - Options.
 * @returns {object}               Baseline description.
 */
export function baselineShift( x, sampleRate, opts = {} ) {

	if ( x.length < 4 ) return {
		shifted : false,
	}

	const windowS = opts.windowS ?? Math.max( 1, x.length / sampleRate / 10 )
	const smooth  = movingAverage( x, Math.max( 2, Math.round( windowS * sampleRate ) ) )

	const head = smooth.slice( 0, Math.max( 1, Math.floor( smooth.length * 0.2 ) ) )
	const tail = smooth.slice( Math.floor( smooth.length * 0.8 ) )

	const startLevel = head.reduce( ( a, b ) => a + b, 0 ) / head.length
	const endLevel   = tail.reduce( ( a, b ) => a + b, 0 ) / tail.length
	const delta      = endLevel - startLevel

	const noise = median( x.map( v => Math.abs( v - median( x ) ) ) ) * 1.4826 || 1e-9

	return {
		shifted    : Math.abs( delta ) > 3 * noise,
		delta      : round( delta, 4 ),
		startLevel : round( startLevel, 4 ),
		endLevel   : round( endLevel, 4 ),
		direction  : delta > 0 ? 'depolarizing' : 'hyperpolarizing',
		snr        : round( Math.abs( delta ) / noise, 2 ),
	}

}

function median( a ) {

	if ( !a.length ) return 0
	const s = [ ...a ].sort( ( x, y ) => x - y )
	return s[ Math.floor( s.length / 2 ) ]

}

function round( v, d = 4 ) {

	if ( !Number.isFinite( v ) ) return 0
	return Number( v.toFixed( d ) )

}
