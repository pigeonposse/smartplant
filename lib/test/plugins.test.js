/**
 * Integration test across all ten official plugins.
 *
 * This is the test that would have caught the 1.x breakage: every plugin is
 * actually installed on a real kernel and its documented method is called.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	after, describe, it,
} from 'node:test'

import { createPlant, definePlugin } from '../src/index.js'

const tmp = await mkdtemp( join( tmpdir(), 'smartplant-plugins-' ) )
after( () => rm( tmp, {
	recursive : true,
	force     : true,
} ) )

/** Plugin package → the method its README documents. */
const PLUGINS = {
	alerts      : 'checkAlerts',
	diary       : 'logAndSummarize',
	fertilizer  : 'guideFertilization',
	history     : 'analyzeTrends',
	lighting    : 'optimizeLight',
	pests       : 'monitorPests',
	simulator   : 'simulateConditions',
	stress      : 'detectStress',
	ventilation : 'adjustVentilation',
	watering    : 'predictWatering',
}

async function makePlant( sensor = {} ) {

	return createPlant( {
		name    : 'Ivy',
		species : 'Monstera deliciosa',
		sensor  : {
			driver : 'mock',
			...sensor,
		},
		ai      : { provider : 'mock' },
		memory  : { path : join( tmp, `${Math.random().toString( 36 ).slice( 2 )}.json` ) },
	} )

}

describe( 'official plugins', () => {

	for ( const [ name, method ] of Object.entries( PLUGINS ) ) {

		it( `${name}: installs and ${method}() returns a usable result`, async () => {

			const plant  = await makePlant()
			const plugin = ( await import( `@smartplant/${name}` ) ).default

			assert.equal( plugin.name, name, 'plugin name must match its package' )

			await plant.use( plugin )
			await plant.read()

			const api = plant.plugin( name )
			assert.equal( typeof api[ method ], 'function', `${name} must expose ${method}()` )

			// simulator needs a hypothesis; history needs a window. Both default fine.
			const result = await api[ method ]( name === 'simulator'
				? { conditions : { soil : 5 } }
				: {} )

			assert.equal( typeof result, 'object' )
			assert.equal( typeof ( result.advice ?? result.entry ), 'string' )
			assert.ok( ( result.advice ?? result.entry ).length > 0, 'must produce text' )

			await plant.destroy()

		} )

	}

	it( 'all ten plugins coexist on one plant', async () => {

		const plant = await makePlant()

		for ( const name of Object.keys( PLUGINS ) ) {

			await plant.use( ( await import( `@smartplant/${name}` ) ).default )

		}

		assert.equal( plant.plugins.size, 10 )
		await plant.read()
		await plant.destroy()

	} )

} )

describe( 'plugin local computation (no AI)', () => {

	it( 'ventilation computes VPD from temperature and humidity', async () => {

		const plant = await makePlant( {
			temperature : 25,
			humidity : 50,
			dayNight : false,
		} )
		await plant.use( ( await import( '@smartplant/ventilation' ) ).default )
		await plant.read()

		const vpd = plant.plugin( 'ventilation' ).vpd()
		// At 25°C / 50% RH the deficit is ~1.58 kPa.
		assert.ok( vpd > 1.3 && vpd < 1.8, `unexpected VPD: ${vpd}` )
		await plant.destroy()

	} )

	it( 'simulator scores a hypothetical without calling the AI', async () => {

		const plant = await makePlant( {
			soil : 35,
			humidity : 65,
			temperature : 22,
			dayNight : false,
			light : 400,
		} )
		await plant.use( ( await import( '@smartplant/simulator' ) ).default )
		await plant.read()

		const sim = plant.plugin( 'simulator' )
		const dry = sim.score( { soil : 2 } )

		assert.ok( dry.delta < 0, 'drying the soil must lower wellbeing' )

		const sweep = sim.sweep( 'temperature', [ 5, 22, 45 ] )
		assert.equal( sweep.length, 3 )
		assert.ok( sweep[ 1 ].wellbeing > sweep[ 0 ].wellbeing )
		assert.ok( sweep[ 1 ].wellbeing > sweep[ 2 ].wellbeing )

		await plant.destroy()

	} )

	it( 'history reports insufficient data instead of inventing a trend', async () => {

		const plant = await makePlant()
		await plant.use( ( await import( '@smartplant/history' ) ).default )
		await plant.read()

		const result = await plant.plugin( 'history' ).analyzeTrends()
		assert.equal( result.direction, 'unknown' )
		assert.equal( result.offline, true )

		await plant.destroy()

	} )

	it( 'alerts stays silent — and free — when nothing is out of range', async () => {

		const plant = await makePlant( {
			soil : 35,
			humidity : 65,
			temperature : 22,
			dayNight : false,
			light : 400,
		} )
		await plant.use( ( await import( '@smartplant/alerts' ) ).default )
		await plant.read()

		const before = plant.ai.stats.requests
		const result = await plant.plugin( 'alerts' ).checkAlerts()

		assert.equal( result.triggered, false )
		assert.equal( plant.ai.stats.requests, before, 'must not spend an AI request' )

		await plant.destroy()

	} )

	it( 'lighting estimates daily light hours from stored readings', async () => {

		const plant = await makePlant( {
			light : 500,
			dayNight : false,
		} )
		await plant.use( ( await import( '@smartplant/lighting' ) ).default )
		for ( let i = 0; i < 5; i++ ) await plant.read()

		const hours = plant.plugin( 'lighting' ).dailyLightHours( 200 )
		assert.equal( hours, 24, 'constant 500 lux means fully lit' )

		await plant.destroy()

	} )

	it( 'diary stores its entry in the plant\'s memory', async () => {

		const plant = await makePlant()
		await plant.use( ( await import( '@smartplant/diary' ) ).default )
		await plant.read()

		await plant.plugin( 'diary' ).logAndSummarize()
		const entries = plant.plugin( 'diary' ).entries()

		assert.equal( entries.length, 1 )
		assert.equal( entries[ 0 ].author, 'plant' )

		await plant.destroy()

	} )

	it( 'watering reacts to plant:thirsty on its own', async () => {

		const plant = await makePlant( {
			soil : 2,
			humidity : 5,
		} )
		await plant.use( ( await import( '@smartplant/watering' ) ).default )

		let fired = null
		plant.on( 'watering:needed', e => {

			fired = e

		} )
		await plant.read()

		assert.ok( fired, 'watering plugin should emit watering:needed' )
		assert.ok( fired.advice.length > 0 )

		await plant.destroy()

	} )

} )

