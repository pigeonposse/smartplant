/**
 * What worked last time, and the control that stops it being superstition.
 *
 * Almost every plant problem resolves on its own. A ledger that records
 * "problem → I did X → problem went away" learns with total confidence that X
 * works, and because it is used to choose the next action, it confirms itself.
 * Most of what is tested here is the refusal to credit anything.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import { doseModifier, ResolutionLedger } from '../src/resolutions/index.js'

const HOUR = 3_600_000

/** One complete episode. */
function episode( ledger, problem, {
	actions = [], resolved = true, hours = 12, at = Date.now(),
} = {} ) {

	ledger.opened( problem, { at } )
	for ( const a of actions ) ledger.acted( a )
	return ledger.closed( problem, {
		resolved,
		at : at + hours * HOUR,
	} )

}

const many = ( ledger, problem, n, opts ) => {

	for ( let i = 0; i < n; i++ ) episode( ledger, problem, opts )

}

describe( 'episodes', () => {

	it( 'treats a condition that keeps firing as one episode', () => {

		const led = new ResolutionLedger()
		led.opened( 'thirsty' )
		led.opened( 'thirsty' )
		led.opened( 'thirsty' )

		assert.equal( led.open.size, 1 )

	} )

	it( 'ignores actions taken while nothing is wrong', () => {

		// Routine watering on a healthy plant cures nothing, and counting it is
		// exactly how "watering fixes everything" gets learned.
		const led = new ResolutionLedger()
		assert.deepEqual( led.acted( 'water' ), [] )

	} )

	it( 'closes an episode nobody ever closed as a failure', () => {

		const led = new ResolutionLedger( { maxOpenHours : 24 } )
		led.opened( 'thirsty', { at : Date.now() - 48 * HOUR } )

		const expired = led.expire()

		assert.equal( expired.length, 1 )
		assert.equal( expired[ 0 ].resolved, false )
		assert.equal( led.open.size, 0 )

	} )

} )

describe( 'the control', () => {

	it( 'refuses to say anything without episodes where nothing was done', () => {

		const led = new ResolutionLedger()
		many( led, 'thirsty', 8, { actions : [ 'water' ] } )

		const w = led.whatWorked( 'thirsty' )
		assert.equal( w.known, false )
		assert.match( w.why, /nothing was done|compare a treatment against/ )

	} )

	it( 'refuses a plant that has barely had the problem', () => {

		const led = new ResolutionLedger()
		many( led, 'thirsty', 2, {} )

		assert.match( led.whatWorked( 'thirsty' ).why, /2 time\(s\); 4 are needed/ )

	} )

	it( 'will not credit an action when the plant was recovering anyway', () => {

		// The failure this whole module exists to prevent: the problem clears on
		// its own every time, and whatever you happened to do takes the credit.
		const led = new ResolutionLedger()
		many( led, 'thirsty', 5, {
			resolved : true,
			hours : 20,
		} )
		many( led, 'thirsty', 5, {
			actions : [ 'water' ],
			resolved : true,
			hours : 19,
		} )

		const r = led.recommend( 'thirsty' )

		assert.equal( r.recommend, false )
		assert.match( r.why, /recovering on its own/ )

	} )

	it( 'credits an action that genuinely beats waiting', () => {

		const led = new ResolutionLedger()
		// Left alone it clears one time in five, slowly.
		for ( let i = 0; i < 5; i++ ) episode( led, 'thirsty', {
			resolved : i < 1,
			hours : 60,
		} )
		many( led, 'thirsty', 5, {
			actions : [ 'water' ],
			resolved : true,
			hours : 8,
		} )

		const r = led.recommend( 'thirsty' )

		assert.equal( r.recommend, true )
		assert.equal( r.action, 'water' )
		assert.ok( r.lift >= 0.7 )
		assert.match( r.why, /against 20% for waiting/ )

	} )

	it( 'caps its own confidence, because this is one plant and few episodes', () => {

		const led = new ResolutionLedger()
		for ( let i = 0; i < 5; i++ ) episode( led, 'thirsty', { resolved : false } )
		many( led, 'thirsty', 40, {
			actions : [ 'water' ],
			resolved : true,
		} )

		assert.ok( led.recommend( 'thirsty' ).confidence <= 0.7 )

	} )

	it( 'refuses to attribute anything when several things were done at once', () => {

		const led = new ResolutionLedger()
		for ( let i = 0; i < 5; i++ ) episode( led, 'thirsty', { resolved : false } )
		many( led, 'thirsty', 5, {
			actions : [ 'water', 'fertilize', 'move' ],
			resolved : true,
		} )

		const w = led.whatWorked( 'thirsty' )

		assert.equal( w.actions.length, 0 )
		assert.match( w.unattributable.why, /Change one thing at a time/ )
		assert.equal( led.recommend( 'thirsty' ).recommend, false )

	} )

	it( 'reports how often the problem passes by itself', () => {

		const led = new ResolutionLedger()
		for ( let i = 0; i < 6; i++ ) episode( led, 'hot', {
			resolved : i < 3,
			hours : 10,
		} )

		const base = led.baseRate( 'hot' )

		assert.equal( base.known, true )
		assert.equal( base.rate, 0.5 )
		assert.equal( base.medianHours, 10 )

	} )

} )

