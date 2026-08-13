/**
 * What a person sees when they open the plant in a browser.
 *
 * Everything this library works out about a plant has, until now, only been
 * reachable from code. The diagnosis, the internal states, the maintenance
 * inspection, the reasons a refusal happened — all of it exists and none of it
 * is visible to somebody who just wants to know how their plant is.
 *
 * This assembles that into one object. Rendering it is a separate concern; this
 * file decides *what is true and what is worth saying*, which is the part with
 * judgement in it.
 *
 * ## The gaps are the content
 *
 * A dashboard with four handsome gauges and no mention of the electrode that is
 * not connected is lying by omission, and it is exactly the opposite of how the
 * rest of this library behaves. Every layer here refuses rather than guesses,
 * names the sensor that would unlock an inference, and says when it does not
 * know — and a screen that hides all of that behind a green tick has undone the
 * work.
 *
 * So `unknown` is a first-class value in this payload, `missing` is a top-level
 * section rather than a footnote, and a metric with no sensor is shown as *not
 * measured* rather than omitted. A person should be able to tell, at a glance,
 * the difference between "this plant is fine" and "nothing here can see whether
 * this plant is fine", because those look identical on most dashboards and they
 * are not remotely the same situation.
 *
 * ## Nothing secret leaves
 *
 * API keys, tokens and endpoints live in the same config object as everything
 * else, and it would be very easy to serialise the lot. Only an allow-list is
 * ever copied out, and the AI section reports which provider is configured and
 * never how it authenticates.
 */

import { CONDITION, PLAUSIBLE } from '../maintenance/index.js'

/** How a value is doing against this plant's own comfortable range. */
export const BAND = {
	UNKNOWN : 'unknown',
	LOW     : 'low',
	OK      : 'ok',
	HIGH    : 'high',
}

const finite = Number.isFinite

/**
 * Where a reading sits in this plant's own range.
 *
 * Against *this plant's* range rather than a species table, because the ranges
 * this library keeps are learned from where the plant actually lives.
 *
 * @param   {number} value - The reading.
 * @param   {object} range - `{min, max}`.
 * @returns {object}       `{band, fraction}`.
 */
export function band( value, range ) {

	if ( !finite( value ) || !finite( range?.min ) || !finite( range?.max ) ) {

		return {
			band : BAND.UNKNOWN,
			fraction : null,
		}

	}

	const span = range.max - range.min

	return {
		band : value < range.min ? BAND.LOW : value > range.max ? BAND.HIGH : BAND.OK,
		// Clamped so a wildly out-of-range value does not draw a bar off the
		// screen, but the number itself is always shown unclamped alongside it.
		fraction : span > 0
			? Number( Math.min( 1.2, Math.max( -0.2, ( value - range.min ) / span ) ).toFixed( 3 ) )
			: null,
	}

}

/**
 * Every metric this plant could have, and what it actually has.
 *
 * The list is driven by what is plausible rather than by what was read, so a
 * metric with no sensor appears with `measured: false` instead of vanishing.
 * A missing row is invisible; a row saying "no sensor" is information.
 *
 * @param   {object} plant - A `SmartPlant`.
 * @returns {object[]}     Rows.
 */
export function vitals( plant ) {

	const reading = plant.memory?.lastReading ?? {}
	const ranges = plant.ranges ?? {}

	// Everything with a known plausible range, plus any *number* actually being
	// reported that is not in that list. A reading also carries provenance —
	// which driver produced it, when — and those are not vitals.
	const keys = new Set( [
		...Object.keys( PLAUSIBLE ),
		...Object.keys( reading ).filter( k => finite( reading[ k ] ) ),
	] )
	for ( const k of [ 't', 'timestamp', 'at' ] ) keys.delete( k )

	return [ ...keys ].sort().map( key => {

		const value = reading[ key ]
		const measured = finite( value )
		const range = ranges[ key ]

		return {
			metric : key,
			value : measured ? value : null,
			measured,
			range : range ? {
				min : range.min,
				max : range.max,
			} : null,
			...band( value, range ),
			why : measured
				? range
					? null
					: 'Measured, but this plant has no learned comfortable range for it yet — that takes a couple of weeks of history.'
				: 'No sensor reporting this. Not a reading of zero and not a plant that is fine: nothing is watching it.',
		}

	} )

}

