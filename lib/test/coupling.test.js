/**
 * Two plants close together stop being two plants.
 *
 * Most of what is tested here is refusal. The physics of a shared humid pocket
 * is not in doubt; what is in doubt is whether a given pair of sensors can see
 * it, and almost every test below is about the system saying so rather than
 * producing a number it cannot stand behind.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import {
	AID, aidEffect, airVpd, canOffer, co2Depletion, COUPLING, COUPLING_RANGE,
	coupled, couplingState, crowdingRisk, LoopbackBus, pocket, primingAlert,
	receivePriming, RECIPROCAL_AID, shadeAvoidance, substrateNotes,
} from '../src/colony/index.js'

const ROOM = {
	temperature : 26,
	humidity : 42,
	co2 : 620,
}

const PAIR = {
	metres : 0.25,
	a : {
		temperature : 25.4,
		humidity : 58,
		leafTemperature : 23.1,
	},
	b : {
		temperature : 25.6,
		humidity : 57,
	},
}

describe( 'being close enough to matter', () => {

	it( 'will not assess a pair whose distance nobody declared', () => {

		const r = coupled( {} )

		assert.equal( r.coupled, null )
		assert.match( r.why, /No distance/ )

	} )

	it( 'says a declared distance is declared', () => {

		const r = coupled( { metres : 0.2 } )

		assert.equal( r.coupled, true )
		assert.equal( r.declared, true )
		// It is a claim about the world that goes stale the moment a pot moves,
		// and it should never read as a measurement.
		assert.match( r.why, /Declared, not measured/ )

	} )

	it( 'treats plants across the room as neighbours, not a pair', () => {

		const r = coupled( { metres : COUPLING_RANGE + 0.5 } )

		assert.equal( r.coupled, false )
		assert.match( r.why, /neighbours in a room/ )

	} )

} )

describe( 'the reference problem', () => {

	it( 'refuses to call two agreeing plants a humid pocket', () => {

		const r = pocket( PAIR, null )

		assert.equal( r.reference, false )
		// Every effect unknown, none of them false. Nothing was ruled out.
		assert.ok( r.effects.every( e => e.observed === null ) )
		assert.match( r.effects[ 0 ].why, /exactly what a humid room looks like/ )

	} )

	it( 'finds the pocket once there is something outside it to compare against', () => {

		const r = pocket( PAIR, ROOM )
		const rh = r.effects.find( e => e.effect === COUPLING.HUMIDITY_POCKET.id )

		assert.equal( r.reference, true )
		assert.equal( rh.observed, true )
		assert.equal( rh.lift, 15.5 )

	} )

	it( 'reports the VPD drop, which is the part that actually does the work', () => {

		const r = pocket( PAIR, ROOM )
		const vpd = r.effects.find( e => e.effect === COUPLING.VPD_BUFFER.id )

		assert.equal( vpd.observed, true )
		assert.ok( vpd.drop > 0 )
		assert.ok( vpd.pairVpd < vpd.referenceVpd )
		assert.match( vpd.why, /stomata open longer|hold its stomata open/ )

	} )

	it( 'finds no pocket when the pair matches the room', () => {

		const still = {
			metres : 0.2,
			a : {
				temperature : 26,
				humidity : 43,
			},
			b : {
				temperature : 26,
				humidity : 42,
			},
		}
		const rh = pocket( still, ROOM ).effects.find( e => e.effect === COUPLING.HUMIDITY_POCKET.id )

		// A real false, not an unknown — there was enough to answer with.
		assert.equal( rh.observed, false )

	} )

	it( 'leaves cooling unknown without leaf temperature on both', () => {

		const cool = pocket( PAIR, ROOM ).effects.find( e => e.effect === COUPLING.EVAPORATIVE_COOLING.id )

		// Only plant `a` has a leaf probe, and one leaf cannot speak for a pair.
		assert.equal( cool.observed, null )

	} )

	it( 'computes air VPD or returns nothing', () => {

		assert.ok( airVpd( 25, 50 ) > 1.5 )
		assert.equal( airVpd( 25, undefined ), null )
		assert.equal( airVpd( undefined, 50 ), null )

	} )

} )

describe( 'the cost side', () => {

	it( 'flags the conditions for CO2 depletion even with no CO2 sensor', () => {

		const r = co2Depletion( {
			airflow : 0.05,
			light : 14_000,
		} )

		assert.equal( r.observed, null )
		assert.equal( r.risk, true )
		assert.match( r.why, /A small fan removes the problem/ )

	} )

	it( 'does not flag still air in the dark', () => {

		const r = co2Depletion( {
			airflow : 0.05,
			light : 100,
		} )

		assert.equal( r.risk, false )

	} )

	it( 'does not flag bright light in moving air', () => {

		const r = co2Depletion( {
			airflow : 0.9,
			light : 30_000,
		} )

		assert.equal( r.risk, false )
		assert.match( r.why, /replaces the pocket faster/ )

	} )

	it( 'measures depletion against outside the pair when it can', () => {

		const r = co2Depletion( {
			co2 : 480,
			reference : 620,
			airflow : 0.05,
			light : 14_000,
		} )

		assert.equal( r.observed, true )
		assert.match( r.why, /competing, not helping/ )

	} )

	it( 'knows a neighbour is being read as competition', () => {

		const r = shadeAvoidance( { redFarRed : 0.4 } )

		assert.equal( r.observed, true )
		assert.match( r.why, /elongating/ )

	} )

	it( 'refuses to blame elongation on a neighbour without the ratio', () => {

		const r = shadeAvoidance( {} )

		assert.equal( r.observed, null )
		assert.match( r.why, /guessing with a confident face/ )

	} )

} )

describe( 'the whole picture', () => {

	it( 'reports cost ahead of benefit, and says to move the air rather than the plants', () => {

		const s = couplingState( {
			...PAIR,
			a : {
				...PAIR.a,
				co2 : 500,
				airflow : 0.04,
				light : 15_000,
			},
		}, ROOM )

		assert.ok( s.benefits.includes( COUPLING.HUMIDITY_POCKET.id ) )
		assert.ok( s.costs.includes( COUPLING.CO2_DEPLETION.id ) )
		assert.match( s.why, /moving the air/ )

	} )

	it( 'assesses nothing for a pair that is not a pair', () => {

		const s = couplingState( {
			...PAIR,
			metres : 3,
		}, ROOM )

		assert.deepEqual( s.effects, [] )

	} )

	it( 'distinguishes "nothing measurable" from "nothing happening"', () => {

		const s = couplingState( PAIR, null )

		assert.deepEqual( s.benefits, [] )
		assert.equal( s.unknown.length, 5 )
		assert.match( s.why, /not the same as the pairing doing nothing/ )

	} )

} )

describe( 'priming, and what it honestly is', () => {

	it( 'says nothing when there is nothing found', () => {

		assert.equal( primingAlert( {} ), null )

	} )

	it( 'goes out on suspicion, unlike everything else here', () => {

		const a = primingAlert( {
			suspected : true,
			what : 'spider mites',
			from : 'ivy',
		}, { metres : 0.3 } )

		assert.equal( a.confirmed, false )
		assert.equal( a.urgency, 'high' )
		assert.match( a.why, /a few wasted inspections cost less than a room/ )

	} )

	it( 'never pretends to be a volatile', () => {

		const a = primingAlert( { confirmed : true } )

		assert.equal( a.substitute, true )
		assert.equal( COUPLING.PRIMING.substitute, 'colony-alert' )
		assert.match( a.why, /if anything here could smell it/ )

	} )

	it( 'raises how soon a warned plant looks, and nothing more', () => {

		const r = receivePriming( primingAlert( {
			suspected : true,
			from : 'ivy',
		}, { metres : 0.2 } ) )

		assert.equal( r.prime, true )
		assert.equal( r.inspectWithin, 6 )
		// The line that matters: a warning is not a diagnosis.
		assert.match( r.why, /would be dosing a plant for a problem it may not have/ )

	} )

	it( 'is calmer about a plant across the room', () => {

		const r = receivePriming( primingAlert( { suspected : true }, { metres : 4 } ) )

		assert.equal( r.inspectWithin, 24 )

	} )

} )

describe( 'a shared pot', () => {

	it( 'says nothing at all for separate pots', () => {

		assert.deepEqual( substrateNotes( {} ), [] )

	} )

	it( 'notes root chemistry as unmeasurable and the moisture probe as measurable', () => {

		const notes = substrateNotes( {
			sharedSubstrate : true,
			livingSubstrate : true,
		} )

		assert.equal( notes.filter( n => n.measurable ).length, 1 )
		assert.ok( notes.some( n => n.effect === COUPLING.ALLELOPATHY.id ) )
		assert.ok( notes.some( n => n.effect === COUPLING.MYCORRHIZAL.id ) )
		assert.match( notes.find( n => n.measurable ).why, /speaks for two root systems/ )

	} )

} )

describe( 'huddling', () => {

	const plant = reading => ( {
		body : {},
		memory : { lastReading : reading },
	} )

	it( 'is the only kind of aid where nobody spends anything', () => {

		assert.ok( RECIPROCAL_AID.includes( AID.HUDDLE ) )
		assert.equal( aidEffect( AID.HUDDLE ).reciprocal, true )
		assert.equal( aidEffect( AID.HUDDLE ).metric, 'humidity' )
		assert.equal( aidEffect( AID.HUDDLE ).mode, 'sustain' )

	} )

	it( 'refuses at midday in still air', () => {

		const r = canOffer( plant( {
			airflow : 0.04,
			light : 15_000,
		} ), AID.HUDDLE )

		assert.equal( r.able, false )
		assert.equal( r.reason, 'co2-depletion' )
		// Refuses the timing, not the arrangement — and says so.
		assert.match( r.why, /the arrangement is fine, the timing is not/ )

	} )

	it( 'allows the same pair after dark', () => {

		assert.equal( canOffer( plant( {
			airflow : 0.04,
			light : 200,
		} ), AID.HUDDLE ).able, true )

	} )

	it( 'allows it with a fan running', () => {

		assert.equal( canOffer( plant( {
			airflow : 0.8,
			light : 30_000,
		} ), AID.HUDDLE ).able, true )

	} )

	it( 'allows an unmeasured room, and says why that exception exists', () => {

		const r = crowdingRisk( plant( { light : 15_000 } ) )

		assert.equal( r.unsafe, false )
		assert.equal( r.flagged, true )
		assert.match( r.why, /mild, reversible and fixed by opening a window/ )

	} )

} )

describe( 'over the channel', () => {

	it( 'warns the colony and the neighbour looks sooner', async () => {

		const bus = new LoopbackBus()

		const make = async name => {

			const p = await createPlant( {
				name,
				species : 'Ficus',
				sensor : { driver : 'mock' },
				ai : { provider : 'mock' },
			} )
			await p.read()
			await p.joinColony( { transport : bus.endpoint( name.toLowerCase() ) } )
			return p

		}

		const [ sick, well ] = await Promise.all( [ make( 'Ivy' ), make( 'Willow' ) ] )

		sick._lastInfectionWatch = {
			suspected : true,
			what : 'spider mites',
		}

		const out = await sick.colony.warnNeighbours( { near : { willow : 0.25 } } )

		assert.deepEqual( out.sent, [ 'willow' ] )
		assert.equal( well.colony.primed.prime, true )
		assert.equal( well.colony.primed.inspectWithin, 6 )
		assert.equal( well.colony.primed.from, 'ivy' )

		await Promise.all( [ sick, well ].map( p => p.destroy() ) )

	} )

	it( 'will not warn anyone about something it cannot see', async () => {

		const bus = new LoopbackBus()
		const p = await createPlant( {
			name : 'Blind',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		await p.read()
		await p.joinColony( { transport : bus.endpoint( 'blind' ) } )

		const out = await p.colony.warnNeighbours()

		assert.deepEqual( out.sent, [] )
		assert.match( out.why, /train everyone to ignore the next one/ )

		await p.destroy()

	} )

} )
