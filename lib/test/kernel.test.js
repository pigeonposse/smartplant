import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	after, describe, it,
} from 'node:test'

import {
	createPlant, definePlugin, EVENTS, MockSensor, SmartPlant,
} from '../src/index.js'

const tmp = await mkdtemp( join( tmpdir(), 'smartplant-' ) )
after( () => rm( tmp, {
	recursive : true,
	force     : true,
} ) )

const base = extra => ( {
	name    : 'Ivy',
	species : 'Monstera deliciosa',
	sensor  : 'mock',
	ai      : { provider : 'mock' },
	memory  : { path : join( tmp, `${Math.random().toString( 36 ).slice( 2 )}.json` ) },
	...extra,
} )

describe( 'kernel', () => {

	it( 'creates and initializes a plant with no hardware and no API key', async () => {

		const plant = await createPlant( base() )
		assert.ok( plant instanceof SmartPlant )
		assert.equal( plant.memory.plant.name, 'Ivy' )
		assert.equal( plant.memory.plant.species, 'Monstera deliciosa' )
		await plant.destroy()

	} )

	it( 'reads the sensor and stores the reading', async () => {

		const plant = await createPlant( base() )
		const reading = await plant.read()

		assert.ok( Number.isFinite( reading.temperature ) )
		assert.ok( Number.isFinite( reading.soil ) )
		assert.equal( plant.memory.data.readings.length, 1 )
		await plant.destroy()

	} )

	it( 'exposes getSensor() — the API the 1.x plugins called but that never existed', async () => {

		const plant = await createPlant( base() )
		assert.ok( plant.getSensor() instanceof MockSensor )
		assert.ok( plant.getSensor( 'mock' ) instanceof MockSensor )
		assert.throws( () => plant.getSensor( 'nope' ), /not attached/ )
		await plant.destroy()

	} )

	it( 'emits plant:thirsty when the soil dries below the comfort band', async () => {

		const plant = await createPlant( base( {
			sensor : {
				driver : 'mock',
				soil   : 5,
				humidity : 10,
			},
		} ) )

		let fired = null
		plant.on( EVENTS.THIRSTY, e => {

			fired = e

		} )
		await plant.read()

		assert.ok( fired, 'expected plant:thirsty' )
		assert.equal( fired.direction, 'low' )
		await plant.destroy()

	} )

	it( 'emits plant:happy when everything is in range', async () => {

		const plant = await createPlant( base( {
			sensor : {
				driver : 'mock',
				soil : 35,
				// In range for the tropical archetype this species resolves to —
				// 50% humidity is generic-normal and dry for a Monstera.
				humidity : 65,
				temperature : 22,
				dayNight : false,
				light : 800,
			},
		} ) )

		let happy = false
		plant.on( EVENTS.HAPPY, () => {

			happy = true

		} )
		await plant.read()

		assert.equal( happy, true )
		await plant.destroy()

	} )

	it( 'analyze() returns a structured object with the requested keys', async () => {

		const plant = await createPlant( base() )
		await plant.read()

		const result = await plant.analyze( 'How is the plant?', {
			schema : {
				advice : '',
				emoji : '🌿',
				severity : 'low',
			},
		} )

		assert.equal( typeof result.advice, 'string' )
		assert.ok( result.advice.length > 0 )
		assert.ok( 'severity' in result )
		assert.ok( Number.isFinite( result.happiness ) )
		await plant.destroy()

	} )

	it( 'degrades to the offline voice instead of throwing when the AI fails', async () => {

		const plant = await createPlant( base() )
		await plant.read()

		plant.ai.registerProvider( 'broken', { generate : async () => {

			throw new Error( 'provider exploded' )

		} } )
		plant.ai.use( 'broken' )

		const result = await plant.analyze( 'How is the plant?' )
		assert.equal( result.offline, true )
		assert.ok( result.advice.length > 0 )
		await plant.destroy()

	} )

	it( 'water() records an event and re-wets the mock soil', async () => {

		const plant = await createPlant( base( {
			sensor : {
				driver : 'mock',
				soil : 20,
			},
		} ) )
		const before = ( await plant.read() ).soil

		await plant.water( { amount : 40 } )
		const after = ( await plant.read() ).soil

		assert.ok( after > before, `expected soil to rise, got ${before} → ${after}` )
		assert.equal( plant.memory.daysSince( 'water' ), 0 )
		await plant.destroy()

	} )

	it( 'monitoring can be started and stopped without leaking a timer', async () => {

		const plant = await createPlant( base( { interval : 10_000 } ) )
		await plant.startMonitoring()

		assert.equal( plant.isMonitoring, true )
		assert.equal( plant.memory.data.readings.length, 1, 'reads immediately on start' )

		plant.stopMonitoring()
		assert.equal( plant.isMonitoring, false )
		await plant.destroy()

	} )

} )

