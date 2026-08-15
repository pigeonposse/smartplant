import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from 'smartplant'

import plugin from './index.js'

const plant = async ( hemisphere ) => {

	const p = await createPlant( {
		name : 'Yearly',
		species : 'Ficus lyrata',
		sensor : { driver : 'mock' },
		ai : { provider : 'mock' },
		...( hemisphere ? { hemisphere } : {} ),
	} )
	await p.use( plugin )
	return p

}

describe( '@smartplant/season', () => {

	it( 'refuses to guess the hemisphere', async () => {

		const p = await plant()
		const r = await p.plugin( 'season' ).now()

		assert.equal( r.known, false )
		// Half the guesses would be exactly six months wrong.
		assert.match( r.why, /six months wrong/ )

		await p.destroy()

	} )

	it( 'leaves the bands alone without one', async () => {

		const p = await plant()
		assert.equal( ( await p.plugin( 'season' ).ranges() ).applied, false )
		await p.destroy()

	} )

	it( 'moves the bands when it knows where the plant is', async () => {

		const p = await plant( 'north' )
		const r = await p.plugin( 'season' ).ranges()

		assert.equal( r.applied, true )
		assert.ok( r.season )

		await p.destroy()

	} )

	it( 'declines to model a tropical year from latitude', async () => {

		const p = await plant( 'tropical' )
		const r = await p.plugin( 'season' ).now()

		assert.equal( r.season, null )
		assert.equal( r.tropical, true )

		await p.destroy()

	} )

	it( 'gives the table full weight on a plant with no history', async () => {

		const p = await plant( 'south' )
		assert.equal( ( await p.plugin( 'season' ).weight() ).weight, 1 )
		await p.destroy()

	} )

	it( 'has nothing to say about last year until there was one', async () => {

		const p = await plant( 'south' )
		await p.read()
		assert.equal( ( await p.plugin( 'season' ).lastYear() ).known, false )
		await p.destroy()

	} )

} )
