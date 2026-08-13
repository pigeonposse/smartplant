/**
 * Building the inheritance bundle.
 *
 * What leaves a mature plant is a set of *priors*: comfort ranges it actually
 * lived well in, policies that kept paying off across changing conditions, the
 * shape of its rhythm. What does not leave is the plant. No name, no wellbeing,
 * no raw readings, no timestamps of when a home was occupied, no open wounds,
 * no keys.
 *
 * The new plant is meant to be born with an inheritance, not with a borrowed
 * biography. Its own record starts empty.
 *
 * The bundle also carries the **conditions the priors were learned under**.
 * Without that, the receiving plant has no way to tell an inherited regularity
 * from an inherited pathology: a plant that learned "water at 15% soil" because
 * its pot drained badly is passing on a fix for a problem the new plant does not
 * have. Shipping the origin conditions is what makes that detectable on arrival
 * rather than three weeks later.
 */

import { transferability } from './transferability.js'

export const SCHEMA_VERSION = 1

/**
 * The parts an inheritance can be split into.
 *
 * All-or-nothing transfer forces a choice nobody should have to make: take a
 * plant's watering habits along with its light response because they arrived in
 * the same envelope. These are independent kinds of knowledge learned from
 * independent evidence, and they should travel independently.
 */
export const MODULES = {
	ranges   : 'Comfort ranges the source actually thrived in',
	policies : 'Learned action policies that survived changing conditions',
	cadence  : 'Watering rhythm',
	rhythm   : 'The shape of the electrome baseline',
}

export const ALL_MODULES = Object.keys( MODULES )

/** Percentile helper: one bad reading must not define anything. */
function percentile( sorted, p ) {

	if ( !sorted.length ) return null
	const i = Math.min( sorted.length - 1, Math.max( 0, Math.floor( sorted.length * p ) ) )
	return Number( sorted[ i ].toFixed( 2 ) )

}

/**
 * Summarise the environment a plant has actually been living in.
 *
 * This is the fingerprint of the *place*, and it is what the receiving plant
 * compares itself against.
 *
 * @param   {object[]} readings - Reading rows.
 * @returns {object|null}       Conditions, or null with too little data.
 */
export function summarizeConditions( readings = [] ) {

	if ( readings.length < 20 ) return null

	const conditions = {}

	for ( const metric of [ 'temperature', 'humidity', 'soil', 'light' ] ) {

		const values = readings.map( r => r[ metric ] ).filter( Number.isFinite )
		if ( values.length < 20 ) continue

		const sorted = [ ...values ].sort( ( a, b ) => a - b )
		conditions[ metric ] = {
			p10    : percentile( sorted, 0.1 ),
			median : percentile( sorted, 0.5 ),
			p90    : percentile( sorted, 0.9 ),
			n      : values.length,
		}

	}

	return Object.keys( conditions ).length ? conditions : null

}

/**
 * The smallest difference in each metric that means anything.
 *
 * Comparing raw intersection-over-union breaks down when a plant lives somewhere
 * very stable: two rooms both holding 22°C have zero-width bands, no measurable
 * union, and would score as having nothing in common — the exact opposite of the
 * truth. Bands are widened to at least this before comparison, so agreement
 * below the resolution that matters horticulturally reads as agreement.
 */
export const MIN_SPAN = {
	temperature : 2,
	humidity    : 6,
	soil        : 6,
	light       : 150,
}

/** Widen a band to the smallest span that carries meaning for that metric. */
function widen( metric, lo, hi ) {

	const floor = MIN_SPAN[ metric ] ?? 1
	const span = hi - lo
	if ( span >= floor ) return [ lo, hi ]

	const pad = ( floor - span ) / 2
	return [ lo - pad, hi + pad ]

}

/**
 * How much two environments actually overlap, per metric.
 *
 * Intersection over union of the p10-p90 bands. Two plants in the same room
 * score high; a windowsill and a shaded corner do not, and should not.
 *
 * @param   {object} origin      - Conditions the priors came from.
 * @param   {object} destination - Conditions where they are going.
 * @returns {object}             `{compatible, overlap, mismatches, verdict}`.
 */
