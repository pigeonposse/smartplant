/**
 * Moving a plant into a bigger pot, and noticing it needs one.
 *
 * The two halves of the same thing: an index that says the container is filling
 * up without ever having seen a root, and a mode where the person says how many
 * litres and the system does the rest.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import {
	dryingRate, ROOT_SPACE, rootSpace, wateringInterval,
} from '../src/archetypes/rootspace.js'
import {
	assess, MAX_SETTLING_DAYS, MIN_SETTLING_DAYS, PHASE, RESETS, start,
} from '../src/archetypes/transplant.js'

const HOUR = 3600_000
const DAY = 86_400_000

/** A plant that has been in one pot, drying at a given rate. */
const grown = async ( { days = 200, earlyRate = 2, lateRate = 2, waterEvery = 5 } = {} ) => {

	const plant = await createPlant( {
		name : 'Potted',
		species : 'Ficus lyrata',
		sensor : { driver : 'mock' },
		ai : { provider : 'mock' },
		pot : {
			litres : 2,
			since : new Date( Date.now() - days * DAY ).toISOString(),
		},
	} )

	const start_ = Date.now() - days * DAY
	let soil = 60

	for ( let h = 0; h < days * 24; h += 6 ) {

		const at = start_ + h * HOUR
		const late = h > days * 24 * 0.25
		const rate = late ? lateRate : earlyRate

		soil -= rate / 4

		if ( soil < 20 ) {

			soil = 60
			await plant.memory.addEvent( 'water', { at : new Date( at ).toISOString() } )

		}

		await plant.memory.addReading( {
			timestamp : at,
			soil,
			temperature : 22,
			humidity : 55,
			light : 900,
		} )

	}

	return plant

}

