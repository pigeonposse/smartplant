/**
 * Capability, beaconing, security priming and navigation.
 *
 * The common thread: each of these knows something about hardware, and each of
 * them refuses rather than proceeding when the hardware is not there. The tests
 * that matter most are the refusals.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import {
	BEACON, beaconMode, capable, considerAlert, decode, distress, FACULTY,
	frame, LoopbackBus, onDistress, opticalLink, opticalPeers, prepareBeacon,
	protocol, RECEIVE_HZ, relevance, RING, ringFor, SECURITY_PHASE, UVB,
	uvbGate, whoCanRead,
} from '../src/colony/index.js'
import {
	canCross, planMove, REFUSAL, ros2Surveyor, Surveyor, worthMoving,
} from '../src/navigation/index.js'

const FAST = {
	id : 'willow',
	faculties : [ FACULTY.FAST_LIGHT ],
	photodiodeHz : 20_000,
	metrics : [ 'light', 'temperature' ],
}
const SLOW = {
	id : 'fern',
	faculties : [],
	photodiodeHz : null,
	metrics : [ 'light' ],
}
const EMITTER = {
	id : 'ivy',
	faculties : [ FACULTY.SPECTRAL ],
}

describe( 'what a plant advertises', () => {

	it( 'publishes its equipment when it joins', async () => {

		const bus = new LoopbackBus()

		const make = async ( name, extra = {} ) => {

			const p = await createPlant( {
				name,
				species : 'Ficus',
				sensor : { driver : 'mock' },
				ai : { provider : 'mock' },
			} )
			Object.assign( p, extra )
			await p.read()
			await p.joinColony( { transport : bus.endpoint( name.toLowerCase() ) } )
			return p

		}

		const a = await make( 'Ivy' )
		const b = await make( 'Willow', { optical : { sampleRateHz : 20_000 } } )
		await new Promise( r => setTimeout( r, 30 ) )

		assert.ok( a.colony.manifest.metrics.includes( 'soil' ) )
		assert.equal( a.colony.manifests.get( 'willow' )?.photodiodeHz, 20_000 )
		assert.ok( a.colony.manifests.get( 'willow' ).faculties.includes( FACULTY.FAST_LIGHT ) )

		await Promise.all( [ a, b ].map( p => p.destroy() ) )

	} )

	it( 'separates a missing instrument from a steady value', () => {

		const r = whoCanRead( { fern : SLOW }, 'airflow' )

		assert.deepEqual( r.who, [] )
		assert.match( r.why, /the instrument is missing, not that the value is steady/ )

	} )

	it( 'treats a claim as permission to ask, never as a promise', () => {

		assert.match( capable( FAST, FACULTY.FAST_LIGHT ).why, /Declared, not verified/ )
		assert.equal( capable( null, FACULTY.SEE ).can, null )

	} )

} )

describe( 'the optical link, and the half everyone forgets', () => {

	it( 'refuses to blink at a lux sensor', () => {

		const r = opticalLink( EMITTER, SLOW )

		assert.equal( r.can, false )
		assert.equal( r.reason, 'slow-receiver' )
		assert.match( r.why, new RegExp( `${RECEIVE_HZ} Hz or better` ) )

	} )

	it( 'allows it to a fast photodiode', () => {

		assert.equal( opticalLink( EMITTER, FAST ).can, true )

	} )

	it( 'refuses to send blind', () => {

		assert.equal( opticalLink( EMITTER, null ).reason, 'unknown-receiver' )

	} )

	it( 'needs an emitter too', () => {

		assert.equal( opticalLink( SLOW, FAST ).reason, 'no-emitter' )

	} )

	it( 'says when nobody in the colony could hear it', () => {

		const r = opticalPeers( EMITTER, { fern : SLOW } )

		assert.deepEqual( r.who, [] )
		assert.match( r.why, /Worth knowing before the battery is low rather than after/ )

	} )

} )

describe( 'beacon mode', () => {

	it( 'stays off in ordinary daylight operation', () => {

		const r = beaconMode( {
			charge : 0.8,
			ambientLux : 9000,
		} )

		assert.equal( r.mode, BEACON.OFF )
		// The honest framing, rather than "optical is cheaper".
		assert.match( r.why, /a fallback and a night channel, not a better link/ )

	} )

	it( 'comes up on critical charge, and says the radio is what costs', () => {

		const r = beaconMode( {
			charge : 0.03,
			ambientLux : 9000,
		} )

		assert.equal( r.mode, BEACON.CRITICAL )
		assert.match( r.why, /Wi-Fi association/ )

	} )

	it( 'comes up on a failed radio at any charge', () => {

		assert.equal( beaconMode( {
			charge : 1,
			radioFailed : true,
		} ).mode, BEACON.CRITICAL )

	} )

	it( 'runs quietly in the dark, for the SNR', () => {

		const r = beaconMode( {
			charge : 0.9,
			ambientLux : 0,
		} )

		assert.equal( r.mode, BEACON.QUIET )
		assert.match( r.why, /fewer and dimmer pulses/ )

	} )

	it( 'survives a round trip', () => {

		const f = frame( {
			from : 'ivy',
			kind : 'sos',
			body : { c : 0.03 },
		} )
		const d = decode( f.bits )

		assert.equal( d.ok, true )
		assert.equal( d.message.from, 'ivy' )
		assert.equal( d.message.body.c, 0.03 )

	} )

	it( 'drops a corrupt frame rather than half-believing it', () => {

		const f = frame( { from : 'ivy' } )
		const bits = [ ...f.bits ]
		bits[ 40 ] ^= 1

		const d = decode( bits )
		assert.equal( d.ok, false )
		assert.match( d.why, /cannot ask for a resend/ )

	} )

	it( 'reports silence and slowness as indistinguishable, from the receiving end', () => {

		assert.match( decode( [ 0, 0, 0, 0 ] ).why, /those look identical/ )

	} )

	it( 'books the emission against the dose ledger like any other light', () => {

		const p = prepareBeacon( EMITTER, FAST, { kind : 'sos' }, { mode : BEACON.CRITICAL } )

		assert.equal( p.send, true )
		assert.equal( p.band, 'amber' )
		assert.equal( p.nm, 590 )
		// A message is still light landing on a plant.
		assert.ok( p.dose.seconds > 0 )
		assert.equal( p.dose.band, 'amber' )

	} )

	it( 'switches to green only when the sender is buried', () => {

		const p = prepareBeacon( EMITTER, FAST, {}, {
			mode : BEACON.CRITICAL,
			obstructed : true,
		} )

		assert.equal( p.nm, 530 )
		assert.match( p.why, /Penetrates leaf tissue/ )

	} )

	it( 'will not transmit when the mode does not call for it', () => {

		assert.equal( prepareBeacon( EMITTER, FAST, {}, { mode : BEACON.OFF } ).send, false )

	} )

	it( 'asks the receiver to be a radio, not a nurse', () => {

		const r = onDistress( {
			from : 'ivy',
			kind : 'sos',
			body : { c : 0.02 },
		} )

		assert.equal( r.relay, true )
		assert.match( r.why, /a neighbour cannot charge it — but a person can/ )

	} )

	it( 'carries only what a relay needs', () => {

		const d = distress( { memory : { lastReading : {
			soil : 12.4,
			temperature : 19.8,
		} } } )

		assert.equal( d.kind, 'sos' )
		assert.deepEqual( Object.keys( d.body ).sort(), [ 'c', 's', 't' ] )

	} )

} )

describe( 'security priming', () => {

	const plant = ( species, load = 'low' ) => ( {
		memory : { plant : { species } },
		archetype : { id : 'tropical-understorey' },
		states : () => ( {
			stress_load : {
				level : load,
				acts : load !== 'low',
				why : 'Several episodes and slow recovery.',
			},
			defense_activation : {
				level : 'low',
				acts : false,
			},
		} ),
	} )

	const alert = ( metres, species = 'Ficus lyrata', archetype = 'tropical-understorey' ) => ( {
		from : 'neighbour',
		species,
		archetype,
		metres,
		what : 'spider mites',
	} )

	it( 'weights a warning by distance and by what the pest can eat', () => {

		assert.equal( ringFor( 0.3 ), RING.CONTACT )
		assert.equal( ringFor( 3 ), RING.ROOM )
		assert.equal( ringFor( 500 ), null )

		assert.equal( relevance( alert( 0.3 ), plant( 'Ficus lyrata' ) ).weight, 1 )
		assert.ok( relevance( alert( 3 ), plant( 'Ficus lyrata' ) ).weight < 1 )

	} )

	it( 'refuses a warning from another building, and says why that is doctrine', () => {

		const r = considerAlert( plant( 'Ficus lyrata' ), alert( 500 ) )

		assert.equal( r.prime, false )
		assert.match( r.why, /a fact about that city/ )

	} )

	it( 'refuses when no distance was declared', () => {

		assert.equal( relevance( { species : 'Ficus lyrata' }, plant( 'Ficus lyrata' ) ).weight, 0 )

	} )

	it( 'discounts an unrelated host without dismissing it', () => {

		// A different species *and* a different strategy — otherwise the shared
		// archetype alone keeps them related.
		const r = relevance( alert( 3, 'Zea mays', 'grass' ), plant( 'Ficus lyrata' ) )

		assert.ok( r.weight > 0 )
		assert.ok( r.weight < relevance( alert( 3 ), plant( 'Ficus lyrata' ) ).weight )
		assert.match( r.why, /a spider mite eats almost anything/ )

	} )

	it( 'refuses to prime a plant that is already spent', () => {

		const r = considerAlert( plant( 'Ficus lyrata', 'high' ), alert( 0.3 ) )

		assert.equal( r.prime, false )
		assert.equal( r.blocked, 'stress_load' )
		assert.match( r.why, /trades a possible threat for a certain cost/ )

	} )

	it( 'holds red:far-red high, because low would switch off what it is inducing', () => {

		const r = considerAlert( plant( 'Ficus lyrata' ), alert( 0.3 ) )

		assert.equal( r.redFarRed.hold, 'high' )
		assert.match( r.redFarRed.why, /suppresses jasmonate and salicylate responsiveness/ )

	} )

	it( 'runs airflow and watching without UV-B by default', () => {

		const r = considerAlert( plant( 'Ficus lyrata' ), alert( 0.3 ) )

		assert.ok( r.phases.includes( SECURITY_PHASE.AIRFLOW ) )
		assert.ok( !r.phases.includes( SECURITY_PHASE.UVB ) )
		assert.equal( r.uvb.reason, 'not-enabled' )

	} )

	describe( 'the UV-B interlocks', () => {

		const withUvb = ( extra = {} ) => ( {
			...plant( 'Ficus lyrata' ),
			spectral : {
				light : { channels : [ 'red', 'blue', 'uvb' ] },
				safety : { usedToday : () => extra.used ?? 0 },
			},
		} )

		const strong = relevance( alert( 0.3 ), plant( 'Ficus lyrata' ) )

		it( 'is off unless deliberately enabled', () => {

			assert.equal( uvbGate( withUvb(), strong, {} ).reason, 'not-enabled' )

		} )

		it( 'needs a fixture that actually has the channel', () => {

			assert.equal( uvbGate( plant( 'Ficus lyrata' ), strong, { allowUvb : true } ).reason, 'no-emitter' )

		} )

		it( 'waits for the room to be empty', () => {

			const r = uvbGate( withUvb(), strong, {
				allowUvb : true,
				occupied : true,
			} )

			assert.equal( r.reason, 'occupied' )
			assert.match( r.why, /burns skin and eyes/ )

		} )

		it( 'is held for a threat worth it', () => {

			const weak = relevance( alert( 3, 'Zea mays', 'grass' ), plant( 'Ficus lyrata' ) )

			assert.equal( uvbGate( withUvb(), weak, { allowUvb : true } ).reason, 'weak-alert' )

		} )

		it( 'has a daily cap no caller can raise', () => {

			const r = uvbGate( withUvb( { used : UVB.maxSecondsPerDay } ), strong, { allowUvb : true } )

			assert.equal( r.reason, 'daily-cap' )
			assert.match( r.why, /cannot be raised by a caller/ )

		} )

		it( 'allows it when every interlock is satisfied', () => {

			const r = uvbGate( withUvb(), strong, {
				allowUvb : true,
				occupied : false,
			} )

			assert.equal( r.allowed, true )
			assert.ok( r.pulseSeconds > 0 )

		} )

	} )

	it( 'orders the protocol by cost and always stands down', () => {

		const plan = protocol( considerAlert( plant( 'Ficus lyrata' ), alert( 0.3 ) ) )

		assert.equal( plan[ 0 ].phase, SECURITY_PHASE.AIRFLOW )
		assert.equal( plan.at( -1 ).phase, SECURITY_PHASE.STAND_DOWN )
		assert.match( plan.at( -1 ).why, /paid forever for a threat that passed/ )

	} )

	it( 'keeps the electrode a witness rather than a driver', () => {

		const watch = protocol( considerAlert( plant( 'Ficus lyrata' ), alert( 0.3 ) ) )
			.find( p => p.phase === SECURITY_PHASE.WATCH )

		assert.equal( watch.action.electrode, 'observe' )
		assert.match( watch.why, /watches rather than drives/ )

	} )

} )

describe( 'moving a plant without being clumsy', () => {

	const tall = {
		heightM : 2,
		baseM : 0.35,
		wheelbaseM : 0.4,
	}

	it( 'refuses a threshold a delivery robot would not notice', () => {

		const r = canCross( tall, { stepM : 0.04 } )

		assert.equal( r.safe, false )
		assert.match( r.why, /tipping moment/ )

	} )

	it( 'crosses a small one', () => {

		assert.equal( canCross( tall, { stepM : 0.01 } ).safe, true )

	} )

	it( 'will not guess the geometry', () => {

		const r = canCross( {}, { stepM : 0.04 } )

		assert.equal( r.safe, null )
		assert.match( r.why, /two numbers with a tape measure/ )

	} )

	it( 'refuses a destination nobody has measured', () => {

		const r = worthMoving( { light : 400 }, null, {} )

		assert.equal( r.better, null )
		assert.match( r.why, /a guess dressed as a decision/ )

	} )

	it( 'catches the trade that makes "go toward the light" dangerous', () => {

		const r = worthMoving(
			{
				light : 400,
				temperature : 21,
				airflow : 0.1,
			},
			{
				light : 9000,
				temperature : 14,
				airflow : 0.9,
			},
			{ metric : 'light' },
		)

		assert.equal( r.better, false )
		assert.ok( r.gain > 0 )
		assert.equal( r.costs.length, 2 )

	} )

	it( 'approves a move that improves one thing and breaks none', () => {

		assert.equal( worthMoving(
			{
				light : 400,
				temperature : 21,
			},
			{
				light : 2000,
				temperature : 21,
			},
			{ metric : 'light' },
		).better, true )

	} )

	it( 'refuses to arrive beside an infested neighbour', async () => {

		const r = await planMove( {
			memory : { lastReading : {
				light : 400,
				temperature : 21,
			} },
			chassis : tall,
			states : () => ( {} ),
		}, {
			to : { x : 1 },
			there : {
				light : 2000,
				temperature : 21,
			},
			want : { metric : 'light' },
			neighbours : [ {
				id : 'fern',
				biotic : true,
				metres : 0.3,
			} ],
		} )

		assert.equal( r.go, false )
		assert.ok( r.refusals.some( x => x.reason === REFUSAL.BIOTIC ) )

	} )

	it( 'refuses to move a plant that is defending itself', async () => {

		const r = await planMove( {
			memory : { lastReading : { light : 400 } },
			chassis : tall,
			states : () => ( { defense_activation : {
				acts : true,
				statement : 'Estimated activation of the defence pathway: high.',
			} } ),
		}, {
			to : {},
			there : { light : 2000 },
			want : { metric : 'light' },
		} )

		assert.ok( r.refusals.some( x => x.reason === REFUSAL.DEFENDING ) )

	} )

	it( 'refuses with no surveyor, after everything else has passed', async () => {

		const r = await planMove( {
			memory : { lastReading : { light : 400 } },
			chassis : tall,
			states : () => ( {} ),
		}, {
			to : {},
			there : { light : 2000 },
			want : { metric : 'light' },
		} )

		assert.equal( r.go, false )
		assert.equal( r.refusals[ 0 ].reason, REFUSAL.NO_MAP )
		assert.match( r.refusals[ 0 ].why, /only the navigation is missing/ )

	} )

	it( 'goes when a surveyor finds a path', async () => {

		const surveyor = Object.assign( new Surveyor(), {
			pathTo : async () => ( {
				found : true,
				length : 12,
			} ),
		} )

		const r = await planMove( {
			memory : { lastReading : { light : 400 } },
			chassis : tall,
			states : () => ( {} ),
		}, {
			to : {},
			there : { light : 2000 },
			want : { metric : 'light' },
		}, { surveyor } )

		assert.equal( r.go, true )

	} )

	it( 'knows nothing by default, which is the safe answer', async () => {

		const s = new Surveyor()

		assert.equal( ( await s.pose() ).known, false )
		assert.equal( ( await s.pathTo( {} ) ).found, false )
		assert.match( ( await s.pathTo( {} ) ).why, /deliberately does not reimplement it/ )

	} )

	it( 'refuses a partial path rather than improvising the rest', async () => {

		const s = ros2Surveyor( { call : async () => ( { error : 'goal in unknown space' } ) } )
		const r = await s.pathTo( { x : 1 } )

		assert.equal( r.found, false )
		assert.match( r.why, /a partial path is not a path/ )

	} )

} )
