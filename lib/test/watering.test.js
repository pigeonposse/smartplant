/**
 * How much water, and how warm the leaves are.
 *
 * Both are places where the obvious design is wrong by an order of magnitude:
 * a table of millilitres per species, and an absolute temperature from an
 * uncalibrated sensor.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import {
	confirm as confirmWatering, dose, potVolume, pumpSeconds, SUBGROUP_WATERING,
	WATERING,
} from '../src/archetypes/watering.js'
import {
	evenness, frameStats, heatmap, segment, stressIndex,
} from '../src/vision/thermal.js'

/** A frame with a cool canopy against a warm wall. */
const frame = ( canopyT, spread = 0.5, wall = 23 ) => {

	const w = 64, h = 48
	const data = new Float32Array( w * h )

	for ( let i = 0; i < data.length; i++ ) {

		const x = i % w, y = Math.floor( i / w )
		data[ i ] = ( x > 12 && x < 50 && y > 8 && y < 40 )
			? canopyT + ( ( x + y ) % 5 ) * spread / 5
			: wall + ( i % 7 ) * 0.05

	}

	return {
		width : w,
		height : h,
		data,
	}

}

describe( 'the pot decides the volume, the plant decides the fraction', () => {

	it( 'gives thirty times the water for thirty times the pot', () => {

		const small = dose( {
			archetype : 'tropical',
			pot : { diameterCm : 12 },
		} )
		const big = dose( {
			archetype : 'tropical',
			pot : { diameterCm : 40 },
		} )

		// The same plant with the same archetype. A table of millilitres per
		// species would be badly wrong for one of them.
		assert.ok( big.ml / small.ml > 20 )

	} )

	it( 'refuses a volume when nobody has said how big the pot is', () => {

		const r = dose( { archetype : 'tropical' } )

		assert.equal( r.known, false )
		assert.deepEqual( r.missing, [ 'pot' ] )
		assert.match( r.why, /a default would be wrong by that same factor/ )

	} )

	it( 'refuses without an archetype, because a cactus and a fern are opposite', () => {

		const r = dose( { pot : { diameterCm : 20 } } )

		assert.equal( r.known, false )
		assert.match( r.why, /guessing between them is how one of them dies/ )

	} )

	it( 'lets a subgroup override its archetype', () => {

		const plain = dose( {
			archetype : 'tropical',
			pot : { diameterCm : 20 },
		} )
		const aroid = dose( {
			archetype : 'tropical',
			subgroup : 'aroid',
			pot : { diameterCm : 20 },
		} )

		assert.ok( aroid.ml < plain.ml )
		assert.equal( aroid.subgroup, 'aroid' )

	} )

	it( 'wants opposite things from a cactus and a fern in the same pot', () => {

		const cactus = dose( {
			archetype : 'xerophyte',
			subgroup : 'cactus',
			pot : { diameterCm : 20 },
		} )
		const fern = dose( {
			archetype : 'hygrophyte',
			subgroup : 'fern',
			pot : { diameterCm : 20 },
		} )

		assert.ok( fern.ml > cactus.ml * 1.5 )
		assert.ok( fern.dryBackTo > cactus.dryBackTo * 5 )

	} )

	it( 'names the water carnivorous plants need, which nothing here can check', () => {

		assert.match( SUBGROUP_WATERING.carnivorous.why, /nothing in this library can tell what is in the reservoir/ )

	} )

	it( 'declares every archetype', () => {

		for ( const [ id, w ] of Object.entries( WATERING ) ) {

			assert.ok( w.fraction > 0 && w.fraction < 1, id )
			assert.ok( w.why.length > 40, id )

		}

	} )

	it( 'computes a pot volume, or nothing', () => {

		assert.ok( potVolume( { diameterCm : 20 } ) > 1 )
		assert.equal( potVolume( {} ), null )

	} )

} )

describe( 'seconds are measured, not looked up', () => {

	it( 'gives the volume and refuses the duration without a flow rate', () => {

		const r = pumpSeconds( 450, {} )

		assert.equal( r.known, false )
		assert.equal( r.ml, 450 )
		assert.match( r.why, /a measuring jug for ten seconds/ )

	} )

	it( 'converts once the pump has been measured', () => {

		const r = pumpSeconds( 450, { mlPerSecond : 30 } )

		assert.equal( r.seconds, 15 )

	} )

	it( 'says when a flow rate has gone stale', () => {

		const r = pumpSeconds( 300, {
			mlPerSecond : 30,
			measuredAt : Date.now() - 200 * 86_400_000,
		} )

		assert.equal( r.stale, true )
		assert.match( r.why, /flow drifts/ )

	} )

} )

