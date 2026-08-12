/**
 * Multi-site coherence.
 *
 * The electrode is the weakest link in the whole evidence chain. A dry contact,
 * a callus forming, a wire brushing a leaf — any of these produce a confident,
 * well-shaped waveform that means nothing. Everything downstream then reasons
 * beautifully about an artefact.
 *
 * Two electrodes fix this in a way one never can, because plant electrical
 * signals **propagate**, and they do so at speeds physiology constrains:
 *
 *   Action potentials     ~1-40 mm/s   (fast, through the phloem)
 *   Variation potentials  ~0.5-5 mm/s  (slower, hydraulically coupled)
 *
 * So a real event appears at both sites, in the right order, separated by a
 * delay consistent with the distance between them. An artefact at one electrode
 * appears at one electrode. A shared electrical interference appears at both
 * sites *simultaneously* — zero delay, which is itself diagnostic.
 *
 * That is a corroboration test grounded in physics rather than in statistics,
 * and it is very hard to fake.
 */

import { detrend, zscore } from './dsp.js'
import { detectSpikes } from './spikes.js'

/** Propagation speeds in mm/s, from the plant electrophysiology literature. */
export const PROPAGATION = {
	action_potential    : {
		min : 1,
		max : 40,
		typical : 10,
	},
	variation_potential : {
		min : 0.5,
		max : 5,
		typical : 2,
	},
	system_potential    : {
		min : 0.1,
		max : 2,
		typical : 0.5,
	},
}

/**
 * Cross-correlation between two traces, returning the lag of best alignment.
 *
 * @param   {number[]} a            - First trace.
 * @param   {number[]} b            - Second trace.
 * @param   {number}   sampleRate   - Samples per second (shared).
 * @param   {number}   [maxLagS]    - Largest lag to consider, seconds.
 * @returns {object}                `{lagSeconds, correlation, curve}`.
 */
export function crossCorrelate( a, b, sampleRate, maxLagS = 600 ) {

	const n = Math.min( a.length, b.length )
	if ( n < 8 ) return {
		lagSeconds : null,
		correlation : 0,
		reason : 'traces too short',
	}

	const za = zscore( detrend( a.slice( 0, n ) ) )
	const zb = zscore( detrend( b.slice( 0, n ) ) )

	// Cap the lag search so every candidate still has real overlap. Without this,
	// an extreme lag leaves a handful of overlapping samples, and a mean over a
	// handful of products is trivially large — two traces of pure noise then
	// "correlate" at 0.9 and get reported as a corroborated event.
	const minOverlap = Math.max( 32, Math.floor( n / 2 ) )
	const maxLag = Math.min( Math.round( maxLagS * sampleRate ), n - minOverlap )

	if ( maxLag < 1 ) return {
		lagSeconds : null,
		correlation : 0,
		reason : `Traces too short to search for a lag: ${n} samples leaves no room for ${minOverlap} overlapping.`,
	}

	let bestLag = 0, bestCorr = -Infinity
	const curve = []

	for ( let lag = -maxLag; lag <= maxLag; lag++ ) {

		let sum = 0, count = 0

		for ( let i = 0; i < n; i++ ) {

			const j = i + lag
			if ( j < 0 || j >= n ) continue
			sum += za[ i ] * zb[ j ]
			count++

		}

		if ( count < minOverlap ) continue

		const corr = sum / count
		curve.push( {
			lagSeconds : Number( ( lag / sampleRate ).toFixed( 3 ) ),
			corr : Number( corr.toFixed( 4 ) ),
		} )

		if ( corr > bestCorr ) {

			bestCorr = corr
			bestLag = lag

		}

	}

	// A periodic signal correlates just as well at lag+period as at lag, so the
	// answer is ambiguous whenever a rival peak comes close. Saying so is far
	// better than returning one of several equally good lags as if it were the
	// measurement — for periodic data, match discrete events instead.
	const bestLagS = bestLag / sampleRate

	// A rival is a *separate* peak, not the shoulder of the one we found. So walk
	// outwards from the best lag until the correlation has genuinely fallen away,
	// and only look for competition beyond that.
	const bestIdx = curve.findIndex( c => c.lagSeconds === Number( bestLagS.toFixed( 3 ) ) )
	const floor = bestCorr * 0.5
	let lo = bestIdx, hi = bestIdx
	while ( lo > 0 && curve[ lo - 1 ].corr > floor ) lo--
	while ( hi < curve.length - 1 && curve[ hi + 1 ].corr > floor ) hi++

	const rivals = curve.filter( ( c, i ) =>
		( i < lo || i > hi ) && c.corr > bestCorr * 0.9 )

	return {
		// Positive lag means the event reached site B after site A.
		lagSeconds  : Number( bestLagS.toFixed( 3 ) ),
		correlation : Number( bestCorr.toFixed( 4 ) ),
		ambiguous   : rivals.length > 0,
		rivalLags   : rivals.slice( 0, 3 ).map( r => r.lagSeconds ),
		curve,
	}

}

