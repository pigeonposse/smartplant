/**
 * 11 · Learning it is wrong
 *
 * Everything else in this library measures the plant. This measures the system's
 * grip on the plant — the four ways it can find out that what it believes is not
 * holding up.
 *
 *   1. Prediction error   — the model's forecasts against what happened
 *   2. Continuity         — is this still the same plant, or a tiring electrode?
 *   3. Inheritance decay  — belief that is never tested should get quieter
 *   4. Hysteresis         — does the same stimulus still get the same answer?
 *
 * Run with:  node examples/11-learning-it-is-wrong.js
 */

import { PlantPersonalization } from '../src/personalization/index.js'
import {
	ContinuityTracker, electromeFingerprint, hysteresis, responseHistory,
} from '../src/signals/index.js'
import { Inheritance } from '../src/migration/index.js'

const line = t => console.log( `\n[1m${t}[0m\n${'─'.repeat( t.length )}` )
const DAY = 86_400_000
const HOUR = 3600_000

// ── 1 · The model finds out it is wrong ─────────────────────────────────────

line( '1 · Prediction error' )

const learner = new PlantPersonalization( { actions : [ 'move_to_light', 'water_early' ] } )

/** One round: forecast, act, score. */
async function round( after ) {

	const choice = await learner.suggest( { happiness : 55 }, {
		explore : false,
		available : [ 'move_to_light' ],
	} )
	await learner.outcome( { happiness : after } )
	return choice.expected

}

// Summer: moving this plant toward the light reliably helps, and the model
// learns to expect that.
for ( let i = 0; i < 12; i++ ) await round( 80 )
console.log( `after a summer of it working, the model expects: ${( await round( 80 ) ).toFixed( 3 )}` )

learner.predictions.reset( 'move_to_light' )

// Winter: the window it moves toward is now a cold draught. Same action, same
// confident forecast, and it stops working.
for ( let i = 0; i < 12; i++ ) await round( 35 )

const cal = learner.predictions.calibration( 'move_to_light' )
console.log( `after ${cal.n} predictions in the new conditions: ${cal.bias}, mean error ${cal.meanError}` )
console.log( `\n${cal.verdict}` )
console.log( '\nNote what it did not say: that the plant is resisting. The plant has no' )
console.log( 'model of the system to resist. The model is simply wrong, and now it knows.' )

// ── 2 · Is this still the same plant? ───────────────────────────────────────

line( '2 · Continuity, and the electrode problem' )

const noisy = ( n, seed ) => {

	let s = seed
	const r = () => {

		s = ( s * 1103515245 + 12345 ) & 0x7fffffff
		return s / 0x7fffffff - 0.5

	}
	return Array.from( { length : 600 }, ( _, i ) => -60 + 2 * Math.sin( ( 2 * Math.PI * i ) / 300 ) + r() * n )

}
const fp = ( n, seed ) => electromeFingerprint( noisy( n, seed ), 5, { mainsHz : 0 } )

/** Two months of history, with a chosen degradation pattern. */
function months( degrade, sites ) {

	const t = new ContinuityTracker( {
		anchorAfter : 6,
		recent : 3,
	} )
	const t0 = Date.now() - 60 * DAY

	for ( let i = 0; i < 20; i++ ) {

		for ( const site of sites ) {

			t.push( fp( degrade( site, i ), i + 1 + site.length * 100 ), {
				site,
				at : t0 + i * 3 * DAY,
			} )

		}

	}

	return t

}

const cases = [
	[ 'one electrode, drifting', [ 'stem' ], ( _s, i ) => ( i < 10 ? 0.5 : 9 ) ],
	[ 'two, only one drifts   ', [ 'stem', 'petiole' ], ( s, i ) => ( s === 'petiole' && i >= 10 ? 9 : 0.5 ) ],
	[ 'two, both drift together', [ 'stem', 'petiole' ], ( _s, i ) => ( i < 10 ? 0.5 : 9 ) ],
]

for ( const [ label, sites, degrade ] of cases ) {

	const a = months( degrade, sites ).attribute()
	console.log( `${label} → ${a.cause.toUpperCase()}` )
	console.log( `   ${a.why.slice( 0, 150 )}…\n` )

}

// ── 3 · Belief that is never tested ─────────────────────────────────────────

line( '3 · Inheritance fades, tested or not' )

const bundle = {
	manifest : {
		schemaVersion : 1,
		species : 'ficus lyrata',
		sourceHash : 'x',
	},
	policies : [ {
		action : 'move_to_light',
		trials : 40,
		meanReward : 0.8,
		transferability : 0.6,
		band : 'strong',
		distinct : 4,
	} ],
	withheld : [],
}

console.log( 'a prior nobody ever puts to the question:' )
for ( const days of [ 0, 30, 60, 120, 240 ] ) {

	const inh = new Inheritance( bundle, {
		compatibility : {
			mean : 1,
			mismatches : [],
		},
		graftedAt : Date.now() - days * DAY,
	} )
	const p = inh.prior( 'move_to_light' )
	console.log( `  ${String( days ).padStart( 3 )} days later → weight ${p.weight}` )

}

console.log( '\nIt used to sit at full strength forever, outranking policies this plant' )
console.log( 'had actually confirmed for itself.' )

// ── 4 · Does the same question get the same answer? ─────────────────────────

line( '4 · Hysteresis' )

/** Waterings, with the uptake speeding up partway, and optionally the weather too. */
function waterings( { tauAfter, warmAfter = false } ) {

	const readings = [], events = []

	for ( let w = 0; w < 12; w++ ) {

		const t0 = Date.now() - ( 12 - w ) * 10 * DAY
		const tau = w >= 6 ? tauAfter : 12
		const temperature = warmAfter && w >= 6 ? 30 : 22

		events.push( {
			t : new Date( t0 ).toISOString(),
			type : 'water',
		} )

		for ( let h = -8; h <= 26; h += 2 ) {

			readings.push( {
				t : new Date( t0 + h * HOUR ).toISOString(),
				soil : h <= 0 ? 25 : 25 + 30 * ( 1 - Math.exp( -h / tau ) ),
				temperature,
				humidity : 55,
				light : 900,
			} )

		}

	}

	readings.sort( ( a, b ) => new Date( a.t ) - new Date( b.t ) )
	return {
		readings,
		events,
	}

}

const primed = waterings( { tauAfter : 3 } )
const r1 = hysteresis( responseHistory( primed.readings, primed.events, 'water' ), primed.events[ 6 ].t )
console.log( `same conditions, faster uptake → changed: ${r1.changed} (${r1.direction})` )
console.log( `   ${r1.verdict.slice( 0, 160 )}…` )

const confounded = waterings( {
	tauAfter : 3,
	warmAfter : true,
} )
const r2 = hysteresis( responseHistory( confounded.readings, confounded.events, 'water' ), confounded.events[ 6 ].t )
console.log( `\nsame change, but the weather changed too → known: ${r2.known}` )
console.log( `   ${r2.reason}` )

console.log( `\n${r1.caveat}` )
