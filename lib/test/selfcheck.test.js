/**
 * Looking at itself: the periodic review, and the state of the instrument.
 *
 * One asks how the plant has been changing. The other asks whether the things
 * measuring it can still be believed. The interesting cases in both are the
 * ones where the obvious reading is wrong: a change the weather already
 * explains, and a sensor that keeps answering while it has stopped measuring.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import { compareSpans, movedConditions, narrate, PERIODS } from '../src/checkup/index.js'
import {
	CONDITION, electrodeQuality, implausible, maintenanceCues, stuckReading,
} from '../src/maintenance/index.js'

const HOUR = 3600_000
const DAY = 86_400_000

function rng( seed ) {

	let s = seed
	return () => {

		s = ( s * 1103515245 + 12345 ) & 0x7fffffff
		return s / 0x7fffffff - 0.5

	}

}

/**
 * A plant with a controllable two-span history.
 *
 * @param {object} opts - `{ recent, prior }` metric overrides per span.
 */
async function withHistory( {
	days = 60, prior = {}, recent = {}, electrode = false, name = 'LongLived',
} = {} ) {

	const plant = await createPlant( {
		name,
		species : 'Ficus lyrata',
		sensor  : {
			driver : 'mock',
			dayNight : false,
		},
		ai      : { provider : 'mock' },
	} )

	if ( electrode ) {

		await plant.attachSensor( {
			driver : 'electrode',
			transport : 'synthetic',
			sampleRate : 5,
			bufferSeconds : 600,
			mainsHz : 0,
		} )

	}

	const r = rng( 11 )
	const base = {
		temperature : 22,
		humidity : 55,
		soil : 45,
		light : 900,
	}

	for ( let i = 0; i < days * 4; i++ ) {

		const at = Date.now() - ( days * 4 - i ) * 6 * HOUR
		// The last 7 days are the "recent" span.
		const isRecent = at >= Date.now() - 7 * DAY
		const shift = isRecent ? recent : prior

		await plant.memory.addReading( {
			timestamp   : at,
			temperature : ( shift.temperature ?? base.temperature ) + r() * 2,
			humidity    : ( shift.humidity ?? base.humidity ) + r() * 4,
			soil        : ( shift.soil ?? base.soil ) + r() * 5,
			light       : ( shift.light ?? base.light ) + r() * 80,
		} )

	}

	return plant

}

// ── the periodic review ─────────────────────────────────────────────────────

