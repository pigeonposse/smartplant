/**
 * Whether the pot is getting small, and moving to a bigger one.
 *
 * The pot is the physical limit of everything the plant can do, and until now it
 * was a number used to size a watering and nothing else. Nothing here knew that
 * a plant outgrows its container, that outgrowing it is gradual and invisible,
 * or that a person usually notices only once the plant is already suffering.
 *
 * ## It does not see the roots, and says so everywhere
 *
 * There is no root sensor. This does not measure root mass, cannot see rot,
 * knows nothing about root architecture, and does not replace looking at the
 * rootball when you tip the plant out. Anybody reading a number from here as a
 * picture of the substrate has been misled.
 *
 * What it does is narrower and still worth having:
 *
 * > The system cannot see the roots, but it can tell whether this plant is
 * > behaving like one whose pot is running out — and it notices that months
 * > before a person does, because a person notices when the plant starts
 * > suffering and this notices when the drying curve starts changing.
 *
 * ## The measurement that carries it
 *
 * A pot with more root in it holds less available water and empties faster. So
 * the same plant in the same pot, watered the same way, needs watering sooner
 * than it did — and *that ratio*, recent against early in this pot, is the
 * signal. It is a comparison of the plant against itself in one container,
 * which is why it does not need a table of expected sizes.
 *
 * Everything else is corroboration. One signal moving is a hot week or a probe
 * that shifted; several moving together over months is a pot filling up.
 *
 * ## And it recommends, it never acts
 *
 * `acts` is false and stays false. Repotting is a physical act with real risk to
 * the plant, it costs the person an afternoon, and the evidence here is indirect
 * by construction. The system says what it sees and when, with the evidence
 * attached, and the decision is somebody else's.
 */

/** How much room is left, as far as behaviour can tell. */
export const ROOT_SPACE = {
	HIGH    : 'high',
	MEDIUM  : 'medium',
	LOW     : 'low',
	UNKNOWN : 'unknown',
}

/**
 * Roughly how long each archetype tends to go before it wants more room.
 *
 * A weak prior, and it fades the moment there is local evidence. It exists so a
 * plant with two months of history is not completely silent, not because a
 * table knows anything about a particular plant in a particular flat.
 */
export const TYPICAL_DAYS = {
	xerophyte  : 900,
	tropical   : 500,
	hygrophyte : 400,
	heliophyte : 450,
	c4         : 400,
	woody      : 700,
}

/** Days in a pot before the early behaviour is worth comparing against. */
export const BASELINE_DAYS = 45

const finite = Number.isFinite

/**
 * How fast the substrate empties, from a series of soil readings.
 *
 * Measured over drying runs — stretches where moisture only falls — because the
 * average over everything is dominated by how often somebody waters.
 *
 * @param   {object[]} rows - Readings, oldest first.
 * @returns {object}        `{known, perDay, runs}`.
 */
export function dryingRate( rows ) {

	const usable = ( rows ?? [] )
		.filter( r => finite( r?.soil ) )
		.map( r => ( {
			at : new Date( r.t ?? r.timestamp ).getTime(),
			soil : r.soil,
		} ) )
		.filter( r => finite( r.at ) )
		.sort( ( a, b ) => a.at - b.at )

	if ( usable.length < 8 ) {

		return {
			known : false,
			why : `${usable.length} soil readings. A drying rate is the slope of a stretch where moisture only falls, and there is not enough here to find one.`,
		}

	}

	const runs = []
	let start = usable[ 0 ]

	for ( let i = 1; i < usable.length; i++ ) {

		const prev = usable[ i - 1 ], now = usable[ i ]

		// A rise means somebody watered, which ends the run.
		if ( now.soil > prev.soil + 2 ) {

			const hours = ( prev.at - start.at ) / 3600_000
			const drop = start.soil - prev.soil

			if ( hours >= 12 && drop > 2 ) runs.push( drop / ( hours / 24 ) )
			start = now

		}

	}

	const hours = ( usable.at( -1 ).at - start.at ) / 3600_000
	const drop = start.soil - usable.at( -1 ).soil
	if ( hours >= 12 && drop > 2 ) runs.push( drop / ( hours / 24 ) )

	if ( !runs.length ) {

		return {
			known : false,
			why : 'No drying run long enough to measure. Either this plant is watered before the substrate moves much, or the probe is not following it.',
		}

	}

	return {
		known : true,
		runs : runs.length,
		perDay : Number( ( runs.reduce( ( a, b ) => a + b, 0 ) / runs.length ).toFixed( 2 ) ),
		why : `${runs.length} drying runs, losing ${( runs.reduce( ( a, b ) => a + b, 0 ) / runs.length ).toFixed( 1 )} points a day.`,
	}

}

