/**
 * The four ways the system learns it was wrong, plus teaching the newcomer.
 *
 * Prediction error, identity drift, decaying inheritance, changed responses.
 * What they share is that each one measures the *system's* grip on the plant
 * rather than the plant's state — and each has a confound that would otherwise
 * turn it into confident nonsense. Most of what is tested here is the refusal.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import { BIAS, PredictionLedger } from '../src/prediction/index.js'
import { PlantPersonalization } from '../src/personalization/index.js'
import {
	ContinuityTracker, electromeFingerprint, hysteresis, hysteresisCues,
	responseHistory, responseProfile,
} from '../src/signals/index.js'
import {
	canTeach, experienceOf, Inheritance, isNovice, mergeLessons,
} from '../src/migration/index.js'
import { LoopbackBus } from '../src/colony/index.js'

const DAY = 86_400_000
const HOUR = 3600_000

/** Deterministic noise. */
function rng( seed ) {

	let s = seed
	return () => {

		s = ( s * 1103515245 + 12345 ) & 0x7fffffff
		return s / 0x7fffffff - 0.5

	}

}

function trace( noise, seed ) {

	const r = rng( seed )
	return Array.from( { length : 600 }, ( _, i ) =>
		-60 + 2 * Math.sin( ( 2 * Math.PI * i ) / 300 ) + r() * noise )

}

const fp = ( noise, seed ) => electromeFingerprint( trace( noise, seed ), 5, { mainsHz : 0 } )

// ── #9 · prediction error ───────────────────────────────────────────────────

describe( 'prediction error', () => {

	it( 'refuses a verdict before it has enough predictions', () => {

		const led = new PredictionLedger()
		led.record( {
			action : 'water',
			expected : 0.5,
			observed : 0.1,
		} )

		const c = led.calibration( 'water' )
		assert.equal( c.known, false )
		assert.match( c.verdict, /before calling the model wrong/ )

	} )

	it( 'does not manufacture error out of having no opinion', () => {

		// A model that predicted nothing cannot be wrong. Treating a missing
		// forecast as a forecast of zero would invent error from ignorance.
		const led = new PredictionLedger()
		const r = led.record( {
			action : 'water',
			expected : undefined,
			observed : 0.4,
		} )

		assert.equal( r.skipped, true )
		assert.equal( led.calibration( 'water' ).n, 0 )

	} )

	it( 'names an overconfident model as optimistic, not the plant as resistant', () => {

		const led = new PredictionLedger()
		// The model keeps promising 0.8 and the world keeps delivering 0.2.
		for ( let i = 0; i < 10; i++ ) led.record( {
			action : 'move_to_light',
			expected : 0.8,
			observed : 0.2,
		} )

		const c = led.calibration( 'move_to_light' )

		assert.equal( c.bias, BIAS.OPTIMISTIC )
		assert.ok( c.meanError < 0 )
		assert.match( c.verdict, /the plant is not failing to cooperate/ )
		assert.equal( c.suggestedShift, c.meanError )

	} )

	it( 'names an underconfident model as pessimistic', () => {

		const led = new PredictionLedger()
		for ( let i = 0; i < 10; i++ ) led.record( {
			action : 'shade',
			expected : 0.1,
			observed : 0.7,
		} )

		assert.equal( led.calibration( 'shade' ).bias, BIAS.PESSIMISTIC )

	} )

	it( 'separates a biased model from a merely noisy one', () => {

		// Large errors that average to nothing are not bias, and the fix is not the
		// same: bias means shift the estimate, noise means the model is missing
		// whatever actually drives the outcome.
		const led = new PredictionLedger()
		for ( let i = 0; i < 12; i++ ) led.record( {
			action : 'fertilize',
			expected : 0.5,
			observed : i % 2 ? 1 : 0,
		} )

		const c = led.calibration( 'fertilize' )
		assert.equal( c.bias, BIAS.NOISY )
		assert.ok( Math.abs( c.meanError ) < 0.05 )
		assert.match( c.verdict, /missing from the context/ )

	} )

	it( 'calls a good model calibrated', () => {

		const led = new PredictionLedger()
		for ( let i = 0; i < 10; i++ ) led.record( {
			action : 'water',
			expected : 0.5,
			observed : 0.52,
		} )

		assert.equal( led.calibration( 'water' ).bias, BIAS.CALIBRATED )
		assert.deepEqual( led.faults(), [] )

	} )

	it( 'files miscalibration as a fault of the model, not of the plant', () => {

		const led = new PredictionLedger()
		for ( let i = 0; i < 10; i++ ) led.record( {
			action : 'water',
			expected : 0.9,
			observed : 0.1,
		} )

		const [ cue ] = led.cues()
		assert.equal( cue.claim, 'model_miscalibrated' )
		assert.equal( cue.source, 'prediction' )

	} )

	it( 'writes the forecast down before acting, and compares it after', async () => {

		// The whole point: `suggest()` produced an `expected` and `outcome()`
		// produced a `reward`, and until now nothing ever subtracted them.
		const learner = new PlantPersonalization( { actions : [ 'a' ] } )

		const choice = await learner.suggest( { happiness : 50 }, { explore : false } )
		assert.ok( Number.isFinite( choice.expected ) )

		const result = await learner.outcome( { happiness : 20 } )

		assert.ok( result.prediction )
		assert.equal( result.prediction.expected, Number( choice.expected.toFixed( 4 ) ) )
		assert.ok( Number.isFinite( result.prediction.error ) )
		assert.ok( result.calibration )

	} )

	it( 'surfaces calibration in the plant profile', async () => {

		const learner = new PlantPersonalization( { actions : [ 'a' ] } )
		for ( let i = 0; i < 8; i++ ) {

			await learner.suggest( { happiness : 50 }, { explore : false } )
			await learner.outcome( { happiness : 10 } )

		}

		const profile = learner.profile()
		assert.ok( profile.calibration )
		assert.equal( profile.calibration.known, true )

	} )

} )

