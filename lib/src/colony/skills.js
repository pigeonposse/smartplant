/**
 * The colony vocabulary.
 *
 * Plants in a colony hold a conversation. Most of it is ordinary talk — one
 * plant asks another how it is, and the other answers in its own voice. Skills
 * are the fast path through that conversation: instead of asking in prose and
 * waiting for a model to answer, a plant fires a named request and gets the
 * structured fact straight back.
 *
 * Every skill declares what it needs in order to be spoken at all. This is the
 * rule the whole layer rests on, and it is the same one the spectral layer uses
 * for contraindications: **missing data blocks, it does not permit.**
 *
 * A plant with no electrode cannot say `sense.electrome-spike`. Not quietly, not
 * with low confidence — the skill is simply not in its vocabulary, and a request
 * for it comes back refused with the reason. A colony of cheap sensors therefore
 * says little and means all of it, rather than saying everything and meaning
 * nothing. Anything a plant cannot measure, it does not claim.
 *
 * The catalogue below is the starting vocabulary, not a closed one. Register
 * your own with `registerSkill()`; a skill that needs hardware nobody has yet is
 * still worth declaring, because it stays mute with a stated reason instead of
 * being invented later.
 */

import { experienceOf } from '../migration/teaching.js'

/** Families, in the order they read most naturally in a transcript. */
export const FAMILIES = {
	sense     : 'What I am feeling right now',
	state     : 'How I am',
	canopy    : 'Space, light and where I am growing',
	health    : 'Alarms and recovery',
	rhythm    : 'Clocks, phases and timing',
	rhizo     : 'The conversation underground',
	consensus : 'Talking about the colony itself',
}

const band = ( v, edges, names ) => {

	if ( !Number.isFinite( v ) ) return null
	let i = 0
	while ( i < edges.length && v >= edges[ i ] ) i++
	return names[ i ]

}

/** Shorthand for a skill that just reports a metric it is allowed to report. */
const metric = ( id, family, says, key, extra ) => ( {
	id,
	family,
	says,
	requires : [ key ],
	answer   : ( plant, ctx ) => ( {
		[ key ] : ctx.current?.[ key ],
		...( extra ? extra( plant, ctx ) : {} ),
	} ),
} )

/** A skill that is defined but cannot be spoken by any current sensor. */
const unmeasured = ( id, family, says, needs ) => ( {
	id,
	family,
	says,
	requires : [ needs ],
	// No answer: nothing in the framework can back this yet. Declared so the
	// vocabulary is complete and the silence is explained rather than blank.
	answer   : null,
} )

/** @type {Map<string, object>} */
const CATALOGUE = new Map()

const define = skill => {

	CATALOGUE.set( skill.id, skill )
	return skill

}

// ── 1 · Sensing and microclimate ────────────────────────────────────────────

define( metric( 'sense.luminosity-share', 'sense',
	'This is how the light feels down here right now.', 'light',
	( _p, ctx ) => ( { band : band( ctx.current?.light, [ 200, 800, 2000, 10_000 ], [ 'dark', 'dim', 'moderate', 'bright', 'intense' ] ) } ) ) )

define( {
	id       : 'sense.vpd-perception',
	family   : 'sense',
	says     : 'My air is this dry — is anyone else feeling this pull?',
	requires : [ 'temperature', 'humidity' ],
	answer   : ( _p, ctx ) => ( {
		vpd : ctx.vpd,
		band : ctx.vpdBand,
	} ),
} )

define( metric( 'sense.soil-thermal', 'sense',
	'This is the temperature around my roots.', 'temperature' ) )

define( {
	id       : 'sense.electrome-spike',
	family   : 'sense',
	says     : 'Something just moved through my tissue.',
	requires : [ 'electrode' ],
	answer   : plant => {

		const last = plant.perception?.electro
		return {
			events : ( last?.events || [] ).slice( -3 ).map( e => ( {
				type : e.type?.label,
				amplitude : e.amplitude,
				durationS : e.durationS,
			} ) ),
		}

	},
} )