/**
 * The average gap between waterings.
 *
 * @param   {object[]} events - The care log.
 * @param   {object}   [opts] - `{ since }`.
 * @returns {object}          `{known, days}`.
 */
export function wateringInterval( events, opts = {} ) {

	const at = ( events ?? [] )
		.filter( e => e?.type === 'water' )
		.map( e => new Date( e.at ?? e.t ).getTime() )
		.filter( t => finite( t ) && ( !finite( opts?.since ) || t >= opts.since ) )
		.sort( ( a, b ) => a - b )

	if ( at.length < 3 ) {

		return {
			known : false,
			waterings : at.length,
			why : `${at.length} waterings recorded. An interval needs at least three, and one that is watered by hand without anybody logging it will never have them.`,
		}

	}

	const gaps = at.slice( 1 ).map( ( t, i ) => ( t - at[ i ] ) / 86_400_000 )

	return {
		known : true,
		waterings : at.length,
		days : Number( ( gaps.reduce( ( a, b ) => a + b, 0 ) / gaps.length ).toFixed( 2 ) ),
		why : `${at.length} waterings, ${( gaps.reduce( ( a, b ) => a + b, 0 ) / gaps.length ).toFixed( 1 )} days apart on average.`,
	}

}

/**
 * How much room is left in this pot, as far as behaviour can tell.
 *
 * @param   {object} plant  - A `SmartPlant`.
 * @param   {object} [opts] - `{ now }`.
 * @returns {object}        `{index, outlook, confidence, evidence, acts, why}`.
 */
