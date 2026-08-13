/**
 * The zero-setup example: no sensors, no API key, no network.
 *
 *   node examples/01-no-hardware.js
 */

import { createPlant } from '../src/index.js'

const plant = await createPlant( {
	name    : 'Ivy',
	species : 'Monstera deliciosa',
	sensor  : 'mock',
	ai      : { provider : 'mock' },
} )

console.log( '\n— Five readings over a simulated week —\n' )

for ( let day = 1; day <= 5; day++ ) {

	// Dry it out faster than real time so the demo shows a full decline.
	plant.getSensor( 'mock' ).state.soil -= 12
	await plant.read()
	console.log( `Day ${day}:`, plant.status() )

}

console.log( '\n— What the plant says —\n' )
console.log( await plant.speak( 'how are you doing?' ) )

console.log( '\n— Watering it —\n' )
await plant.water( { amount : 40 } )
console.log( plant.status() )

console.log( '\n— 48h stats —\n' )
console.log( plant.memory.stats( 48 ) )

await plant.destroy()
