/**
 * Feature extraction from a plant electrophysiology trace.
 *
 * Raw millivolts mean nothing to an LLM and little to a rule. These reduce a
 * window of samples to the handful of numbers that actually describe what the
 * plant is doing — which is what gets stored, reasoned over, and put in a prompt.
 */

import {
	detrend, dominantFrequency, spectrum, zscore,
} from './dsp.js'

/**
 * Time-domain statistics.
 *
 * @param   {number[]} x - Samples.
 * @returns {object}     Statistics.
 */
export function timeFeatures( x ) {

	const n = x.length
	if ( !n ) return {
		n : 0,
	}

	const sorted = [ ...x ].sort( ( a, b ) => a - b )
	const mean   = x.reduce( ( a, b ) => a + b, 0 ) / n
	const varSum = x.reduce( ( a, b ) => a + ( b - mean ) ** 2, 0 )
	const sd     = Math.sqrt( varSum / n )

	// Higher moments describe the *shape* of the distribution: plant action
	// potentials are sharp and one-sided, so they skew and spike the kurtosis
	// well before they move the mean.
	const skewness = sd === 0 ? 0 : x.reduce( ( a, b ) => a + ( ( b - mean ) / sd ) ** 3, 0 ) / n
	const kurtosis = sd === 0 ? 0 : x.reduce( ( a, b ) => a + ( ( b - mean ) / sd ) ** 4, 0 ) / n - 3

	let crossings = 0
	for ( let i = 1; i < n; i++ ) {

		if ( ( x[ i - 1 ] - mean ) * ( x[ i ] - mean ) < 0 ) crossings++

	}

	const diffs = []
	for ( let i = 1; i < n; i++ ) diffs.push( x[ i ] - x[ i - 1 ] )

	return {
		n,
		mean         : round( mean ),
		sd           : round( sd ),
		min          : round( sorted[ 0 ] ),
		max          : round( sorted[ n - 1 ] ),
		median       : round( sorted[ Math.floor( n / 2 ) ] ),
		range        : round( sorted[ n - 1 ] - sorted[ 0 ] ),
		rms          : round( Math.sqrt( x.reduce( ( a, b ) => a + b * b, 0 ) / n ) ),
		skewness     : round( skewness ),
		kurtosis     : round( kurtosis ),
		zeroCrossings: crossings,
		// Mean absolute slope: how fast the membrane potential is moving.
		meanSlope    : diffs.length ? round( diffs.reduce( ( a, b ) => a + Math.abs( b ), 0 ) / diffs.length ) : 0,
		maxSlope     : diffs.length ? round( Math.max( ...diffs.map( Math.abs ) ) ) : 0,
	}

}

/**
 * Frequency-domain features, including band powers over the ranges that matter
 * for plant electrophysiology.
 *
 * @param   {number[]} x          - Samples.
 * @param   {number}   sampleRate - Samples per second.
 * @returns {object}              Spectral features.
 */
export function spectralFeatures( x, sampleRate ) {

	const { freqs, magnitudes } = spectrum( x, sampleRate )
	if ( !freqs.length ) return { available : false }

	const power = magnitudes.map( m => m * m )
	const total = power.reduce( ( a, b ) => a + b, 0 ) || 1

	// Spectral centroid: the "centre of mass" of the spectrum. Rises when a
	// plant shifts from slow drift to fast signalling.
	const centroid = freqs.reduce( ( acc, f, i ) => acc + f * power[ i ], 0 ) / total

	// Spectral entropy: flat spectrum (noise) → 1, single tone → 0.
	const norm = power.map( p => p / total )
	const entropy = -norm.reduce( ( a, p ) => ( p > 0 ? a + p * Math.log2( p ) : a ), 0 ) / Math.log2( norm.length || 2 )

	const peak = dominantFrequency( x, sampleRate, { minHz : 0 } )

	return {
		available       : true,
		dominantHz      : peak ? round( peak.frequency, 6 ) : null,
		dominantPeriodS : peak ? round( peak.periodSeconds, 2 ) : null,
		centroidHz      : round( centroid, 6 ),
		entropy         : round( entropy ),
		bands           : bandPowers( freqs, power, total ),
	}

}

