import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from 'smartplant'

import plugin from './index.js'

describe( '@smartplant/fertilizer', () => {

	it( 'installs on a plant and guideFertilization() produces advice', async () => {

		// mock sensor + mock provider: no hardware, no API key, no network.
		const plant = await createPlant( {
			name    : 'Test Plant',
			species : 'Monstera deliciosa',
			sensor  : 'mock',
			ai      : { provider : 'mock' },
		} )

		await plant.use( plugin )
		await plant.read()

		const result = await plant.plugin( 'fertilizer' ).guideFertilization( {} )

		assert.equal( typeof result, 'object' )
		assert.ok( ( result.advice ?? result.entry ).length > 0 )

		await plant.destroy()

	} )

} )