// ── #1 · continuity and drift ───────────────────────────────────────────────

describe( 'continuity', () => {

	/** Feed a tracker a history, optionally degrading one site partway. */
	function run( { sites, degrade = () => 0.5, samples = 20 } ) {

		const t = new ContinuityTracker( {
			anchorAfter : 6,
			recent : 3,
		} )
		const t0 = Date.now() - 60 * DAY

		for ( let i = 0; i < samples; i++ ) {

			for ( const site of sites ) {

				t.push( fp( degrade( site, i ), i + 1 + site.length * 100 ), {
					site,
					at : t0 + i * 3 * DAY,
				} )

			}

		}

		return t

	}

	it( 'will not judge before an anchor exists', () => {

		const t = new ContinuityTracker( { anchorAfter : 10 } )
		t.push( fp( 0.5, 1 ), { site : 'stem' } )

		assert.equal( t.drift( 'stem' ).known, false )
		assert.equal( t.attribute().cause, 'unknown' )

	} )

	it( 'holds the anchor still while the rolling baseline would have followed', () => {

		// The frog-boiling case: every step is small, the total is not. A rolling
		// baseline tracks it to the end and never fires.
		const t = run( {
			sites : [ 'stem' ],
			degrade : ( _s, i ) => 0.5 + i * 0.6,
		} )

		const d = t.drift( 'stem' )
		assert.equal( d.known, true )
		assert.ok( d.distance > 0.1, `gradual change must accumulate, got ${d.distance}` )
		assert.ok( d.continuity < 1 )

	} )

	it( 'refuses to attribute drift from a single electrode', () => {

		const t = run( {
			sites : [ 'stem' ],
			degrade : ( _s, i ) => ( i < 10 ? 0.5 : 9 ),
		} )
		const a = t.attribute()

		// The honest answer. Over months, a forming callus and a reorganising
		// electrome are the same measurement from one site.
		assert.equal( a.cause, 'unattributable' )
		assert.equal( a.confidence, 0 )
		assert.match( a.why, /one electrode cannot tell/ )

	} )

	it( 'blames the electrode when only one site moves', () => {

		const t = run( {
			sites : [ 'stem', 'petiole' ],
			degrade : ( s, i ) => ( s === 'petiole' && i >= 10 ? 9 : 0.5 ),
		} )
		const a = t.attribute()

		assert.equal( a.cause, 'electrode' )
		assert.deepEqual( a.suspect, [ 'petiole' ] )
		assert.match( a.why, /the contact, not the physiology/ )

	} )

	it( 'credits the plant when every site moves together', () => {

		const t = run( {
			sites : [ 'stem', 'petiole' ],
			degrade : ( _s, i ) => ( i < 10 ? 0.5 : 9 ),
		} )
		const a = t.attribute()

		assert.equal( a.cause, 'physiology' )
		assert.ok( a.agreement >= 0.6 )
		assert.match( a.why, /do not fail in step/ )

	} )

	it( 'reports a stable plant as stable', () => {

		const t = run( { sites : [ 'stem', 'petiole' ] } )
		const a = t.attribute()

		assert.equal( a.cause, 'stable' )
		assert.equal( a.drifting, false )

	} )

	it( 'files electrode drift as a hardware claim, not a plant one', () => {

		const t = run( {
			sites : [ 'stem', 'petiole' ],
			degrade : ( s, i ) => ( s === 'petiole' && i >= 10 ? 9 : 0.5 ),
		} )

		const [ cue ] = t.cues()
		assert.equal( cue.claim, 'electrode_degraded' )

	} )

	it( 'demands a reason before erasing the drift record', () => {

		const t = run( { sites : [ 'stem' ] } )

		assert.throws( () => t.reanchor(), /needs a stated reason/ )

		const before = t.drift( 'stem' ).distance
		t.reanchor( 'repotted' )
		assert.ok( t.drift( 'stem' ).distance <= before )

	} )

	it( 'withholds a rate until enough time has passed to have one', () => {

		const t = new ContinuityTracker( {
			anchorAfter : 6,
			recent : 3,
			minDays : 30,
		} )
		for ( let i = 0; i < 12; i++ ) {

			t.push( fp( 0.5, i + 1 ), {
				site : 'stem',
				at : Date.now() - ( 12 - i ) * HOUR,
			} )

		}

		assert.equal( t.drift( 'stem' ).perDay, null )

	} )

} )