/**
 * Power in the bands that correspond to known plant electrical phenomena.
 *
 * The boundaries follow the literature's timescales: action potentials resolve
 * in seconds, variation potentials over tens of seconds to minutes, and system
 * potentials and circadian drift far slower.
 */
function bandPowers( freqs, power, total ) {

	const BANDS = {
		circadian : [ 0, 0.0001 ],      // > ~3 h period — drift, day/night
		slow      : [ 0.0001, 0.01 ],   // ~100 s - 3 h — variation/system potentials
		medium    : [ 0.01, 0.5 ],      // 2 - 100 s   — action potentials
		fast      : [ 0.5, 10 ],        // 0.1 - 2 s   — fast transients
		noise     : [ 10, Infinity ],   // above physiology — electrical noise
	}

	const out = {}
	for ( const [ name, [ lo, hi ] ] of Object.entries( BANDS ) ) {

		let sum = 0
		for ( let i = 0; i < freqs.length; i++ ) {

			if ( freqs[ i ] >= lo && freqs[ i ] < hi ) sum += power[ i ]

		}
		out[ name ] = round( sum / total )

	}
	return out

}

/**
 * Complexity of a trace, 0-1.
 *
 * A dying or dormant plant produces a simple, low-complexity signal; an actively
 * responding one produces a structured, higher-complexity one. Uses a normalized
 * Higuchi-style curve length, which is cheap and robust at these sample counts.
 *
 * @param   {number[]} x - Samples.
 * @returns {number}     0-1.
 */
export function complexity( x ) {

	if ( x.length < 4 ) return 0
	const z = zscore( detrend( x ) )

	let length = 0
	for ( let i = 1; i < z.length; i++ ) length += Math.abs( z[ i ] - z[ i - 1 ] )

	// A pure random walk of n z-scored samples has an expected curve length
	// around n; saturate there so the metric stays in 0-1.
	return round( Math.min( 1, length / z.length ) )

}

/**
 * Full feature vector for one window — the object that goes into memory, the
 * vector store and the prompt.
 *
 * @param   {number[]} samples    - Samples.
 * @param   {number}   sampleRate - Samples per second.
 * @returns {object}              Features.
 */
export function extractFeatures( samples, sampleRate ) {

	return {
		time       : timeFeatures( samples ),
		spectral   : spectralFeatures( samples, sampleRate ),
		complexity : complexity( samples ),
		durationS  : round( samples.length / sampleRate, 2 ),
		sampleRate,
	}

}

/**
 * Render features as a compact line for an AI prompt.
 *
 * @param   {object} features - Result of `extractFeatures`.
 * @returns {string}          One-line brief.
 */
export function describeFeatures( features ) {

	const t = features.time || {}
	const s = features.spectral || {}
	const parts = [
		`${features.durationS}s @ ${features.sampleRate}Hz`,
		`amplitude ${t.range ?? '?'}mV (rms ${t.rms ?? '?'})`,
		`activity ${features.complexity}`,
	]
	if ( s.available && s.dominantPeriodS ) parts.push( `dominant rhythm ~${formatPeriod( s.dominantPeriodS )}` )
	if ( s.available ) parts.push( `spectral entropy ${s.entropy}` )
	if ( t.kurtosis > 3 ) parts.push( 'spiky (possible action potentials)' )
	return parts.join( ', ' )

}

function formatPeriod( seconds ) {

	if ( seconds >= 3600 ) return `${round( seconds / 3600, 1 )}h`
	if ( seconds >= 60 ) return `${round( seconds / 60, 1 )}min`
	return `${round( seconds, 1 )}s`

}

function round( v, digits = 4 ) {

	if ( !Number.isFinite( v ) ) return 0
	return Number( v.toFixed( digits ) )

}
