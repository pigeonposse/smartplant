/**
 * The full stack, end to end, with no hardware and no API key.
 *
 *   node examples/04-symbiotic-stack.js
 *
 * Electrode → DSP → events → symbolic reasoning → semantic recall → voice,
 * plus the exports that connect it to the rest of an IoT setup.
 */

import { createPlant, EVENTS } from '../src/index.js'
import { prometheusMetrics } from '../src/integrations/index.js'
import { generateProject } from '../src/firmware/index.js'

const plant = await createPlant( {
	name    : 'Rosa',
	species : 'Monstera deliciosa',
	ai      : { provider : 'mock' },
	sensor  : {
		driver        : 'electrode',
		transport     : 'synthetic',
		sampleRate    : 5,
		bufferSeconds : 1800,
		mainsHz       : 0,
		apPerHour     : 0,
		vpPerHour     : 0,
		circadianMv   : 3,
	},
} )

const electrode = plant.getSensor( 'electrode' )

// ── 1. the plant signals damage, and the system understands what that means ──

plant.on( EVENTS.DAMAGE, e => {

	console.log( `\n🩹 damage signal: ${e.summary.counts.variation_potential} variation potential(s)` )

} )

console.log( '— Baseline —\n' )
electrode.advance( 300 )
let electro = await plant.listen( { seconds : 300 } )
console.log( `events: ${electro.summary.physiological}, damage: ${electro.summary.damageSignal}` )

console.log( '\n— Something wounds a leaf —' )
electrode.stimulate( 'variation_potential' )
// Let the event play out, then keep recording so it sits inside the window with
// quiet baseline on both sides — exactly what a continuous recording gives you.
electrode.advance( 900 )
electro = await plant.listen( { seconds : 1200 } )

console.log( `\ndetected: ${electro.events.map( e => `${e.type.label} (${e.durationS}s, ${e.amplitude}mV)` ).join( ', ' )}` )
console.log( `interpretation: ${electro.events[ 0 ]?.type.note}` )

// ── 2. symbolic reasoning over everything perceived ──────────────────────────

console.log( '\n— What the rules conclude —\n' )
const diagnosis = plant.diagnose()
console.log( diagnosis.explanation )

if ( diagnosis.treatments.length ) {

	console.log( `\nsuggested: ${diagnosis.treatments.map( t => t.treatment ).join( ', ' )}` )

}

// ── 3. the knowledge graph explains itself ───────────────────────────────────

console.log( '\n— Why might a plant wilt? —\n' )
for ( const cause of plant.knowledge.diagnose( 'wilting' ) ) {

	console.log( `  ${cause.cause} (${cause.kind}) → ${cause.treatments.join( ', ' )}` )

}

// ── 4. semantic memory: the plant recognizes a repeat ────────────────────────

await plant.knowledge.remember( 'last spring a cat chewed a leaf and the same signal appeared' )
await plant.knowledge.remember( 'the radiator dried the air out in December' )

const recalled = await plant.recall( 'something damaged a leaf', { k : 1 } )
console.log( `\n— Recalled —\n  "${recalled[ 0 ]?.text}" (similarity ${recalled[ 0 ]?.score})` )

// ── 5. the plant speaks, grounded in all of the above ────────────────────────

console.log( '\n— The plant —\n' )
console.log( await plant.speak( 'what happened to you?' ) )

// ── 6. exports into the wider ecosystem ──────────────────────────────────────

console.log( '\n— Prometheus —\n' )
// A scalar read so the electrode also participates in ordinary monitoring.
await plant.read()
console.log( prometheusMetrics( plant ).split( '\n' ).slice( 0, 9 ).join( '\n' ) )

console.log( '\n— Firmware for the hardware version of this —\n' )
const files = generateProject( {
	target    : 'platformio',
	sensors   : [ { type : 'electrode' }, 'dht22' ],
	transport : 'mqtt',
} )
console.log( `generated: ${Object.keys( files ).join( ', ' )}` )
console.log( files[ 'platformio.ini' ].trim() )

await plant.destroy()
