/**
 * Knowledge transfer — the one who knows the room teaches the one who just
 * arrived.
 *
 * Migration is a deliberate act: someone exports a bundle and someone imports
 * it. This is the same machinery with a different trigger. A plant that has been
 * in a room long enough to know it notices a newcomer that has not, and offers
 * what it has learned about *this place*.
 *
 * The earlier version of this idea was succession: when a plant dies, its
 * knowledge is distributed. That framing had a fatal practical flaw — the
 * trigger is undecidable. A dormant plant, a dead plant and a disconnected
 * electrode look very similar electrically, and a false positive means
 * distributing the estate of a plant that is merely sleeping.
 *
 * "Has little local experience" has no such problem. It is directly measurable,
 * and being wrong about it is harmless: teach a plant that already knew, and its
 * own evidence outweighs the lesson anyway. Nobody has to die for the colony to
 * accumulate knowledge.
 *
 * ## One room is one teacher
 *
 * If three experienced plants each hand the newcomer a bundle, that is **not
 * three confirmations**. They share a window, a radiator and a watering can, so
 * they are three views of one room and largely one body of evidence. Treating
 * them as independent would leave the newcomer three times as confident as the
 * evidence warrants, which is precisely the failure the colony's evidence rules
 * exist to prevent. So multiple teachers are merged into a single inheritance,
 * weighted by how much they actually agree.
 */

import { exportBundle } from './bundle.js'

/**
 * How much this plant knows about where it is.
 *
 * @param   {object} plant - A `SmartPlant`.
 * @returns {object}       `{level, days, readings, settled, score}`.
 */
export function experienceOf( plant ) {

	const readings = plant?.memory?.data?.readings || []
	const first = readings[ 0 ]?.t
	const days = first
		? ( Date.now() - new Date( first ).getTime() ) / 86_400_000
		: 0

	// A settled electrome baseline is the sharpest available marker: it means the
	// plant has been measured long enough to know what normal looks like for it.
	const settled = Boolean( plant?.electrome?.settled )
	const policies = plant?.body?.personalization?.memory?.episodes?.length || 0

	const score = Number( Math.min( 1,
		0.4 * Math.min( 1, days / 30 )
		+ 0.3 * Math.min( 1, readings.length / 200 )
		+ 0.2 * ( settled ? 1 : 0 )
		+ 0.1 * Math.min( 1, policies / 30 ),
	).toFixed( 3 ) )

	return {
		days      : Number( days.toFixed( 1 ) ),
		readings  : readings.length,
		settled,
		policies,
		score,
		level     : score < 0.25 ? 'newcomer' : score < 0.6 ? 'settling' : 'established',
	}

}

/**
 * Is this plant new enough to be worth teaching?
 *
 * @param   {object} experience - From `experienceOf`.
 * @param   {object} [opts]     - `{ threshold }`, default 0.25.
 * @returns {object}            `{novice, why}`.
 */
export function isNovice( experience, opts = {} ) {

	const threshold = opts.threshold ?? 0.25
	const novice = experience.score < threshold

	return {
		novice,
		score : experience.score,
		why : novice
			? `${experience.days}d in place, ${experience.readings} readings, baseline ${experience.settled ? 'settled' : 'not settled'} — this plant has not been here long enough to know the room.`
			: `${experience.days}d in place with a ${experience.settled ? 'settled' : 'forming'} baseline; it is learning this room for itself.`,
	}

}

/**
 * Whether a teacher has anything worth teaching.
 *
 * @param   {object} teacher - Experience of the would-be teacher.
 * @param   {object} learner - Experience of the newcomer.
 * @param   {object} [opts]  - `{ minGap }`, default 0.3.
 * @returns {object}         `{qualified, why}`.
 */
export function canTeach( teacher, learner, opts = {} ) {

	const minGap = opts.minGap ?? 0.3

	if ( teacher.level === 'newcomer' ) {

		return {
			qualified : false,
			why : 'A plant that does not know the room yet has nothing to pass on about it.',
		}

	}

	if ( teacher.score - learner.score < minGap ) {

		return {
			qualified : false,
			why : `The two plants have comparable experience (${teacher.score} vs ${learner.score}); there is no asymmetry to transfer across.`,
		}

	}

	return {
		qualified : true,
		why : `${teacher.days}d of local experience against ${learner.days}d — worth passing on what this room does.`,
	}

}

