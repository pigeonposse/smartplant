/**
 * Integrations, firmware generation, federated learning, and the multimodal
 * kernel surface that ties them together.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	after, describe, it,
} from 'node:test'

import { createPlant, EVENTS } from '../src/index.js'
import {
	aggregate, applyProfile, computeLocalUpdate, FederatedRegistry,
} from '../src/federated/index.js'
import {
	generateArduinoSketch, generateEspIdf, generatePlatformIO, generateProject,
	SUPPORTED_SENSORS,
} from '../src/firmware/index.js'
import {
	generateFlow, prometheusMetrics, toLineProtocol,
} from '../src/integrations/index.js'

const tmp = await mkdtemp( join( tmpdir(), 'smartplant-platform-' ) )
after( () => rm( tmp, {
	recursive : true,
	force     : true,
} ) )

const makePlant = extra => createPlant( {
	name    : 'Rosa',
	species : 'Monstera deliciosa',
	sensor  : 'mock',
	ai      : { provider : 'mock' },
	memory  : { path : join( tmp, `${Math.random().toString( 36 ).slice( 2 )}.json` ) },
	...extra,
} )

describe( 'influx line protocol', () => {

	it( 'renders a reading with tags and a millisecond timestamp', () => {

		const line = toLineProtocol( 'plant', {
			plant : 'Rosa',
			species : 'Monstera',
		}, {
			temperature : 21.5,
			soil        : 44,
			timestamp   : new Date( 1_700_000_000_000 ),
		} )

		assert.match( line, /^plant,plant=Rosa,species=Monstera / )
		assert.match( line, /temperature=21\.5/ )
		assert.match( line, /soil=44/ )
		assert.match( line, / 1700000000000$/ )

	} )

	it( 'escapes spaces and commas in tag values', () => {

		const line = toLineProtocol( 'plant', { plant : 'Big Rosa, the second' }, { soil : 10 } )
		assert.match( line, /plant=Big\\ Rosa\\,\\ the\\ second/ )

	} )

	it( 'returns null when a reading has no numeric fields', () => {

		assert.equal( toLineProtocol( 'plant', {}, { timestamp : new Date() } ), null )

	} )

} )

describe( 'prometheus export', () => {

	it( 'emits gauges for every measured metric plus wellbeing', async () => {

		const plant = await makePlant()
		await plant.read()

		const text = prometheusMetrics( plant )

		assert.match( text, /# TYPE smartplant_temperature gauge/ )
		assert.match( text, /smartplant_wellbeing\{plant="Rosa"/ )
		assert.match( text, /smartplant_readings_total/ )

		await plant.destroy()

	} )

	it( 'escapes quotes in label values', async () => {

		const plant = await makePlant( { name : 'The "Big" One' } )
		await plant.read()

		assert.match( prometheusMetrics( plant ), /plant="The \\"Big\\" One"/ )
		await plant.destroy()

	} )

} )

describe( 'node-red flow generation', () => {

	it( 'produces an importable flow with a tab, broker and one input per metric', () => {

		const flow = generateFlow( {
			plantName : 'Rosa',
			metrics : [ 'soil', 'temperature' ],
		} )

		assert.equal( flow.filter( n => n.type === 'tab' ).length, 1 )
		assert.equal( flow.filter( n => n.type === 'mqtt-broker' ).length, 1 )
		assert.equal( flow.filter( n => n.type === 'mqtt in' ).length, 2 )
		assert.equal( flow.filter( n => n.type === 'ui_gauge' ).length, 2 )

	} )

	it( 'every node id is unique and every wire points at a real node', () => {

		const flow = generateFlow( { metrics : [ 'soil', 'temperature', 'light' ] } )

		const ids = flow.map( n => n.id )
		assert.equal( new Set( ids ).size, ids.length, 'duplicate node ids' )

		for ( const node of flow ) {

			for ( const wire of node.wires || [] ) {

				for ( const target of wire ) {

					assert.ok( ids.includes( target ), `wire points at unknown node ${target}` )

				}

			}

		}

	} )

	it( 'serializes to JSON, which is how Node-RED imports it', () => {

		assert.doesNotThrow( () => JSON.parse( JSON.stringify( generateFlow() ) ) )

	} )

} )

describe( 'firmware generation', () => {

	it( 'generates a sketch that reads the requested sensors', () => {

		const sketch = generateArduinoSketch( {
			sensors   : [ 'dht22', {
				type : 'capacitive_soil',
				pin : 34,
			} ],
			transport : 'mqtt',
			mqttHost  : '10.0.0.5',
		} )

		assert.match( sketch, /#include <DHT\.h>/ )
		assert.match( sketch, /DHT dht\(4, DHT22\)/ )
		assert.match( sketch, /const int SOIL_PIN = 34/ )
		assert.match( sketch, /10\.0\.0\.5/ )
		assert.match( sketch, /void setup\(\)/ )
		assert.match( sketch, /void loop\(\)/ )

	} )

	it( 'emits balanced braces — a crude but effective syntax check', () => {

		const sketch = generateArduinoSketch( { sensors : [ 'dht22', 'bh1750', 'capacitive_soil' ] } )

		const open = ( sketch.match( /\{/g ) || [] ).length
		const close = ( sketch.match( /\}/g ) || [] ).length
		assert.equal( open, close, 'unbalanced braces in generated firmware' )

	} )

	it( 'builds a JSON payload the mqtt driver can parse directly', () => {

		const sketch = generateArduinoSketch( { sensors : [ 'dht22' ] } )

		assert.match( sketch, /String payload = "\{"/ )
		assert.match( sketch, /\\"temperature\\"/ )
		assert.match( sketch, /\\"humidity\\"/ )
		assert.match( sketch, /payload \+= "\}"/ )

	} )

	it( 'omits WiFi entirely for the serial transport', () => {

		const sketch = generateArduinoSketch( {
			sensors : [ 'dht22' ],
			transport : 'serial',
		} )

		assert.ok( !sketch.includes( 'WiFi.begin' ), 'serial firmware must not drag in WiFi' )
		assert.match( sketch, /Serial\.println\(payload\)/ )

	} )

	it( 'lists the right libraries in platformio.ini', () => {

		const ini = generatePlatformIO( {
			sensors : [ 'dht22', 'bh1750' ],
			transport : 'mqtt',
		} )

		assert.match( ini, /platform = espressif32/ )
		assert.match( ini, /DHT sensor library/ )
		assert.match( ini, /BH1750/ )
		assert.match( ini, /PubSubClient/ )

	} )

	it( 'omits PubSubClient when MQTT is not used', () => {

		const ini = generatePlatformIO( {
			sensors : [ 'dht22' ],
			transport : 'serial',
		} )
		assert.ok( !ini.includes( 'PubSubClient' ) )

	} )

	it( 'generates an ESP-IDF project that deep-sleeps', () => {

		const c = generateEspIdf( {
			sensors : [ 'capacitive_soil' ],
			intervalMs : 600_000,
		} )

		assert.match( c, /void app_main\(void\)/ )
		assert.match( c, /esp_deep_sleep/ )
		assert.match( c, /600ULL \* 1000000ULL/ )

	} )

	it( 'generateProject returns every file for the chosen target', () => {

		const pio = generateProject( { target : 'platformio' } )
		assert.deepEqual( Object.keys( pio ).sort(), [ 'README.md', 'platformio.ini', 'src/main.cpp' ] )

		const idf = generateProject( { target : 'esp-idf' } )
		assert.ok( 'main/main.c' in idf )
		assert.ok( 'CMakeLists.txt' in idf )

		const ino = generateProject( { target : 'arduino' } )
		assert.ok( 'smartplant/smartplant.ino' in ino )

	} )

	it( 'rejects an unknown sensor by name', () => {

		assert.throws( () => generateArduinoSketch( { sensors : [ 'tricorder' ] } ), /Unknown sensor "tricorder"/ )

	} )

	it( 'every supported sensor generates without throwing', () => {

		for ( const type of Object.keys( SUPPORTED_SENSORS ) ) {

			assert.doesNotThrow( () => generateArduinoSketch( { sensors : [ type ] } ), `sensor ${type} failed` )

		}

	} )

} )

describe( 'federated learning', () => {

	/** A plant with a month of healthy readings and regular waterings. */
	async function trainedPlant( bias = 0 ) {

		const plant = await makePlant( { memory : {
			path : join( tmp, `fed-${Math.random().toString( 36 ).slice( 2 )}.json` ),
			autosave : false,
		} } )

		await plant.memory.setPlant( { species : 'Monstera deliciosa' } )

		for ( let i = 0; i < 60; i++ ) {

			await plant.memory.addReading( {
				temperature : 21 + bias + ( i % 3 ),
				humidity    : 52 + bias,
				soil        : 50 + bias,
				light       : 400,
			} )

		}
		for ( let i = 0; i < 4; i++ ) {

			await plant.memory.addEvent( 'water', {} )

		}

		return plant

	}

	it( 'produces an update that carries statistics, never raw readings', async () => {

		const plant = await trainedPlant()
		const update = computeLocalUpdate( plant )

		assert.ok( update, 'expected an update' )
		assert.equal( update.species, 'monstera deliciosa' )
		assert.ok( update.metrics.temperature.min > 0 )
		assert.ok( update.samples >= 20 )

		// The privacy guarantee, asserted rather than assumed.
		assert.ok( !( 'readings' in update ) )
		assert.ok( !( 'events' in update ) )
		assert.ok( !( 'name' in update ) )
		assert.ok( !JSON.stringify( update ).includes( 'Rosa' ) )

		await plant.destroy()

	} )

	it( 'refuses to produce an update from too little data', async () => {

		const plant = await makePlant()
		await plant.read()

		assert.equal( computeLocalUpdate( plant ), null )
		await plant.destroy()

	} )

	it( 'aggregates several updates by weighted average', async () => {

		const plants = await Promise.all( [ trainedPlant( 0 ), trainedPlant( 2 ), trainedPlant( -2 ) ] )
		const updates = plants.map( p => computeLocalUpdate( p ) )

		const profile = aggregate( updates )

		assert.ok( profile )
		assert.equal( profile.contributors, 3 )
		// The three biases cancel, so the mean should sit near the middle plant.
		assert.ok( Math.abs( profile.ranges.temperature.min - 21 ) < 3 )

		for ( const p of plants ) await p.destroy()

	} )

	it( 'refuses to publish below the contributor threshold', async () => {

		const plant = await trainedPlant()
		assert.equal( aggregate( [ computeLocalUpdate( plant ) ] ), null )
		await plant.destroy()

	} )

	it( 'the registry rejects an update carrying raw history', () => {

		const registry = new FederatedRegistry()

		assert.throws( () => registry.submit( {
			species  : 'monstera',
			metrics  : { soil : {
				min : 40,
				max : 60,
				n : 30,
			} },
			readings : [ {
				t : 'x',
				soil : 1,
			} ],
		} ), /must not contain "readings"/ )

	} )

	it( 'the registry publishes once enough contributors exist', async () => {

		const registry = new FederatedRegistry( { minContributors : 3 } )
		const plants = await Promise.all( [ trainedPlant( 0 ), trainedPlant( 1 ), trainedPlant( -1 ) ] )

		for ( const p of plants ) registry.submit( computeLocalUpdate( p ) )

		const profile = registry.profile( 'Monstera deliciosa' )
		assert.ok( profile, 'expected a published profile' )
		assert.equal( profile.source, 'federated' )

		for ( const p of plants ) await p.destroy()

	} )

	it( 'applying a profile blends rather than overwrites local ranges', async () => {

		const plant = await makePlant()
		const before = { ...plant.ranges.temperature }

		applyProfile( plant, { ranges : { temperature : {
			min : 30,
			max : 40,
		} } }, { weight : 0.5 } )

		const after = plant.ranges.temperature
		assert.ok( after.min > before.min && after.min < 30, 'must land between local and community' )

		await plant.destroy()

	} )

} )