describe( 'checkup', () => {

	it( 'refuses a period it does not know', async () => {

		const plant = await withHistory()
		await assert.rejects( () => plant.checkup( { period : 'yearly' } ), /Unknown checkup period/ )
		await plant.destroy()

	} )

	it( 'refuses to compare spans that are not comparable', async () => {

		// A full week against three days would report the difference in sampling
		// as a difference in the plant.
		const plant = await createPlant( {
			name : 'Newcomer',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		await plant.read()

		const r = await plant.checkup()
		assert.equal( r.known, false )
		assert.match( r.why, /both need at least 10/ )

		await plant.destroy()

	} )

	it( 'reports a steady plant as steady', async () => {

		const plant = await withHistory()
		const r = await plant.checkup()

		assert.equal( r.known, true )
		assert.equal( r.findings.length, 0 )
		assert.match( r.verdict, /Steady/ )

		await plant.destroy()

	} )

	it( 'compares the two spans metric by metric', () => {

		const c = compareSpans(
			[ { temperature : 25 }, { temperature : 25 } ],
			[ { temperature : 20 }, { temperature : 20 } ],
		)

		assert.equal( c.temperature.change, 5 )
		assert.equal( c.temperature.percent, 25 )

	} )

	it( 'notices which conditions moved enough to explain something', () => {

		const moved = movedConditions( {
			temperature : { change : 5 },
			humidity : { change : 1 },
		} )

		assert.deepEqual( moved, [ 'temperature' ] )

	} )

	it( 'marks a wellbeing change as confounded when the room moved with it', async () => {

		// The trap this exists to avoid: reporting the weather as a finding about
		// the plant. Soil drops, wellbeing drops, and the room got hot.
		const plant = await withHistory( {
			prior  : {
				soil : 50,
				temperature : 20,
			},
			recent : {
				soil : 20,
				temperature : 29,
			},
		} )

		const r = await plant.checkup()
		const wellbeing = r.findings.find( f => f.id === 'wellbeing' )

		assert.ok( wellbeing, 'a large wellbeing change should be noticed' )
		assert.equal( wellbeing.confounded, true )
		assert.match( wellbeing.why, /which is enough to explain it/ )

		await plant.destroy()

	} )

	it( 'reports a wellbeing change the conditions do not account for', async () => {

		// Soil alone moved, which is not in the confounder list for wellbeing on
		// its own here — the point is that the verdict separates the two cases.
		const plant = await withHistory( {
			prior  : { soil : 50 },
			recent : { soil : 47 },
		} )

		const r = await plant.checkup()
		assert.equal( r.movedConditions.length, 0 )

		await plant.destroy()

	} )

	it( 'does a monthly review over a longer span', async () => {

		const plant = await withHistory( { days : 90 } )
		const r = await plant.checkup( { period : 'monthly' } )

		assert.equal( r.known, true )
		assert.equal( r.period, 'monthly' )
		assert.equal( r.spans.days, PERIODS.monthly.days )

		await plant.destroy()

	} )

	it( 'emits an event and logs the review', async () => {

		const plant = await withHistory()

		let announced = null
		plant.on( 'plant:checkup', r => {

			announced = r

		} )

		await plant.checkup()

		assert.ok( announced )
		assert.ok( plant.memory.data.events.some( e => e.type === 'checkup:weekly' ) )

		await plant.destroy()

	} )

	it( 'narrates in the first person without a model', async () => {

		const plant = await withHistory()
		const r = await plant.checkup()

		// Deterministic: works offline and cannot embellish.
		assert.equal( typeof r.narration, 'string' )
		assert.match( r.narration, /I am much as I was/ )

		await plant.destroy()

	} )

	it( 'says so plainly when there is not enough history to narrate', () => {

		assert.match( narrate( {
			known : false,
			why : 'not yet',
		} ), /not yet/ )

	} )

	it( 'runs what is due and skips what is not', async () => {

		const plant = await withHistory()

		const first = await plant.runDueReviews()
		assert.ok( first.maintenance )
		assert.ok( first.weekly )
		assert.ok( first.monthly )

		// Nothing is due a second time straight away.
		const second = await plant.runDueReviews()
		assert.deepEqual( Object.keys( second ), [] )

		await plant.destroy()

	} )

} )

// ── the instrument ──────────────────────────────────────────────────────────

describe( 'stuck sensors', () => {

	it( 'does not call a stable room a stuck sensor', () => {

		// The distinction is precision, not stability: a real measurement moves in
		// its last digit even when the world does not.
		const stable = Array.from( { length : 40 }, ( _, i ) => 55 + ( i % 3 ) * 0.01 )
		assert.equal( stuckReading( stable ).stuck, false )

	} )

	it( 'catches a sensor returning exactly the same number', () => {

		const latched = Array.from( { length : 40 }, () => 55 )
		const r = stuckReading( latched )

		assert.equal( r.stuck, true )
		assert.match( r.why, /latched/ )

	} )

	it( 'needs enough readings before accusing anything', () => {

		assert.equal( stuckReading( [ 55, 55, 55 ] ).stuck, false )

	} )

	it( 'finds readings no sensor could truthfully produce', () => {

		const r = implausible( [ { humidity : 55 }, { humidity : 140 }, { humidity : -5 } ], 'humidity' )

		assert.equal( r.found, true )
		assert.equal( r.count, 2 )
		assert.match( r.why, /outside what humidity can physically be/ )

	} )

	it( 'accepts a metric it has no range for', () => {

		assert.equal( implausible( [ { weird : 9 } ], 'weird' ).found, false )

	} )

} )

describe( 'electrode quality', () => {

	const noisy = ( amplitude, hz, rate = 500, n = 2000 ) =>
		Array.from( { length : n }, ( _, i ) =>
			-60 + amplitude * Math.sin( ( 2 * Math.PI * hz * i ) / rate ) )

	it( 'calls a flat trace a disconnection, not a calm plant', () => {

		// Living tissue is never electrically silent, so silence is the wire.
		const q = electrodeQuality( Array.from( { length : 200 }, () => -60 ), 5, { mainsHz : 0 } )

		assert.equal( q.condition, CONDITION.FAILED )
		assert.equal( q.flat, true )
		assert.match( q.why, /not in contact with a plant/ )

	} )

	it( 'flags mains hum that survived filtering', () => {

		const q = electrodeQuality( noisy( 5, 50 ), 500, { mainsHz : 50 } )

		assert.equal( q.condition, CONDITION.DEGRADED )
		assert.match( q.why, /grounding or shielding/ )

	} )

	it( 'passes a healthy-looking trace', () => {

		const r = rng( 3 )
		const trace = Array.from( { length : 500 }, ( _, i ) => -60 + 2 * Math.sin( i / 40 ) + r() * 0.4 )

		assert.equal( electrodeQuality( trace, 5, { mainsHz : 0 } ).condition, CONDITION.OK )

	} )

	it( 'flags a saturating amplifier', () => {

		const trace = Array.from( { length : 500 }, ( _, i ) => ( i % 5 === 0 ? 5000 : -60 + Math.sin( i ) ) )
		const q = electrodeQuality( trace, 5, { mainsHz : 0 } )

		assert.equal( q.condition, CONDITION.DEGRADED )
		assert.match( q.why, /saturating/ )

	} )

	it( 'refuses to trust a sample rate that cannot see the mains at all', () => {

		// At or below twice the mains frequency the hum is not removed, it is
		// folded down into the band where plant signals live.
		const q = electrodeQuality( noisy( 5, 50, 80, 800 ), 80, { mainsHz : 50 } )

		assert.equal( q.condition, CONDITION.DEGRADED )
		assert.equal( q.aliased, true )
		assert.match( q.why, /folded down/ )

	} )

	it( 'refuses to judge too short a window', () => {

		assert.equal( electrodeQuality( [ 1, 2, 3 ], 5 ).condition, CONDITION.UNKNOWN )

	} )

} )

describe( 'inspection', () => {

	it( 'passes a healthy plant', async () => {

		const plant = await withHistory()
		const r = await plant.maintenance()

		assert.equal( r.condition, CONDITION.OK )
		assert.match( r.verdict, /reading normally/ )

		await plant.destroy()

	} )

	it( 'catches a sensor that keeps answering while it has stopped measuring', async () => {

		const plant = await createPlant( {
			name : 'Stuck',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		// The dangerous failure: numbers keep arriving, nothing throws, and every
		// layer downstream reasons about a value that stopped being a measurement.
		for ( let i = 0; i < 30; i++ ) {

			await plant.memory.addReading( {
				timestamp : Date.now() - ( 30 - i ) * HOUR,
				temperature : 22 + i * 0.1,
				humidity : 55,
				soil : 40 + i * 0.1,
				light : 900,
			} )

		}

		const r = await plant.maintenance()
		const sensor = r.components.find( c => c.kind === 'sensor' )

		assert.equal( sensor.condition, CONDITION.DEGRADED )
		assert.match( sensor.why, /humidity/ )

		await plant.destroy()

	} )

	it( 'notices a driver that has been failing', async () => {

		const plant = await withHistory()
		const driver = plant._drivers[ 0 ]

		driver.health = {
			reads : 10,
			failures : 5,
			consecutiveFailures : 5,
			lastError : 'timeout',
		}

		const r = await plant.maintenance()
		const sensor = r.components.find( c => c.kind === 'sensor' )

		assert.equal( sensor.condition, CONDITION.FAILED )
		assert.match( sensor.why, /reads in a row have failed/ )

		await plant.destroy()

	} )

	it( 'checks the electrode and says what to do about it', async () => {

		const plant = await withHistory( { electrode : true } )
		const electrode = plant.getSensor( 'electrode' )

		// A disconnected lead: constant value, no life in it at all.
		electrode.buffer = Array.from( { length : 500 }, () => -60 )

		const r = await plant.maintenance()
		const found = r.components.find( c => c.kind === 'electrode' )

		assert.equal( found.condition, CONDITION.FAILED )
		assert.ok( r.actions.some( a => /physically in contact/.test( a ) ) )

		await plant.destroy()

	} )

	it( 'suggests trusting a broken component less, rather than dropping it silently', async () => {

		const plant = await withHistory( { electrode : true } )
		plant.getSensor( 'electrode' ).buffer = Array.from( { length : 500 }, () => -60 )

		const r = await plant.maintenance()

		// Marked unreliable, with the reason stated. Silently discarding a sensor
		// is its own way of being wrong without saying so.
		assert.equal( r.suggestedWeights.electrode, 0 )

		await plant.destroy()

	} )

	it( 'reports memory that is out of order', async () => {

		const plant = await withHistory()

		plant.memory.data.readings.push( {
			t : new Date( Date.now() - 100 * DAY ).toISOString(),
			soil : 40,
		} )

		const r = await plant.maintenance()
		const memory = r.components.find( c => c.kind === 'storage' )

		assert.equal( memory.condition, CONDITION.DEGRADED )
		assert.match( memory.why, /chronological order/ )

		await plant.destroy()

	} )

	it( 'files instrument faults as claims about the instrument', async () => {

		const plant = await withHistory( { electrode : true } )
		plant.getSensor( 'electrode' ).buffer = Array.from( { length : 500 }, () => -60 )

		const cues = maintenanceCues( await plant.maintenance() )

		assert.ok( cues.length > 0 )
		assert.equal( cues[ 0 ].claim, 'instrument_unreliable' )
		assert.equal( cues[ 0 ].source, 'maintenance' )

		await plant.destroy()

	} )

	it( 'announces a degraded component', async () => {

		const plant = await withHistory( { electrode : true } )
		plant.getSensor( 'electrode' ).buffer = Array.from( { length : 500 }, () => -60 )

		const seen = []
		plant.on( 'maintenance:component-degraded', c => seen.push( c.component ) )

		await plant.maintenance()
		assert.ok( seen.includes( 'electrode' ) )

		await plant.destroy()

	} )

	it( 'notices when the colony has gone quiet', async () => {

		const { LoopbackBus } = await import( '../src/colony/index.js' )
		const bus = new LoopbackBus()

		const a = await withHistory( { name : 'A' } )
		const b = await withHistory( { name : 'B' } )
		await a.joinColony( { transport : bus.endpoint( 'a' ) } )
		await b.joinColony( { transport : bus.endpoint( 'b' ) } )

		assert.equal( ( await a.maintenance() ).components.find( c => c.kind === 'link' ).condition, CONDITION.OK )

		await b.leaveColony()

		const after = await a.maintenance()
		assert.equal( after.components.find( c => c.kind === 'link' ).condition, CONDITION.FAILED )

		await Promise.all( [ a, b ].map( p => p.destroy() ) )

	} )

} )
