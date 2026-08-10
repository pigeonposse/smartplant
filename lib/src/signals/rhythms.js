/**
 * Biological rhythm detection.
 *
 * Plants run a circadian clock and it is one of the most reliable health
 * indicators there is: a stressed, sick or light-starved plant loses rhythm
 * amplitude and drifts off a 24-hour period before any visible symptom appears.
 *
 * Autocorrelation is used rather than an FFT because plant recordings are short
 * relative to the period being looked for (a few days of data for a 24 h cycle),
 * where the FFT has almost no frequency resolution and autocorrelation still works.
 */

import { detrend, zscore } from './dsp.js'

/**
 * Autocorrelation across a lag range.
 *
 * @param   {number[]} x       - Samples.
 * @param   {number}   maxLag  - Largest lag in samples.
 * @returns {number[]}         Correlation per lag, index = lag.
 */
export function autocorrelation( x, maxLag ) {

	const z = zscore( detrend( x ) )
	const n = z.length
	const lim = Math.min( maxLag, n - 2 )
	const out = Array.from( { length : lim + 1 }, () => 0 )

	for ( let lag = 0; lag <= lim; lag++ ) {

		let sum = 0
		const count = n - lag
		for ( let i = 0; i < count; i++ ) sum += z[ i ] * z[ i + lag ]
		out[ lag ] = count > 0 ? sum / count : 0

	}

	return out

}

/**
 * Find the dominant rhythm in a series of timestamped readings.
 *
 * @param   {object[]} series            - `{t, value}` records, oldest first.
 * @param   {object}   [opts]            - Options.
 * @param   {number}   [opts.minPeriodH] - Shortest period to consider, hours.
 * @param   {number}   [opts.maxPeriodH] - Longest period to consider, hours.
 * @returns {object}                     Rhythm description.
 */
export function findRhythm( series, opts = {} ) {

	const { minPeriodH = 1, maxPeriodH = 48 } = opts

	if ( series.length < 8 ) {

		return {
			detected : false,
			reason   : `Need at least 8 readings to look for a rhythm, got ${series.length}.`,
		}

	}

	const times  = series.map( s => new Date( s.t ).getTime() )
	const values = series.map( s => s.value )
	const spanH  = ( times.at( -1 ) - times[ 0 ] ) / 3600_000

	if ( spanH < minPeriodH * 2 ) {

		return {
			detected : false,
			reason   : `Need at least two full cycles: ${round( spanH, 1 )}h of data cannot show a ${minPeriodH}h rhythm.`,
		}

	}

	// Readings arrive irregularly; resample onto a uniform grid so a lag is a
	// fixed amount of time rather than "however long those samples happened to take".
	const stepH   = Math.max( spanH / 512, minPeriodH / 8 )
	const grid    = resampleToGrid( times, values, stepH )
	const maxLag  = Math.min( Math.floor( maxPeriodH / stepH ), grid.length - 2 )
	const acf     = autocorrelation( grid, maxLag )

	const minLag = Math.max( 1, Math.floor( minPeriodH / stepH ) )
	let bestLag = -1, bestCorr = -Infinity

	// Take the first prominent local maximum, not the global one: harmonics of
	// the true period also correlate well and would otherwise win at 48h.
	for ( let lag = minLag + 1; lag < acf.length - 1; lag++ ) {

		if ( acf[ lag ] > acf[ lag - 1 ] && acf[ lag ] >= acf[ lag + 1 ] && acf[ lag ] > bestCorr ) {

			bestCorr = acf[ lag ]
			bestLag  = lag
			if ( bestCorr > 0.6 ) break

		}

	}

	if ( bestLag < 0 || bestCorr < 0.2 ) {

		return {
			detected : false,
			reason   : 'No repeating cycle stood out above the noise.',
			strength : round( Math.max( 0, bestCorr ), 3 ),
			spanH    : round( spanH, 1 ),
		}

	}

	const periodH = bestLag * stepH

	return {
		detected   : true,
		periodHours: round( periodH, 2 ),
		strength   : round( bestCorr, 3 ),
		spanH      : round( spanH, 1 ),
		cycles     : round( spanH / periodH, 1 ),
		kind       : classifyPeriod( periodH ),
		amplitude  : round( ( Math.max( ...grid ) - Math.min( ...grid ) ) / 2, 4 ),
	}

}

/** Name a period by the biology it corresponds to. */
function classifyPeriod( hours ) {

	if ( hours >= 20 && hours <= 28 ) return 'circadian'
	if ( hours >= 10 && hours < 20 ) return 'ultradian'
	if ( hours < 10 ) return 'ultradian-fast'
	if ( hours > 28 && hours <= 60 ) return 'infradian'
	return 'long'

}

/**
 * Assess circadian health specifically.
 *
 * A weak or off-period circadian rhythm is an early, pre-visual stress marker.
 *
 * @param   {object[]} series - `{t, value}` records.
 * @returns {object}          Assessment.
 */
export function circadianHealth( series ) {

	const rhythm = findRhythm( series, {
		minPeriodH : 8,
		maxPeriodH : 40,
	} )

	if ( !rhythm.detected ) {

		return {
			...rhythm,
			healthy : null,
			verdict : rhythm.reason,
		}

	}

	const offBy   = Math.abs( rhythm.periodHours - 24 )
	const onPeriod = offBy <= 3
	const strong   = rhythm.strength >= 0.4

	let verdict
	if ( onPeriod && strong ) verdict = `Healthy circadian rhythm: ${rhythm.periodHours}h period, strength ${rhythm.strength}.`
	else if ( onPeriod ) verdict = `Rhythm is on a 24h period but weak (${rhythm.strength}) — possible low light or early stress.`
	else if ( strong ) verdict = `Strong rhythm but off-period (${rhythm.periodHours}h vs 24h) — the light cycle may be inconsistent.`
	else verdict = `Weak, off-period rhythm (${rhythm.periodHours}h, strength ${rhythm.strength}) — this often precedes visible stress.`

	return {
		...rhythm,
		healthy   : onPeriod && strong,
		offByHours: round( offBy, 2 ),
		verdict,
	}

}

/**
 * Resample irregular samples onto a uniform grid by linear interpolation.
 *
 * @param   {number[]} times  - Epoch milliseconds, ascending.
 * @param   {number[]} values - Values.
 * @param   {number}   stepH  - Grid step in hours.
 * @returns {number[]}        Uniform samples.
 */
export function resampleToGrid( times, values, stepH ) {

	const stepMs = stepH * 3600_000
	const start  = times[ 0 ]
	const end    = times.at( -1 )
	const out    = []

	let j = 0
	for ( let t = start; t <= end; t += stepMs ) {

		while ( j < times.length - 2 && times[ j + 1 ] < t ) j++

		const t0 = times[ j ], t1 = times[ j + 1 ] ?? times[ j ]
		const v0 = values[ j ], v1 = values[ j + 1 ] ?? values[ j ]
		const frac = t1 === t0 ? 0 : ( t - t0 ) / ( t1 - t0 )
		out.push( v0 + ( v1 - v0 ) * Math.min( 1, Math.max( 0, frac ) ) )

	}

	return out

}

function round( v, d = 4 ) {

	if ( !Number.isFinite( v ) ) return 0
	return Number( v.toFixed( d ) )

}
