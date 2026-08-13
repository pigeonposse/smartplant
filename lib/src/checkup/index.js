/**
 * The plant's own periodic review of how it has been changing.
 *
 * Everything else in the library lives in the present or in a short window. A
 * reading is now; a shift is against the last few windows; even drift is only
 * consulted when somebody asks. Nothing ever sits down and compares this week
 * with last week on purpose.
 *
 * That gap matters because the changes worth catching are the ones no single
 * reading is remarkable enough to trigger. A response that gets slower by two
 * percent a week is invisible daily and obvious across a season. A comfort range
 * that has quietly drifted upward. A model that has been mildly optimistic for a
 * month. Each is unremarkable on the day it happens and each is a finding when
 * you look back deliberately.
 *
 * ## The comparison has to be fair
 *
 * The naive version — this week's averages against last month's — is mostly a
 * measurement of the calendar. Days lengthen, heating comes on, the sun moves
 * off the windowsill. A checkup that reports "soil moisture is down 8%" without
 * noticing that the room is four degrees warmer has found the weather and
 * labelled it the plant.
 *
 * So every comparison here carries what the *conditions* did over the same
 * span, and a finding whose likely driver moved with it is marked as confounded
 * rather than reported as a change in the plant. The system is looking for
 * things it cannot explain by the room, because those are the ones worth acting
 * on.
 */

import { hysteresis, responseHistory } from '../signals/hysteresis.js'
import { regimeChange } from '../signals/regime.js'

export const PERIODS = {
	weekly  : {
		days : 7,
		label : 'week',
	},
	monthly : {
		days : 30,
		label : 'month',
	},
}

/** Mean of a metric over a set of rows. */
function meanOf( rows, metric ) {

	const vals = rows.map( r => r[ metric ] ).filter( Number.isFinite )
	if ( !vals.length ) return null
	return Number( ( vals.reduce( ( a, b ) => a + b, 0 ) / vals.length ).toFixed( 2 ) )

}

/**
 * Compare two spans of readings, metric by metric.
 *
 * @param   {object[]} recent - The span just ended.
 * @param   {object[]} prior  - The equivalent span before it.
 * @returns {object}          Metric → `{recent, prior, change}`.
 */
export function compareSpans( recent, prior ) {

	const out = {}

	for ( const metric of [ 'temperature', 'humidity', 'soil', 'light' ] ) {

		const a = meanOf( prior, metric )
		const b = meanOf( recent, metric )
		if ( a === null || b === null ) continue

		out[ metric ] = {
			prior  : a,
			recent : b,
			change : Number( ( b - a ).toFixed( 2 ) ),
			percent: a !== 0 ? Number( ( ( ( b - a ) / Math.abs( a ) ) * 100 ).toFixed( 1 ) ) : null,
		}

	}

	return out

}

/**
 * Which conditions moved enough to explain a change in the plant.
 *
 * @param   {object} comparison - From `compareSpans`.
 * @param   {object} [opts]     - `{ thresholds }`.
 * @returns {string[]}          Metrics that moved materially.
 */
export function movedConditions( comparison, opts = {} ) {

	const thresholds = {
		temperature : 2,
		humidity : 8,
		light : 250,
		soil : 10,
		...opts.thresholds,
	}

	return Object.entries( comparison )
		.filter( ( [ metric, c ] ) => Math.abs( c.change ) >= ( thresholds[ metric ] ?? Infinity ) )
		.map( ( [ metric ] ) => metric )

}

/**
 * Run a periodic self-review.
 *
 * @param   {object} plant          - A `SmartPlant`.
 * @param   {object} [opts]         - Options.
 * @param   {string} [opts.period]  - `'weekly'` | `'monthly'`. Default weekly.
 * @returns {Promise<object>}       The evolution report.
 */