/**
 * The whole picture, as one serialisable object.
 *
 * @param   {object} plant  - A `SmartPlant`.
 * @param   {object} [opts] - `{ deep }` to include the full system diagnosis.
 * @returns {Promise<object>} The payload.
 */
export async function snapshot( plant, opts = {} ) {

	const reading = plant.memory?.lastReading ?? {}
	const rows = vitals( plant )
	const states = safely( () => plant.states?.() ) ?? {}

	// Deliberately computed rather than counted from the reading: a plant can be
	// reporting six numbers and still be blind to the one that matters.
	const missing = rows.filter( r => !r.measured ).map( r => r.metric )

	const payload = {
		plant : {
			name : plant.memory?.plant?.name ?? 'plant',
			species : plant.memory?.plant?.species ?? null,
			archetype : plant.archetype?.id ?? null,
			since : plant.memory?.data?.readings?.[ 0 ]?.t ?? null,
			readings : plant.memory?.data?.readings?.length ?? 0,
		},

		at : new Date().toISOString(),
		lastReadingAt : reading.t ?? reading.timestamp ?? null,

		vitals : rows,

		// The five internal states, flattened to what a screen needs. `acts` is
		// carried through because a state that is not allowed to change anything
		// should not look like one that is.
		states : Object.fromEntries( Object.entries( states ).map( ( [ name, s ] ) => [ name, {
			level : s.level,
			confidence : s.confidence,
			acts : s.acts,
			why : s.why,
			evidence : ( s.evidence ?? [] ).map( e => e.detail ?? e ),
		} ] ) ),

		// What the plant would say for itself. One line, in its own voice.
		says : safely( () => plant.status?.() ) ?? null,

		layers : {
			vision : Boolean( plant.vision ),
			electrode : Boolean( plant.electrode || plant.perception?.electro ),
			spectral : Boolean( plant.spectral ),
			colony : Boolean( plant.colony?.enabled ),
			body : Boolean( plant.body ),
			power : Boolean( plant.power ),
			// Which provider, never how it authenticates.
			ai : plant.ai?.provider?.name ?? plant.config?.ai?.provider ?? null,
		},

		missing : {
			metrics : missing,
			why : missing.length
				? `${missing.length} metric${missing.length === 1 ? '' : 's'} have no sensor. They are listed rather than hidden because a screen showing only what is measured cannot be told apart from a plant with nothing wrong.`
				: 'Every metric this library knows how to use is being reported.',
		},

		colony : plant.colony?.enabled
			? {
				id : plant.colony.id,
				neighbours : [ ...( plant.colony.neighbours?.keys?.() ?? [] ) ],
				primed : plant.colony.primed ?? null,
			}
			: null,

		power : plant.power
			? {
				charge : plant.power.charge ?? null,
				mode : plant.power.mode ?? null,
			}
			: null,
	}

	// Maintenance is cheap and belongs on the front page: an instrument problem
	// looks exactly like a plant problem until somebody checks.
	payload.instrument = safely( () => plant.maintenance?.() ) ?? null

	if ( payload.instrument ) {

		payload.instrument = {
			condition : payload.instrument.condition ?? CONDITION.UNKNOWN,
			findings : ( payload.instrument.findings ?? [] ).map( f => ( {
				what : f.what ?? f.metric ?? null,
				condition : f.condition,
				why : f.why,
			} ) ),
		}

	}

	if ( opts.deep ) payload.diagnosis = await safelyAsync( () => plant.systemDiagnosis?.() )

	return payload

}

function safely( fn ) {

	try {

		return fn()

	}
	catch {

		// A panel that throws because one layer is misconfigured is worse than a
		// panel with one section missing — this is the screen someone opens
		// *because* something is wrong.
		return null

	}

}

async function safelyAsync( fn ) {

	try {

		return await fn()

	}
	catch ( err ) {

		return {
			error : true,
			why : `This section could not be produced: ${err.message}`,
		}

	}

}