// ── #3 · inheritance that fades ─────────────────────────────────────────────

describe( 'inheritance decay', () => {

	const bundle = {
		manifest : {
			schemaVersion : 1,
			species : 'ficus lyrata',
			sourceHash : 'abc',
		},
		policies : [ {
			action : 'move_to_light',
			trials : 40,
			meanReward : 0.8,
			transferability : 0.6,
			band : 'strong',
			distinct : 4,
		} ],
		withheld : [],
	}

	const at = days => new Inheritance( bundle, {
		compatibility : {
			mean : 1,
			mismatches : [],
		},
		graftedAt : Date.now() - days * DAY,
	} )

	it( 'fades an untested prior with time alone', () => {

		// The gap this closes: a prior nobody ever put to the question used to keep
		// full weight forever, outranking policies the plant had actually confirmed.
		const fresh = at( 0 ).prior( 'move_to_light' )
		const old   = at( 120 ).prior( 'move_to_light' )

		assert.ok( old.weight < fresh.weight / 2 )
		assert.ok( old.decay.time < fresh.decay.time )

	} )

	it( 'halves on schedule', () => {

		const inh = at( 60 )
		assert.ok( Math.abs( inh.prior( 'move_to_light' ).decay.time - 0.5 ) < 0.01 )

	} )

	it( 'still lets local evidence do its own work', () => {

		const inh = at( 0 )
		const before = inh.prior( 'move_to_light' ).weight
		for ( let i = 0; i < 20; i++ ) inh.recordLocal( 'move_to_light', 0 )

		assert.ok( inh.prior( 'move_to_light' ).weight < before )
		assert.ok( inh.prior( 'move_to_light' ).decay.evidence < 1 )

	} )

	it( 'compounds both decays rather than picking one', () => {

		const both = at( 60 )
		for ( let i = 0; i < 10; i++ ) both.recordLocal( 'move_to_light', 0 )

		const p = both.prior( 'move_to_light' )
		assert.ok( Math.abs( p.weight - 0.6 * p.decay.evidence * p.decay.time ) < 0.002 )

	} )

} )

