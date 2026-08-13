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

import { exportBundle, summarizeConditions } from './bundle.js'

/**
 * How much two plants have in common, and therefore what may pass between them.
 *
 * A fern cannot tell a pothos when to water — that is a fact about being a fern.
 * It can tell it that this corner gets 300 lux and that the radiator takes the
 * humidity to 35% every winter, because that is a fact about the room, and the
 * room is the same for both. Refusing the whole exchange because the species
 * differ throws away the half that was always transferable.
 *
 * The split that matters is not really species, it is **what the knowledge is
 * about**:
 *
 *   the room  — air temperature, humidity, light. Shared by everything in it.
 *   the pot   — substrate moisture, conductivity, pH. Shared by nothing.
 *   the plant — comfort ranges, watering rhythm, what resolved what. Shared
 *               only with something that lives the same way.
 *
 * Soil moisture looks environmental and is not: 40% in the teacher's bark is a
 * different world from 40% in the learner's peat, and passing it across as
 * though it described a shared place is how a lesson becomes misinformation.
 */
export const KINSHIP = {
	SPECIES   : 'species',
	ARCHETYPE : 'archetype',
	NEIGHBOUR : 'neighbour',
}

/** Metrics that describe the space rather than the container. */
export const ROOM_METRICS = [ 'temperature', 'humidity', 'light', 'par', 'co2', 'airflow', 'redFarRed' ]

/**
 * What one plant may teach another.
 *
 * @param   {object} teacher - `{species, archetype}`.
 * @param   {object} learner - `{species, archetype}`.
 * @returns {object}         `{kinship, teaches, why}`.
 */
export function kinship( teacher, learner ) {

	const same = ( a, b ) => a && b && String( a ).toLowerCase().trim() === String( b ).toLowerCase().trim()

	if ( same( teacher?.species, learner?.species ) ) {

		return {
			kinship : KINSHIP.SPECIES,
			teaches : [ 'room', 'ranges', 'cadence', 'rhythm', 'resolutions' ],
			why : `Both are ${learner.species}. Everything this plant has learned about living here applies, including what resolved which problem.`,
		}

	}

	if ( same( teacher?.archetype, learner?.archetype ) ) {

		return {
			kinship : KINSHIP.ARCHETYPE,
			// Same strategy, different plant: the comfort bands are a reasonable
			// starting guess, the watering rhythm and the electrical baseline are
			// not — those belong to the species and to the pot.
			teaches : [ 'room', 'ranges' ],
			why : `Different species but the same strategy (${learner.archetype}), so the comfort bands are a fair starting guess. The watering rhythm and the electrical baseline are not — those belong to the species.`,
		}

	}

	return {
		kinship : KINSHIP.NEIGHBOUR,
		teaches : [ 'room' ],
		why : `Nothing in common biologically, so nothing biological passes. What does pass is the room: what the light, the air and the seasons actually do in this spot, which is the same for both of them.`,
	}

}

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

	const relation = opts.for
		? kinship(
			{
				species : teacher.memory?.plant?.species,
				archetype : teacher.archetype?.id,
			},
			opts.for,
		)
		: {
			kinship : KINSHIP.SPECIES,
			teaches : [ 'room', 'ranges', 'cadence', 'rhythm', 'resolutions' ],
			why : 'No learner named, so the full lesson is prepared.',
		}

	const teaches = new Set( opts.modules || relation.teaches )

	// Only the biological modules go through the inheritance bundle; the room is
	// assembled separately because it is not a property of the teacher at all.
	const modules = [
		teaches.has( 'ranges' ) && 'ranges',
		teaches.has( 'cadence' ) && 'cadence',
		teaches.has( 'rhythm' ) && 'rhythm',
	].filter( Boolean )

	const bundle = modules.length
		? exportBundle( teacher, {
			...opts,
			only : modules,
		} )
		: {
			manifest : {
				schemaVersion : 1,
				species : String( teacher.memory?.plant?.species || '' ).toLowerCase().trim(),
				createdAt : new Date().toISOString(),
				sourceHash : 'room-only',
			},
			ranges : {},
			policies : [],
			withheld : [],
			modules : [],
		}

	return {
		...bundle,
		room : teaches.has( 'room' ) ? roomKnowledge( teacher, opts ) : null,
		resolutions : teaches.has( 'resolutions' ) ? resolutionKnowledge( teacher ) : null,
		lesson : {
			from    : teacher.memory?.plant?.name ?? null,
			archetype : teacher.archetype?.id ?? null,
			kinship : relation.kinship,
			teaches : [ ...teaches ],
			modules,
			why     : relation.why,
		},
	}

}

/**
 * What the room does, as distinct from what the pot does.
 *
 * Everything here is a property of the space, so it is worth the same to any
 * plant standing in it. Substrate metrics are deliberately excluded: 40%
 * moisture in the teacher's bark is a different world from 40% in the learner's
 * peat, and passing it across as shared knowledge would be misinformation
 * wearing the shape of data.
 *
 * @param   {object} teacher - The experienced plant.
 * @param   {object} [opts]  - `{ hours }`.
 * @returns {object|null}    The room's behaviour.
 */
