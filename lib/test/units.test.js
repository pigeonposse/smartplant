import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	after, describe, it,
} from 'node:test'

import { parseJSONLoose } from '../src/ai/service.js'
import { EventBus } from '../src/core/events.js'
import {
	loadMessages, LANGUAGES, t,
} from '../src/language/index.js'
import {
	comfortScore, deviations, happiness,
} from '../src/memory/context.js'
import { linearTrend, PlantMemory } from '../src/memory/store.js'
import { ManualSensor } from '../src/sensors/drivers/manual.js'
import { MockSensor } from '../src/sensors/drivers/mock.js'
import { mergeReadings } from '../src/sensors/registry.js'
import { happinessEmoji, offlineVoice } from '../src/voice/persona.js'

const tmp = await mkdtemp( join( tmpdir(), 'smartplant-units-' ) )
after( () => rm( tmp, {
	recursive : true,
	force     : true,
} ) )

describe( 'comfort model', () => {

	it( 'scores 100 inside the band', () => {

		assert.equal( comfortScore( 50, {
			min : 40,
			max : 60,
		} ), 100 )

	} )

	it( 'penalizes too-high as well as too-low — the 1.x bug', () => {

		const range = {
			min : 40,
			max : 60,
		}
		// 1.x normalization returned 100% for anything at or above max.
		assert.ok( comfortScore( 80, range ) < 100 )
		assert.ok( comfortScore( 20, range ) < 100 )
		assert.equal( comfortScore( 80, range ), comfortScore( 20, range ) )

	} )

	it( 'floors at 0 far outside the band', () => {

		assert.equal( comfortScore( 500, {
			min : 40,
			max : 60,
		} ), 0 )

	} )

	it( 'averages only the metrics actually measured', () => {

		const score = happiness( {
			temperature : 22,
			soil        : 50,
		} )
		assert.equal( score, 100 )

	} )

	it( 'reports deviations worst-first', () => {

		const devs = deviations( {
			soil        : 2,
			temperature : 27,
		} )
		assert.equal( devs[ 0 ].metric, 'soil' )
		assert.equal( devs[ 0 ].direction, 'low' )
		assert.equal( devs[ 1 ].direction, 'high' )

	} )

	it( 'returns 0 rather than NaN with no data', () => {

		assert.equal( happiness( {} ), 0 )

	} )

} )

describe( 'memory', () => {

	it( 'persists and reloads across instances', async () => {

		const path = join( tmp, 'persist.json' )

		const a = new PlantMemory( { path } )
		await a.load()
		await a.setPlant( {
			name : 'Rosa',
			species : 'Monstera',
		} )
		await a.addReading( {
			temperature : 21,
			soil : 55,
		} )
		await a.addEvent( 'water', { amount : 30 } )

		const b = new PlantMemory( { path } )
		await b.load()

		assert.equal( b.plant.name, 'Rosa' )
		assert.equal( b.data.readings.length, 1 )
		assert.equal( b.lastEvent( 'water' ).amount, 30 )

	} )

	it( 'enforces the ring-buffer cap', async () => {

		const m = new PlantMemory( {
			maxReadings : 5,
			autosave : false,
		} )
		for ( let i = 0; i < 20; i++ ) await m.addReading( { temperature : i } )

		assert.equal( m.data.readings.length, 5 )
		assert.equal( m.lastReading.temperature, 19 )

	} )

	it( 'computes stats and trend direction', async () => {

		const m = new PlantMemory( { autosave : false } )
		for ( const soil of [ 60, 55, 50, 45, 40 ] ) await m.addReading( { soil } )

		const s = m.stats( 24 ).soil
		assert.equal( s.n, 5 )
		assert.equal( s.min, 40 )
		assert.equal( s.max, 60 )
		assert.ok( s.trend < 0, 'soil is falling' )

	} )

	it( 'daysSince returns null for events that never happened', async () => {

		const m = new PlantMemory( { autosave : false } )
		assert.equal( m.daysSince( 'water' ), null )
		await m.addEvent( 'water' )
		assert.equal( m.daysSince( 'water' ), 0 )

	} )

	it( 'starts fresh instead of throwing on a corrupt file', async () => {

		const path = join( tmp, 'corrupt.json' )
		const { writeFile } = await import( 'node:fs/promises' )
		await writeFile( path, '{ not json at all', 'utf-8' )

		const m = new PlantMemory( { path } )
		await m.load()
		assert.equal( m.data.readings.length, 0 )

	} )

	it( 'migrates the 1.x historicalData shape', async () => {

		const path = join( tmp, 'v1.json' )
		const { writeFile } = await import( 'node:fs/promises' )
		await writeFile( path, JSON.stringify( {
			historicalData : [
				{
					timestamp : new Date().toISOString(),
					temperature : 20,
					humidity : 50,
					light : 300,
				},
			],
		} ), 'utf-8' )

		const m = new PlantMemory( { path } )
		await m.load()

		assert.equal( m.data.readings.length, 1 )
		assert.equal( m.lastReading.temperature, 20 )
		assert.equal( m.data.historicalData, undefined )

	} )

	it( 'linearTrend is 0 for a flat series and positive for a rising one', () => {

		assert.equal( linearTrend( [ 5, 5, 5, 5 ] ), 0 )
		assert.ok( linearTrend( [ 1, 2, 3, 4 ] ) > 0 )
		assert.equal( linearTrend( [ 7 ] ), 0 )

	} )

} )