define( unmeasured( 'sense.acoustic-vibration', 'sense',
	'I feel continuous mechanical vibration.', 'accelerometer' ) )
define( unmeasured( 'sense.uv-exposure', 'sense',
	'UV at my canopy is near what I can tolerate.', 'uv-sensor' ) )
define( unmeasured( 'sense.co2-pocket', 'sense',
	'The air around me is stagnant and low in CO2.', 'co2-sensor' ) )

define( metric( 'sense.root-impedance', 'sense',
	'This is how my substrate conducts.', 'conductivity' ) )

define( metric( 'sense.humidity-flow', 'sense',
	'This is the moisture in my air.', 'humidity' ) )

define( {
	id       : 'sense.spectral-quality',
	family   : 'sense',
	says     : 'The red to far-red reaching me says how much shade is over my head.',
	requires : [ 'spectral' ],
	answer   : plant => ( { phytochrome : plant.spectral?.history?.findLast( h => h.band === 'farRed' )?.locking ?? null } ),
} )

// ── 2 · State and needs ─────────────────────────────────────────────────────

define( metric( 'state.hydraulic-turgor', 'state',
	'This is how much water I have to work with.', 'soil',
	( plant, ctx ) => ( { wellbeing : ctx.happiness } ) ) )

define( {
	id       : 'state.stomata-status',
	family   : 'state',
	says     : 'My stomata are open / closed, and this is why.',
	requires : [ 'spectral' ],
	answer   : plant => {

		const blue = plant.spectral?.history?.findLast( h => h.band === 'blue' )
		return {
			locked : blue?.locking?.locked ?? null,
			reading : blue?.reading ?? null,
		}

	},
} )

define( unmeasured( 'state.phenology-stage', 'state',
	'I have entered bud break / flowering / ripening.', 'phenology-observer' ) )

define( metric( 'state.nutritional-deficit', 'state',
	'This is what my substrate is carrying.', 'conductivity' ) )

define( {
	id       : 'state.photosynthetic-rate',
	family   : 'state',
	says     : 'This is how well I am processing photons.',
	requires : [ 'spectral' ],
	answer   : plant => ( { red : plant.spectral?.history?.findLast( h => h.band === 'red' )?.locking ?? null } ),
} )

define( unmeasured( 'state.sap-flow', 'state',
	'My sap flow is accelerating.', 'sap-flow-sensor' ) )
define( unmeasured( 'state.root-expansion', 'state',
	'My roots are pushing into this quadrant.', 'root-imaging' ) )
define( unmeasured( 'state.thermal-stress', 'state',
	'My leaf is hotter than the air around it.', 'leaf-ir' ) )

define( metric( 'state.salinity', 'state',
	'I am at my salt limit at the roots.', 'conductivity' ) )

define( unmeasured( 'state.energy-reserve', 'state',
	'My stored sugars are high / spent.', 'carbohydrate-assay' ) )

// ── 3 · Canopy and space ────────────────────────────────────────────────────
// Almost all of this needs to know where the speaker physically is. Until a
// plant has a body and eyes, it cannot honestly negotiate for space.

for ( const [ id, says ] of [
	[ 'canopy.shade-warning', 'If I keep growing this way I will take your sun.' ],
	[ 'canopy.growth-vector', 'I plan to put my new leaves into that gap.' ],
	[ 'canopy.space-yield', 'I yield this light; I will lean back.' ],
	[ 'canopy.density-agreement', 'We are too tight in this volume.' ],
	[ 'canopy.light-filter', 'The light passing through me to you carries this spectrum.' ],
	[ 'canopy.crown-shyness', 'I am keeping my leaves clear of yours.' ],
	[ 'canopy.structural-support', 'I am leaning on your structure.' ],
	[ 'canopy.airflow-pass', 'I am opening my leaves to let the draught through to you.' ],
	[ 'canopy.phototropism-sync', 'We are both leaning the same way; we will shade each other.' ],
	[ 'canopy.microclimate-shield', 'I am standing between you and the wind.' ],
] ) define( unmeasured( id, 'canopy', says, 'vision+position' ) )

// ── 4 · Health ──────────────────────────────────────────────────────────────