export function roomKnowledge( teacher, opts = {} ) {

	const rows = teacher.memory?.since?.( opts.hours ?? 24 * 60 ) || []
	const conditions = summarizeConditions( rows )

	if ( !conditions ) return null

	const room = {}

	for ( const metric of ROOM_METRICS ) {

		if ( conditions[ metric ] ) room[ metric ] = conditions[ metric ]

	}

	if ( !Object.keys( room ).length ) return null

	// How much the spot moves, which is often more useful than where it sits: a
	// stable corner and a swinging windowsill can share a mean and behave
	// nothing alike.
	const swing = {}

	for ( const metric of Object.keys( room ) ) {

		swing[ metric ] = Number( ( room[ metric ].p90 - room[ metric ].p10 ).toFixed( 2 ) )

	}

	return {
		conditions : room,
		swing,
		days : rows.length
			? Number( ( ( new Date( rows.at( -1 ).t ) - new Date( rows[ 0 ].t ) ) / 86_400_000 ).toFixed( 1 ) )
			: 0,
		observations : rows.length,
		why : `What this spot actually does, measured over ${rows.length} readings. Air and light only — substrate is a property of the pot, not of the room, and does not transfer.`,
	}

}

/**
 * What resolved what, for a plant of the same species.
 *
 * Carries the base rate with every finding, because "watering worked" without
 * "and it cleared on its own anyway" is not information.
 *
 * @param   {object} teacher - The experienced plant.
 * @returns {object|null}    Resolutions worth passing on.
 */
export function resolutionKnowledge( teacher ) {

	const ledger = teacher._resolutions
	if ( !ledger ) return null

	const problems = [ ...ledger.history.keys() ]
		.map( p => ledger.whatWorked( p ) )
		.filter( w => w.known && w.actions?.some( a => a.enough ) )

	if ( !problems.length ) return null

	return {
		problems : problems.map( w => ( {
			problem : w.problem,
			base    : w.base,
			actions : w.actions.filter( a => a.enough ),
		} ) ),
		why : 'What has actually resolved these problems here, each with how often the problem cleared on its own — the second half is what makes the first half mean anything.',
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

	if ( valid.length === 1 ) {

		// One lesson still gets the merged shape. A consumer should not have to
		// branch on how many teachers there happened to be.
		const only = valid[ 0 ]
		const bio = Object.keys( only.ranges || {} ).length ? 1 : 0

		return {
			...only,
			room : only.room ?? null,
			lesson : {
				...only.lesson,
				teachers : 1,
				biological : bio,
				roomOnly : 1 - bio,
				agreement : null,
				why : only.lesson?.why ?? 'One neighbour contributed.',
			},
		}

	}

	// Lessons of different kinds now arrive together: a same-species neighbour
	// sending comfort bands, a fern sending only what the room does. Refusing the
	// whole batch because they differ would throw away the room, which every one
	// of them agrees about.
	const biological = valid.filter( b => Object.keys( b.ranges || {} ).length )

	// The barrier for comfort bands is the archetype, not the species — that is
	// precisely what an archetype is, a shared way of living. A Monstera and a
	// pothos want roughly the same conditions; a fern and a cactus do not, and no
	// averaging of the two describes anything real.
	const archetypes = new Set( biological.map( b => b.lesson?.archetype ?? b.manifest.species ) )

	if ( archetypes.size > 1 ) {

		throw new Error( `Cannot merge comfort ranges across ${[ ...archetypes ].join( ' and ' )}. A fern's comfortable is a cactus's drowning, and the average describes neither. Room knowledge merges freely; biology does not.` )

	}

	const median = xs => {

		const s = [ ...xs ].sort( ( a, b ) => a - b )
		const m = Math.floor( s.length / 2 )
		return s.length % 2 ? s[ m ] : ( s[ m - 1 ] + s[ m ] ) / 2

	}

	// Medians, not means: one teacher in an odd corner should not drag the lesson.
	// A neighbour of the same species knows more about being this plant than one
	// that merely shares its strategy, so it is counted twice in the median.
	const weighted = biological.flatMap( b =>
		b.lesson?.kinship === KINSHIP.SPECIES ? [ b, b ] : [ b ] )

	const ranges = {}
	for ( const metric of [ 'temperature', 'humidity', 'soil', 'light' ] ) {

		const mins = weighted.map( b => b.ranges?.[ metric ]?.min ).filter( Number.isFinite )
		const maxs = weighted.map( b => b.ranges?.[ metric ]?.max ).filter( Number.isFinite )
		if ( !mins.length ) continue

		ranges[ metric ] = {
			min : Number( median( mins ).toFixed( 2 ) ),
			max : Number( median( maxs ).toFixed( 2 ) ),
			teachers : biological.filter( b => Number.isFinite( b.ranges?.[ metric ]?.min ) ).length,
			sameSpecies : biological.filter( b => b.lesson?.kinship === KINSHIP.SPECIES ).length,
		}

	}

	// The room merges across everybody, biology or not: they are all standing in
	// it, and more observers of one space is genuinely better.
	const conditions = {}
	for ( const metric of ROOM_METRICS ) {

		const parts = valid.map( b => b.conditions?.[ metric ] || b.room?.conditions?.[ metric ] ).filter( Boolean )
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
		modules : biological.length ? [ 'ranges' ] : [],
		room : {
			conditions,
			contributors : valid.length,
			why : `What this room does, pooled from ${valid.length} plant(s) standing in it. Air and light only — substrate belongs to each pot.`,
		},
		lesson : {
			teachers  : valid.length,
			biological : biological.length,
			roomOnly  : valid.length - biological.length,
			agreement,
			// Stated in the artefact so it survives being passed around.
			why : `${valid.length} neighbour(s) contributed — ${biological.length} of the same kind, ${valid.length - biological.length} passing on the room only. They share that room and are not independent witnesses to it, so this is one lesson (agreement ${agreement}) rather than ${valid.length}.`,
		},
	}

}
