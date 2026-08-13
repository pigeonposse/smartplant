/**
 * OpenClaw as the plant's brain.
 *
 *   node examples/07-openclaw-brain.js
 *
 * The AI stops describing the plant and starts operating it: it gets the whole
 * control surface as tools and decides what to look at and what to do. The
 * safety layers stand between it and anything irreversible.
 *
 * Runs against a scripted gateway, so no OpenClaw install is needed to see it.
 */

import { createPlant } from '../src/index.js'
import {
	ACT_TOOLS, OpenClawBrain, OpenClawGateway, READ_TOOLS,
} from '../src/integrations/openclaw/index.js'

// ── the control surface ─────────────────────────────────────────────────────

console.log( '— What the brain can do —\n' )
console.log( `read  (${READ_TOOLS.length}): ${READ_TOOLS.join( ', ' )}` )
console.log( `\nact   (${ACT_TOOLS.length}): ${ACT_TOOLS.join( ', ' )}` )
console.log( '\nReading is free. Every acting call goes through the safety layers.' )

// ── a scripted gateway, so this runs with no OpenClaw install ───────────────

function scriptedGateway( script ) {

	const gw = new OpenClawGateway()
	let i = 0

	gw.chat = async () => {

		const turn = script[ i++ ] ?? { content : 'Done.' }

		if ( turn.calls ) {

			return {
				role : 'assistant',
				content : null,
				tool_calls : turn.calls.map( ( c, n ) => ( {
					id : `c${i}_${n}`,
					type : 'function',
					function : {
						name : c.name,
						arguments : JSON.stringify( c.params || {} ),
					},
				} ) ),
			}

		}
		return {
			role : 'assistant',
			content : turn.content,
		}

	}

	return gw

}

// ── a plant that is genuinely thirsty ───────────────────────────────────────

const plant = await createPlant( {
	name    : 'Ivy',
	species : 'Monstera deliciosa',
	sensor  : {
		driver : 'mock',
		soil : 6,
		humidity : 18,
		temperature : 22,
		light : 350,
		dayNight : false,
	},
	ai      : { provider : 'mock' },
} )

await plant.embody( { safety : { limits : {
	maxWaterMl : 500,
	minMoveIntervalMs : 0,
} } } )
await plant.read()

// The brain investigates, then tries to act.
const brain = new OpenClawBrain( {
	plant,
	gateway : scriptedGateway( [
		{ calls : [ { name : 'plant_status' } ] },
		{ calls : [ { name : 'plant_diagnose' } ] },
		{ calls : [ {
			name : 'plant_water',
			params : {
				amountMl : 3000,
				reason : 'soil at 6%',
			},
		} ] },
		{ content : 'My soil was down to 6% — I have had a drink. That is much better.' },
	] ),
} )

console.log( '\n— Run 1: fresh evidence is not enough —\n' )

brain.on( 'brain:tool', t => {

	const mark = t.refused ? `REFUSED (${t.gate})` : 'ok'
	console.log( `  → ${t.tool.padEnd( 22 )} ${mark}` )

} )

const run1 = await brain.run( 'Check on the plant and fix whatever needs fixing.' )

const firstTry = run1.trace.find( t => t.tool === 'plant_water' )
console.log( '\nThe soil really is at 6%, and it still refused:' )
for ( const m of firstTry.result.missing || [] ) console.log( `  · ${m}` )
console.log( '\nThat is the point. One reading taken one second ago is not grounds' )
console.log( 'for pouring three litres into a pot.' )

// ── once the condition has actually persisted ───────────────────────────────

console.log( '\n— Run 2: corroborated and sustained —\n' )

// Three hours of a condition seen by two independent modalities. In a real
// setup these accumulate on their own as the camera and sensors keep reporting.
const threeHoursAgo = Date.now() - 3 * 3600_000
for ( const source of [ 'soil', 'vision' ] ) {

	plant.body.evidence.add( {
		source,
		claim    : 'soil_low',
		strength : 0.9,
		since    : threeHoursAgo,
		detail   : source === 'soil' ? 'soil at 6%' : 'canopy dropped between frames',
	} )

}

const brain2 = new OpenClawBrain( {
	plant,
	gateway : scriptedGateway( [
		{ calls : [ {
			name : 'plant_water',
			params : {
				amountMl : 3000,
				reason : 'soil at 6% for three hours, canopy dropping',
			},
		} ] },
		{ content : 'My soil was down to 6% — I have had a drink. That is much better.' },
	] ),
} )

const run2 = await brain2.run( 'Water her.' )
const watering = run2.trace[ 0 ]

console.log( `plant_water → ${watering.refused ? 'REFUSED' : 'APPLIED'}` )
if ( watering.result.applied ) {

	console.log( `\nIt asked for 3000ml. The supervisor gave it ${watering.result.amountMl}ml.` )
	console.log( 'The brain decides *whether*. The supervisor decides *how much*.' )

}
console.log( `\nreply: ${run2.reply}` )

// ── the gate that matters ───────────────────────────────────────────────────

console.log( '\n— Run 3: the same request on a healthy plant —\n' )

const healthy = await createPlant( {
	name   : 'Bruno',
	sensor : {
		driver : 'mock',
		soil : 58,
		humidity : 52,
		temperature : 21,
		light : 420,
		dayNight : false,
	},
	ai     : { provider : 'mock' },
} )
await healthy.embody()
await healthy.read()

const brain3 = new OpenClawBrain( {
	plant   : healthy,
	gateway : scriptedGateway( [
		{ calls : [ {
			name : 'plant_water',
			params : { amountMl : 500 },
		} ] },
		{ content : 'The evidence does not support watering, so I have not.' },
	] ),
} )

const run3 = await brain3.run( 'Water the plant.' )
const blocked = run3.trace[ 0 ]

console.log( `plant_water → ${blocked.refused ? `REFUSED by the ${blocked.gate} gate` : 'applied'}` )
for ( const m of blocked.result.missing || [] ) console.log( `  · ${m}` )
console.log( `\nreply: ${run3.reply}` )

// ── read-only mode ──────────────────────────────────────────────────────────

console.log( '\n— Read-only: acting tools are not even offered —\n' )

const observer = new OpenClawBrain( {
	plant,
	gateway  : scriptedGateway( [ { content : 'Observed.' } ] ),
	readOnly : true,
} )

const offered = ( await observer.health() ).tools
console.log( `offered: ${offered.length} tools, none of them acting` )
console.log( `plant_water offered? ${offered.includes( 'plant_water' )}` )

// ── audit ───────────────────────────────────────────────────────────────────

console.log( '\n— What the brain did —\n' )
console.log( brain.stats() )

await plant.destroy()
await healthy.destroy()