export function compareConditions( origin = {}, destination = {} ) {

	const overlap = {}
	const mismatches = []

	for ( const metric of Object.keys( origin ) ) {

		const a = origin[ metric ], b = destination[ metric ]
		if ( !a || !b ) continue

		const [ aLo, aHi ] = widen( metric, a.p10, a.p90 )
		const [ bLo, bHi ] = widen( metric, b.p10, b.p90 )

		const lo = Math.max( aLo, bLo )
		const hi = Math.min( aHi, bHi )
		const union = Math.max( aHi, bHi ) - Math.min( aLo, bLo )

		// Two identical bands leave no union to divide by, and that case is total
		// agreement, not total ignorance.
		const iou = union > 0 ? Math.max( 0, hi - lo ) / union : 1
		overlap[ metric ] = Number( iou.toFixed( 3 ) )

		if ( iou < 0.3 ) {

			mismatches.push( {
				metric,
				origin      : `${a.p10}–${a.p90}`,
				destination : `${b.p10}–${b.p90}`,
				overlap     : overlap[ metric ],
			} )

		}

	}

	const scores = Object.values( overlap )
	const mean = scores.length
		? Number( ( scores.reduce( ( x, y ) => x + y, 0 ) / scores.length ).toFixed( 3 ) )
		: null

	return {
		// No shared metrics is not compatibility, it is ignorance. Say so.
		compatible : mean !== null && mean >= 0.4 && mismatches.length === 0,
		overlap,
		mean,
		mismatches,
		verdict : mean === null
			? 'No shared measurements between the two environments, so nothing can be checked. Treat every prior as unverified.'
			: mismatches.length
				? `The two spots differ where it matters: ${mismatches.map( m => `${m.metric} (${m.origin} vs ${m.destination})` ).join( ', ' )}. Priors that depend on these will be held back.`
				: `Environments overlap well (${mean}). Inherited priors are worth trying here.`,
	}

}

/** Group episodes into per-action policies. */
function policiesFrom( episodes = [] ) {

	const byAction = new Map()

	for ( const ep of episodes ) {

		if ( !ep?.action ) continue
		if ( !byAction.has( ep.action ) ) byAction.set( ep.action, [] )
		byAction.get( ep.action ).push( {
			// Only what a policy needs. The episode text and its embedding stay
			// behind: they encode the source plant's situations verbatim.
			at      : ep.at,
			reward  : Number( ep.reward ?? 0 ),
			context : ep.context || {},
		} )

	}

	return [ ...byAction.entries() ].map( ( [ action, eps ] ) => ( {
		action,
		episodes : eps,
	} ) )

}

/**
 * Build an inheritance bundle from a mature plant.
 *
 * @param   {object} plant              - A `SmartPlant`, ideally with `embody()` history.
 * @param   {object} [opts]             - Options.
 * @param   {number} [opts.hours]       - History window. Default 90 days.
 * @param   {number} [opts.minWellbeing] - Learn ranges only from readings at least this good.
 * @param   {object} [opts.transferability] - Passed through to the scorer.
 * @returns {object}                    The bundle.
 */