define( {
	id       : 'health.pest-gossip', family : 'health',
	says     : 'Something is biting my leaves.',
	requires : [ 'vision' ],
	answer   : plant => ( { lastAnalysis : plant.perception?.vision?.findings ?? null } ),
} )

define( unmeasured( 'health.fungal-signal', 'health',
	'I smell spores at my base.', 'spore-sensor' ) )
define( unmeasured( 'health.voc-emission', 'health',
	'I am releasing defensive volatiles.', 'voc-sensor' ) )
define( unmeasured( 'health.systemic-immunity', 'health',
	'My immune response is up — ready yours.', 'voc-sensor' ) )
define( unmeasured( 'health.pathogen-isolate', 'health',
	'I am cutting this zone off.', 'tissue-imaging' ) )

define( {
	id       : 'health.recovery-progress', family : 'health',
	says     : 'My stress is coming down since the last episode.',
	requires : [ 'wellbeing' ],
	answer   : ( plant, ctx ) => ( {
		now : ctx.happiness,
		trend : plant.memory.stats( 24 )?.soil?.trend ?? null,
	} ),
} )

define( {
	id       : 'health.neighbor-check', family : 'health',
	says     : 'You have been quiet for a long time — are you still there?',
	requires : [],
	answer   : ( plant, ctx ) => ( {
		alive : true,
		lastReadingAt : plant.memory.lastReading?.t ?? null,
		wellbeing : ctx.happiness,
	} ),
} )

define( metric( 'health.toxin-alert', 'health',
	'Something in the shared soil is off.', 'conductivity' ) )

define( {
	id       : 'health.wound-response', family : 'health',
	says     : 'I have been damaged.',
	requires : [ 'electrode' ],
	answer   : plant => ( {
		variationPotentials : ( plant.perception?.electro?.events || [] )
			.filter( e => e.type?.label === 'variation_potential' ).length,
	} ),
} )

define( metric( 'health.root-rot-risk', 'health',
	'The soil around me is waterlogged.', 'soil' ) )

// ── 5 · Rhythms ─────────────────────────────────────────────────────────────

define( {
	id       : 'rhythm.circadian-align', family : 'rhythm',
	says     : 'My internal clock says it is dawn now.',
	requires : [ 'clock' ],
	answer   : plant => {

		const c = plant.perception?.electro?.clock
		return {
			acrophaseHour : c?.acrophaseHour,
			periodHours : c?.periodHours,
			freeRunning : c?.freeRunning,
		}

	},
} )

define( {
	id       : 'rhythm.sleep-phase', family : 'rhythm',
	says     : 'I am going into my night.',
	requires : [ 'clock' ],
	answer   : plant => ( { subjectiveHour : plant.perception?.electro?.clock?.subjectiveHour ?? null } ),
} )

define( {
	id       : 'rhythm.stomata-orchestration', family : 'rhythm',
	says     : 'Open yours now — I have closed mine, so the local humidity will hold.',
	requires : [ 'temperature', 'humidity' ],
	answer   : ( _p, ctx ) => ( {
		vpd : ctx.vpd,
		band : ctx.vpdBand,
	} ),
} )

define( metric( 'rhythm.water-demand-shift', 'rhythm',
	'I will be drawing water shortly.', 'soil' ) )

define( {
	id       : 'rhythm.seasonal-shift', family : 'rhythm',
	says     : 'The days are shortening; I am preparing for dormancy.',
	requires : [ 'light' ],
	answer   : plant => ( { photoperiodTrend : plant.memory.stats( 24 * 14 )?.light?.trend ?? null } ),
} )

define( {
	id       : 'rhythm.pulse-resonance', family : 'rhythm',
	says     : 'Let us line up our oscillations.',
	requires : [ 'electrode' ],
	answer   : plant => ( { fingerprint : plant.perception?.electro?.fingerprint ?? null } ),
} )

