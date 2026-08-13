/**
 * 10 · Colony
 *
 * Three plants on one bus, talking to each other.
 *
 * Most of it is ordinary conversation. Skills are the fast path through it: a
 * named request that comes back with the fact itself instead of a sentence.
 *
 * The part worth watching is what happens when a plant is asked something it
 * has no sensor for. It does not guess, and it does not go quiet — it says what
 * it is blind to, which is information the asker did not have before.
 *
 * Note what you cannot do here: put a sentence in a plant's mouth. The channel
 * is between plants. A person reads it and never writes to it.
 *
 * Run with:  node examples/10-colony.js
 */

import { createPlant } from '../src/index.js'
import { LoopbackBus, ColonyMember, lexiconOf } from '../src/colony/index.js'

const line = t => console.log( `\n[1m${t}[0m\n${'─'.repeat( t.length )}` )

const bus = new LoopbackBus()

async function join( name, sensor, { electrode = false } = {} ) {

	const plant = await createPlant( {
		name,
		species : 'Ficus lyrata',
		sensor  : {
			driver : 'mock',
			dayNight : false,
			...sensor,
		},
		ai : { provider : 'mock' },
	} )

	if ( electrode ) {

		await plant.attachSensor( {
			driver : 'electrode',
			transport : 'synthetic',
			sampleRate : 5,
			mainsHz : 0,
		} )

	}

	await plant.read()
	await plant.joinColony( { transport : bus.endpoint( name.toLowerCase() ) } )
	return plant

}

// Ivy is on a dry windowsill and has an electrode. Hazel and Willow do not.
const ivy = await join( 'Ivy', {
	temperature : 27,
	humidity : 33,
	soil : 21,
}, { electrode : true } )
const hazel = await join( 'Hazel', {
	temperature : 21,
	humidity : 63,
	soil : 56,
} )
const willow = await join( 'Willow', {
	temperature : 22,
	humidity : 58,
	soil : 49,
} )

// ── who is here, and what can each of them actually say ─────────────────────

line( '1 · The colony introduces itself' )

for ( const p of [ ivy, hazel, willow ] ) {

	const lex = lexiconOf( p )
	console.log( `${p.memory.plant.name.padEnd( 5 )} speaks ${String( lex.speakable.length ).padStart( 2 )} skills · knows: ${lex.capabilities.join( ', ' )}` )

}

console.log( '\nRosa can say things the others cannot, because Ivy has an electrode:' )
const extra = lexiconOf( ivy ).speakable.filter( s => !lexiconOf( hazel ).speakable.includes( s ) )
for ( const s of extra ) console.log( `  · ${s}` )

// ── the fast path ───────────────────────────────────────────────────────────

line( '2 · Asking, the quick way' )

const vpd = await ivy.colony.ask( 'hazel', 'sense.vpd-perception' )
console.log( `Ivy → Hazel  "${vpd.says}"` )
console.log( `Hazel → Ivy  ${JSON.stringify( vpd.data )}` )

const mine = ivy.context()
console.log( `\nRosa's own air: ${mine.vpd} kPa (${mine.vpdBand}) — Hazel's corner is a different world.` )

// ── the refusal, which is also an answer ────────────────────────────────────

line( '3 · Asking for something it cannot know' )

const spike = await ivy.colony.ask( 'hazel', 'sense.electrome-spike' )
console.log( `Ivy → Hazel  asks for an electrical spike` )
console.log( `Hazel → Ivy  "${spike.reason}"` )

const under = await ivy.colony.ask( 'hazel', 'rhizo.mycelium-connect' )
console.log( `\nRosa → Hazel  asks about the mycelial network` )
console.log( `Hazel → Ivy  "${under.reason}"` )
console.log( '\nNo guessing, no silence. The colony never trades in facts nobody measured.' )

// ── ordinary conversation ───────────────────────────────────────────────────

line( '4 · Just talking' )

// A person can watch every line go past. There is no way to add one.
ivy.on( 'colony:message', l => {

	if ( l.kind === 'chat' ) console.log( `  [watching] ${l.from} → ${l.to}: "${l.text}"` )

} )

// `report()` takes no message — Ivy says how Ivy is, from Ivy's readings.
const reply = await ivy.colony.report( { to : 'hazel' } )
console.log( `\nLila answered: "${reply.text}"` )

// ── asking the whole room ───────────────────────────────────────────────────

line( '5 · Asking everyone, and what that is worth' )

const { answers, refusals } = await ivy.colony.askAll( 'sense.vpd-perception' )
console.log( `answered: ${answers.map( a => `${a.peer} (${a.data.vpd} kPa)` ).join( ', ' )}` )
console.log( `refused : ${refusals.length}` )

const cues = ColonyMember.cuesFrom( answers, 'air_too_dry' )
console.log( `\nevidence cues produced: ${cues.length}` )
console.log( `  source   : ${cues[ 0 ].source}` )
console.log( `  strength : ${cues[ 0 ].strength}` )
console.log( `  ${cues[ 0 ].detail}` )
console.log( '\nTwo neighbours agreeing is one room agreeing with itself. It counts once.' )

await Promise.all( [ ivy, hazel, willow ].map( p => p.destroy() ) )