export function exportBundle( plant, opts = {} ) {

	const hours = opts.hours ?? 24 * 90
	const minWellbeing = opts.minWellbeing ?? 70

	// Selective transfer: `only` names what to send, `except` what to leave. An
	// unknown name is a typo that would silently ship nothing, so it throws.
	const requested = opts.only || ALL_MODULES.filter( m => !( opts.except || [] ).includes( m ) )
	const unknown = requested.filter( m => !ALL_MODULES.includes( m ) )

	if ( unknown.length ) {

		throw new Error( `Unknown inheritance module(s): ${unknown.join( ', ' )}. Choose from: ${ALL_MODULES.join( ', ' )}.` )

	}

	const wants = new Set( requested )

	const species = plant?.memory?.plant?.species
	if ( !species ) {

		throw new Error( 'Cannot export an inheritance without a species: priors are only meaningful between plants of the same kind. Set { species } on the source plant.' )

	}

	const rows = plant.memory.since( hours )
	const healthy = rows.filter( r => plant.happiness( r ) >= minWellbeing )

	// Comfort ranges come from the readings where the plant was doing well —
	// "the conditions it thrived in", not "the conditions it endured".
	const ranges = {}
	for ( const metric of wants.has( 'ranges' ) ? [ 'temperature', 'humidity', 'soil', 'light' ] : [] ) {

		const values = healthy.map( r => r[ metric ] ).filter( Number.isFinite )
		if ( values.length < 20 ) continue

		const sorted = [ ...values ].sort( ( a, b ) => a - b )
		ranges[ metric ] = {
			min : percentile( sorted, 0.1 ),
			max : percentile( sorted, 0.9 ),
			n   : values.length,
		}

	}

	const episodes = wants.has( 'policies' )
		? ( plant.body?.personalization?.memory?.episodes || [] )
		: []
	const scored = policiesFrom( episodes ).map( policy => {

		const t = transferability( policy, opts.transferability )
		const rewards = policy.episodes.map( e => e.reward )

		return {
			action        : policy.action,
			trials        : policy.episodes.length,
			meanReward    : Number( ( rewards.reduce( ( a, b ) => a + b, 0 ) / rewards.length ).toFixed( 4 ) ),
			transferability : t.score,
			band          : t.band,
			distinct      : t.diversity.distinct,
			why           : t.why,
		}

	} )

	// Only what survived the gate travels. The rest is reported so the export is
	// legible — you can see what was held back and why.
	const policies = scored.filter( p => p.transferability > 0 )
	const withheld = scored.filter( p => p.transferability <= 0 )

	const waterings = plant.memory.data.events.filter( e => e.type === 'water' )
	const intervals = []
	for ( let i = 1; i < waterings.length; i++ ) {

		const days = ( new Date( waterings[ i ].t ) - new Date( waterings[ i - 1 ].t ) ) / 86_400_000
		if ( days > 0 && days < 90 ) intervals.push( days )

	}

	const rhythm = wants.has( 'rhythm' ) && plant.electrome?.baseline
		? {
			// The *shape* of the baseline, as a species-in-this-kind-of-room prior.
			// Not the source plant's identity, which its own record keeps.
			complexity  : plant.electrome.baseline.complexity,
			entropy     : plant.electrome.baseline.entropy,
			variability : plant.electrome.baseline.variability,
		}
		: null

	return {
		manifest : {
			schemaVersion : SCHEMA_VERSION,
			species       : String( species ).toLowerCase().trim(),
			createdAt     : new Date().toISOString(),
			spanDays      : rows.length
				? Number( ( ( new Date( rows.at( -1 ).t ) - new Date( rows[ 0 ].t ) ) / 86_400_000 ).toFixed( 1 ) )
				: 0,
			readings      : rows.length,
			healthy       : healthy.length,
			// A stable, non-reversible handle so two bundles from the same source
			// can be recognised without the source being identifiable.
			sourceHash    : hashOf( `${species}:${rows[ 0 ]?.t ?? ''}:${rows.length}` ),
		},
		conditions : summarizeConditions( rows ),
		ranges,
		policies,
		withheld,
		modules : [ ...wants ],
		careCadence : wants.has( 'cadence' ) && intervals.length >= 2
			? { wateringDays : Number( ( intervals.reduce( ( a, b ) => a + b, 0 ) / intervals.length ).toFixed( 1 ) ) }
			: null,
		rhythm,
	}

}

/** Small non-cryptographic digest — an identifier, not a security boundary. */
function hashOf( text ) {

	let h = 2_166_136_261
	for ( let i = 0; i < text.length; i++ ) {

		h ^= text.charCodeAt( i )
		h = Math.imul( h, 16_777_619 )

	}
	return ( h >>> 0 ).toString( 16 ).padStart( 8, '0' )

}