describe( 'sensors', () => {

	it( 'the mock driver is deterministic for a given seed', async () => {

		const a = new MockSensor( { seed : 7 } )
		const b = new MockSensor( { seed : 7 } )
		assert.deepEqual( ( await a.read() ).soil, ( await b.read() ).soil )

	} )

	it( 'the mock plant dries out over time', async () => {

		const s = new MockSensor( {
			soil : 80,
			dryingRate : 2,
		} )
		const first = ( await s.read() ).soil
		for ( let i = 0; i < 10; i++ ) await s.read()
		const later = ( await s.read() ).soil

		assert.ok( later < first, `${later} should be below ${first}` )

	} )

	it( 'watering the mock raises soil moisture', async () => {

		const s = new MockSensor( { soil : 20 } )
		await s.read()
		s.water( 50 )
		assert.ok( ( await s.read() ).soil > 60 )

	} )

	it( 'the manual driver merges partial updates', async () => {

		const s = new ManualSensor( { initial : {
			soil : 40,
			temperature : 20,
		} } )
		s.set( { soil : 70 } )

		const r = await s.read()
		assert.equal( r.soil, 70 )
		assert.equal( r.temperature, 20, 'unset metrics survive' )

	} )

	it( 'normalize drops non-numeric values instead of storing NaN', async () => {

		const s = new ManualSensor( { initial : {
			soil : 'wet',
			temperature : 21,
		} } )
		const r = await s.read()

		assert.equal( r.soil, undefined )
		assert.equal( r.temperature, 21 )

	} )

	it( 'mergeReadings gives priority to the first driver', () => {

		const merged = mergeReadings( [
			{
				soil : 10,
				source : 'a',
			},
			{
				soil : 90,
				temperature : 22,
				source : 'b',
			},
		] )

		assert.equal( merged.soil, 10 )
		assert.equal( merged.temperature, 22 )

	} )

} )

describe( 'ai json parsing', () => {

	it( 'parses clean JSON', () => {

		assert.deepEqual( parseJSONLoose( '{"a":1}' ), { a : 1 } )

	} )

	it( 'parses fenced JSON', () => {

		assert.deepEqual( parseJSONLoose( '```json\n{"a":1}\n```' ), { a : 1 } )

	} )

	it( 'recovers JSON buried in prose', () => {

		assert.deepEqual( parseJSONLoose( 'Sure! Here you go:\n{"a":1}\nHope that helps.' ), { a : 1 } )

	} )

	it( 'does not truncate on a brace inside a string', () => {

		const parsed = parseJSONLoose( '{"advice":"use a {pot} with drainage","emoji":"🌿"}' )
		assert.equal( parsed.advice, 'use a {pot} with drainage' )

	} )

	it( 'returns null for unparseable text rather than throwing', () => {

		assert.equal( parseJSONLoose( 'no json here' ), null )
		assert.equal( parseJSONLoose( null ), null )

	} )

} )

