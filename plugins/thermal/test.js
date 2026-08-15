import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from 'smartplant'

import plugin from './index.js'

/** A cool canopy against a warmer wall. */
const frame = ( canopy, spread = 0.5, wall = 23 ) => {

	const w = 64, h = 48
	const data = new Float32Array( w * h )

	for ( let i = 0; i < data.length; i++ ) {

		const x = i % w, y = Math.floor( i / w )
		data[ i ] = ( x > 12 && x < 50 && y > 8 && y < 40 )
			? canopy + ( ( x + y ) % 5 ) * spread / 5
			: wall + ( i % 7 ) * 0.05

	}

	return {
		width : w,
		height : h,
		data,
	}

}

const plant = async ( canopy, spread ) => {

	const p = await createPlant( {
		name : 'Warm',
		species : 'Ficus',
		sensor : { driver : 'mock' },
		ai : { provider : 'mock' },
	} )
	await p.use( plugin )
	await p.read()
	p.memory.lastReading.temperature = 23

	if ( canopy !== undefined ) {

		const cam = await p.attachSensor( {
			driver : 'thermal',
			frame : async () => frame( canopy, spread ),
		} )
		await cam.read()

	}

	return p

}

describe( '@smartplant/thermal', () => {

	it( 'says so when there is no camera', async () => {

		const p = await plant()
		assert.equal( ( await p.plugin( 'thermal' ).stress() ).known, false )
		await p.destroy()

	} )

	it( 'reads a cool canopy as a plant with water to spend', async () => {

		const p = await plant( 21.2 )
		const r = await p.plugin( 'thermal' ).stress()

		assert.ok( r.index < 0.3 )
		await p.destroy()

	} )

	it( 'reads a canopy at air temperature as one that has shut down', async () => {

		const p = await plant( 24, 0.5 )
		p.sensors.peek( 'thermal' ).frame = async () => frame( 24, 0.5, 28 )
		await p.sensors.peek( 'thermal' ).read()

		const r = await p.plugin( 'thermal' ).stress()
		assert.ok( r.index > 0.6 )
		await p.destroy()

	} )

	it( 'sees half a canopy working, which a clip cannot', async () => {

		const p = await plant( 21, 25 )
		const r = await p.plugin( 'thermal' ).evenness()

		assert.equal( r.even, false )
		assert.match( r.why, /whichever it happened to be clipped to/ )

		await p.destroy()

	} )

	it( 'draws a map that is relative on purpose', async () => {

		const p = await plant( 21 )
		const m = await p.plugin( 'thermal' ).map()

		assert.equal( m.relative, true )
		assert.ok( m.rows.length > 4 )

		await p.destroy()

	} )

} )