/**
 * Build the lesson: what a newcomer actually needs from a neighbour.
 *
 * Deliberately narrower than a full inheritance. What transfers usefully between
 * plants in one room is knowledge *of the room* — the conditions it holds, the
 * rhythm it imposes. Learned action policies are far more about the individual
 * and its pot, so they are excluded unless asked for.
 *
 * @param   {object} teacher - The experienced plant.
 * @param   {object} [opts]  - `{ modules }` to override the default selection.
 * @returns {object}         A migration bundle.
 */
export function prepareLesson( teacher, opts = {} ) {

	const modules = opts.modules || [ 'ranges', 'cadence', 'rhythm' ]

	return {
		...exportBundle( teacher, {
			...opts,
			only : modules,
		} ),
		lesson : {
			from    : teacher.memory?.plant?.name ?? null,
			modules,
			why     : 'What one plant can usefully tell another in the same room is what the room does, not what works in its own pot.',
		},
	}

}

/**
 * Merge several teachers into one lesson.
 *
 * The point is the merge itself. Neighbours are correlated observers of a shared
 * room, so N bundles are not N independent endorsements — they are one body of
 * evidence seen N times. Agreement between them raises confidence a little and
 * then saturates.
 *
 * @param   {object[]} bundles - Bundles from several teachers.
 * @returns {object|null}      One merged bundle, or null.
 */
export function mergeLessons( bundles ) {

	const valid = ( bundles || [] ).filter( b => b?.manifest?.species )
	if ( !valid.length ) return null
	if ( valid.length === 1 ) return valid[ 0 ]

	const species = valid[ 0 ].manifest.species
	if ( !valid.every( b => b.manifest.species === species ) ) {

		throw new Error( 'Cannot merge lessons from different species.' )

	}

	const median = xs => {

		const s = [ ...xs ].sort( ( a, b ) => a - b )
		const m = Math.floor( s.length / 2 )
		return s.length % 2 ? s[ m ] : ( s[ m - 1 ] + s[ m ] ) / 2

	}

	// Medians, not means: one teacher in an odd corner should not drag the lesson.
	const ranges = {}
	for ( const metric of [ 'temperature', 'humidity', 'soil', 'light' ] ) {

		const mins = valid.map( b => b.ranges?.[ metric ]?.min ).filter( Number.isFinite )
		const maxs = valid.map( b => b.ranges?.[ metric ]?.max ).filter( Number.isFinite )
		if ( !mins.length ) continue

		ranges[ metric ] = {
			min : Number( median( mins ).toFixed( 2 ) ),
			max : Number( median( maxs ).toFixed( 2 ) ),
			teachers : mins.length,
		}

	}

	const conditions = {}
	for ( const metric of [ 'temperature', 'humidity', 'soil', 'light' ] ) {

		const parts = valid.map( b => b.conditions?.[ metric ] ).filter( Boolean )
		if ( !parts.length ) continue

		conditions[ metric ] = {
			p10    : Number( median( parts.map( p => p.p10 ) ).toFixed( 2 ) ),
			median : Number( median( parts.map( p => p.median ) ).toFixed( 2 ) ),
			p90    : Number( median( parts.map( p => p.p90 ) ).toFixed( 2 ) ),
			n      : parts.reduce( ( a, p ) => a + p.n, 0 ),
		}

	}

	// How much the teachers actually agree about the room, which is all the extra
	// confidence a crowd is worth here.
	const spread = Object.values( ranges ).length
		? Object.entries( ranges ).map( ( [ metric ] ) => {

			const mins = valid.map( b => b.ranges?.[ metric ]?.min ).filter( Number.isFinite )
			return Math.max( ...mins ) - Math.min( ...mins )

		} )
		: []

	const agreement = spread.length
		? Number( Math.max( 0, 1 - ( spread.reduce( ( a, b ) => a + b, 0 ) / spread.length ) / 10 ).toFixed( 3 ) )
		: 0

	return {
		manifest : {
			...valid[ 0 ].manifest,
			createdAt : new Date().toISOString(),
			teachers  : valid.length,
			sourceHash: valid.map( b => b.manifest.sourceHash ).sort().join( '+' ),
		},
		conditions,
		ranges,
		policies : [],
		withheld : [],
		careCadence : null,
		rhythm : null,
		modules : [ 'ranges' ],
		lesson : {
			teachers  : valid.length,
			agreement,
			// Stated in the artefact so it survives being passed around.
			why : `${valid.length} neighbours contributed, but they share a room and are not independent witnesses to it. Merged into one lesson (agreement ${agreement}) rather than counted ${valid.length} times.`,
		},
	}

}
