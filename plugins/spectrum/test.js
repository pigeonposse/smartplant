import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from 'smartplant'

import plugin from './index.js'

describe( '@smartplant/spectrum', () => {

	const makePlant = () => createPlant( {
		name    : 'Test Plant',
		species : 'Monstera deliciosa',
		// An electrode is what makes a probe measurable; synthetic needs no hardware.
		sensor  : {
			driver : 'electrode',
			transport : 'synthetic',
			sampleRate : 2,
			bufferSeconds : 7200,
			mainsHz : 0,
			circadianMv : 0,
		},
		ai      : { provider : 'mock' },
	} )

	it( 'installs and diagnose() runs a full spectral sweep', async () => {

		const plant = await makePlant()
		await plant.use( plugin, { spectral : {
			light  : { driver : 'mock' },
			safety : { darkHours : [ 25, 26 ] },
		} } )

		const result = await plant.plugin( 'spectrum' ).diagnose( {
			bands : [ 'amber', 'blue', 'red' ],
			cycles : 2,
			simulate : true,
		} )

		assert.equal( typeof result, 'object' )
		assert.ok( result.advice.length > 0 )
		assert.ok( result.findings.length > 0 )
		assert.ok( result.sweep.responses.amber, 'the control band must run' )

		await plant.destroy()

	} )

	it( 'reports the fixture channels and today\'s doses', async () => {

		const plant = await makePlant()
		await plant.use( plugin, { spectral : {
			light  : { driver : 'mock', channels : [ 'blue', 'red' ] },
			safety : { darkHours : [ 25, 26 ] },
		} } )

		const spectrum = plant.plugin( 'spectrum' )
		assert.deepEqual( spectrum.channels(), [ 'blue', 'red' ] )
		assert.ok( Array.isArray( spectrum.doses() ) )

		await plant.destroy()

	} )

	it( 'refuses to force stomata open on a dry plant', async () => {

		const plant = await makePlant()
		await plant.use( plugin, { spectral : {
			light  : { driver : 'mock' },
			safety : { darkHours : [ 25, 26 ] },
		} } )

		// The plant reports dry soil, so blue therapy must be refused.
		plant.getSensor( 'electrode' ).push( 0 )
		await plant.memory.addReading( { soil : 12, timestamp : new Date() } )

		const r = await plant.plugin( 'spectrum' ).treat( 'blue', {
			seconds : 60,
			simulate : true,
		} )

		assert.equal( r.applied, false )
		assert.match( r.explanation, /conserve water|accelerates dehydration/ )

		await plant.destroy()

	} )

	it( 'turns the lamp off on teardown', async () => {

		const plant = await makePlant()
		await plant.use( plugin, { spectral : {
			light  : { driver : 'mock' },
			safety : { darkHours : [ 25, 26 ] },
		} } )

		await plant.spectral.light.emit( { red : 1 } )
		await plant.plugin( 'spectrum' ).destroy()

		assert.deepEqual( plant.spectral.light.current, {}, 'a lamp must never be left on' )

		await plant.destroy()

	} )

} )
