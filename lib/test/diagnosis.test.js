/**
 * The setup check somebody runs after wiring a plant.
 *
 * Two things decide whether this is useful or noise: it must not call an absent
 * subsystem broken, and every red line must end in something a person can
 * actually go and do.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import { LoopbackBus } from '../src/colony/index.js'
import { formatDiagnosis, RESULT } from '../src/diagnosis/index.js'

const plain = ( overrides = {} ) => createPlant( {
	name    : 'Trial',
	species : 'Ficus lyrata',
	sensor  : {
		driver : 'mock',
		dayNight : false,
	},
	ai      : { provider : 'mock' },
	...overrides,
} )

const find = ( report, area ) => report.checks.find( c => c.area === area )

describe( 'system diagnosis', () => {

	it( 'passes a working setup', async () => {

		const plant = await plain()
		const r = await plant.systemDiagnosis()

		assert.equal( r.ok, true )
		assert.equal( r.counts.fail, 0 )
		assert.equal( find( r, 'reading' ).result, RESULT.OK )

		await plant.destroy()

	} )

	it( 'calls what is not configured absent, not broken', async () => {

		// Telling somebody their camera is down when they never wanted one is how
		// people learn to ignore warnings.
		const plant = await plain()
		const r = await plant.systemDiagnosis()

		for ( const area of [ 'electrode', 'spectral', 'vision', 'colony' ] ) {

			assert.equal( find( r, area ).result, RESULT.ABSENT, `${area} should be absent, not failing` )

		}
		assert.equal( r.ok, true )

		await plant.destroy()

	} )

	it( 'reads an impossible value as a broken sensor, not a distressed plant', async () => {

		const plant = await plain( { sensor : {
			driver : 'manual',
			initial : {
				humidity : 140,
				temperature : 22,
				soil : 50,
				light : 900,
			},
		} } )

		const r = await plant.systemDiagnosis()
		const reading = find( r, 'reading' )

		assert.equal( reading.result, RESULT.FAIL )
		assert.match( reading.says, /wiring or calibration fault, not a plant in distress/ )
		assert.match( reading.fix, /Check the humidity probe/ )

		await plant.destroy()

	} )

	it( 'catches a lead that is not touching the plant', async () => {

		const plant = await plain( { sensor : {
			driver : 'electrode',
			transport : 'synthetic',
			sampleRate : 5,
			bufferSeconds : 600,
			mainsHz : 0,
		} } )

		plant.getSensor( 'electrode' ).advance( 120 )
		plant.getSensor( 'electrode' ).buffer = Array.from( { length : 500 }, () => -60 )

		const r = await plant.systemDiagnosis()
		const electrode = find( r, 'electrode' )

		assert.equal( electrode.result, RESULT.FAIL )
		assert.match( electrode.fix, /Reseat the electrode/ )
		assert.equal( r.ok, false )

		await plant.destroy()

	} )

	it( 'catches a sample rate that cannot see the mains', async () => {

		const plant = await plain( { sensor : {
			driver : 'electrode',
			transport : 'synthetic',
			sampleRate : 5,
			bufferSeconds : 600,
			mainsHz : 50,
		} } )
		plant.getSensor( 'electrode' ).advance( 120 )

		const electrode = find( await plant.systemDiagnosis(), 'electrode' )

		assert.equal( electrode.result, RESULT.FAIL )
		assert.match( electrode.fix, /Raise the electrode sample rate above 100Hz/ )

		await plant.destroy()

	} )

	it( 'does not fail an electrode-only rig for having no soil probe', async () => {

		// It reports voltage and activity and nothing else, which is exactly what
		// it was configured to do.
		const plant = await plain( { sensor : {
			driver : 'electrode',
			transport : 'synthetic',
			sampleRate : 5,
			bufferSeconds : 600,
			mainsHz : 0,
		} } )
		plant.getSensor( 'electrode' ).advance( 120 )

		assert.equal( find( await plant.systemDiagnosis(), 'reading' ).result, RESULT.OK )

		await plant.destroy()

	} )

	it( 'warns that one electrode can never attribute drift', async () => {

		const plant = await plain( { sensor : {
			driver : 'electrode',
			transport : 'synthetic',
			sampleRate : 5,
			bufferSeconds : 600,
			mainsHz : 0,
		} } )
		plant.getSensor( 'electrode' ).advance( 120 )

		const electrode = find( await plant.systemDiagnosis(), 'electrode' )

		assert.equal( electrode.result, RESULT.WARN )
		assert.match( electrode.fix, /A second electrode/ )

		await plant.destroy()

	} )

	it( 'warns that memory in a process is memory that will be lost', async () => {

		const plant = await plain()
		const memory = find( await plant.systemDiagnosis(), 'memory' )

		assert.equal( memory.result, RESULT.WARN )
		assert.match( memory.fix, /Give it somewhere to live/ )

		await plant.destroy()

	} )

	it( 'says when the AI is only a mock', async () => {

		const plant = await plain()
		const ai = find( await plant.systemDiagnosis(), 'ai' )

		assert.equal( ai.result, RESULT.WARN )
		assert.match( ai.says, /canned text/ )

		await plant.destroy()

	} )

	it( 'reports an unreachable provider without failing the whole plant', async () => {

		const plant = await plain( { ai : {
			provider : 'ollama',
			host : 'http://127.0.0.1:1',
			timeout : 800,
			retries : 0,
		} } )

		const ai = find( await plant.systemDiagnosis(), 'ai' )

		assert.equal( ai.result, RESULT.FAIL )
		// The plant keeps working offline, and the fix says so.
		assert.match( ai.fix, /key|reachable/i )

		await plant.destroy()

	} )

	it( 'skips contacting the model when asked to', async () => {

		const plant = await plain( { ai : {
			provider : 'ollama',
			host : 'http://127.0.0.1:1',
		} } )

		const ai = find( await plant.systemDiagnosis( { probeAI : false } ), 'ai' )

		assert.equal( ai.result, RESULT.OK )
		assert.match( ai.says, /not contacted/ )

		await plant.destroy()

	} )

	it( 'notices a colony with nobody in it', async () => {

		const { LoopbackBus } = await import( '../src/colony/index.js' )
		const plant = await plain()
		await plant.joinColony( { transport : new LoopbackBus().endpoint( 'solo' ) } )

		const colony = find( await plant.systemDiagnosis(), 'colony' )

		assert.equal( colony.result, RESULT.WARN )
		assert.match( colony.fix, /same address/ )

		await plant.destroy()

	} )

	it( 'gives every red and amber line something to do', async () => {

		const plant = await plain( { sensor : {
			driver : 'electrode',
			transport : 'synthetic',
			sampleRate : 5,
			bufferSeconds : 600,
			mainsHz : 50,
		} } )
		plant.getSensor( 'electrode' ).advance( 120 )

		const r = await plant.systemDiagnosis()

		// "Electrode: degraded" is a fact with no next step. The point of this
		// whole module is that it never stops there.
		for ( const c of r.checks ) {

			if ( c.result === RESULT.FAIL || c.result === RESULT.WARN ) {

				assert.ok( c.fix, `${c.area} is ${c.result} with nothing to do about it` )

			}

		}

		assert.equal( r.fixes.length, r.checks.filter( c => c.result !== RESULT.OK && c.result !== RESULT.ABSENT ).length )

		await plant.destroy()

	} )

	it( 'renders a report a person can read', async () => {

		const plant = await plain()
		const text = formatDiagnosis( await plant.systemDiagnosis() )

		assert.match( text, /System diagnosis/ )
		assert.match( text, /working · .* to look at · .* broken/ )
		assert.match( text, /What to change/ )

		await plant.destroy()

	} )

} )

describe( 'the subsystems added in 3.0.4', () => {

	it( 'checks every one of them', async () => {

		const plant = await plain()
		const areas = ( await plant.systemDiagnosis( { probeAI : false } ) ).checks.map( c => c.area )

		for ( const a of [ 'states', 'coupling', 'optical', 'security', 'navigation', 'dashboard' ] ) {

			assert.ok( areas.includes( a ), `${a} is not diagnosed` )

		}

		await plant.destroy()

	} )

	it( 'names the instrument each unassessable state is waiting on', async () => {

		const plant = await plain()
		const states = ( await plant.systemDiagnosis( { probeAI : false } ) ).checks
			.find( c => c.area === 'states' )

		// The most useful thing this check can do on a new rig: turn "you could
		// add sensors" into a specific list of what each one switches on.
		assert.match( `${states.says} ${states.fix ?? ''}`, /electrode/ )

		await plant.destroy()

	} )

	it( 'fails a plant that can move and has not been measured', async () => {

		const plant = await plain()
		plant.body = { drive : {} }

		const nav = ( await plant.systemDiagnosis( { probeAI : false } ) ).checks
			.find( c => c.area === 'navigation' )

		assert.equal( nav.result, RESULT.FAIL )
		assert.match( nav.fix, /tape measure/ )

		await plant.destroy()

	} )

	it( 'warns when the dashboard is listening beyond loopback', async () => {

		const plant = await plain()

		const quiet = ( await plant.systemDiagnosis( { probeAI : false } ) ).checks
			.find( c => c.area === 'dashboard' )
		assert.equal( quiet.result, RESULT.ABSENT )

		const server = await plant.serve( {
			port : 7891,
			host : '0.0.0.0',
		} )

		const loud = ( await plant.systemDiagnosis( { probeAI : false } ) ).checks
			.find( c => c.area === 'dashboard' )
		assert.equal( loud.result, RESULT.WARN )
		assert.match( loud.fix, /whether anybody is home/ )

		await server.close()
		await plant.destroy()

	} )

	it( 'warns about a fixture that can emit UV-B', async () => {

		const plant = await plain()
		await plant.useSpectral( { light : { driver : 'mock' } } )

		const without = ( await plant.systemDiagnosis( { probeAI : false } ) ).checks
			.find( c => c.area === 'security' )
		assert.equal( without.result, RESULT.ABSENT )

		plant.spectral.light.channels = [ 'red', 'blue', 'uvb' ]

		const with_ = ( await plant.systemDiagnosis( { probeAI : false } ) ).checks
			.find( c => c.area === 'security' )
		assert.equal( with_.result, RESULT.WARN )
		// The interlocks do not apply to a lamp somebody switches on by hand.
		assert.match( with_.fix, /outside this library/ )

		await plant.destroy()

	} )

	it( 'catches an emitter with nobody able to decode it', async () => {

		const bus = new LoopbackBus()

		const make = async ( name, extra = {} ) => {

			const p = await createPlant( {
				name,
				species : 'Ficus',
				sensor : { driver : 'mock' },
				ai : { provider : 'mock' },
			} )
			Object.assign( p, extra )
			await p.read()
			await p.joinColony( { transport : bus.endpoint( name.toLowerCase() ) } )
			return p

		}

		const emitter = await make( 'Ivy' )
		await emitter.useSpectral( { light : { driver : 'mock' } } )
		const deaf = await make( 'Fern' )
		await new Promise( r => setTimeout( r, 40 ) )

		const optical = ( await emitter.systemDiagnosis( { probeAI : false } ) ).checks
			.find( c => c.area === 'optical' )

		assert.equal( optical.result, RESULT.WARN )
		assert.match( optical.fix, /blinking at a wall/ )

		await Promise.all( [ emitter, deaf ].map( p => p.destroy() ) )

	} )

} )

describe( 'the subsystems added in 3.0.5', () => {

	it( 'checks every one of them', async () => {

		const plant = await plain()
		const areas = ( await plant.systemDiagnosis( { probeAI : false } ) ).checks.map( c => c.area )

		for ( const a of [
			'transplant', 'thermal', 'activity',
			'consolidation', 'provenance', 'profile',
			'season', 'pot', 'root-space',
		] ) {

			assert.ok( areas.includes( a ), `${a} is not diagnosed` )

		}

		await plant.destroy()

	} )

	it( 'says a settling transplant is caution rather than a fault', async () => {

		const plant = await plain( { pot : { litres : 2 } } )
		await plant.transplant( { volumeL : 6 } )

		const t = find( await plant.systemDiagnosis( { probeAI : false } ), 'transplant' )

		assert.equal( t.result, RESULT.WARN )
		assert.match( t.fix, /Nothing to fix — the caution is deliberate/ )
		// And it names what is being held back, so "root-space: not applicable"
		// does not read as a missing sensor.
		assert.match( t.fix, /root-space estimate stands aside/ )

		await plant.destroy()

	} )

	it( 'fails a thermal camera that produces no frame', async () => {

		const plant = await plain()
		await plant.attachSensor( {
			driver : 'thermal',
			frame  : async () => null,
		} )

		const t = find( await plant.systemDiagnosis( { probeAI : false } ), 'thermal' )

		assert.equal( t.result, RESULT.FAIL )
		assert.match( t.fix, /one temperature per pixel/ )

		await plant.destroy()

	} )

	it( 'names the plugins that are installed and cannot do anything yet', async () => {

		const plant = await plain()
		await plant.use( ( await import( '@smartplant/season' ) ).default )
		await plant.use( ( await import( '@smartplant/presence' ) ).default )

		const p = find( await plant.systemDiagnosis( { probeAI : false } ), 'plugins' )

		assert.equal( p.result, RESULT.WARN )
		assert.match( p.fix, /season wants/ )
		assert.match( p.fix, /presence wants/ )
		// The point of saying it: a refusal is honest and also a quiet way to
		// conclude nothing works.
		assert.match( p.fix, /quiet way to conclude nothing works/ )

		await plant.destroy()

	} )

	it( 'stops warning about a plugin once it has what it needs', async () => {

		const plant = await plain( { hemisphere : 'north' } )
		await plant.use( ( await import( '@smartplant/season' ) ).default )

		const p = find( await plant.systemDiagnosis( { probeAI : false } ), 'plugins' )

		assert.equal( p.result, RESULT.OK )

		await plant.destroy()

	} )

	it( 'fails a plugin that installed without an init', async () => {

		const plant = await plain()
		plant.plugins.set( 'inert', { name : 'inert' } )

		const p = find( await plant.systemDiagnosis( { probeAI : false } ), 'plugins' )

		assert.equal( p.result, RESULT.FAIL )
		assert.match( p.fix, /definePlugin/ )

		await plant.destroy()

	} )

	it( 'reports the profiler as off rather than as broken', async () => {

		const plant = await plain()
		const p = find( await plant.systemDiagnosis( { probeAI : false } ), 'profile' )

		assert.equal( p.result, RESULT.ABSENT )

		await plant.destroy()

	} )

	it( 'runs consolidation without emitting anything', async () => {

		const plant = await plain()
		const seen = []
		plant.on( '*', e => { seen.push( e?.type ?? e?.event ?? '' ) } )

		const c = find( await plant.systemDiagnosis( { probeAI : false } ), 'consolidation' )

		assert.equal( c.result, RESULT.OK )
		// The diagnosis takes a reading, which is an event. What consolidation
		// must never do is announce a conclusion drawn from rereading old data.
		assert.equal( seen.filter( t => `${t}`.startsWith( 'consolidat' ) ).length, 0 )

		await plant.destroy()

	} )

	it( 'every new line still ends in something to do when it is not green', async () => {

		const plant = await plain()
		const r = await plant.systemDiagnosis( { probeAI : false } )

		for ( const c of r.checks ) {

			if ( c.result === RESULT.WARN || c.result === RESULT.FAIL ) {

				assert.ok( c.fix, `${c.area} is ${c.result} with nothing to do about it` )

			}

		}

		await plant.destroy()

	} )

} )