for ( const [ id, says, needs ] of [
	[ 'rhythm.flowering-intent', 'I intend to open flowers this cycle.', 'phenology-observer' ],
	[ 'rhythm.nectar-production', 'I am secreting nectar now.', 'phenology-observer' ],
	[ 'rhythm.spore-release-window', 'Good window for coordinated dispersal.', 'phenology-observer' ],
	[ 'rhythm.dawn-preparation', 'Readying pigments for first light.', 'pigment-assay' ],
] ) define( unmeasured( id, 'rhythm', says, needs ) )

// ── 6 · Underground ─────────────────────────────────────────────────────────
// Nothing here has a sensor. Declared in full so the vocabulary is honest about
// what it is missing rather than silently short.

for ( const [ id, says, needs ] of [
	[ 'rhizo.mycelium-connect', 'I have a live link to the mycelial network this way.', 'mycorrhizal-probe' ],
	[ 'rhizo.exudate-share', 'I am releasing root exudates into the rhizosphere.', 'rhizosphere-assay' ],
	[ 'rhizo.root-territory', 'This soil is held by my root hair.', 'root-imaging' ],
	[ 'rhizo.nutrient-patch', 'I found phosphorus over here.', 'rhizosphere-assay' ],
	[ 'rhizo.water-channel', 'There is water moving underground toward you.', 'soil-moisture-array' ],
	[ 'rhizo.symbiosis-signal', 'I have taken up with nitrogen-fixing bacteria.', 'rhizosphere-assay' ],
	[ 'rhizo.allelopathy-warning', 'My roots are putting out inhibitors — do not come closer this side.', 'rhizosphere-assay' ],
	[ 'rhizo.graft-offer', 'Our roots are touching; shall we fuse?', 'root-imaging' ],
	[ 'rhizo.microbiome-status', 'The life in my soil is active.', 'rhizosphere-assay' ],
	[ 'rhizo.depletion-zone', 'I have used up the nitrogen in this volume.', 'rhizosphere-assay' ],
] ) define( unmeasured( id, 'rhizo', says, needs ) )

// ── 7 · Talking about the colony ────────────────────────────────────────────
// This family needs no sensor at all: it is the colony talking about itself.

define( {
	id : 'consensus.identity', family : 'consensus',
	says : 'This is who I am and where I stand.',
	requires : [],
	answer : plant => ( {
		name : plant.memory.plant.name,
		species : plant.memory.plant.species,
		type : plant.memory.plant.type,
	} ),
} )

define( {
	id : 'consensus.presence', family : 'consensus',
	says : 'Still alive, still reading the world.',
	requires : [],
	answer : ( plant, ctx ) => ( {
		alive : true,
		wellbeing : ctx.happiness,
	} ),
} )

define( {
	id : 'consensus.experience', family : 'consensus',
	says : 'This is how long I have been here and how well I know this room.',
	requires : [],
	answer : plant => experienceOf( plant ),
} )

define( {
	id : 'consensus.lesson', family : 'consensus',
	says : 'Here is what I have learned about this room, for someone who just arrived.',
	requires : [],
	// Answered by the colony layer, which has the migration module to hand.
	answer : null,
	colonyLevel : true,
} )

define( {
	id : 'consensus.offers', family : 'consensus',
	says : 'This is everything I am able to tell you about.',
	requires : [],
	answer : plant => ( { offers : lexiconOf( plant ).speakable } ),
} )

define( {
	id : 'consensus.collective-mood', family : 'consensus',
	says : 'This is how I read the colony as a whole.',
	requires : [],
	answer : ( plant, ctx ) => ( { mine : ctx.happiness } ),
} )

define( {
	id : 'consensus.anomaly-check', family : 'consensus',
	says : 'What you feel does not match what I feel — let us compare.',
	requires : [],
	answer : ( _p, ctx ) => ( { current : ctx.current } ),
} )

for ( const [ id, says ] of [
	[ 'consensus.neighbor-trust', 'Your readings look consistent with mine.' ],
	[ 'consensus.leader-role', 'I will be the microclimate reference for this group.' ],
	[ 'consensus.quarantine-peer', 'That node is talking nonsense; stop relaying it.' ],
	[ 'consensus.memory-gossip', 'Remember what the last heat wave did to this corner.' ],
	[ 'consensus.topology-map', 'This is how I see the colony laid out from here.' ],
	[ 'consensus.harmony-index', 'This is how in step the colony is.' ],
] ) define( {
	id,
	family : 'consensus',
	says,
	requires : [],
	// Answered by the colony layer itself rather than by a sensor.
	answer : null,
	colonyLevel : true,
} )