describe( 'selective migration', () => {

	async function grown( name ) {

		const plant = await createPlant( {
			name,
			species : 'Ficus lyrata',
			sensor : {
				driver : 'mock',
				dayNight : false,
			},
			ai : { provider : 'mock' },
		} )

		const r = rng( 5 )
		for ( let i = 0; i < 240; i++ ) {

			await plant.memory.addReading( {
				timestamp : Date.now() - ( 240 - i ) * 6 * HOUR,
				temperature : 22 + r() * 4,
				humidity : 55 + r() * 10,
				soil : 45 + r() * 12,
				light : 900 + r() * 200,
			} )

		}

		return plant

	}

	it( 'sends only the modules asked for', async () => {

		const plant = await grown( 'V' )
		const only = await plant.exportInheritance( { only : [ 'ranges' ] } )

		assert.deepEqual( only.modules, [ 'ranges' ] )
		assert.ok( Object.keys( only.ranges ).length > 0 )
		assert.equal( only.careCadence, null )
		assert.equal( only.rhythm, null )

		await plant.destroy()

	} )

	it( 'excludes what is named', async () => {

		const plant = await grown( 'V' )
		const b = await plant.exportInheritance( { except : [ 'ranges' ] } )

		assert.ok( !b.modules.includes( 'ranges' ) )
		assert.deepEqual( b.ranges, {} )

		await plant.destroy()

	} )

	it( 'throws on a misspelled module rather than silently sending nothing', async () => {

		const plant = await grown( 'V' )

		await assert.rejects(
			() => plant.exportInheritance( { only : [ 'rangos' ] } ),
			/Unknown inheritance module/,
		)

		await plant.destroy()

	} )

} )

// ── #8 · hysteresis ─────────────────────────────────────────────────────────

describe( 'response hysteresis', () => {

	/**
	 * Waterings, with the response optionally changing partway.
	 *
	 * @param {object} opts - `{ changeAt, fastTau, slowTau, drift }`.
	 */
	function wateringHistory( {
		occurrences = 12, changeAt = 6, tauBefore = 10, tauAfter = 10, warmAfter = false,
	} = {} ) {

		const readings = [], events = []

		for ( let w = 0; w < occurrences; w++ ) {

			const t0 = Date.now() - ( occurrences - w ) * 10 * DAY
			const tau = w >= changeAt ? tauAfter : tauBefore
			// Optionally shift the weather partway, to test the confound control.
			const temp = warmAfter && w >= changeAt ? 30 : 22

			events.push( {
				t : new Date( t0 ).toISOString(),
				type : 'water',
			} )

			for ( let h = -8; h <= 26; h += 2 ) {

				readings.push( {
					t : new Date( t0 + h * HOUR ).toISOString(),
					soil : h <= 0 ? 25 : 25 + 30 * ( 1 - Math.exp( -h / tau ) ),
					temperature : temp,
					humidity : 55,
					light : 900,
				} )

			}

		}

		readings.sort( ( a, b ) => new Date( a.t ) - new Date( b.t ) )
		return {
			readings,
			events,
		}

	}

	it( 'measures amplitude and latency of one response', () => {

		const { readings, events } = wateringHistory( { occurrences : 1 } )
		const p = responseProfile( readings, new Date( events[ 0 ].t ).getTime() )

		assert.ok( p )
		assert.ok( p.amplitude > 0 )
		assert.ok( p.latencyHours > 0 )
		assert.ok( p.context.temperature )

	} )

	it( 'returns null rather than guessing without a baseline', () => {

		assert.equal( responseProfile( [], Date.now() ), null )

	} )

	it( 'finds no hysteresis when nothing changed', () => {

		const { readings, events } = wateringHistory()
		const h = responseHistory( readings, events, 'water' )
		const r = hysteresis( h, events[ 6 ].t )

		assert.equal( r.known, true )
		assert.equal( r.changed, false )
		assert.match( r.verdict, /No hysteresis/ )

	} )

	it( 'detects a response that got faster', () => {

		// Priming: after the episode the plant takes up water noticeably sooner.
		const { readings, events } = wateringHistory( {
			tauBefore : 12,
			tauAfter : 3,
		} )
		const h = responseHistory( readings, events, 'water' )
		const r = hysteresis( h, events[ 6 ].t )

		assert.equal( r.changed, true )
		assert.match( r.direction, /faster|stronger/ )
		assert.ok( r.matched.situations >= 1 )

	} )

	it( 'refuses to conclude when the conditions changed too', () => {

		// The confound that makes this hard: the response differs, but so does the
		// weather it was measured in. That is not memory and must not be reported
		// as memory.
		const { readings, events } = wateringHistory( {
			tauBefore : 12,
			tauAfter : 3,
			warmAfter : true,
		} )
		const h = responseHistory( readings, events, 'water' )
		const r = hysteresis( h, events[ 6 ].t )

		assert.equal( r.known, false )
		assert.match( r.reason, /could just as easily be the difference in conditions/ )

	} )

	it( 'needs enough occurrences either side', () => {

		const { readings, events } = wateringHistory( { occurrences : 4 } )
		const h = responseHistory( readings, events, 'water' )
		const r = hysteresis( h, events[ 2 ].t )

		assert.equal( r.known, false )
		assert.match( r.reason, /comparable occurrences either side/ )

	} )

	it( 'names the confound it cannot exclude', () => {

		const { readings, events } = wateringHistory( {
			tauBefore : 12,
			tauAfter : 3,
		} )
		const r = hysteresis( responseHistory( readings, events, 'water' ), events[ 6 ].t )

		// Plant age cannot be separated from memory using readings alone, and
		// saying so is part of the result rather than a footnote.
		assert.match( r.caveat, /older and larger/ )

	} )

	it( 'produces a capped cue, given how few occurrences it rests on', () => {

		const { readings, events } = wateringHistory( {
			tauBefore : 12,
			tauAfter : 3,
		} )
		const r = hysteresis( responseHistory( readings, events, 'water' ), events[ 6 ].t )
		const [ cue ] = hysteresisCues( r, 'watering' )

		assert.equal( cue.claim, 'response_changed' )
		assert.ok( cue.strength <= 0.5 )

	} )

} )