describe( 'dose, from measured hysteresis', () => {

	it( 'does nothing without a measured change', () => {

		assert.equal( doseModifier( null ), null )
		assert.equal( doseModifier( {
			known : true,
			changed : false,
		} ), null )

	} )

	it( 'cuts the dose when the plant has become more reactive', () => {

		const d = doseModifier( {
			known : true,
			changed : true,
			direction : 'stronger and faster',
		} )

		assert.equal( d.direction, 'reduce' )
		assert.ok( d.factor < 1 )

	} )

	it( 'does NOT raise the dose when the plant has become less reactive', () => {

		// The asymmetry is the whole point. A weaker response is at least as often
		// damage as tolerance, and root rot answers a bigger drink by getting
		// worse. The tempting move here is the harmful one.
		const d = doseModifier( {
			known : true,
			changed : true,
			direction : 'weaker',
		} )

		assert.equal( d.direction, 'hold' )
		assert.equal( d.factor, 1 )
		assert.equal( d.caution, true )
		assert.match( d.why, /Do not read that as needing more/ )

	} )

} )

describe( 'on a live plant', () => {

	const thirsty = () => createPlant( {
		name : 'Ivy',
		species : 'Ficus lyrata',
		sensor : {
			driver : 'manual',
			initial : {
				// Clearly below the woody archetype's floor, not merely near it:
				// a mild deviation does not raise a condition event.
				soil : 5,
				temperature : 22,
				humidity : 55,
				light : 900,
			},
		},
		ai : { provider : 'mock' },
	} )

	it( 'opens an episode when a condition fires and closes it when it clears', async () => {

		const plant = await thirsty()
		await plant.read()

		assert.deepEqual( [ ...plant.resolutions.open.keys() ], [ 'plant:thirsty' ] )

		plant.getSensor( 'manual' ).set( { soil : 40 } )
		await plant.read()

		const done = plant.resolutions.history.get( 'plant:thirsty' )
		assert.equal( done.length, 1 )
		assert.equal( done[ 0 ].resolved, true )

		await plant.destroy()

	} )

	it( 'attributes care given while the problem was open', async () => {

		const plant = await thirsty()
		await plant.read()
		await plant.water()

		plant.getSensor( 'manual' ).set( { soil : 40 } )
		await plant.read()

		assert.deepEqual( plant.resolutions.history.get( 'plant:thirsty' )[ 0 ].actions, [ 'water' ] )

		await plant.destroy()

	} )

	it( 'says it does not know yet rather than guessing from one episode', async () => {

		const plant = await thirsty()
		await plant.read()
		await plant.water()
		plant.getSensor( 'manual' ).set( { soil : 40 } )
		await plant.read()

		const r = await plant.whatWorkedBefore( 'plant:thirsty' )

		assert.equal( r.recommend, false )
		assert.match( r.why, /are needed before this plant's own history says anything/ )

		await plant.destroy()

	} )

	it( 'survives being stored and restored', async () => {

		const plant = await thirsty()
		await plant.read()
		plant.getSensor( 'manual' ).set( { soil : 40 } )
		await plant.read()

		const saved = plant.resolutions.toJSON()
		const restored = ResolutionLedger.from( saved )

		assert.equal( restored.history.get( 'plant:thirsty' ).length, 1 )

		await plant.destroy()

	} )

} )

describe( 'the same problem is not the same problem', () => {

	const HOT = {
		temperature : 31,
		humidity : 25,
		soil : 20,
	}
	const COOL = {
		temperature : 17,
		humidity : 70,
		soil : 20,
	}

	/** Watering earns its keep in the heat and adds nothing in the cool. */
	function twoWeathers() {

		const led = new ResolutionLedger()
		const add = ( ctx, opts ) => {

			const at = Date.now() - ( opts.hours ?? 12 ) * HOUR * 2
			led.opened( 'thirsty', {
				at,
				context : ctx,
			} )
			for ( const a of opts.actions || [] ) led.acted( a )
			led.closed( 'thirsty', {
				resolved : opts.resolved,
				at : at + ( opts.hours ?? 12 ) * HOUR,
			} )

		}

		for ( let i = 0; i < 4; i++ ) add( HOT, {
			resolved : false,
			hours : 60,
		} )
		for ( let i = 0; i < 4; i++ ) add( HOT, {
			actions : [ 'water' ],
			resolved : true,
			hours : 6,
		} )
		for ( let i = 0; i < 4; i++ ) add( COOL, {
			resolved : true,
			hours : 12,
		} )
		for ( let i = 0; i < 4; i++ ) add( COOL, {
			actions : [ 'water' ],
			resolved : true,
			hours : 12,
		} )

		return led

	}

	it( 'gives opposite answers for the same problem in different conditions', () => {

		// Pooled, these average into a treatment for a situation nobody is in.
		const led = twoWeathers()

		const hot = led.recommend( 'thirsty', { like : HOT } )
		const cool = led.recommend( 'thirsty', { like : COOL } )

		assert.equal( hot.recommend, true )
		assert.equal( hot.lift, 1 )
		assert.equal( cool.recommend, false )
		assert.match( cool.why, /recovering on its own/ )

	} )

	it( 'says which question it answered', () => {

		const hot = twoWeathers().recommend( 'thirsty', { like : HOT } )

		assert.ok( hot.narrowed )
		assert.match( hot.narrowed.why, /conditions like these/ )

	} )

	it( 'falls back to everything, and says so, when too few episodes match', () => {

		const led = twoWeathers()
		const odd = led.whatWorked( 'thirsty', { like : {
			temperature : 5,
			humidity : 95,
			soil : 90,
		} } )

		assert.equal( odd.narrowed.fellBack, true )
		assert.match( odd.narrowed.why, /regardless of the conditions/ )

	} )

} )

describe( 'asking the colony what worked', () => {

	const HOUR_ = HOUR

	async function member( bus, name, species ) {

		const { createPlant : make } = await import( '../src/index.js' )
		const plant = await make( {
			name,
			species,
			sensor : {
				driver : 'mock',
				dayNight : false,
			},
			ai : { provider : 'mock' },
		} )
		await plant.joinColony( { transport : bus.endpoint( name.toLowerCase() ) } )
		return plant

	}

	const seed = ( plant, problem, { actions = [], resolved, hours = 12 } ) => {

		const at = Date.now() - hours * HOUR_ * 2
		plant.resolutions.opened( problem, { at } )
		for ( const a of actions ) plant.resolutions.acted( a )
		plant.resolutions.closed( problem, {
			resolved,
			at : at + hours * HOUR_,
		} )

	}

	it( 'ignores neighbours of another species', async () => {

		const { LoopbackBus } = await import( '../src/colony/index.js' )
		const bus = new LoopbackBus()

		const other = await member( bus, 'Other', 'Monstera deliciosa' )
		for ( let i = 0; i < 5; i++ ) seed( other, 'plant:thirsty', { resolved : false } )
		for ( let i = 0; i < 6; i++ ) seed( other, 'plant:thirsty', {
			actions : [ 'move' ],
			resolved : true,
		} )

		const mine = await member( bus, 'Newcomer', 'Ficus lyrata' )
		const r = await mine.colony.askColonyWhatWorked( 'plant:thirsty' )

		// A confident answer from the wrong species is worse than no answer.
		assert.equal( r.known, false )
		assert.match( r.why, /none of them is a ficus lyrata/ )

		await Promise.all( [ other, mine ].map( p => p.destroy() ) )

	} )

	it( 'pools same-species neighbours and carries their base rate', async () => {

		const { LoopbackBus } = await import( '../src/colony/index.js' )
		const bus = new LoopbackBus()

		const old = await member( bus, 'Elder', 'Ficus lyrata' )
		for ( let i = 0; i < 5; i++ ) seed( old, 'plant:thirsty', {
			resolved : i < 1,
			hours : 60,
		} )
		for ( let i = 0; i < 6; i++ ) seed( old, 'plant:thirsty', {
			actions : [ 'water' ],
			resolved : true,
			hours : 7,
		} )

		const mine = await member( bus, 'Newcomer', 'Ficus lyrata' )
		const r = await mine.colony.askColonyWhatWorked( 'plant:thirsty' )

		assert.equal( r.recommend, true )
		assert.equal( r.action, 'water' )
		// "Watering worked every time" is not information without this next to it.
		assert.ok( Number.isFinite( r.baseRate ) )
		// Another pot, another window: never worth more than this plant's own record.
		assert.ok( r.confidence <= 0.45 )

		await Promise.all( [ old, mine ].map( p => p.destroy() ) )

	} )

	it( 'refuses when the neighbours were recovering on their own too', async () => {

		const { LoopbackBus } = await import( '../src/colony/index.js' )
		const bus = new LoopbackBus()

		const old = await member( bus, 'Elder2', 'Ficus lyrata' )
		for ( let i = 0; i < 5; i++ ) seed( old, 'plant:thirsty', { resolved : true } )
		for ( let i = 0; i < 6; i++ ) seed( old, 'plant:thirsty', {
			actions : [ 'water' ],
			resolved : true,
		} )

		const mine = await member( bus, 'Newcomer2', 'Ficus lyrata' )
		const r = await mine.colony.askColonyWhatWorked( 'plant:thirsty' )

		assert.equal( r.recommend, false )
		assert.match( r.why, /mostly recovering anyway/ )

		await Promise.all( [ old, mine ].map( p => p.destroy() ) )

	} )

} )
