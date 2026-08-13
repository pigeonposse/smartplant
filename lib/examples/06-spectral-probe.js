/**
 * Interrogating a plant with light.
 *
 *   node examples/06-spectral-probe.js
 *
 * Shows why colour matters: 🔵 blue and 🔴 red read two different pathways, and
 * the *pair* separates thirst from malnutrition — which one electrode never can.
 *
 * Runs with no LED, no electrode and no API key.
 */

import { createPlant } from '../src/index.js'
import { BANDS, crossBandDiagnosis, describeBands, probePeriodSanity } from '../src/spectral/index.js'

// ── the catalogue ───────────────────────────────────────────────────────────

console.log( '— What each colour does —\n' )

for ( const b of describeBands() ) {

	console.log( `${b.emoji} ${b.label.padEnd( 14 )} ${String( b.nm + 'nm' ).padStart( 7 )}  ${( b.probes || '—' ).padEnd( 24 )} risk: ${b.risk}` )

}

// ── the correction that makes it work at all ────────────────────────────────

console.log( '\n— Why a 2 Hz flicker measures nothing —\n' )

const tooFast = probePeriodSanity( 'blue', 0.5 / 60 )
console.log( `2 Hz:   ${tooFast.ok ? 'ok' : 'REFUSED'} — ${tooFast.reason}` )

const correct = probePeriodSanity( 'blue', BANDS.blue.probe.periodMinutes )
console.log( `16 min: ${correct.ok ? 'ok' : 'refused'} — ${correct.reason}` )

// ── a real sweep ────────────────────────────────────────────────────────────

const plant = await createPlant( {
	name    : 'Ivy',
	species : 'Monstera deliciosa',
	sensor  : {
		driver        : 'electrode',
		transport     : 'synthetic',
		sampleRate    : 2,
		bufferSeconds : 7200,
		mainsHz       : 0,
		apPerHour     : 0,
		circadianMv   : 0,
		noiseMv       : 0.3,
	},
	ai      : { provider : 'mock' },
} )

const spectral = await plant.useSpectral( {
	// A fixture must declare what it can emit; most RGB panels have no UV-B LED.
	light  : {
		driver   : 'mock',
		channels : [ 'uvb', 'uva', 'blue', 'green', 'amber', 'red', 'farRed' ],
	},
	// The dark-period guard would otherwise refuse to run this at night.
	safety : { darkHours : [ 25, 26 ] },
} )

console.log( '\n— Running the sweep —\n' )

const sweep = await plant.interrogate( {
	bands    : [ 'amber', 'blue', 'red', 'green' ],
	cycles   : 3,
	simulate : true,     // compress time; a real sweep takes about an hour
} )

for ( const [ id, r ] of Object.entries( sweep.responses ) ) {

	const b = BANDS[ id ]
	console.log( `${b.emoji} ${b.label.padEnd( 8 )} ${r.measured ? `${r.samples} samples, ${r.periodMinutes}min period, SNR ${r.locking.snr}` : r.reason}` )

}

console.log( `\ncontrol (🟠 amber) amplitude: ${sweep.control?.amplitude}` )

// ── what the pairing tells you ──────────────────────────────────────────────

console.log( '\n— The diagnostic that needs two colours —\n' )

const strong = {
	key : 'strong',
	amplitude : 10,
	ratio : 5,
	snr : 20,
}
const weak = {
	key : 'weak',
	amplitude : 2,
	ratio : 1.6,
	snr : 6,
}

for ( const [ label, bands ] of [
	[ '🔵 weak + 🔴 strong', {
		blue : weak,
		red : strong,
	} ],
	[ '🔵 strong + 🔴 weak', {
		blue : strong,
		red : weak,
	} ],
	[ '🔵 strong + 🔴 strong', {
		blue : strong,
		red : strong,
	} ],
] ) {

	const d = crossBandDiagnosis( bands )[ 0 ]
	console.log( `${label.padEnd( 22 )} → ${d ? `${d.condition.replace( /_/g, ' ' )} (${Math.round( d.confidence * 100 )}%)` : 'no cross-band pattern'}` )
	if ( d ) console.log( `${' '.repeat( 25 )}${d.reasoning}` )

}

// ── the interlock that matters ──────────────────────────────────────────────

console.log( '\n— Safety —\n' )

for ( const [ label, ctx ] of [
	[ 'blue on a dry plant', { current : {
		soil : 12,
		humidity : 45,
		temperature : 21,
	} } ],
	[ 'blue on a watered plant', { current : {
		soil : 55,
		humidity : 45,
		temperature : 21,
	} } ],
	[ 'blue with no soil sensor', { current : {
		humidity : 45,
		temperature : 21,
	} } ],
] ) {

	const r = await spectral.treat( 'blue', {
		seconds : 300,
		simulate : true,
		context : ctx,
	} )
	console.log( `${label.padEnd( 26 )} → ${r.applied ? 'APPLIED' : 'REFUSED'}: ${r.explanation}` )

}

console.log( '\n— UV-B needs a human —\n' )

const ctx = {
	current : { soil : 55 },
	happiness : 80,
}

let uv = await spectral.treat( 'uvb', {
	seconds : 60,
	simulate : true,
	context : ctx,
} )
console.log( `without authorization → ${uv.applied ? 'APPLIED' : 'REFUSED'}` )

spectral.safety.authorize( 'uvb' )
uv = await spectral.treat( 'uvb', {
	seconds : 60,
	simulate : true,
	context : ctx,
} )
console.log( `after authorize()     → ${uv.applied ? 'APPLIED' : 'REFUSED'} (${uv.remainingToday}s left today)` )

console.log( '\n— Today\'s doses —\n' )
for ( const d of spectral.safety.report() ) {

	console.log( `${d.emoji} ${d.label.padEnd( 14 )} ${d.usedSeconds}s / ${d.budgetSeconds}s` )

}

await plant.destroy()