// ── Knowledge transfer ──────────────────────────────────────────────────────

describe( 'knowledge transfer', () => {

	async function aged( bus, name, days ) {

		const plant = await createPlant( {
			name,
			species : 'Ficus lyrata',
			sensor : {
				driver : 'mock',
				dayNight : false,
			},
			ai : { provider : 'mock' },
		} )

		const r = rng( 7 )
		for ( let i = 0; i < days * 4; i++ ) {

			await plant.memory.addReading( {
				timestamp : Date.now() - ( days * 4 - i ) * 6 * HOUR,
				temperature : 22 + r() * 3,
				humidity : 55 + r() * 8,
				soil : 45 + r() * 10,
				light : 900 + r() * 150,
			} )

		}

		await plant.joinColony( { transport : bus.endpoint( name.toLowerCase() ) } )
		return plant

	}

	it( 'grades experience by time in place, not by species', async () => {

		const bus = new LoopbackBus()
		const old = await aged( bus, 'Elder', 90 )
		const young = await aged( bus, 'Newcomer', 1 )

		assert.equal( experienceOf( old ).level, 'established' )
		assert.equal( experienceOf( young ).level, 'newcomer' )
		assert.equal( isNovice( experienceOf( young ) ).novice, true )
		assert.equal( isNovice( experienceOf( old ) ).novice, false )

		await Promise.all( [ old, young ].map( p => p.destroy() ) )

	} )

	it( 'will not let a newcomer teach', () => {

		const newcomer = {
			level : 'newcomer',
			score : 0.1,
			days : 1,
		}
		const r = canTeach( newcomer, {
			score : 0.05,
			days : 0,
		} )

		assert.equal( r.qualified, false )
		assert.match( r.why, /nothing to pass on/ )

	} )

	it( 'will not teach a peer with comparable experience', () => {

		const r = canTeach( {
			level : 'established',
			score : 0.7,
			days : 90,
		}, {
			score : 0.65,
			days : 80,
		} )

		assert.equal( r.qualified, false )
		assert.match( r.why, /no asymmetry/ )

	} )

	it( 'spots the newcomer in the colony', async () => {

		const bus = new LoopbackBus()
		const old = await aged( bus, 'Elder', 90 )
		const young = await aged( bus, 'Newcomer', 1 )

		const found = await old.colony.newcomers()

		assert.deepEqual( found.map( f => f.peer ), [ 'newcomer' ] )
		assert.match( found[ 0 ].why, /not been here long enough/ )

		await Promise.all( [ old, young ].map( p => p.destroy() ) )

	} )

	it( 'teaches the room, not its own pot', async () => {

		const bus = new LoopbackBus()
		const old = await aged( bus, 'Elder', 90 )
		const young = await aged( bus, 'Newcomer', 1 )

		const taught = await old.colony.teach( 'newcomer' )

		assert.equal( taught.taught, true )
		// Learned action policies are about the individual and its pot; what
		// transfers between neighbours is what the room does.
		assert.ok( !taught.lesson.lesson.modules.includes( 'policies' ) )
		assert.ok( taught.lesson.lesson.modules.includes( 'ranges' ) )

		await Promise.all( [ old, young ].map( p => p.destroy() ) )

	} )

	it( 'merges several teachers into one lesson, not several', async () => {

		const bus = new LoopbackBus()
		const a = await aged( bus, 'First', 90 )
		const b = await aged( bus, 'Other', 80 )
		const c = await aged( bus, 'Third', 70 )
		const young = await aged( bus, 'Newcomer', 1 )

		const learned = await young.colony.learnFromColony()

		assert.equal( learned.learned, true )
		assert.equal( learned.teachers, 3 )
		assert.equal( learned.merged.manifest.teachers, 3 )
		// Three neighbours in one room are three views of that room.
		assert.match( learned.merged.lesson.why, /not independent witnesses/ )

		await Promise.all( [ a, b, c, young ].map( p => p.destroy() ) )

	} )

	it( 'says so when nobody in the colony knows the room either', async () => {

		const bus = new LoopbackBus()
		const a = await aged( bus, 'First', 1 )
		const b = await aged( bus, 'Other', 1 )

		const learned = await b.colony.learnFromColony()

		assert.equal( learned.learned, false )
		assert.match( learned.why, /No neighbour here has enough local experience/ )

		await Promise.all( [ a, b ].map( p => p.destroy() ) )

	} )

	it( 'refuses to merge comfort ranges across species', () => {

		// A fern's comfortable is a cactus's drowning.
		assert.throws( () => mergeLessons( [
			{
				manifest : { species : 'a' },
				ranges : { soil : {
					min : 20,
					max : 40,
				} },
			},
			{
				manifest : { species : 'b' },
				ranges : { soil : {
					min : 50,
					max : 70,
				} },
			},
		] ), /Cannot merge comfort ranges/ )

	} )

	it( 'merges what the room does across any species at all', () => {

		// The half that was always transferable. Refusing the whole exchange
		// because the species differ throws it away.
		const merged = mergeLessons( [
			{
				manifest : { species : 'fern' },
				ranges : {},
				room : { conditions : { temperature : {
					p10 : 18,
					median : 21,
					p90 : 24,
					n : 100,
				} } },
			},
			{
				manifest : { species : 'pothos' },
				ranges : {},
				room : { conditions : { temperature : {
					p10 : 19,
					median : 22,
					p90 : 25,
					n : 100,
				} } },
			},
		] )

		assert.ok( merged.room.conditions.temperature )
		assert.equal( merged.lesson.biological, 0 )
		assert.equal( merged.lesson.roomOnly, 2 )
		assert.match( merged.lesson.why, /passing on the room only/ )

	} )

	it( 'leaves the newcomer free to outgrow the lesson', async () => {

		const bus = new LoopbackBus()
		const old = await aged( bus, 'Elder', 90 )
		const young = await aged( bus, 'Newcomer', 1 )

		await young.colony.learnFromColony()

		// The lesson arrives as an inheritance, which means every rule that
		// governs an inheritance governs it: advisory, weighted, and fading.
		assert.ok( young.inheritance )
		assert.ok( young.inheritance.report().compatibility )

		await Promise.all( [ old, young ].map( p => p.destroy() ) )

	} )

} )