// ── capability resolution ───────────────────────────────────────────────────

/**
 * What a plant is physically able to talk about.
 *
 * Derived from the drivers actually attached, not from configuration or hope.
 *
 * @param   {object} plant - A `SmartPlant`.
 * @returns {Set<string>}  Capability tokens.
 */
export function capabilitiesOf( plant ) {

	const caps = new Set( [ 'wellbeing' ] )

	for ( const driver of plant._drivers || [] ) {

		for ( const key of driver.provides || [] ) caps.add( key )

	}

	if ( plant.sensors?.peek?.( 'electrode' ) ) caps.add( 'electrode' )
	// The clock only exists once there is enough history for it to be real.
	if ( plant.perception?.electro?.clock?.known ) caps.add( 'clock' )
	if ( plant.spectral ) caps.add( 'spectral' )
	if ( plant.vision ) caps.add( 'vision' )

	return caps

}

/**
 * The vocabulary this particular plant can actually speak.
 *
 * @param   {object} plant - A `SmartPlant`.
 * @returns {object}       `{speakable, mute, capabilities}`.
 */
export function lexiconOf( plant ) {

	const caps = capabilitiesOf( plant )
	const speakable = [], mute = []

	for ( const skill of CATALOGUE.values() ) {

		const missing = ( skill.requires || [] ).filter( r => !caps.has( r ) )

		if ( missing.length || ( !skill.answer && !skill.colonyLevel ) ) {

			mute.push( {
				id : skill.id,
				family : skill.family,
				reason : missing.length
					? `needs ${missing.join( ' and ' )}, which this plant has no sensor for`
					: 'nothing in the framework can measure this yet',
			} )
			continue

		}

		speakable.push( skill.id )

	}

	return {
		speakable,
		mute,
		capabilities : [ ...caps ].sort(),
	}

}

/**
 * Answer a skill request, or refuse it with the reason.
 *
 * @param   {object} plant   - The plant being asked.
 * @param   {string} skillId - Skill.
 * @returns {object}         `{ok, skill, data}` or `{ok: false, reason}`.
 */
export function answerSkill( plant, skillId ) {

	const skill = CATALOGUE.get( skillId )

	if ( !skill ) return {
		ok : false,
		reason : `No such skill: "${skillId}".`,
	}

	const caps = capabilitiesOf( plant )
	const missing = ( skill.requires || [] ).filter( r => !caps.has( r ) )

	if ( missing.length ) {

		return {
			ok : false,
			skill : skillId,
			// The refusal is the honest answer, and it is informative: the asker
			// learns what this neighbour cannot see, which is worth knowing.
			reason : `I have no ${missing.join( ' or ' )} sensor, so I cannot tell you that.`,
		}

	}

	if ( !skill.answer ) {

		return {
			ok : false,
			skill : skillId,
			reason : skill.colonyLevel
				? 'That is a question about the colony, not about me.'
				: 'Nothing I have can measure that.',
		}

	}

	return {
		ok : true,
		skill : skillId,
		says : skill.says,
		data : skill.answer( plant, plant.context() ),
	}

}

/** Register a skill, or replace one. */
export function registerSkill( skill ) {

	if ( !skill?.id || !skill.family ) throw new Error( 'A colony skill needs an { id, family }.' )
	if ( !FAMILIES[ skill.family ] ) throw new Error( `Unknown family "${skill.family}". One of: ${Object.keys( FAMILIES ).join( ', ' )}.` )
	CATALOGUE.set( skill.id, {
		requires : [],
		answer : null,
		...skill,
	} )
	return skill

}

export function getSkill( id ) {

	return CATALOGUE.get( id ) || null

}

export function allSkills() {

	return [ ...CATALOGUE.values() ]

}
