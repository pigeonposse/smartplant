/**
 * 08 · The plant's own terms
 *
 * The four layers here share one idea: stop measuring the plant against a
 * textbook, and start measuring it against *itself*.
 *
 *   1. Electrome fingerprint  — what is normal for THIS plant, not for its species.
 *   2. Internal clock         — what time is it for the plant, not on the wall.
 *   3. Two-site coherence     — is this the plant speaking, or a bad electrode.
 *   4. VPD-aware blue         — does a stomatal response mean comfort or demand.
 *
 * Run with:  node examples/08-the-plants-own-terms.js
 */

import { createPlant } from '../src/index.js'
import { readBlueInContext } from '../src/spectral/index.js'
import { timingAdvice, propagationPlausible } from '../src/signals/index.js'
import { vaporPressureDeficit } from '../src/memory/context.js'

const line = t => console.log( `\n[1m${t}[0m\n${'─'.repeat( t.length )}` )

const plant = await createPlant( {
	name    : 'Rubra',
	species : 'Monstera deliciosa',
	sensor  : {
		driver      : 'mock',
		temperature : 26,
		humidity    : 38,
		soil        : 24,
		dayNight    : false,
	},
	ai : { provider : 'mock' },
} )

// A second electrode 50mm down the stem. This is what makes corroboration
// possible at all — a single electrode can only ever be believed on faith.
await plant.attachSensor( {
	driver        : 'electrode',
	transport     : 'synthetic',
	sampleRate    : 5,
	bufferSeconds : 3600,
	mainsHz       : 0,
	noiseMv       : 0.2,
	sites         : [ {
		id         : 'stem',
		distanceMm : 50,
	} ],
} )

await plant.read()

// ── 1 · The plant's own baseline ────────────────────────────────────────────

line( '1 · Electrome fingerprint' )

// The baseline needs a few windows before it will judge anything. Refusing to
// judge early is the point: a "normal" learned from one window is not normal.
let listened
for ( let i = 0; i < 6; i++ ) listened = await plant.listen( { seconds : 60 } )

console.log( 'signature :', {
	complexity  : listened.fingerprint.complexity,
	entropy     : listened.fingerprint.entropy,
	variability : listened.fingerprint.variability,
} )
console.log( 'verdict   :', listened.shift.verdict )

// ── 2 · The plant's own day ─────────────────────────────────────────────────

line( '2 · Internal clock' )

if ( listened.clock?.known ) {

	console.log( `period    : ${listened.clock.periodHours}h` )
	console.log( `peak at   : ${listened.clock.acrophaseHour}h wall time` )
	console.log( `offset    : ${listened.clock.offsetHours}h from the light cycle` )
	console.log( 'verdict   :', listened.clock.verdict )
	console.log( 'probe now?:', timingAdvice( listened.clock, 'probe' ).reason )

}
else {

	// Honest about what it cannot know yet, rather than inventing a phase.
	console.log( 'not established:', listened.clock?.reason ?? 'needs more than a day of readings' )

}

// ── 3 · Is it the plant, or the electrode? ──────────────────────────────────

line( '3 · Two-site coherence' )

const stem = listened.coherence?.stem
if ( stem ) {

	console.log( 'lag       :', stem.lagSeconds, 's across 50mm' )
	console.log( 'coherent  :', stem.coherent )
	console.log( 'verdict   :', stem.verdict )

}

// The three diagnostic cases, stated plainly:
console.log( '\nwhat a delay tells you:' )
for ( const [ label, lag ] of [
	[ 'simultaneous ', 0.01 ],
	[ 'fast         ', 1.5 ],
	[ 'slow         ', 25 ],
] ) {

	const p = propagationPlausible( lag, 50 )
	console.log( `  ${label} ${String( lag ).padStart( 5 )}s → ${p.plausible ? '' : 'NOT '}plausible · ${p.why}` )

}

// ── 4 · Blue light read in context ──────────────────────────────────────────

line( '4 · VPD-aware blue' )

const ctx = plant.context()
console.log( `VPD       : ${ctx.vpd} kPa (${ctx.vpdBand ?? ''}) at ${ctx.current.temperature}°C / ${ctx.current.humidity}% RH` )
console.log( `soil      : ${ctx.current.soil}%` )

// The same stomatal response means opposite things depending on the air.
for ( const [ label, response, when ] of [
	[ 'strong blue, dry air, dry soil', 'strong', {
		vpd : vaporPressureDeficit( 26, 38 ),
		current : { soil : 24 },
	} ],
	[ 'strong blue, still humid air   ', 'strong', {
		vpd : 0.3,
		current : { soil : 55 },
	} ],
	[ 'weak blue, dry air             ', 'weak', {
		vpd : 2.2,
		current : { soil : 30 },
	} ],
] ) {

	const r = readBlueInContext( response, when )
	console.log( `\n  ${label}\n    → ${r ? r.state : 'literal reading, no reinterpretation needed'}` )
	if ( r ) console.log( `    ${r.verdict}` )

}

await plant.destroy()
