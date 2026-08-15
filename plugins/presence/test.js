import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from 'smartplant'

import plugin from './index.js'

/** Deterministic: a quiet room, then a busy one. */
const radio = ( noise ) => {

	let i = 0
	return async () => 40 + ( ( i++ % 7 ) - 3 ) * noise

}

const plant = async ( noise, samples = 60 ) => {

	const p = await createPlant( {
		name : 'Shelf',
		species : 'Ficus',
		sensor : { driver : 'mock' },
		ai : { provider : 'mock' },
	} )
	await p.use( plugin )

	if ( noise !== undefined ) {

		const s = await p.attachSensor( {
			driver : 'presence',
			sensing : 'rssi',
			sample : radio( noise ),
		} )
		for ( let i = 0; i < samples; i++ ) await s.read()

	}

	return p

}

describe( '@smartplant/presence', () => {

	it( 'refuses UV-B when it cannot see the room', async () => {

		const p = await plant()
		const r = p.plugin( 'presence' ).uvbAllowed()

		assert.equal( r.allowed, false )
		assert.match( r.why, /An interlock that opens when it cannot see is not an interlock/ )

		await p.destroy()

	} )

	it( 'refuses while the radio is still settling', async () => {

		const p = await plant( 0.4, 10 )
		assert.equal( p.plugin( 'presence' ).uvbAllowed().allowed, false )
		await p.destroy()

	} )

	it( 'allows UV-B in an empty room, and names what empty means', async () => {

		const p = await plant( 0.4 )
		const r = p.plugin( 'presence' ).uvbAllowed()

		assert.equal( r.allowed, true )
		assert.match( r.why, /a person sitting perfectly still is the case a WiFi radio cannot see/i )

		await p.destroy()

	} )

	it( 'claims neither direction nor pose', async () => {

		const p = await plant( 0.4 )
		const c = p.plugin( 'presence' ).capability()

		assert.equal( c.direction, false )
		assert.equal( c.pose, false )

		await p.destroy()

	} )

	it( 'has no opinion about a moment it did not sample', async () => {

		const p = await plant( 0.4 )
		const r = await p.plugin( 'presence' ).explains( Date.now() - 86_400_000 )

		assert.equal( r.explains, null )
		await p.destroy()

	} )

} )