/**
 * Is a measured delay consistent with a signal travelling that distance?
 *
 * @param   {number} lagSeconds - Measured delay.
 * @param   {number} distanceMm - Separation between electrodes, mm.
 * @param   {string} [kind]     - Event type to test against.
 * @returns {object}            `{plausible, speedMmS, kind, why}`.
 */
/** "an action potential", not "a action potential". */
function article( kind ) {

	return /^[aeiou]/i.test( kind ) ? 'an' : 'a'

}

export function propagationPlausible( lagSeconds, distanceMm, kind ) {

	if ( !Number.isFinite( lagSeconds ) || !Number.isFinite( distanceMm ) || distanceMm <= 0 ) {

		return {
			plausible : false,
			why : 'Need both a measured delay and the distance between electrodes.',
		}

	}

	const absLag = Math.abs( lagSeconds )

	// A simultaneous event has not propagated. Nothing biological arrives at two
	// separated points at once — but mains pickup and ground loops do exactly that.
	if ( absLag < 0.05 ) {

		return {
			plausible : false,
			speedMmS  : Infinity,
			kind      : 'simultaneous',
			why       : `Both sites moved at the same instant across ${distanceMm}mm. Nothing physiological propagates that fast — this is shared electrical interference, not the plant.`,
		}

	}

	const speed = distanceMm / absLag

	// The published speed ranges overlap: 2mm/s is consistent with an action
	// potential, a variation potential *and* a system potential. Naming one would
	// be false precision, so every match is reported and `kind` is only set when
	// the speed is actually diagnostic.
	const candidates = Object.entries( PROPAGATION )
		.filter( ( [ id ] ) => !kind || id === kind )
		.filter( ( [ , range ] ) => speed >= range.min && speed <= range.max )

	if ( !candidates.length ) {

		const tooSlow = speed < PROPAGATION.system_potential.min

		return {
			plausible : false,
			speedMmS  : Number( speed.toFixed( 3 ) ),
			kind      : null,
			why       : tooSlow
				? `Implied speed ${speed.toFixed( 2 )}mm/s is slower than any known plant signal. The two events are probably unrelated.`
				: `Implied speed ${speed.toFixed( 1 )}mm/s exceeds the fastest plant action potential (~40mm/s). Likely electrical crosstalk rather than propagation.`,
		}

	}

	const kinds = candidates.map( ( [ id ] ) => id )
	const [ firstKind, range ] = candidates[ 0 ]
	const unambiguous = kinds.length === 1

	return {
		plausible : true,
		speedMmS  : Number( speed.toFixed( 3 ) ),
		// Only claim a specific kind when the speed can only be that kind.
		kind      : unambiguous ? firstKind : null,
		kinds,
		range,
		why       : unambiguous
			? `Implied speed ${speed.toFixed( 2 )}mm/s is consistent with ${article( firstKind )} ${firstKind.replace( /_/g, ' ' )} (${range.min}-${range.max}mm/s).`
			: `Implied speed ${speed.toFixed( 2 )}mm/s is physiologically plausible, but the published ranges overlap here — it could be ${kinds.map( k => k.replace( /_/g, ' ' ) ).join( ' or ' )}. The waveform shape decides which.`,
	}

}