describe( 'an open-loop pump reports success either way', () => {

	it( 'confirms a dose that moved the soil', () => {

		assert.equal( confirmWatering( null, 30, 48 ).arrived, true )

	} )

	it( 'calls a dose that moved nothing a fault, not a thirsty plant', () => {

		const r = confirmWatering( null, 42, 43 )

		assert.equal( r.arrived, false )
		assert.equal( r.fault, true )
		// A second dose on a blocked line records a second watering that did not
		// happen.
		assert.match( r.why, /does nothing except record a second watering/ )

	} )

	it( 'will not claim either way without a probe', () => {

		const r = confirmWatering( null, undefined, 40 )

		assert.equal( r.arrived, null )
		assert.match( r.why, /every dose is a claim rather than an event/ )

	} )

	it( 'plans through a plant', async () => {

		const plant = await createPlant( {
			name : 'Pumped',
			species : 'Monstera deliciosa',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
			pot : { diameterCm : 22 },
			pump : { mlPerSecond : 25 },
		} )
		await plant.read()

		const plan = plant.wateringPlan()

		assert.equal( plan.known, true )
		assert.ok( plan.ml > 0 )
		assert.ok( plan.seconds > 0 )

		await plant.destroy()

	} )

} )

describe( 'a thermal camera knows differences, not temperatures', () => {

	it( 'finds the canopy by it being cooler than the room', () => {

		const r = segment( frame( 21 ) )

		assert.equal( r.known, true )
		assert.ok( r.separation > 1 )
		assert.match( r.why, /cooler than the room because it is evaporating/ )

	} )

	it( 'reports a plant that has vanished into the wall as a finding', () => {

		// A plant that has stopped transpiring is at room temperature, which
		// makes it invisible — and that is information, not a failure to find it.
		const r = segment( frame( 23, 0.2, 23 ) )

		assert.equal( r.known, false )
		assert.match( r.why, /is a finding, not a failure to find one/ )

	} )

	it( 'refuses a stress index without a separate thermometer', () => {

		const r = stressIndex( frame( 21 ), null )

		assert.equal( r.known, false )
		// Taking air off the same frame would cancel the error out of both.
		assert.match( r.why, /make their difference look perfect while meaning nothing/ )

	} )

	it( 'reads a cool canopy as a plant with water to spend', () => {

		const r = stressIndex( frame( 21.2 ), 23 )

		assert.ok( r.index < 0.3 )
		assert.match( r.why, /a leaf cools itself by evaporating/i )

	} )

	it( 'reads a canopy that has stopped cooling itself as one that has shut down', () => {

		// A warm wall, air at 23, and a canopy at 24 — above the air because it
		// is no longer evaporating, but still the coolest thing in the frame so
		// the segmentation can find it. A canopy warmer than its background is
		// the case this cannot see, and the module says so.
		const r = stressIndex( frame( 24, 0.5, 28 ), 23 )

		assert.ok( r.index > 0.6 )
		assert.match( r.why, /hours before it looks wilted/ )

	} )

	it( 'sees half a plant working, which one contact probe cannot', () => {

		const r = evenness( frame( 21, 25 ) )

		assert.equal( r.even, false )
		assert.match( r.why, /whichever it happened to be clipped to/ )

	} )

	it( 'draws a map that is relative on purpose', () => {

		const m = heatmap( frame( 21 ) )

		assert.equal( m.relative, true )
		assert.ok( m.rows.length > 4 )
		assert.match( m.why, /knows how parts of a scene differ far better/ )

	} )

	it( 'does not publish leafTemperature from an uncalibrated sensor', async () => {

		const plant = await createPlant( {
			name : 'Thermal',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		const cam = await plant.attachSensor( {
			driver : 'thermal',
			frame : async () => frame( 21 ),
		} )

		const reading = await cam.read()

		// Feeding VPD a number with five degrees of error is worse than having
		// no leaf temperature, because everything downstream looks complete.
		assert.equal( reading.leafTemperature, undefined )
		assert.ok( Number.isFinite( reading.canopySpread ) )

		await plant.destroy()

	} )

	it( 'publishes it when somebody declares the sensor calibrated', async () => {

		const plant = await createPlant( {
			name : 'Calibrated',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		const cam = await plant.attachSensor( {
			driver : 'thermal',
			calibrated : true,
			frame : async () => frame( 21 ),
		} )

		assert.ok( Number.isFinite( ( await cam.read() ).leafTemperature ) )

		await plant.destroy()

	} )

	it( 'refuses a frame that is not one', () => {

		assert.equal( frameStats( null ).known, false )
		assert.equal( frameStats( { data : [ 1, 2 ] } ).known, false )

	} )

} )