describe( 'it does not see the roots, and says so', () => {

	it( 'refuses without a pot size, which nobody can measure for it', async () => {

		const plant = await createPlant( {
			name : 'Potless',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		const r = plant.rootSpace()

		assert.equal( r.index, ROOT_SPACE.UNKNOWN )
		assert.match( r.why, /the one thing here nobody can measure for you/ )

		await plant.destroy()

	} )

	it( 'never acts, whatever it finds', async () => {

		const plant = await grown( { earlyRate : 2, lateRate : 5 } )
		const r = plant.rootSpace()

		// Repotting is a physical act with real risk and an afternoon of
		// somebody's time, and the evidence here is indirect by construction.
		assert.equal( r.acts, false )

		await plant.destroy()

	} )

	it( 'reads a pot filling up from the plant drying faster than it used to', async () => {

		const plant = await grown( {
			earlyRate : 1.5,
			lateRate : 4,
		} )
		const r = plant.rootSpace()

		assert.ok( [ ROOT_SPACE.LOW, ROOT_SPACE.MEDIUM ].includes( r.index ) )
		assert.ok( r.evidence.some( e => e.signal === 'drying-faster' || e.signal === 'watered-sooner' ) )

		await plant.destroy()

	} )

	it( 'leaves a plant that has not changed alone', async () => {

		const plant = await grown( {
			earlyRate : 2,
			lateRate : 2,
		} )
		const r = plant.rootSpace()

		assert.equal( r.index, ROOT_SPACE.HIGH )
		assert.match( r.why, /nothing about how it behaves has changed/ )

		await plant.destroy()

	} )

	it( 'treats one signal as a hot week rather than a finding', () => {

		// The rule that keeps this from being an alarm generator: a single
		// signal has a dozen ordinary explanations.
		const one = {
			config : { pot : {
				litres : 2,
				since : new Date( Date.now() - 200 * DAY ).toISOString(),
			} },
			memory : { data : {
				readings : [],
				events : [],
			} },
			archetype : { id : 'tropical' },
		}

		const r = rootSpace( one )
		assert.equal( r.acts, false )

	} )

	it( 'discounts a degraded probe rather than letting it push the index', async () => {

		const plant = await grown( {
			earlyRate : 1.5,
			lateRate : 4,
		} )
		plant.maintenance = () => ( { condition : 'degraded' } )

		const r = plant.rootSpace()

		// A failing probe drifts, and drift in the right direction looks exactly
		// like a pot filling up.
		assert.ok( r.evidence.some( e => e.signal === 'instrument-discounted' ) )

		await plant.destroy()

	} )

	it( 'measures a drying rate over runs, not over everything', () => {

		const rows = []
		let soil = 60

		for ( let i = 0; i < 60; i++ ) {

			soil -= 3
			if ( soil < 25 ) soil = 60
			rows.push( {
				t : new Date( Date.now() - ( 60 - i ) * 12 * HOUR ).toISOString(),
				soil,
			} )

		}

		const r = dryingRate( rows )
		assert.equal( r.known, true )
		assert.ok( r.perDay > 0 )

	} )

	it( 'needs three waterings before an interval means anything', () => {

		assert.equal( wateringInterval( [ {
			type : 'water',
			at : new Date().toISOString(),
		} ] ).known, false )

	} )

} )

describe( 'the person says the litres, the system does the rest', () => {

	it( 'asks for one thing and refuses without it', () => {

		const r = start( {}, {} )

		assert.equal( r.started, false )
		assert.match( r.why, /every watering figure, every drying expectation/ )

	} )

	it( 'keeps what is about the plant and resets what is about the pot', () => {

		const keeps = Object.entries( RESETS ).filter( ( [ , v ] ) => !v.resets ).map( ( [ k ] ) => k )
		const resets = Object.entries( RESETS ).filter( ( [ , v ] ) => v.resets ).map( ( [ k ] ) => k )

		// Twelve overrides is months, and a repotting does not invalidate one.
		assert.ok( keeps.includes( 'calibration' ) )
		assert.ok( keeps.includes( 'resolutions' ) )
		assert.ok( keeps.includes( 'identity' ) )

		assert.ok( resets.includes( 'soilBaseline' ) )
		assert.ok( resets.includes( 'wateringDose' ) )
		assert.match( RESETS.soilBaseline.why, /describes a pot that no longer exists/ )

	} )

	it( 'rescales the watering and clears the soil band', async () => {

		const plant = await createPlant( {
			name : 'Moved',
			species : 'Monstera deliciosa',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
			pot : { litres : 1.2 },
		} )
		await plant.read()

		const before = plant.wateringPlan().ml
		await plant.transplant( { volumeL : 5 } )
		const after = plant.wateringPlan().ml

		assert.ok( after > before * 3 )
		assert.equal( plant.ranges.soil, undefined )

		await plant.destroy()

	} )

	it( 'suspends the root-space estimate while it settles', async () => {

		const plant = await grown( { earlyRate : 1.5, lateRate : 4 } )
		await plant.transplant( { volumeL : 5 } )

		const r = plant.rootSpace()

		assert.equal( r.settling, true )
		assert.match( r.why, /the mistake this whole idea exists to avoid/ )

		await plant.destroy()

	} )

	it( 'holds off elective things while it settles', async () => {

		const plant = await createPlant( {
			name : 'Settling',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
			pot : { litres : 1 },
		} )
		await plant.read()
		await plant.transplant( { volumeL : 4 } )

		const probe = plant.mayI( 'probe' )
		assert.equal( probe.allowed, false )
		assert.match( probe.why, /a measurement taken now would be measuring the move/ )

		// Care is still care. A settling plant still gets watered.
		assert.equal( plant.mayI( 'water' ).allowed, true )

		await plant.destroy()

	} )

	it( 'decides on the readings rather than the calendar', () => {

		const episode = {
			phase : PHASE.SETTLING,
			at : Date.now() - 2 * DAY,
			boundary : Date.now() - 2 * DAY,
			volumeL : 5,
		}

		const early = assess( { memory : { data : { readings : [] } } }, episode )
		assert.equal( early.settled, false )
		assert.match( early.why, /Nothing is decided before day/ )

	} )

	it( 'closes when the pot has found its rhythm', async () => {

		const plant = await createPlant( {
			name : 'Calm',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
			pot : { litres : 1 },
		} )
		await plant.transplant( { volumeL : 5 } )

		// The move was eight days ago, not this instant — otherwise every reading
		// below sits before the boundary and none of them counts.
		const at = Date.now() - 8 * DAY
		plant._transplant.at = at
		plant._transplant.boundary = at

		// A wild first half and a calm second: exactly what settling looks like.

		for ( let i = 0; i < 60; i++ ) {

			await plant.memory.addReading( {
				timestamp : at + i * 3 * HOUR,
				soil : i < 30 ? 40 + ( i % 2 ? 25 : -25 ) : 45 + ( i % 3 ),
				temperature : 22,
				humidity : 55,
				light : 900,
			} )

		}

		const status = plant.transplantStatus()

		assert.equal( status.phase, PHASE.SETTLED )
		assert.equal( status.baselines, 'adopted' )
		assert.match( status.why, /found its rhythm/ )

		await plant.destroy()

	} )

	it( 'gives up waiting rather than staying cautious forever', () => {

		const episode = {
			phase : PHASE.SETTLING,
			at : Date.now() - ( MAX_SETTLING_DAYS + 2 ) * DAY,
			boundary : Date.now() - ( MAX_SETTLING_DAYS + 2 ) * DAY,
			volumeL : 5,
		}

		const rows = Array.from( { length : 60 }, ( _, i ) => ( {
			t : new Date( episode.at + i * 6 * HOUR ).toISOString(),
			soil : 40 + ( i % 2 ? 25 : -25 ),
		} ) )

		const r = assess( { memory : { data : { readings : rows } } }, episode )

		assert.equal( r.settled, true )
		assert.match( r.why, /a reason to keep a transplant open forever/ )

	} )

	it( 'can be closed by hand', async () => {

		const plant = await createPlant( {
			name : 'Forced',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
			pot : { litres : 1 },
		} )
		await plant.transplant( { volumeL : 5 } )

		const r = plant.settleTransplant()
		assert.equal( r.settled, true )
		assert.match( r.why, /may know something they do not/ )

		await plant.destroy()

	} )

	it( 'shows up in the activity feed', async () => {

		const plant = await createPlant( {
			name : 'Logged',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
			pot : { litres : 1 },
		} )
		await plant.read()
		await plant.transplant( { volumeL : 5 } )

		const line = plant.activity.recent( { kind : 'care' } )[ 0 ]
		assert.equal( line.label, 'Transplant started' )
		assert.match( line.detail, /1L → 5L|5L/ )

		await plant.destroy()

	} )

	it( 'notes when the electrode moved too', () => {

		const r = start( {}, {
			volumeL : 5,
			electrodeMoved : true,
		} )

		assert.match( r.why, /a contact to reseat rather than a plant in trouble/ )

	} )

	it( 'says MIN before MAX, which is the whole shape of settling', () => {

		assert.ok( MIN_SETTLING_DAYS < MAX_SETTLING_DAYS )

	} )

} )