describe( 'what one plant may teach another', () => {

	const HOUR_ = 3600_000

	async function member( bus, name, species, days, soil = 40 ) {

		const { createPlant : make } = await import( '../src/index.js' )
		const plant = await make( {
			name,
			species,
			sensor : {
				driver : 'mock',
				dayNight : false,
			},
			ai : { provider : 'mock' },
		} )

		const r = rng( 7 )
		for ( let i = 0; i < days * 4; i++ ) {

			await plant.memory.addReading( {
				timestamp : Date.now() - ( days * 4 - i ) * 6 * HOUR_,
				temperature : 21 + r() * 3,
				humidity : 62 + r() * 6,
				soil : soil + r() * 8,
				light : 650 + r() * 120,
			} )

		}

		await plant.joinColony( { transport : bus.endpoint( name.toLowerCase() ) } )
		return plant

	}

	it( 'grades what may pass by how much the two have in common', async () => {

		const { kinship, KINSHIP } = await import( '../src/migration/teaching.js' )

		const pothos = {
			species : 'Epipremnum aureum',
			archetype : 'tropical',
		}

		// Same plant: everything, including what resolved what.
		const same = kinship( pothos, pothos )
		assert.equal( same.kinship, KINSHIP.SPECIES )
		assert.ok( same.teaches.includes( 'resolutions' ) )

		// Same strategy: the comfort bands are a fair guess, the watering rhythm
		// belongs to the species.
		const cousin = kinship( {
			species : 'Monstera deliciosa',
			archetype : 'tropical',
		}, pothos )
		assert.equal( cousin.kinship, KINSHIP.ARCHETYPE )
		assert.ok( cousin.teaches.includes( 'ranges' ) )
		assert.ok( !cousin.teaches.includes( 'cadence' ) )

		// Nothing biological in common — but they stand in the same room.
		const stranger = kinship( {
			species : 'Nephrolepis',
			archetype : 'hygrophyte',
		}, pothos )
		assert.equal( stranger.kinship, KINSHIP.NEIGHBOUR )
		assert.deepEqual( stranger.teaches, [ 'room' ] )

	} )

	it( 'keeps substrate out of what it calls the room', async () => {

		const { roomKnowledge } = await import( '../src/migration/teaching.js' )
		const { LoopbackBus } = await import( '../src/colony/index.js' )

		const plant = await member( new LoopbackBus(), 'Room', 'Epipremnum aureum', 60 )
		const room = roomKnowledge( plant )

		// 40% moisture in the teacher's bark is a different world from 40% in the
		// learner's peat. It looks environmental and is a property of the pot.
		assert.ok( room.conditions.temperature )
		assert.ok( room.conditions.humidity )
		assert.equal( room.conditions.soil, undefined )
		assert.match( room.why, /substrate is a property of the pot/ )

		await plant.destroy()

	} )

	it( 'lets a fern teach a pothos the room and nothing else', async () => {

		const { LoopbackBus } = await import( '../src/colony/index.js' )
		const bus = new LoopbackBus()

		const fern = await member( bus, 'Fern', 'Nephrolepis exaltata', 110, 60 )
		const newcomer = await member( bus, 'Newcomer', 'Epipremnum aureum', 1 )

		const learned = await newcomer.colony.learnFromColony()

		assert.equal( learned.learned, true )
		assert.equal( learned.merged.lesson.biological, 0 )
		assert.equal( learned.merged.lesson.roomOnly, 1 )
		// The half that was always transferable, which refusing on species threw away.
		assert.ok( learned.merged.room.conditions.temperature )
		assert.deepEqual( learned.merged.ranges, {} )

		await Promise.all( [ fern, newcomer ].map( p => p.destroy() ) )

	} )

	it( 'takes biology from its own kind and the room from everybody', async () => {

		const { LoopbackBus } = await import( '../src/colony/index.js' )
		const bus = new LoopbackBus()

		const elder = await member( bus, 'PothosElder', 'Epipremnum aureum', 120, 38 )
		const cousin = await member( bus, 'Monstera', 'Monstera deliciosa', 100, 42 )
		const stranger = await member( bus, 'Fern2', 'Nephrolepis exaltata', 110, 60 )
		const newcomer = await member( bus, 'PothosNew', 'Epipremnum aureum', 1 )

		const learned = await newcomer.colony.learnFromColony()

		assert.equal( learned.teachers, 3 )
		assert.equal( learned.merged.lesson.biological, 2 )
		assert.equal( learned.merged.lesson.roomOnly, 1 )

		// The fern's soil never reaches the ranges, and it would have dragged them
		// badly: it sits at 60% where the aroids sit near 40%.
		assert.ok( learned.merged.ranges.soil.max < 50 )
		assert.equal( learned.merged.ranges.soil.sameSpecies, 1 )

		await Promise.all( [ elder, cousin, stranger, newcomer ].map( p => p.destroy() ) )

	} )

	it( 'refuses to average a fern and a cactus', async () => {

		const { mergeLessons : merge } = await import( '../src/migration/teaching.js' )

		assert.throws( () => merge( [
			{
				manifest : { species : 'fern' },
				lesson : { archetype : 'hygrophyte' },
				ranges : { soil : {
					min : 50,
					max : 70,
				} },
			},
			{
				manifest : { species : 'cactus' },
				lesson : { archetype : 'xerophyte' },
				ranges : { soil : {
					min : 5,
					max : 20,
				} },
			},
		] ), /the average describes neither/ )

	} )

} )