describe( 'one plugin, two plants', () => {

	it( 'gives each plant its own instance', async () => {

		// A plugin module is a definition. Installing the shared object on two
		// plants used to rebind the first plant's plugin to the second, so every
		// later call read and acted on the wrong plant — silently. Two plants in
		// one process is the normal case for a colony or an inheritance.
		const { definePlugin, createPlant } = await import( '../src/index.js' )

		const spy = definePlugin( {
			name : 'whoami',
			async setup( plant ) {

				this.installedOn = plant.memory.plant.name

			},
			methods : { who() {

				return {
					setup : this.installedOn,
					live  : this.plant.memory.plant.name,
				}

			} },
		} )

		const a = await createPlant( {
			name : 'A',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		const b = await createPlant( {
			name : 'B',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		await a.use( spy )
		await b.use( spy )

		assert.deepEqual( a.plugin( 'whoami' ).who(), {
			setup : 'A',
			live : 'A',
		}, 'installing on B must not rebind A' )
		assert.deepEqual( b.plugin( 'whoami' ).who(), {
			setup : 'B',
			live : 'B',
		} )
		assert.notEqual( a.plugin( 'whoami' ), b.plugin( 'whoami' ) )

		// The shared definition itself stays uninstalled.
		assert.equal( spy.plant, null )

		await a.destroy()
		await b.destroy()

	} )

	it( 'unhooks one plant without deafening the other', async () => {

		const { definePlugin, createPlant } = await import( '../src/index.js' )

		let heard = 0
		const ears = definePlugin( {
			name : 'ears',
			on : { 'sensor:reading'() {

				heard++

			} },
		} )

		const a = await createPlant( {
			name : 'A',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		const b = await createPlant( {
			name : 'B',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		await a.use( ears )
		await b.use( ears )

		await a.destroy()

		heard = 0
		await b.read()
		assert.equal( heard, 1, 'destroying A must not remove B\'s listener' )

		await b.destroy()

	} )

} )

describe( 'a plugin that would install and do nothing', () => {

	it( 'is refused, and told where its hooks are wired', async () => {

		const plant = await createPlant( {
			name : 'Host',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		// `definePlugin` accepts `setup` and `on`. A raw object handed to use()
		// only gets `init`, so this would have installed, reported as present,
		// and never run.
		await assert.rejects(
			() => plant.use( {
				name : 'inert',
				setup : () => {},
			} ),
			/would install and do nothing/,
		)

		await assert.rejects(
			() => plant.use( {
				name : 'inert-listeners',
				on : { 'sensor:reading' : () => {} },
			} ),
			/an `on` map/,
		)

		// And it is genuinely not installed — the refusal is not cosmetic.
		assert.throws( () => plant.plugin( 'inert' ), /is not installed/ )

		await plant.destroy()

	} )

	it( 'still accepts both sanctioned shapes', async () => {

		const plant = await createPlant( {
			name : 'Host2',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		let viaDefine = 0
		let viaInit = 0

		await plant.use( definePlugin( {
			name : 'defined',
			on : { 'sensor:reading' : () => { viaDefine++ } },
		} ) )

		await plant.use( {
			name : 'raw',
			init : p => p.on( 'sensor:reading', () => { viaInit++ } ),
		} )

		await plant.read()

		assert.equal( viaDefine, 1 )
		assert.equal( viaInit, 1 )

		await plant.destroy()

	} )

} )
