/**
 * 09 · Inheritance
 *
 * A mature plant leaves what it learned to a new plant of the same species.
 *
 * The interesting part is not the transfer. It is the two refusals:
 *
 *   · A policy learned in one unchanging spot does not travel, however much
 *     evidence stands behind it. It describes the spot, not the plant.
 *   · A policy about something the two environments disagree on is held back on
 *     arrival, because it may be a fix for a problem the new plant does not have.
 *
 * Run with:  node examples/09-inheritance.js
 */

import { createPlant } from '../src/index.js'

const line = t => console.log( `\n[1m${t}[0m\n${'─'.repeat( t.length )}` )

/** Build a plant with a history in a given spot. */
async function grow( { name, temperature, soil, light, episodes = [] } ) {

	const plant = await createPlant( {
		name,
		species : 'Ficus lyrata',
		sensor  : {
			driver : 'mock',
			dayNight : false,
		},
		ai : { provider : 'mock' },
	} )

	let seed = 11
	const jitter = span => {

		seed = ( seed * 1103515245 + 12345 ) & 0x7fffffff
		return ( seed / 0x7fffffff - 0.5 ) * span

	}

	// Six months, four readings a day.
	for ( let i = 0; i < 180 * 4; i++ ) {

		await plant.memory.addReading( {
			timestamp   : Date.now() - ( 180 * 4 - i ) * 6 * 3600_000,
			temperature : temperature + jitter( 4 ),
			humidity    : 55 + jitter( 10 ),
			soil        : soil + jitter( 12 ),
			light       : light + jitter( 200 ),
		} )

	}

	if ( episodes.length ) plant.body = { personalization : { memory : { episodes } } }

	return plant

}

const at = ( action, spots, n, reward ) => Array.from( { length : n }, ( _, i ) => ( {
	at      : new Date().toISOString(),
	action,
	reward,
	context : spots[ i % spots.length ],
} ) )

const FOUR_SEASONS = [
	{
		temperature : 14,
		soil : 25,
		humidity : 35,
	},
	{
		temperature : 22,
		soil : 45,
		humidity : 55,
	},
	{
		temperature : 27,
		soil : 62,
		humidity : 70,
	},
	{
		temperature : 18,
		soil : 55,
		humidity : 48,
	},
]
const ONE_WINDOWSILL = [ {
	temperature : 22,
	soil : 45,
	humidity : 55,
} ]

// ── The source: a plant that has been alive a while ─────────────────────────

const mature = await grow( {
	name        : 'Vieja',
	temperature : 22,
	soil        : 45,
	light       : 900,
	episodes    : [
		// Tried across cold mornings and warm afternoons, damp soil and dry.
		...at( 'shift_toward_window', FOUR_SEASONS, 32, 0.7 ),
		// Four hundred outcomes — and every single one on the same windowsill.
		...at( 'water_at_low_soil', ONE_WINDOWSILL, 400, 0.9 ),
	],
} )

line( '1 · What is worth leaving behind' )

const bundle = await mature.exportInheritance()

console.log( `species   : ${bundle.manifest.species}` )
console.log( `history   : ${bundle.manifest.readings} readings over ${bundle.manifest.spanDays} days` )

console.log( '\nshipped:' )
for ( const p of bundle.policies ) console.log( `  ✓ ${p.action}\n      ${p.why}` )

console.log( '\nwithheld:' )
for ( const p of bundle.withheld ) console.log( `  ✗ ${p.action}\n      ${p.why}` )

console.log( '\nNote which one had more evidence.' )

// ── The receiver: same species, a different corner of the flat ──────────────

line( '2 · Arriving somewhere else' )

const seedling = await grow( {
	name        : 'Nueva',
	temperature : 19,
	soil        : 68,       // a pot that holds water, unlike the source's
	light       : 300,      // a shaded corner, not a windowsill
} )

const before = { ...seedling.ranges.temperature }
const { inheritance, compatibility } = await seedling.inherit( bundle )

console.log( 'compatibility:', compatibility.verdict )
console.log( '\noverlap per metric:', compatibility.overlap )

console.log( `\nranges moved partway: temperature ${before.min}–${before.max} → ${seedling.ranges.temperature.min}–${seedling.ranges.temperature.max}` )
console.log( `(the source lived at ${bundle.ranges.temperature.min}–${bundle.ranges.temperature.max}, and this plant did not simply adopt it)` )

const report = inheritance.report()
console.log( `\nadmitted : ${report.admitted}` )
console.log( `in shadow: ${report.shadow.join( ', ' ) || 'none'}` )

if ( report.held.length ) {

	console.log( '\nheld back on arrival:' )
	for ( const h of report.held ) console.log( `  ✗ ${h.action}\n      ${h.reason}` )

}

// ── Outgrowing it ───────────────────────────────────────────────────────────

line( '3 · The new body wins' )

const action = report.priors[ 0 ]?.action
if ( action ) {

	console.log( `inherited estimate for "${action}": ${inheritance.prior( action ).expected}` )
	console.log( 'but this plant keeps finding it useless (0.0)...\n' )

	for ( const n of [ 0, 5, 20, 60 ] ) {

		while ( ( inheritance.local.get( action )?.n ?? 0 ) < n ) inheritance.recordLocal( action, 0 )

		const b = inheritance.blend( action, 0 )
		console.log( `  after ${String( n ).padStart( 2 )} local outcomes → estimate ${b.expected.toFixed( 3 )}  (inherited weight ${b.weight})` )

	}

	console.log( '\nThe inheritance fades on a schedule. It never gets a vote it did not earn here.' )

}

await mature.destroy()
await seedling.destroy()
