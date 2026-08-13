/**
 * What the metrics say together, the tabular record, and the device catalogue.
 *
 * The recurring risk across all three is substitution: filling a gap with
 * something that looks like the missing value and fails in exactly the case the
 * measurement exists to detect. Most of these tests are about refusing to.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import {
	leafVpd, lightSaturation, rootEffort, stomatalOpening,
	thermalInertia, uptakeBalance,
} from '../src/inference/index.js'
import { toCSV, toTable } from '../src/journal/index.js'
import { device, devices, suggest, SUPPORT } from '../src/devices/index.js'

const HOUR = 3_600_000

describe( 'crossing the metrics', () => {

	it( 'refuses to fake a leaf temperature it does not have', () => {

		// Air temperature stands in for leaf temperature only when the stomata
		// are doing nothing, which is precisely what this measurement is for.
		const r = leafVpd( {
			temperature : 28,
			humidity : 40,
		} )

		assert.equal( r.known, false )
		assert.ok( Number.isFinite( r.airVpd ) )
		assert.match( r.why, /assume the stomata are closed/ )

	} )

	it( 'reads a cooler leaf as transpiring', () => {

		const r = leafVpd( {
			temperature : 28,
			humidity : 40,
			leafTemperature : 25,
		} )

		assert.equal( r.state, 'transpiring' )
		assert.ok( r.value < r.airVpd )
		assert.match( r.why, /evaporation doing the cooling/ )

	} )

	it( 'reads a hotter leaf as shut down', () => {

		const r = leafVpd( {
			temperature : 28,
			humidity : 40,
			leafTemperature : 31,
		} )

		assert.equal( r.state, 'closed' )
		assert.match( r.why, /check water before adding light or heat/ )

	} )

	it( 'prefers a measured conductance to its own inference', () => {

		const r = stomatalOpening( {
			temperature : 28,
			humidity : 40,
			leafTemperature : 25,
			stomatalConductance : 210,
		} )

		assert.equal( r.measured, true )
		assert.equal( r.value, 210 )

	} )

	it( 'labels its inferred opening as an index, not a conductance', () => {

		const r = stomatalOpening( {
			temperature : 28,
			humidity : 40,
			leafTemperature : 25,
		} )

		assert.equal( r.measured, false )
		assert.match( r.unit, /index/ )
		assert.match( r.why, /not a conductance/ )

	} )

	it( 'catches salt concentrating while the plant looks like it is drinking', () => {

		const rows = Array.from( { length : 10 }, ( _, i ) => ( {
			t : new Date( Date.now() - ( 10 - i ) * HOUR ).toISOString(),
			soil : 60 - i * 3,
			conductivity : 800 + i * 40,
		} ) )

		const r = uptakeBalance( rows )

		assert.equal( r.state, 'salt_accumulating' )
		assert.equal( r.cue.claim, 'salt_accumulation' )
		assert.match( r.why, /Flush the substrate rather than feeding again/ )

	} )

	it( 'calls balanced uptake balanced', () => {

		const rows = Array.from( { length : 10 }, ( _, i ) => ( {
			t : new Date( Date.now() - ( 10 - i ) * HOUR ).toISOString(),
			soil : 60 - i * 3,
			conductivity : 900 - i * 30,
		} ) )

		assert.equal( uptakeBalance( rows ).state, 'balanced' )
		assert.equal( uptakeBalance( rows ).cue, null )

	} )

	it( 'says nothing about uptake while nothing is being taken up', () => {

		const rows = Array.from( { length : 10 }, ( _, i ) => ( {
			t : new Date( Date.now() - ( 10 - i ) * HOUR ).toISOString(),
			soil : 60,
			conductivity : 900,
		} ) )

		assert.equal( uptakeBalance( rows ).state, 'idle' )

	} )

	it( 'reads the substrate temperature swing as a moisture signal', () => {

		const make = soilAmp => Array.from( { length : 14 }, ( _, i ) => ( {
			t : new Date( Date.now() - ( 14 - i ) * HOUR ).toISOString(),
			temperature : 20 + 8 * Math.sin( i / 2 ),
			soilTemperature : 20 + soilAmp * Math.sin( i / 2 ),
		} ) )

		// A wet pot absorbs the swing; a dry one follows it.
		assert.equal( thermalInertia( make( 7 ) ).state, 'dry' )
		assert.equal( thermalInertia( make( 1.5 ) ).state, 'wet' )

	} )

	it( 'refuses a thermal reading with no swing to measure against', () => {

		const flat = Array.from( { length : 14 }, ( _, i ) => ( {
			t : new Date( Date.now() - ( 14 - i ) * HOUR ).toISOString(),
			temperature : 20,
			soilTemperature : 20,
		} ) )

		assert.equal( thermalInertia( flat ).known, false )

	} )

	it( 'reports root effort in the terms a root experiences', () => {

		assert.equal( rootEffort( { matricPotential : -5 } ).state, 'saturated' )
		assert.equal( rootEffort( { matricPotential : -75 } ).state, 'straining' )
		assert.match( rootEffort( {} ).why, /coir and in clay/ )

	} )

	it( 'notices when more light has stopped helping', () => {

		const climbing = Array.from( { length : 20 }, ( _, i ) => ( {
			par : 100 + i * 60,
			co2 : 800 - i * 20,
		} ) )
		const plateaued = Array.from( { length : 20 }, ( _, i ) => ( {
			par : 100 + i * 60,
			co2 : i < 10 ? 800 - i * 20 : 620,
		} ) )

		assert.equal( lightSaturation( climbing ).saturated, false )
		assert.ok( lightSaturation( plateaued ).gain <= lightSaturation( climbing ).gain )

	} )

	it( 'says which one sensor would unlock the most', async () => {

		const plant = await createPlant( {
			name : 'Basic',
			species : 'Ficus',
			sensor : {
				driver : 'mock',
				dayNight : false,
			},
			ai : { provider : 'mock' },
		} )
		await plant.read()

		const r = await plant.infer()

		assert.equal( r.known.length, 0 )
		assert.equal( r.unlock[ 0 ].metric, 'leafTemperature' )
		assert.ok( r.unlock[ 0 ].unlocks >= 2 )

		await plant.destroy()

	} )

} )

describe( 'the tabular record', () => {

	async function logged() {

		const plant = await createPlant( {
			name : 'Table',
			species : 'Ficus',
			sensor : {
				driver : 'mock',
				dayNight : false,
			},
			ai : { provider : 'mock' },
		} )

		for ( let i = 0; i < 12; i++ ) {

			// A two-minute hole, on purpose.
			if ( i === 5 || i === 6 ) continue

			await plant.memory.addReading( {
				timestamp : Date.now() - ( 12 - i ) * 60_000,
				temperature : 22 + i * 0.1,
				humidity : 55 + i,
				soil : 60 - i * 2,
				light : 800 + i * 10,
			} )

		}

		return plant

	}

	it( 'gives one row per interval with every metric present', async () => {

		const plant = await logged()
		const t = await plant.journal( {
			hours : 1,
			everyMinutes : 1,
		} )

		assert.ok( t.rows.length >= 9 )
		assert.ok( t.columns.some( c => c.key === 'temperature' ) )
		assert.ok( t.columns.some( c => c.key === 'vpd' && c.derived ) )
		assert.ok( t.columns.some( c => c.key === 'alerts' ) )

		await plant.destroy()

	} )

	it( 'leaves a gap empty rather than repeating the last value', async () => {

		// Carrying a value forward is how a table turns a sensor that stopped
		// reporting into one reporting a stable value — the exact failure the
		// maintenance layer exists to catch.
		const plant = await logged()
		const t = await plant.journal( {
			hours : 1,
			everyMinutes : 1,
			sparse : false,
		} )

		const empty = t.rows.filter( r => r.temperature === null )
		assert.ok( empty.length >= 2, 'the hole must survive into the table' )
		assert.ok( empty.every( r => r.filled === 0 ) )

		await plant.destroy()

	} )

	it( 'reports how much of the window actually has data', async () => {

		const plant = await logged()
		const t = await plant.journal( {
			hours : 1,
			everyMinutes : 1,
		} )

		assert.ok( t.coverage.ratio > 0 && t.coverage.ratio < 1 )
		assert.equal( t.coverage.withReadings, 10 )

		await plant.destroy()

	} )

	it( 'omits columns for instruments that are not there', async () => {

		const plant = await logged()
		const t = await plant.journal( { hours : 1 } )

		// A table with eighteen permanently empty columns implies instruments
		// that do not exist.
		assert.ok( !t.metrics.includes( 'leafTemperature' ) )
		assert.ok( !t.metrics.includes( 'par' ) )

		await plant.destroy()

	} )

	it( 'carries care events on the row they happened in', async () => {

		const plant = await logged()
		await plant.water()

		const t = await plant.journal( { hours : 1 } )
		assert.ok( t.rows.some( r => String( r.events ).includes( 'water' ) ) )

		await plant.destroy()

	} )

	it( 'renders as CSV with units in the header', async () => {

		const plant = await logged()
		const csv = toCSV( await plant.journal( { hours : 1 } ) )

		assert.match( csv.split( '\n' )[ 0 ], /Temperature \(°C\)/ )
		assert.ok( csv.split( '\n' ).length > 5 )

		await plant.destroy()

	} )

	it( 'renders as an aligned table that names its own gaps', async () => {

		const plant = await logged()
		const text = toTable( await plant.journal( { hours : 1 } ) )

		assert.match( text, /Empty cells are gaps, not zeros/ )

		await plant.destroy()

	} )

} )

describe( 'the device catalogue', () => {

	it( 'covers every layer', () => {

		for ( const layer of [ 'plant', 'root', 'air', 'vision', 'actuator' ] ) {

			assert.ok( devices( { layer } ).length > 0, `nothing for ${layer}` )

		}

	} )

	it( 'never claims a device has been verified', () => {

		// None of these can be tested from inside a library: verifying a DS18B20
		// profile requires a DS18B20.
		for ( const dev of devices() ) {

			assert.ok( Object.values( SUPPORT ).includes( dev.support ) )
			assert.ok( dev.notes, `${dev.id} has no wiring or calibration note` )

		}

	} )

	it( 'gives a usable config for everything it claims to support', () => {

		for ( const dev of devices() ) {

			if ( dev.support === SUPPORT.DECLARED ) continue
			assert.ok( dev.config, `${dev.id} claims support with no config` )

		}

	} )

	it( 'says plainly when a device has no automated path', () => {

		const declared = devices( { support : SUPPORT.DECLARED } )

		assert.ok( declared.length > 0 )
		// CO₂ injection is dangerous in a closed room and deliberately unsupported.
		assert.ok( declared.some( x => x.id === 'co2-injector' ) )

	} )

	it( 'answers what to buy next, best first', () => {

		const next = suggest( [ 'temperature', 'humidity', 'soil', 'light' ] )

		assert.ok( next.length > 0 )
		assert.ok( next[ 0 ].adds.length >= next.at( -1 ).adds.length )
		assert.ok( next.every( x => x.support !== SUPPORT.DECLARED ) )

	} )

	it( 'suggests nothing once you have everything it offers', () => {

		const all = devices().flatMap( x => x.provides || [] )
		assert.equal( suggest( all ).length, 0 )

	} )

	it( 'looks one up, and returns null for a name it does not know', () => {

		assert.equal( device( 'ds18b20' ).layer, 'root' )
		assert.equal( device( 'nope' ), null )

	} )

} )
