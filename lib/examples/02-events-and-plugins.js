/**
 * Reacting to the plant instead of polling it, and installing plugins.
 *
 *   node examples/02-events-and-plugins.js
 */

import {
	createPlant, definePlugin, EVENTS,
} from '../src/index.js'

const plant = await createPlant( {
	name    : 'Rosa',
	species : 'Monstera deliciosa',
	// Start it already parched so the events fire on the first read.
	sensor  : {
		driver : 'mock',
		soil : 8,
		humidity : 15,
		temperature : 21,
		light : 400,
		dayNight : false,
	},
	ai      : { provider : 'mock' },
} )

// ── react to conditions, not numbers ────────────────────────────────────────

plant.on( EVENTS.THIRSTY, e => {

	console.log( `🚨 thirsty: ${e.metric} is ${e.value}${e.unit} (ideal ${e.range.min}-${e.range.max}${e.unit})` )

} )

plant.on( EVENTS.STRESSED, e => {

	console.log( `😣 stressed: wellbeing down to ${e.happiness}/100` )

} )

// ── a plugin in twelve lines ────────────────────────────────────────────────

const autoWater = definePlugin( {
	name : 'auto-water',
	on   : {
		async [ EVENTS.THIRSTY ]() {

			console.log( '🤖 auto-water: opening the valve' )
			await this.plant.water( { amount : 35 } )
			console.log( '🤖 auto-water:', this.plant.status() )

		},
	},
} )

await plant.use( autoWater )

console.log( '\n— First read —\n' )
await plant.read()

await plant.destroy()
