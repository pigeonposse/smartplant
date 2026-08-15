/**
 * Celsius or Fahrenheit.
 *
 * The tests that matter here are not the arithmetic — they are the two ways a
 * unit setting silently corrupts a system: a number that changes unit somewhere
 * in the middle of the library, and a probe that lies about what it is sending.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import {
	formatTemperature, normalise, plausibleTemperature, resolveUnits,
	temperatureBand, toC, toF, UNITS,
} from '../src/units/index.js'

const plant = ( config = {} ) => createPlant( {
	name : 'Ivy',
	species : 'Ficus lyrata',
	sensor : {
		driver : 'mock',
		dayNight : false,
	},
	ai : { provider : 'mock' },
	...config,
} )

describe( 'temperature units', () => {

	it( 'converts both ways', () => {

		assert.equal( toF( 0 ), 32 )
		assert.equal( toF( 100 ), 212 )
		assert.equal( Math.round( toC( 72 ) * 100 ) / 100, 22.22 )

	} )

	it( 'defaults to Celsius and does not guess from a locale', () => {

		// A Canadian laptop set to en-US would otherwise flip every temperature
		// on the screen, with no symptom but numbers that still look plausible.
		assert.equal( resolveUnits( {} ), UNITS.METRIC )
		assert.equal( resolveUnits( { units : 'imperial' } ), UNITS.IMPERIAL )
		assert.equal( resolveUnits( { units : 'F' } ), UNITS.IMPERIAL )

	} )

	it( 'formats for a screen', () => {

		assert.equal( formatTemperature( 21.3, UNITS.METRIC ), '21.3°C' )
		assert.equal( formatTemperature( 21.3, UNITS.IMPERIAL ), '70.3°F' )
		assert.equal( formatTemperature( null, UNITS.IMPERIAL ), '—' )

	} )

	it( 'converts a band as two temperatures, not as a width', () => {

		// 15–28°C is 59–82.4°F. Scaling the width by 9/5 without the offset gives
		// 27–50.4, which looks like a plausible band and is not one.
		const b = temperatureBand( {
			min : 15,
			max : 28,
		}, UNITS.IMPERIAL )

		assert.equal( b.min, 59 )
		assert.equal( b.max, 82.4 )

	} )

} )

describe( 'the unit never travels with the number', () => {

	it( 'stores Celsius whatever the display is set to', async () => {

		const c = await plant()
		const f = await plant( { units : 'imperial' } )

		await c.read()
		await f.read()

		// Both are mock readings around room temperature. If the display setting
		// had leaked downward, the imperial one would be storing seventies.
		assert.ok( f.memory.lastReading.temperature < 40 )
		assert.equal( f.units, 'imperial' )
		assert.equal( c.units, 'metric' )

		await c.destroy()
		await f.destroy()

	} )

	it( 'shows Fahrenheit on the status line and keeps the emoji honest', async () => {

		const p = await plant( { units : 'imperial' } )
		await p.read()

		const line = p.status()

		assert.match( line, /°F/ )
		assert.doesNotMatch( line, /°C/ )
		// The emoji is chosen on the Celsius value against the Celsius band.
		// Comparing a Fahrenheit number against a Celsius range would put every
		// plant in the imperial world permanently on fire.
		assert.doesNotMatch( line, /🔥/ )

		await p.destroy()

	} )

	it( 'sends Celsius plus a display instruction to the panel', async () => {

		const { snapshot } = await import( '../src/dashboard/vitals.js' )
		const p = await plant( { units : 'imperial' } )
		await p.read()

		const snap = await snapshot( p )
		const temp = snap.vitals.find( v => v.metric === 'temperature' )

		assert.equal( snap.units, 'imperial' )
		// The payload stays canonical: a JSON feed whose numbers change meaning
		// with a setting cannot be diffed, cached, or compared between plants.
		assert.ok( temp.value < 40 )

		await p.destroy()

	} )

} )

describe( 'a probe that reports Fahrenheit', () => {

	it( 'is converted once, at the wire', async () => {

		const p = await plant( {
			sensor : {
				driver : 'manual',
				unit : 'F',
				initial : {
					temperature : 72,
					humidity : 55,
					soil : 40,
					light : 400,
				},
			},
		} )
		await p.read()

		assert.equal( p.memory.lastReading.temperature, 22.22 )

		await p.destroy()

	} )

	it( 'converts every temperature it sends, not just the air one', () => {

		const out = normalise( {
			temperature : 72,
			soilTemperature : 68,
			leafTemperature : 70,
			humidity : 55,
		}, 'F' )

		// Converting one of two temperatures is worse than converting neither:
		// they would then disagree by forty degrees and every layer comparing
		// them would draw a conclusion from the difference.
		assert.equal( out.temperature, 22.22 )
		assert.equal( out.soilTemperature, 20 )
		assert.equal( out.leafTemperature, 21.11 )
		assert.equal( out.humidity, 55, 'humidity is not a temperature' )

	} )

	it( 'is not double converted when the display is also imperial', async () => {

		const p = await plant( {
			units : 'imperial',
			sensor : {
				driver : 'manual',
				unit : 'F',
				initial : {
					temperature : 72,
					humidity : 55,
					soil : 40,
					light : 400,
				},
			},
		} )
		await p.read()

		// In at 72°F, stored as 22.22°C, back out at 72°F. The display setting
		// and the wire setting are separate on purpose: somebody who chose
		// Fahrenheit because they think in it must not thereby convert a probe
		// that was already Celsius.
		assert.equal( p.memory.lastReading.temperature, 22.22 )
		assert.match( p.status(), /72°F/ )

		await p.destroy()

	} )

	it( 'leaves a Celsius probe alone', () => {

		const reading = {
			temperature : 21,
			humidity : 55,
		}

		assert.equal( normalise( reading, null ), reading )
		assert.equal( normalise( reading, 'C' ), reading )

	} )

} )

describe( 'a probe that lies about its unit', () => {

	it( 'is named rather than quietly rescaled', () => {

		const r = plausibleTemperature( 72 )

		assert.equal( r.ok, false )
		assert.equal( r.suspect, 'F' )
		assert.equal( r.asFahrenheit, 22.2 )
		assert.match( r.why, /hide the mislabelling for the life of this plant/ )

	} )

	it( 'is caught by the diagnosis, with the wire named as the fix', async () => {

		const p = await plant( {
			sensor : {
				driver : 'manual',
				initial : {
					temperature : 72,
					humidity : 55,
					soil : 40,
					light : 400,
				},
			},
		} )

		const units = ( await p.systemDiagnosis( { probeAI : false } ) ).checks
			.find( c => c.area === 'units' )

		assert.equal( units.result, 'fail' )
		assert.match( units.fix, /unit: "F"/ )

		await p.destroy()

	} )

	it( 'accepts an ordinary room in either system', () => {

		assert.equal( plausibleTemperature( 21 ).ok, true )
		assert.equal( plausibleTemperature( -5 ).ok, true )
		assert.equal( plausibleTemperature( undefined ).ok, true )
		// And a disconnected probe is still a wiring fault, not a cold plant.
		assert.equal( plausibleTemperature( -50 ).ok, false )

	} )

} )
