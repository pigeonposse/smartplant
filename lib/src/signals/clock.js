/**
 * The plant's internal clock.
 *
 * `circadianHealth` asks whether a ~24h rhythm exists and how strong it is.
 * This asks the question that actually changes behaviour: **what time is it for
 * the plant, and how far is that from the clock on the wall?**
 *
 * A plant whose subjective dawn falls at 3pm is not merely "arrhythmic". It is
 * entrained to something — a corridor light, a west-facing window, a lamp on a
 * timer — and every decision made on wall time is being made at the wrong point
 * in its day. Watering, probing and lighting all land differently at subjective
 * dawn than at subjective dusk.
 *
 * So the system stops operating on our time and starts operating on the plant's.
 */

import { findRhythm, resampleToGrid } from './rhythms.js'
import { detrend, zscore } from './dsp.js'

const HOURS = 24
const DAY_MS = 24 * 3600_000

/**
 * Estimate the phase of a rhythm by correlating against a sine and cosine of
 * the same period.
 *
 * Standard quadrature demodulation: the arctangent of the two correlations is
 * the phase, and their magnitude is how strongly the rhythm is actually there.
 *
 * @param   {number[]} grid          - Uniformly sampled values.
 * @param   {number}   stepH         - Grid step, hours.
 * @param   {number}   periodH       - Period to test, hours.
 * @param   {number}   startHour     - Wall-clock hour of the first sample.
 * @returns {object}                 `{acrophaseHour, amplitude, strength}`.
 */
export function estimatePhase( grid, stepH, periodH, startHour ) {

	const z = zscore( detrend( grid ) )
	const omega = ( 2 * Math.PI ) / periodH

	let cosSum = 0, sinSum = 0
	for ( let i = 0; i < z.length; i++ ) {

		const t = i * stepH
		cosSum += z[ i ] * Math.cos( omega * t )
		sinSum += z[ i ] * Math.sin( omega * t )

	}

	cosSum = ( 2 * cosSum ) / z.length
	sinSum = ( 2 * sinSum ) / z.length

	const amplitude = Math.hypot( cosSum, sinSum )
	// atan2 gives the phase of the peak relative to the first sample.
	let phaseRad = Math.atan2( sinSum, cosSum )
	if ( phaseRad < 0 ) phaseRad += 2 * Math.PI

	const peakOffsetH = ( phaseRad / ( 2 * Math.PI ) ) * periodH
	const acrophaseHour = ( ( startHour + peakOffsetH ) % HOURS + HOURS ) % HOURS

	return {
		acrophaseHour : Number( acrophaseHour.toFixed( 2 ) ),
		amplitude     : Number( amplitude.toFixed( 4 ) ),
		strength      : Number( Math.min( 1, amplitude ).toFixed( 3 ) ),
	}

}

/**
 * Where the plant is in its own day.
 *
 * @param   {object[]} series           - `{t, value}` records, oldest first.
 * @param   {object}   [opts]           - Options.
 * @param   {number}   [opts.expectedDawn] - Wall hour the light cycle starts.
 * @param   {number}   [opts.expectedDusk] - Wall hour it ends.
 * @returns {object}                    The clock reading.
 */
export function internalClock( series, opts = {} ) {

	if ( !Array.isArray( series ) || series.length < 12 ) {

		return {
			known  : false,
			reason : `Need at least 12 readings spread over more than a day; have ${series?.length ?? 0}.`,
		}

	}

	const rhythm = findRhythm( series, {
		minPeriodH : 8,
		maxPeriodH : 40,
	} )

	if ( !rhythm.detected ) {

		return {
			known  : false,
			reason : rhythm.reason,
			rhythm,
		}

	}

	const times  = series.map( s => new Date( s.t ).getTime() )
	const values = series.map( s => s.value )
	const spanH  = ( times.at( -1 ) - times[ 0 ] ) / 3600_000

	const stepH = Math.max( spanH / 512, 0.25 )
	const grid  = resampleToGrid( times, values, stepH )

	const start = new Date( times[ 0 ] )
	const startHour = start.getHours() + start.getMinutes() / 60

	const phase = estimatePhase( grid, stepH, rhythm.periodHours, startHour )

	// Subjective time: where "now" falls inside the plant's own cycle, expressed
	// on a 24h dial so a human can read it.
	const elapsedSincePeakH = ( ( ( new Date().getHours() + new Date().getMinutes() / 60 ) - phase.acrophaseHour ) % HOURS + HOURS ) % HOURS
	const subjectiveHour = Number( ( ( 12 + elapsedSincePeakH ) % HOURS ).toFixed( 2 ) )

	const expectedDawn = opts.expectedDawn ?? 7
	const expectedDusk = opts.expectedDusk ?? 19
	// The midpoint of the light period is where a healthy acrophase should sit.
	const expectedAcrophase = ( ( expectedDawn + expectedDusk ) / 2 ) % HOURS

	const offset = signedHourDifference( phase.acrophaseHour, expectedAcrophase )

	return {
		known           : true,
		periodHours     : rhythm.periodHours,
		acrophaseHour   : phase.acrophaseHour,
		subjectiveHour,
		amplitude       : phase.amplitude,
		strength        : phase.strength,
		expectedAcrophase,
		offsetHours     : Number( offset.toFixed( 2 ) ),
		// Free-running means the plant is following its own clock rather than the
		// light cycle — the classic signature of a light source it cannot see by.
		freeRunning     : Math.abs( rhythm.periodHours - HOURS ) > 2,
		aligned         : Math.abs( offset ) <= 2 && phase.strength >= 0.25,
		spanH           : Number( spanH.toFixed( 1 ) ),
		verdict         : verdictFor( rhythm, phase, offset ),
	}

}