describe( 'plugins', () => {

	it( 'installs a plugin and binds it to the plant', async () => {

		const plant = await createPlant( base() )

		const p = definePlugin( {
			name    : 'demo',
			methods : { double( n ) {

				return n * 2

			} },
		} )

		await plant.use( p )
		assert.equal( plant.plugin( 'demo' ).double( 21 ), 42 )
		assert.equal( plant.plugin( 'demo' ).plant, plant )
		await plant.destroy()

	} )

	it( 'rejects duplicate plugin names', async () => {

		const plant = await createPlant( base() )
		const p = definePlugin( { name : 'dup' } )

		await plant.use( p )
		await assert.rejects( () => plant.use( definePlugin( { name : 'dup' } ) ), /already installed/ )
		await plant.destroy()

	} )

	it( 'wires plugin event listeners and detaches them on destroy', async () => {

		const plant = await createPlant( base( {
			sensor : {
				driver : 'mock',
				soil : 2,
				humidity : 5,
			},
		} ) )

		let calls = 0
		await plant.use( definePlugin( {
			name : 'listener',
			on   : { [ EVENTS.THIRSTY ] : function () {

				calls++

			} },
		} ) )

		await plant.read()
		assert.equal( calls, 1 )

		await plant.plugin( 'listener' ).destroy()
		await plant.read()
		assert.equal( calls, 1, 'listener should be detached' )
		await plant.destroy()

	} )

	it( 'a plugin failing to initialize does not stay half-installed', async () => {

		const plant = await createPlant( base() )
		const bad = definePlugin( {
			name  : 'bad',
			setup() {

				throw new Error( 'nope' )

			},
		} )

		await assert.rejects( () => plant.use( bad ), /failed to initialize/ )
		assert.equal( plant.has( 'bad' ), false )
		await plant.destroy()

	} )

	it( 'a listener that acts on the plant does not trigger a feedback loop', async () => {

		// Regression: an auto-waterer reacting to plant:thirsty calls water(),
		// which reads again, which re-emits plant:thirsty… until soil saturates.
		const plant = await createPlant( base( {
			sensor : {
				driver : 'mock',
				soil : 5,
				humidity : 8,
			},
		} ) )

		let waterings = 0
		await plant.use( definePlugin( {
			name : 'auto-water',
			on   : { async [ EVENTS.THIRSTY ]() {

				waterings++
				await this.plant.water( { amount : 5 } )

			} },
		} ) )

		await plant.read()

		assert.equal( waterings, 1, `expected exactly one watering, got ${waterings}` )
		await plant.destroy()

	} )

	it( 'one broken listener does not stop the others', async () => {

		const plant = await createPlant( base( {
			sensor : {
				driver : 'mock',
				soil : 2,
				humidity : 5,
			},
		} ) )

		let good = 0
		plant.on( EVENTS.THIRSTY, () => {

			throw new Error( 'boom' )

		} )
		plant.on( EVENTS.THIRSTY, () => {

			good++

		} )

		await plant.read()
		assert.equal( good, 1 )
		await plant.destroy()

	} )

} )

describe( 'subsystems that have not been set up', () => {

	const fresh = () => createPlant( {
		name : 'Newcomer',
		species : 'Ficus',
		sensor : { driver : 'mock' },
		ai : { provider : 'mock' },
	} )

	it( 'explains what to call instead of failing on a null read', async () => {

		const plant = await fresh()

		// "Cannot read properties of undefined (reading 'ask')" tells a person
		// nothing about what they did. Methods on the plant already do better —
		// listen() without an electrode names the exact config to add — and a
		// property reached *through* should not be worse for where it sits.
		assert.throws( () => plant.colony.ask( 'x', 'y' ), /Call joinColony/ )
		assert.throws( () => plant.brain.run( 'hola' ), /Call useBrain/ )

		await plant.destroy()

	} )

	it( 'keeps optional chaining meaning what it always meant', async () => {

		const plant = await fresh()

		// This is the constraint that makes the obvious fix wrong. Code across
		// this library and its plugins reads `plant.spectral?.history` and expects
		// undefined; optional chaining only short-circuits on null and undefined,
		// so a plain object in the slot would throw where it used to yield nothing.
		// Only known methods answer — everything else still reads as absent.
		assert.equal( plant.colony?.transcript, undefined )
		assert.equal( plant.colony?.neighbours, undefined )
		assert.equal( plant.brain?.somethingElse, undefined )

		await plant.destroy()

	} )

	it( 'answers plainly when asked whether it is set up', async () => {

		const plant = await fresh()

		assert.equal( plant.colony.enabled, false )
		assert.equal( plant.brain.enabled, false )

		const { LoopbackBus } = await import( '../src/colony/index.js' )
		await plant.joinColony( { transport : new LoopbackBus().endpoint( 'x' ) } )

		// A real one has no `enabled` at all, which is the point: only the stub
		// claims to be disabled.
		assert.notEqual( plant.colony.enabled, false )
		assert.equal( typeof plant.colony.ask, 'function' )

		await plant.destroy()

	} )

	it( 'is not mistaken for a promise', async () => {

		const plant = await fresh()

		// A thenable in this slot would make `await plant.colony` hang or throw
		// somewhere far from the cause.
		assert.equal( plant.colony.then, undefined )
		assert.equal( await plant.colony !== undefined, true )

		await plant.destroy()

	} )

} )