export async function checkup( plant, opts = {} ) {

	const periodId = opts.period || 'weekly'
	const period = PERIODS[ periodId ]

	if ( !period ) throw new Error( `Unknown checkup period "${periodId}". Use ${Object.keys( PERIODS ).join( ' or ' )}.` )

	const hours = period.days * 24
	const recent = plant.memory.since( hours )
	const all = plant.memory.data.readings
	const cutoff = Date.now() - hours * 3600_000
	const priorStart = Date.now() - hours * 2 * 3600_000

	const prior = all.filter( r => {

		const t = new Date( r.t ).getTime()
		return t >= priorStart && t < cutoff

	} )

	// Two spans or nothing. Comparing a full week against three days would report
	// the difference in sampling as a difference in the plant.
	if ( recent.length < 10 || prior.length < 10 ) {

		return {
			period : periodId,
			known  : false,
			at     : new Date().toISOString(),
			recent : recent.length,
			prior  : prior.length,
			why : `A ${period.label}ly review compares the last ${period.days} days against the ${period.days} before them. There are ${recent.length} and ${prior.length} readings in those spans; both need at least 10.`,
		}

	}

	const conditions = compareSpans( recent, prior )
	const moved = movedConditions( conditions, opts )
	const findings = []

	// ── wellbeing ────────────────────────────────────────────────────────────

	const wellRecent = recent.reduce( ( a, r ) => a + plant.happiness( r ), 0 ) / recent.length
	const wellPrior  = prior.reduce( ( a, r ) => a + plant.happiness( r ), 0 ) / prior.length
	const wellChange = wellRecent - wellPrior

	if ( Math.abs( wellChange ) >= 5 ) {

		findings.push( {
			id      : 'wellbeing',
			change  : Number( wellChange.toFixed( 1 ) ),
			// A wellbeing change with the conditions that drive it is the room, not
			// the plant, and saying otherwise would take credit for the weather.
			confounded : moved.length > 0,
			why : `Wellbeing ${wellChange > 0 ? 'rose' : 'fell'} ${Math.abs( wellChange ).toFixed( 1 )} points over the ${period.label}${moved.length ? `, but ${moved.join( ' and ' )} moved too, which is enough to explain it` : ', with the conditions steady'}.`,
		} )

	}

	// ── electrical identity ──────────────────────────────────────────────────

	const drift = plant.continuity?.attribute?.()

	if ( drift?.cause === 'physiology' ) {

		findings.push( {
			id      : 'electrome_drift',
			confounded : false,
			why : `The electrical signature has moved and every electrode agrees, so this is the plant rather than the contacts. ${drift.why}`,
		} )

	}
	else if ( drift?.cause === 'electrode' ) {

		findings.push( {
			id      : 'electrode_suspect',
			confounded : false,
			instrument : true,
			why : drift.why,
		} )

	}

	// ── regime ───────────────────────────────────────────────────────────────

	const fingerprints = plant.continuity
		? [ ...( plant.continuity.sites.get( 'primary' )?.history || [] ) ].map( h => ( {
			at : new Date( h.at ).toISOString(),
			fingerprint : h.fingerprint,
		} ) )
		: []

	if ( fingerprints.length >= 10 ) {

		const regime = regimeChange( fingerprints, opts.regime )
		if ( regime.changed ) {

			findings.push( {
				id : 'regime_change',
				at : regime.at,
				confounded : moved.length > 0,
				why : regime.why,
			} )

		}

	}

	// ── how the plant answers ────────────────────────────────────────────────

	const events = plant.memory.data.events || []
	const waterings = responseHistory( all, events, 'water' )

	if ( waterings.length >= 6 ) {

		const h = hysteresis( waterings, new Date( cutoff ).toISOString(), opts.hysteresis )

		if ( h.known && h.changed ) {

			findings.push( {
				id : 'response_changed',
				direction : h.direction,
				// Hysteresis already matched on starting conditions, so this one is
				// not confounded by the room in the way the averages are.
				confounded : false,
				why : h.verdict,
			} )

		}

	}

	// ── the model's own grip ─────────────────────────────────────────────────

	const calibration = plant.body?.personalization?.predictions?.report?.()

	if ( calibration?.known && calibration.faults?.length ) {

		findings.push( {
			id : 'model_miscalibrated',
			confounded : false,
			instrument : true,
			why : `The model is systematically wrong about ${calibration.faults.length} action(s). ${calibration.faults[ 0 ].verdict}`,
		} )

	}

	const real = findings.filter( f => !f.confounded && !f.instrument )
	const confounded = findings.filter( f => f.confounded )
	const instrument = findings.filter( f => f.instrument )

	return {
		period    : periodId,
		known     : true,
		at        : new Date().toISOString(),
		spans     : {
			recent : recent.length,
			prior : prior.length,
			days : period.days,
		},
		conditions,
		movedConditions : moved,
		wellbeing : {
			recent : Number( wellRecent.toFixed( 1 ) ),
			prior : Number( wellPrior.toFixed( 1 ) ),
			change : Number( wellChange.toFixed( 1 ) ),
		},
		findings,
		verdict   : summarise( period, findings, real, confounded, instrument, moved ),
	}

}

function summarise( period, findings, real, confounded, instrument, moved ) {

	if ( !findings.length ) {

		return `Nothing has changed materially over the ${period.label}${moved.length ? `, though ${moved.join( ' and ' )} did move` : ''}. Steady.`

	}

	const parts = []

	if ( real.length ) parts.push( `${real.length} change(s) the conditions do not account for: ${real.map( f => f.id ).join( ', ' )}` )
	if ( confounded.length ) parts.push( `${confounded.length} change(s) that ${moved.join( ' and ' )} already explains` )
	if ( instrument.length ) parts.push( `${instrument.length} problem(s) with the instrument rather than the plant` )

	return `Over the ${period.label}: ${parts.join( '; ' )}.`

}

/**
 * Turn a review into something the plant can say in the first person.
 *
 * Deterministic — no model involved, so it works offline and cannot embellish.
 *
 * @param   {object} report - From `checkup`.
 * @returns {string}        One or two sentences.
 */
export function narrate( report ) {

	if ( !report?.known ) return report?.why || 'Not enough history for a review yet.'

	const period = PERIODS[ report.period ].label
	const real = report.findings.filter( f => !f.confounded && !f.instrument )

	if ( !real.length ) {

		return `Looking back over the ${period}, I am much as I was.`

	}

	const lines = {
		wellbeing        : report.wellbeing.change > 0
			? `I have been doing better this ${period} than last.`
			: `I have been doing worse this ${period} than last.`,
		electrome_drift  : `My electrical signature has shifted since I settled, and both my electrodes agree it is me and not them.`,
		regime_change    : `Something changed in how I behave, and I can point at when.`,
		response_changed : `I answer watering differently than I used to.`,
	}

	return real.map( f => lines[ f.id ] || f.why ).join( ' ' )

}
