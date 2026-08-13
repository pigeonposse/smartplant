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
import { formatDiagnosis, RESULT } from '../src/diagnosis/index.js'

const plain = ( overrides = {} ) => createPlant( {
	name    : 'Prueba',
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