/**
 * Test whether two electrode sites saw the same physiological event.
 *
 * This is the corroboration primitive. A conclusion resting on a single
 * electrode is one bad contact away from fiction; a conclusion resting on two
 * sites with a physically coherent delay is hard to produce by accident.
 *
 * @param   {object} siteA              - `{samples, sampleRate, id}`.
 * @param   {object} siteB              - `{samples, sampleRate, id}`.
 * @param   {object} opts               - Options.
 * @param   {number} opts.distanceMm    - Separation between the electrodes.
 * @param   {number} [opts.minCorrelation] - Correlation floor. Default 0.4.
 * @returns {object}                    `{coherent, lagSeconds, propagation, verdict}`.
 */
export function siteCoherence( siteA, siteB, opts = {} ) {

	const distanceMm = opts.distanceMm
	const minCorrelation = opts.minCorrelation ?? 0.4

	if ( !Number.isFinite( distanceMm ) ) {

		return {
			coherent : false,
			verdict  : 'Cannot judge coherence without knowing how far apart the electrodes are. Measure it once and pass { distanceMm }.',
		}

	}

	const rate = Math.min( siteA.sampleRate, siteB.sampleRate )
	const xc = crossCorrelate( siteA.samples, siteB.samples, rate, opts.maxLagS )

	if ( xc.lagSeconds === null ) {

		return {
			coherent : false,
			verdict  : xc.reason,
		}

	}

	const prop = propagationPlausible( xc.lagSeconds, distanceMm )
	const strong = Math.abs( xc.correlation ) >= minCorrelation

	// An ambiguous lag cannot corroborate anything: we do not know which of
	// several equally good delays is the real one.
	const coherent = strong && prop.plausible && !xc.ambiguous

	let verdict
	if ( coherent ) {

		verdict = `Both electrodes saw the same event, ${Math.abs( xc.lagSeconds ).toFixed( 2 )}s apart across ${distanceMm}mm. ${prop.why} This is the plant, corroborated at two sites.`

	}
	else if ( !strong ) {

		verdict = `The two sites are not tracking each other (correlation ${xc.correlation}). Whatever one electrode is reporting, the other does not see it — treat single-site conclusions with suspicion.`

	}
	else if ( xc.ambiguous ) {

		verdict = `The two sites track each other, but the delay is ambiguous — ${[ xc.lagSeconds, ...xc.rivalLags ].join( 's, ' )}s all fit equally well. That happens with a periodic signal; match discrete events instead of correlating the whole trace.`

	}
	else {

		verdict = prop.why

	}

	return {
		coherent,
		correlation : xc.correlation,
		lagSeconds  : xc.lagSeconds,
		distanceMm,
		propagation : prop,
		leadingSite : xc.lagSeconds > 0 ? ( siteA.id ?? 'A' ) : ( siteB.id ?? 'B' ),
		verdict,
	}

}

/**
 * Match discrete events between two sites and check each pair's timing.
 *
 * Cross-correlation answers "do these traces move together". This answers the
 * sharper question: "did *this specific spike* propagate?" — which is what you
 * need before concluding that a wound signal is real.
 *
 * @param   {object} siteA           - `{samples, sampleRate, id}`.
 * @param   {object} siteB           - `{samples, sampleRate, id}`.
 * @param   {object} opts            - `{distanceMm, threshold, toleranceS}`.
 * @returns {object}                 `{pairs, orphansA, orphansB, corroborated}`.
 */
