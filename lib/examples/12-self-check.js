/**
 * 12 · Self-check
 *
 * Two reviews that run themselves, and look at different things.
 *
 *   · `checkup()`     — how the plant has been changing over a week or a month
 *   · `maintenance()` — whether the instrument measuring it can still be believed
 *
 * The first is about the organism, the second about the infrastructure holding
 * it up. Neither is much use without the other: a plant that looks stable
 * through a stuck sensor is not stable, it is unmeasured.
 *
 * Run with:  node examples/12-self-check.js
 */

import { createPlant } from '../src/index.js'

const line = t => console.log( `\n[1m${t}[0m\n${'─'.repeat( t.length )}` )
const HOUR = 3600_000
const DAY = 86_400_000

/** A plant with two months behind it, and a chosen shift in the last week. */
async function grow( { name, recent = {}, stuckHumidity = false } ) {

	const plant = await createPlant( {
		name,
		species : 'Ficus lyrata',
		sensor  : {
			driver : 'mock',
			dayNight : false,
		},
		ai      : { provider : 'mock' },
	} )

	let s = 11
	const r = () => {

		s = ( s * 1103515245 + 12345 ) & 0x7fffffff
		return s / 0x7fffffff - 0.5

	}

	for ( let i = 0; i < 60 * 4; i++ ) {

		const at = Date.now() - ( 60 * 4 - i ) * 6 * HOUR
		const isRecent = at >= Date.now() - 7 * DAY

		await plant.memory.addReading( {
			timestamp   : at,
			temperature : ( isRecent ? recent.temperature ?? 22 : 22 ) + r() * 2,
			// A latched sensor returns the same number exactly, forever.
			humidity    : stuckHumidity && isRecent ? 55 : 55 + r() * 4,
			soil        : ( isRecent ? recent.soil ?? 45 : 45 ) + r() * 5,
			light       : 900 + r() * 80,
		} )

	}

	return plant

}

// ── 1 · A steady plant ──────────────────────────────────────────────────────

line( '1 · Nothing much happened' )

const steady = await grow( { name : 'Steady' } )
const s1 = await steady.checkup()

console.log( s1.verdict )
console.log( `it says: "${s1.narration}"` )

// ── 2 · Something changed, and the room explains it ─────────────────────────

line( '2 · Something changed — but so did the room' )

const hot = await grow( {
	name : 'Warm',
	recent : {
		soil : 20,
		temperature : 29,
	},
} )
const s2 = await hot.checkup()

console.log( `conditions moved: ${s2.movedConditions.join( ', ' )}` )
console.log( `wellbeing: ${s2.wellbeing.prior} → ${s2.wellbeing.recent}\n` )

for ( const f of s2.findings ) {

	console.log( `  ${f.confounded ? '⚠️  confounded' : '✓  real'} · ${f.id}` )
	console.log( `     ${f.why}\n` )

}

console.log( 'Without that check, this would read as a finding about the plant.' )
console.log( 'It is a finding about the weather.' )

// ── 3 · The instrument ──────────────────────────────────────────────────────

line( '3 · Is the instrument still telling the truth?' )

const healthy = await steady.maintenance()
console.log( `healthy plant → ${healthy.condition}: ${healthy.verdict}\n` )

const stuck = await grow( {
	name : 'Stuck',
	stuckHumidity : true,
} )
const report = await stuck.maintenance()

console.log( `stuck sensor  → ${report.condition}: ${report.verdict}` )

for ( const c of report.components.filter( c => c.issues?.length ) ) {

	console.log( `\n  ${c.component} [${c.condition}]` )
	console.log( `     ${c.why}` )

}

console.log( '\nwhat to do about it:' )
for ( const a of report.actions ) console.log( `  · ${a}` )

console.log( '\nsuggested evidence weights:', JSON.stringify( report.suggestedWeights ) )
console.log( 'Marked unreliable and said so — not silently dropped.' )

// ── 4 · Running themselves ──────────────────────────────────────────────────

line( '4 · Nobody has to remember' )

const auto = await grow( { name : 'Sola' } )

auto.on( 'plant:checkup', r => console.log( `  [event] ${r.period} review: ${r.verdict}` ) )
auto.on( 'maintenance:report', r => console.log( `  [event] instrument: ${r.condition}` ) )

const ran = await auto.runDueReviews()
console.log( `\nran: ${Object.keys( ran ).join( ', ' )}` )

const again = await auto.runDueReviews()
console.log( `immediately after: ${Object.keys( again ).length ? Object.keys( again ).join( ', ' ) : 'nothing was due'}` )

await Promise.all( [ steady, hot, stuck, auto ].map( p => p.destroy() ) )
