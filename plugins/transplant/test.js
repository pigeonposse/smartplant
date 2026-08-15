import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from 'smartplant'

import plugin from './index.js'

const plant = async ( pot ) => {

	const p = await createPlant( {
		name : 'Potted',
		species : 'Ficus lyrata',
		sensor : { driver : 'mock' },
		ai : { provider : 'mock' },
		...( pot ? { pot } : {} ),
	} )
	await p.use( plugin )
	await p.read()
	return p

}

describe( '@smartplant/transplant', () => {

	it( 'says nothing useful without a pot size', async () => {

		const p = await plant()
		assert.equal( p.plugin( 'transplant' ).space().index, 'unknown' )
		await p.destroy()

	} )

	it( 'advises looking rather than doing', async () => {

		const p = await plant( { litres : 2 } )
		const plan = p.plugin( 'transplant' ).plan()

		// The person is about to be holding the roots, which makes them the
		// better instrument for the next five minutes.
		assert.match( plan.checks[ 0 ], /Look at the rootball before deciding/ )
		assert.match( plan.checks[ 1 ], /the pot is not the problem/ )

		await p.destroy()

	} )

	it( 'warns against a pot that is far too big', async () => {

		const p = await plant( { litres : 2 } )
		const plan = p.plugin( 'transplant' ).plan()

		assert.equal( plan.suggest, 5 )
		assert.match( plan.checks[ 2 ], /drowns more plants than a tight pot ever has/ )

		await p.destroy()

	} )

	it( 'asks for one thing when the move happens', async () => {

		const p = await plant( { litres : 2 } )
		assert.match( p.plugin( 'transplant' ).plan().checks[ 3 ], /Nothing else/ )
		await p.destroy()

	} )

	it( 'stands aside while a move is settling', async () => {

		const p = await plant( { litres : 2 } )
		await p.transplant( { volumeL : 6 } )

		const plan = p.plugin( 'transplant' ).plan()
		assert.equal( plan.ready, false )
		assert.equal( p.plugin( 'transplant' ).settling().phase, 'settling' )

		await p.destroy()

	} )

} )