export function matchEvents( siteA, siteB, opts = {} ) {

	const distanceMm = opts.distanceMm
	const eventsA = detectSpikes( siteA.samples, siteA.sampleRate, { threshold : opts.threshold ?? 4 } )
	const eventsB = detectSpikes( siteB.samples, siteB.sampleRate, { threshold : opts.threshold ?? 4 } )

	// The widest delay worth considering: the slowest signal crossing the gap.
	const maxDelayS = Number.isFinite( distanceMm )
		? distanceMm / PROPAGATION.system_potential.min
		: 600

	const pairs = []
	const usedB = new Set()

	for ( const a of eventsA ) {

		let best = null, bestDelta = Infinity

		for ( let i = 0; i < eventsB.length; i++ ) {

			if ( usedB.has( i ) ) continue
			const delta = eventsB[ i ].peakTimeS - a.peakTimeS
			if ( Math.abs( delta ) > maxDelayS ) continue
			if ( Math.abs( delta ) < Math.abs( bestDelta ) ) {

				bestDelta = delta
				best = i

			}

		}

		if ( best === null ) continue

		usedB.add( best )
		const prop = Number.isFinite( distanceMm )
			? propagationPlausible( bestDelta, distanceMm )
			: {
				plausible : null,
				why : 'no distance given',
			}

		pairs.push( {
			a          : a.type.label,
			b          : eventsB[ best ].type.label,
			delaySeconds : Number( bestDelta.toFixed( 3 ) ),
			sameType   : a.type.label === eventsB[ best ].type.label,
			propagation: prop,
			corroborated : prop.plausible === true && a.type.label === eventsB[ best ].type.label,
		} )

	}

	const corroborated = pairs.filter( p => p.corroborated )

	return {
		pairs,
		corroborated : corroborated.length,
		orphansA : eventsA.length - pairs.length,
		orphansB : eventsB.length - usedB.size,
		verdict  : summarizeMatches( pairs, corroborated, eventsA.length, eventsB.length ),
	}

}

function summarizeMatches( pairs, corroborated, nA, nB ) {

	if ( !nA && !nB ) return 'Neither electrode detected an event.'

	if ( !pairs.length ) {

		return `${nA} event(s) at one site and ${nB} at the other, none of them matching in time. Either they are unrelated, or one electrode is generating artefacts.`

	}

	if ( !corroborated.length ) {

		return `${pairs.length} event pair(s) found, but none with a physically coherent delay. Suspect interference or a failing contact rather than propagation.`

	}

	const kinds = [ ...new Set( corroborated.map( p => p.propagation.kind ) ) ].join( ', ' )
	return `${corroborated.length} event(s) corroborated across both electrodes with plausible propagation (${kinds}). This is real plant signalling.`

}

/**
 * Cues for the evidence ledger.
 *
 * A corroborated two-site event is the strongest electrophysiological evidence
 * this library can produce, and an *un*corroborated one is a warning about the
 * hardware rather than about the plant.
 *
 * @param   {object}   coherence - Result of `siteCoherence` or `matchEvents`.
 * @returns {object[]}           Cues.
 */
export function coherenceCues( coherence ) {

	if ( !coherence ) return []

	if ( coherence.propagation?.kind === 'simultaneous' ) {

		return [ {
			claim    : 'electrical_interference',
			strength : 0.8,
			detail   : coherence.verdict,
		} ]

	}

	if ( coherence.coherent || coherence.corroborated > 0 ) {

		return [ {
			claim    : 'verified_plant_signal',
			strength : 0.85,
			detail   : coherence.verdict,
		} ]

	}

	if ( coherence.correlation !== undefined && Math.abs( coherence.correlation ) < 0.2 ) {

		return [ {
			claim    : 'electrode_unreliable',
			strength : 0.5,
			detail   : coherence.verdict,
		} ]

	}

	return []

}