describe( 'event bus', () => {

	it( 'awaits async listeners', async () => {

		const bus = new EventBus()
		let done = false

		bus.on( 'x', async () => {

			await new Promise( r => setTimeout( r, 10 ) )
			done = true

		} )
		await bus.emit( 'x' )

		assert.equal( done, true )

	} )

	it( 'collects listener errors instead of throwing', async () => {

		const bus = new EventBus()
		bus.on( 'x', () => {

			throw new Error( 'boom' )

		} )

		const { errors } = await bus.emit( 'x' )
		assert.equal( errors.length, 1 )

	} )

	it( 'off() and once() work', async () => {

		const bus = new EventBus()
		let n = 0

		const off = bus.on( 'x', () => n++ )
		await bus.emit( 'x' )
		off()
		await bus.emit( 'x' )
		assert.equal( n, 1 )

		bus.once( 'y', () => n++ )
		await bus.emit( 'y' )
		await bus.emit( 'y' )
		assert.equal( n, 2 )

	} )

	it( 'wildcard listeners see every event', async () => {

		const bus = new EventBus()
		const seen = []

		bus.on( '*', ( _, name ) => seen.push( name ) )
		await bus.emit( 'a' )
		await bus.emit( 'b' )

		assert.deepEqual( seen, [ 'a', 'b' ] )

	} )

} )

describe( 'i18n', () => {

	it( 'registers all ten locales, including nl which 1.x silently dropped', () => {

		assert.equal( LANGUAGES.length, 10 )
		assert.ok( LANGUAGES.includes( 'nl' ) )
		assert.notEqual( loadMessages( 'nl' ).general.welcome, loadMessages( 'en' ).general.welcome )

	} )

	it( 'accepts regional codes and falls back to English', () => {

		assert.equal( loadMessages( 'es-ES' ).general.welcome, loadMessages( 'es' ).general.welcome )
		assert.equal( loadMessages( 'xx' ).general.welcome, loadMessages( 'en' ).general.welcome )

	} )

	it( 'interpolates placeholders', () => {

		assert.equal( t( 'Hello {name}', { name : 'Rosa' } ), 'Hello Rosa' )
		assert.equal( t( 'Hello {name}', {} ), 'Hello {name}' )

	} )

} )

describe( 'voice', () => {

	it( 'maps wellbeing onto a face', () => {

		assert.equal( happinessEmoji( 95 ), '🤩' )
		assert.equal( happinessEmoji( 5 ), '😵' )
		assert.equal( happinessEmoji( NaN ), '❔' )

	} )

	it( 'always produces a true sentence with no AI', () => {

		const ctx = {
			plant : { name : 'Rosa' },
			current : { soil : 10 },
			happiness : 20,
			deviations : [ {
				metric : 'soil',
				value : 10,
				direction : 'low',
				range : {
					min : 35,
					max : 70,
				},
				unit : '%',
				score : 20,
			} ],
			care : {},
		}

		const line = offlineVoice( ctx )
		assert.match( line, /Rosa/ )
		assert.match( line, /10%/ )

	} )

	it( 'says so when there is no data at all', () => {

		const line = offlineVoice( {
			plant : {},
			current : {},
			deviations : [],
			care : {},
		} )
		assert.match( line, /no readings yet/ )

	} )

} )

describe( 'message catalogue aliases', () => {

	it( 'exposes soil and humidity alert strings — 1.x crashed here', () => {

		const m = loadMessages( 'en' )
		assert.ok( m.alerts.soil?.low, 'alerts.soil must resolve' )
		assert.ok( m.alerts.humidity?.low, 'alerts.humidity must resolve' )
		assert.equal( m.alerts.soil.low, m.alerts.moisture.low )

	} )

	it( 'aliases every locale, not just English', () => {

		for ( const lang of LANGUAGES ) {

			assert.ok( loadMessages( lang ).alerts.soil?.low, `${lang} missing alerts.soil` )

		}

	} )

} )