describe( 'multimodal kernel', () => {

	it( 'exposes a knowledge layer by default', async () => {

		const plant = await makePlant()
		assert.ok( plant.knowledge )
		assert.ok( plant.knowledge.store.size > 0, 'ontology should be preloaded' )
		await plant.destroy()

	} )

	it( 'diagnose() derives a condition with its reasoning', async () => {

		const plant = await makePlant( { sensor : {
			driver : 'mock',
			soil : 3,
			humidity : 8,
		} } )
		await plant.read()

		const d = plant.diagnose()

		assert.ok( d.conclusions.some( c => c.conclusion === 'drought_stress' ) )
		assert.ok( d.treatments.some( t => t.treatment === 'water_thoroughly' ) )
		assert.match( d.explanation, /soil at/ )

		await plant.destroy()

	} )

	it( 'analyze() grounds the prompt with rules and recalled episodes', async () => {

		const plant = await makePlant( { sensor : {
			driver : 'mock',
			soil : 3,
			humidity : 8,
		} } )
		await plant.read()
		await plant.remember( 'this happened last winter too' )

		const result = await plant.analyze( 'What should I do?' )

		assert.ok( result.reasoning, 'the answer should carry its symbolic grounding' )
		assert.ok( result.reasoning.conclusions.length > 0 )
		assert.ok( Array.isArray( result.recalled ) )

		await plant.destroy()

	} )

	it( 'ground:false skips the reasoning pass', async () => {

		const plant = await makePlant()
		await plant.read()

		const result = await plant.analyze( 'How are you?', { ground : false } )
		assert.equal( result.reasoning, null )

		await plant.destroy()

	} )

	it( 'the electrode driver feeds electrophysiology into the context', async () => {

		const plant = await makePlant( {
			sensor : {
				driver : 'electrode',
				transport : 'synthetic',
				sampleRate : 10,
				mainsHz : 0,
				apPerHour : 400,
				circadianMv : 0,
			},
		} )

		await plant.read()
		const electro = await plant.listen( { seconds : 60 } )

		assert.ok( electro.features.time.n > 0 )
		assert.ok( 'damageSignal' in electro.summary )

		const ctx = plant.context()
		assert.ok( ctx.electro, 'context must carry the electrophysiology' )

		await plant.destroy()

	} )

	it( 'emits plant:damaged when a variation potential appears', async () => {

		const plant = await makePlant( {
			sensor : {
				driver : 'electrode',
				transport : 'synthetic',
				sampleRate : 5,
				mainsHz : 0,
				// No spontaneous events: the wound is injected explicitly, so the
				// test asserts the pipeline rather than a lucky random draw.
				apPerHour : 0,
				vpPerHour : 0,
				circadianMv : 0,
				noiseMv : 0.2,
			},
		} )

		let damaged = null
		plant.on( EVENTS.DAMAGE, e => {

			damaged = e

		} )

		plant.getSensor( 'electrode' ).stimulate( 'variation_potential' )
		await plant.listen( { seconds : 600 } )

		assert.ok( damaged, 'expected plant:damaged after a wounding stimulus' )
		assert.equal( damaged.summary.counts.variation_potential, 1 )

		await plant.destroy()

	} )

	it( 'perceive() survives a modality that is not configured', async () => {

		const plant = await makePlant()
		const out = await plant.perceive()

		assert.ok( out.reading )
		assert.equal( out.vision, undefined )
		assert.ok( out.context )

		await plant.destroy()

	} )

	it( 'remember() and recall() find a past situation', async () => {

		const plant = await makePlant( { sensor : {
			driver : 'mock',
			soil : 3,
			humidity : 8,
		} } )
		await plant.read()
		await plant.remember( 'the radiator was on and everything dried out' )

		const hits = await plant.recall( 'soil dry, air dry', { k : 1 } )

		assert.equal( hits.length, 1 )
		assert.match( hits[ 0 ].text, /radiator|dry/ )

		await plant.destroy()

	} )

	it( 'knowledge:false disables the layer cleanly', async () => {

		const plant = await makePlant( { knowledge : false } )
		await plant.read()

		assert.equal( plant.knowledge, null )
		await assert.rejects( async () => plant.diagnose(), /Knowledge layer is disabled/ )

		// The AI path must still work with the layer off.
		const result = await plant.analyze( 'How are you?' )
		assert.ok( result.advice.length > 0 )

		await plant.destroy()

	} )

} )
