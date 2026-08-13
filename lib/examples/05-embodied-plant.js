/**
 * A plant with a body: it decides where in the house to be.
 *
 *   node examples/05-embodied-plant.js
 *
 * Shows the four problems this layer exists to solve:
 *   1. slow plant signals fused with fast body decisions
 *   2. evidence required before acting, so it neither over-reads nor ignores
 *   3. energy and geofence limits that autonomy cannot argue past
 *   4. learning which spot works for *this* plant
 */

import { createPlant, PRIORITY, RISK } from '../src/index.js'
import { collisionReflex } from '../src/control/index.js'

const plant = await createPlant( {
	name    : 'Ivy',
	species : 'Monstera deliciosa',
	// Start it thirsty and in poor light so there is something to decide about.
	sensor  : {
		driver : 'mock',
		soil : 18,
		humidity : 30,
		light : 90,
		temperature : 21,
		dayNight : false,
	},
	ai      : { provider : 'mock' },
} )

const body = await plant.embody( {
	safety : {
		energy : {
			capacityWh : 40,
			stateOfCharge : 0.8,
			moveDrawW : 12,
			speedMs : 0.15,
		},
		geofence : {
			// A room, in metres, with the stairwell fenced off.
			bounds  : [ [ 0, 0 ], [ 6, 0 ], [ 6, 5 ], [ 0, 5 ] ],
			keepOut : [ {
				name : 'stairs',
				polygon : [ [ 5, 4 ], [ 6, 4 ], [ 6, 5 ], [ 5, 5 ] ],
			} ],
			home    : [ 1, 1 ],
		},
		limits : { minMoveIntervalMs : 0 },
	},
	personalization : { actions : [ 'south_window', 'bookshelf', 'bathroom' ] },
} )

await plant.read()

// ── 1. two timescales, kept apart ───────────────────────────────────────────

console.log( '— Fusion —\n' )

body.state.register( 'sonar', {
	rate : 'fast',
	unit : 'm',
} )
// Spaced 200ms apart, as a real sonar would arrive — otherwise every sample
// shares a timestamp and the slope is undefined.
let mono = 0
for ( const d of [ 1.2, 1.0, 0.8, 0.6, 0.45 ] ) {

	body.state.push( 'sonar', d, {
		mono : ( mono += 200 ),
		t    : Date.now(),
	} )

}

const snap = body.state.snapshot()
console.log( `fast: sonar ${snap.fast.sonar.value}m, closing at ${snap.fast.sonar.slope.toFixed( 2 )} m/s` )
console.log( `slow: soil ${snap.slow.soil?.value}%, ${Object.keys( snap.slow ).length} channels summarized` )
console.log( `coherence: usable for control = ${snap.coherence.usableForControl}` )

// ── 2. evidence before action ───────────────────────────────────────────────

console.log( '\n— Evidence —\n' )

const low = plant.justifies( 'soil_low', RISK.LOW )
const high = plant.justifies( 'soil_low', RISK.HIGH )

console.log( `low-risk action:  ${low.allowed ? 'allowed' : 'blocked'} (score ${low.score})` )
console.log( `high-risk action: ${high.allowed ? 'allowed' : 'blocked'} — ${high.missing.join( '; ' )}` )

// ── 3. safety that cannot be argued past ────────────────────────────────────

console.log( '\n— Safety —\n' )

for ( const [ label, mission ] of [
	[ 'move to the window', {
		type : 'move',
		from : [ 1, 1 ],
		target : [ 4, 2 ],
	} ],
	[ 'move onto the stairs', {
		type : 'move',
		from : [ 1, 1 ],
		target : [ 5.5, 4.5 ],
	} ],
	[ 'pour 3 litres', {
		type : 'water',
		amountMl : 3000,
	} ],
] ) {

	const v = body.safety.validate( mission )
	console.log( `${label.padEnd( 22 )} → ${v.explanation}` )

}

// A flat battery makes even a legal move impossible, and it says so.
body.safety.energy.update( { stateOfCharge : 0.12 } )
const broke = body.safety.validate( {
	type : 'move',
	from : [ 1, 1 ],
	target : [ 4, 2 ],
} )
console.log( `${'move on low battery'.padEnd( 22 )} → ${broke.explanation}` )
body.safety.energy.update( { stateOfCharge : 0.8 } )

// ── 4. a reflex beats a plan ────────────────────────────────────────────────

console.log( '\n— Arbitration —\n' )

body.control.registerReflex( 'collision', collisionReflex( {
	channel : 'sonar',
	stopM   : 0.5,
} ) )

body.control.propose( {
	id       : 'relocate',
	priority : PRIORITY.COMFORT,
	reason   : 'light is better by the south window',
	mission  : {
		type : 'move',
		from : [ 1, 1 ],
		target : [ 4, 2 ],
	},
} )

body.control.runReflexes( body.state.snapshot() )

const decided = body.control.decide()
console.log( decided.explanation )
console.log( `rejected: ${decided.rejected.map( r => `${r.proposal.id} (${r.by})` ).join( ', ' ) || 'none'}` )

// ── 5. learning what works for this plant ───────────────────────────────────

console.log( '\n— Personalization —\n' )

const learner = body.personalization

// Simulate a fortnight: the bookshelf genuinely suits this plant best.
const truth = {
	south_window : 8,
	bookshelf : 22,
	bathroom : -6,
}

for ( let day = 0; day < 30; day++ ) {

	const ctx = {
		happiness : 55,
		current : { light : 90 },
		deviations : [],
	}
	const choice = await learner.suggest( ctx )
	await learner.outcome( { happiness : 55 + truth[ choice.action ] + ( Math.random() - 0.5 ) * 4 } )

}

console.log( 'what this plant taught us:' )
for ( const row of learner.profile().actions ) {

	console.log( `  ${row.action.padEnd( 14 )} mean ${String( row.mean ).padStart( 7 )} over ${row.trials} trial(s)${row.trusted ? '' : '  (not enough data)'}` )

}

const final = await learner.suggest( {
	happiness : 55,
	current : { light : 90 },
	deviations : [],
} )
console.log( `\nrecommendation: ${final.reason}` )

await plant.destroy()
