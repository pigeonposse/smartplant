import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from 'smartplant'

import plugin from './index.js'

const plant = async ( power, extra = {} ) => {

	const p = await createPlant( {
		name : 'Offgrid',
		species : 'Ficus lyrata',
		sensor : { driver : 'mock' },
		ai : { provider : 'mock' },
		...( power ? { power } : {} ),
		...extra,
	} )
	await p.use( plugin )
	return p

}

describe( '@smartplant/energy', () => {

	it( 'treats a mains plant as having no problem to solve', async () => {

		const p = await plant()
		assert.equal( p.plugin( 'energy' ).forecast().unlimited, true )
		await p.destroy()

	} )

	it( 'refuses a percentage passed as a fraction', async () => {

		const p = await plant( { capacityWh : 100 } )
		const r = p.plugin( 'energy' ).charge( 85 )

		assert.equal( r.accepted, false )
		assert.match( r.why, /eighty-five times full/ )

		await p.destroy()

	} )

	it( 'drops subsystems as the battery falls', async () => {

		const p = await plant( { capacityWh : 100 } )
		const e = p.plugin( 'energy' )

		e.charge( 1 )
		const full = e.plan().running.length

		e.charge( 0.1 )
		assert.ok( e.plan().running.length < full )

		await p.destroy()

	} )

	it( 'keeps the lamp off at night at any charge', async () => {

		const p = await plant( { capacityWh : 1000 } )
		const e = p.plugin( 'energy' )
		e.charge( 1 )

		assert.equal( e.plan( { night : true } ).running.includes( 'spectral' ), false )
		assert.match( e.plan( { night : true } ).why, /destroys the circadian signal/ )

		await p.destroy()

	} )

	it( 'says an unmeasured panel figure is arithmetic', async () => {

		const p = await plant( {
			capacityWh : 100,
			solar : { wattsPeak : 10 },
		} )
		const h = p.plugin( 'energy' ).forecast().harvest

		assert.equal( h.measured, false )
		assert.match( h.why, /This is arithmetic, not a measurement/ )

		await p.destroy()

	} )

	it( 'becomes a measurement once the panel is instrumented', async () => {

		const p = await plant( {
			capacityWh : 100,
			solar : { wattsPeak : 10 },
		} )
		for ( let i = 0; i < 12; i++ ) p.plugin( 'energy' ).produced( 2.5 )

		assert.equal( p.plugin( 'energy' ).forecast().harvest.measured, true )
		await p.destroy()

	} )

	it( 'costs the return leg of a journey', async () => {

		const p = await plant( { capacityWh : 20 } )
		p.plugin( 'energy' ).charge( 0.5 )

		const far = p.plugin( 'energy' ).canTravel( 400 )
		assert.equal( far.afford, false )
		assert.match( far.why, /stranded there/ )

		await p.destroy()

	} )

} )