export function rootSpace( plant, opts = {} ) {

	opts = opts ?? {}
	const now = opts.now ?? Date.now()

	const pot = plant?.config?.pot ?? plant?.pot
	const since = pot?.since ? new Date( pot.since ).getTime() : null

	if ( !finite( pot?.litres ) && !finite( pot?.diameterCm ) ) {

		return unknown( 'No pot size, so there is no container to be running out of. This is the one thing here nobody can measure for you.', [ 'pot' ] )

	}

	// A pot that was changed recently has no history of its own, and judging it
	// on the old one's behaviour is exactly the mistake this is here to avoid.
	if ( plant?._transplant?.phase === 'settling' ) {

		return {
			index : ROOT_SPACE.UNKNOWN,
			outlook : 'not applicable',
			confidence : 'low',
			acts : false,
			settling : true,
			evidence : [],
			why : 'This plant was moved into a new pot recently and is still settling. Estimating whether it is running out of room would mean judging a container on behaviour learned in a different one, which is the mistake this whole idea exists to avoid.',
		}

	}

	const days = finite( since ) ? ( now - since ) / 86_400_000 : null
	const readings = plant?.memory?.data?.readings ?? []
	const events = plant?.memory?.data?.events ?? []

	// Everything is this plant against itself in this pot: early behaviour
	// against recent. No table of expected sizes is needed and none is used.
	const cut = finite( since ) ? since + BASELINE_DAYS * 86_400_000 : null
	const early = finite( cut ) ? readings.filter( r => new Date( r.t ).getTime() < cut ) : []
	const late = finite( cut ) ? readings.filter( r => new Date( r.t ).getTime() >= cut ) : []

	const evidence = []
	let signals = 0

	const degraded = safely( () => plant.maintenance?.()?.condition === 'degraded' ) === true

	if ( early.length && late.length && !degraded ) {

		const was = dryingRate( early ), is = dryingRate( late )

		if ( was.known && is.known && was.perDay > 0 ) {

			const ratio = is.perDay / was.perDay

			if ( ratio >= 1.25 ) {

				signals++
				evidence.push( {
					signal : 'drying-faster',
					ratio : Number( ratio.toFixed( 2 ) ),
					detail : `soil dries ${ratio.toFixed( 1 )}× faster than in the first ${BASELINE_DAYS} days in this pot`,
				} )

			}

		}

	}

	const earlyWater = wateringInterval( events, { since } )
	const lateWater = finite( cut ) ? wateringInterval( events, { since : cut } ) : { known : false }

	if ( earlyWater.known && lateWater.known && lateWater.days < earlyWater.days * 0.7 ) {

		signals++
		evidence.push( {
			signal : 'watered-sooner',
			detail : `watering interval ${earlyWater.days.toFixed( 1 )}d → ${lateWater.days.toFixed( 1 )}d in the same pot`,
		} )

	}

	// The weak one, and it fades. A plant is not root-bound because a table says
	// its type usually is by now.
	const typical = TYPICAL_DAYS[ plant?.archetype?.id ]

	if ( finite( days ) && finite( typical ) && days > typical ) {

		evidence.push( {
			signal : 'long-in-this-pot',
			weak : true,
			detail : `${Math.round( days )} days in ${pot.litres ?? '?'}L, against roughly ${typical} typical for this type — a weak prior, and it counts for nothing on its own`,
		} )

	}

	if ( degraded ) {

		evidence.push( {
			signal : 'instrument-discounted',
			detail : 'The soil probe is degraded, so the drying comparison was not counted. A failing probe drifts, and drift in the right direction looks exactly like a pot filling up.',
		} )

	}

	if ( !finite( days ) ) {

		return unknown( 'The pot size is known and the date it was set is not, so there is nothing to measure change against. `pot.since` is what makes this a comparison rather than a snapshot.', [ 'pot.since' ] )

	}

	if ( !signals && !evidence.length ) {

		return {
			index : ROOT_SPACE.HIGH,
			outlook : 'not soon',
			confidence : days > 120 ? 'medium' : 'low',
			acts : false,
			daysInPot : Math.round( days ),
			evidence : [],
			why : `${Math.round( days )} days in this pot and nothing about how it behaves has changed — it dries at the same rate and wants water as often as it did. Which is what a plant with room left looks like.`,
		}

	}

	const index = signals >= 2 ? ROOT_SPACE.LOW : signals === 1 ? ROOT_SPACE.MEDIUM : ROOT_SPACE.HIGH
	const confidence = signals >= 2 ? 'medium' : 'low'

	return {
		index,
		outlook : signals >= 2 ? '4–10 weeks' : signals === 1 ? 'watch' : 'not soon',
		confidence,
		// Repotting is a physical act with real risk, it costs an afternoon, and
		// the evidence here is indirect by construction. It says what it sees.
		acts : false,
		daysInPot : Math.round( days ),
		evidence,
		why : signals >= 2
			? `Several things have moved the same way in this pot: ${evidence.filter( e => !e.weak ).map( e => e.detail ).join( '; ' )}. That is what a pot running out of room looks like from the outside — nothing here has seen a root, and a plant behaving like this is usually one that would be happier in a bigger container.`
			: signals === 1
				? `One thing has changed: ${evidence[ 0 ].detail}. One signal is a hot week, a probe that shifted, or a change of room. Worth watching rather than acting on — a second signal moving the same way would make it a finding.`
				: `Nothing has changed in how this plant behaves. ${evidence[ 0 ]?.detail ?? ''}`,
	}

}

function unknown( why, missing ) {

	return {
		index : ROOT_SPACE.UNKNOWN,
		outlook : 'unknown',
		confidence : 'low',
		acts : false,
		missing,
		evidence : [],
		why,
	}

}

function safely( fn ) {

	try {

		return fn()

	}
	catch {

		return null

	}

}