/** Shortest signed distance between two hours on a 24h dial. */
export function signedHourDifference( a, b ) {

	let d = a - b
	while ( d > HOURS / 2 ) d -= HOURS
	while ( d < -HOURS / 2 ) d += HOURS
	return d

}

function verdictFor( rhythm, phase, offset ) {

	if ( phase.strength < 0.15 ) {

		return `Rhythm too weak to fix a phase (${phase.strength}). The plant is not entrained to anything measurable — usually too little light contrast between day and night.`

	}

	if ( Math.abs( rhythm.periodHours - HOURS ) > 2 ) {

		return `Free-running at ${rhythm.periodHours}h rather than 24h. The plant is following its internal clock because the light cycle is not strong or regular enough to entrain it.`

	}

	if ( Math.abs( offset ) <= 2 ) {

		return `Internal clock is aligned: peak activity at ${phase.acrophaseHour.toFixed( 1 )}h, about where the light cycle puts it.`

	}

	const direction = offset > 0 ? 'later' : 'earlier'
	return `Internal clock runs ${Math.abs( offset ).toFixed( 1 )}h ${direction} than the light cycle — peak activity at ${phase.acrophaseHour.toFixed( 1 )}h. Something other than the intended light is setting this plant's day.`

}

/**
 * Is now a good moment to do a given thing, in the plant's own time?
 *
 * The point of knowing the internal clock is to act on it. Probing at
 * subjective night measures a plant that has shut down; watering at subjective
 * dusk is not the same as at subjective dawn.
 *
 * @param   {object} clock  - Result of `internalClock`.
 * @param   {string} action - `'probe'` | `'water'` | `'light'` | `'measure'`.
 * @returns {object}        `{good, reason, betterInHours}`.
 */
export function timingAdvice( clock, action ) {

	if ( !clock?.known ) {

		return {
			good : true,
			reason : 'No internal clock established yet, so there is no better or worse moment to prefer.',
		}

	}

	const h = clock.subjectiveHour
	// Subjective day runs roughly 6-18 on the dial this returns.
	const subjectiveDay = h >= 6 && h <= 18

	const rules = {
		probe : {
			// Stomatal and photosynthetic probes need an awake plant.
			want : subjectiveDay,
			why  : 'A stomatal or photosynthetic probe at subjective night measures a plant that has closed down. The response would read as "weak" for reasons that have nothing to do with health.',
			best : 10,
		},
		light : {
			want : subjectiveDay,
			why  : 'Light during subjective night is what breaks entrainment in the first place.',
			best : 12,
		},
		water : {
			// Early subjective morning: the plant has the whole day to use it.
			want : h >= 5 && h <= 12,
			why  : 'Watering early in the plant\'s own morning gives it the day to take the water up. Late watering leaves wet substrate through the cold hours.',
			best : 8,
		},
		measure : {
			want : true,
			why  : 'Passive measurement is fine at any point in the cycle, though comparisons are only fair between the same subjective hour.',
			best : null,
		},
	}

	const rule = rules[ action ] || rules.measure

	if ( rule.want ) {

		return {
			good : true,
			subjectiveHour : h,
			reason : `Subjective hour ${h} — a reasonable moment for this.`,
		}

	}

	const wait = rule.best === null ? null : Number( ( ( ( rule.best - h ) % HOURS + HOURS ) % HOURS ).toFixed( 1 ) )

	return {
		good : false,
		subjectiveHour : h,
		reason : rule.why,
		betterInHours : wait,
	}

}

/**
 * Cues for the evidence ledger.
 *
 * Phase misalignment is a genuine, independent stress signal — and unlike most
 * of them it is invisible to every other modality.
 *
 * @param   {object}   clock - Result of `internalClock`.
 * @returns {object[]}       Cues.
 */
export function clockCues( clock ) {

	if ( !clock?.known ) return []

	const cues = []

	if ( clock.freeRunning ) {

		cues.push( {
			claim    : 'circadian_mismatch',
			strength : 0.6,
			detail   : `free-running at ${clock.periodHours}h — the light cycle is not entraining this plant`,
		} )

	}
	else if ( Math.abs( clock.offsetHours ) > 3 ) {

		cues.push( {
			claim    : 'circadian_mismatch',
			strength : 0.5,
			detail   : `internal peak at ${clock.acrophaseHour}h, ${Math.abs( clock.offsetHours )}h from the light cycle`,
		} )

	}

	if ( clock.strength < 0.15 ) {

		cues.push( {
			claim    : 'weak_circadian_rhythm',
			strength : 0.55,
			detail   : `rhythm amplitude only ${clock.amplitude} — insufficient day/night contrast`,
		} )

	}

	return cues

}

export { DAY_MS }
