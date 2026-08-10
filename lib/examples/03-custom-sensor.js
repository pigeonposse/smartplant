/**
 * Bringing your own hardware, and your own model.
 *
 *   node examples/03-custom-sensor.js
 */

import {
	createPlant, SensorDriver,
} from '../src/index.js'

// ── a custom driver ─────────────────────────────────────────────────────────

class BucketOfWaterProbe extends SensorDriver {

	static id       = 'bucket'
	static provides = [ 'soil', 'temperature' ]

	async read() {

		// Whatever your hardware does — I2C, GPIO, a file, an HTTP call.
		// normalize() drops non-numeric values and stamps the timestamp.
		return this.normalize( {
			soil        : 30 + Math.round( Math.random() * 10 ),
			temperature : 19.5,
		} )

	}

}

// ── a custom AI backend ─────────────────────────────────────────────────────

const plant = await createPlant( {
	name    : 'Rosa',
	species : 'Monstera deliciosa',
	ai      : { provider : 'mock' },
} )

plant.registerSensor( 'bucket', BucketOfWaterProbe )
await plant.attachSensor( 'bucket' )

plant.ai.registerProvider( 'shouty', {
	label    : 'Shouty LLM',
	needsKey : false,
	generate : async ( { prompt } ) => JSON.stringify( {
		advice   : `LISTEN UP: ${prompt.includes( 'low' ) ? 'WATER IT NOW' : 'IT IS FINE'}`,
		emoji    : '📣',
		severity : 'medium',
	} ),
} )
plant.ai.use( 'shouty' )

await plant.read()
console.log( plant.status() )
console.log( ( await plant.analyze( 'How is it?' ) ).advice )

await plant.destroy()
