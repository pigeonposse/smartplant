/**
 * One plant doing something for another.
 *
 * The colony's other layers only talk. This one acts, which is why nearly all of
 * it is about refusing: proximity is how disease travels, and light shone by a
 * neighbour is a dose that somebody has to account for.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import {
	acceptLight, AID, aidEffect, AidSession, bioticStatus, canOffer, CLOSED, considerRequest,
	CONTACT_AID, LoopbackBus, proximitySafe,
} from '../src/colony/index.js'

const plant = ( extra = {} ) => createPlant( {
	name : 'Helper',
	species : 'Ficus lyrata',
	sensor : {
		driver : 'mock',
		soil : 40,
		dayNight : false,
	},
	ai : { provider : 'mock' },
	...extra,
} )

describe( 'proximity', () => {

	const clean = id => ( {
		id,
		biotic : false,
		canSee : true,
	} )

	it( 'lets two clean plants near each other', () => {

		assert.equal( proximitySafe( clean( 'a' ), clean( 'b' ) ).safe, true )

	} )

	it( 'blocks in both directions, because either can be the source', () => {

		const infected = {
			id : 'sick',
			biotic : true,
			canSee : true,
		}

		// Helper is the carrier.
		assert.equal( proximitySafe( infected, clean( 'b' ) ).safe, false )
		// Asker is the carrier — the helper would pick it up.
		assert.equal( proximitySafe( clean( 'a' ), infected ).safe, false )

	} )

	it( 'treats "cannot see" as unverified rather than clear', () => {

		// A plant with no camera cannot certify itself clean, and absence of
		// evidence is not evidence — least of all here.
		const blind = {
			id : 'blind',
			biotic : null,
			canSee : false,
		}
		const r = proximitySafe( blind, clean( 'b' ) )

		assert.equal( r.safe, false )
		assert.equal( r.reason, 'unverifiable' )
		assert.match( r.why, /Absence of evidence is not evidence/ )

	} )

	it( 'names contact aid as the kind that matters', () => {

		assert.ok( CONTACT_AID.includes( AID.LIGHT ) )
		assert.ok( CONTACT_AID.includes( AID.SHELTER ) )
		// Moving away is help that requires touching nothing.
		assert.ok( !CONTACT_AID.includes( AID.MOVE_ASIDE ) )

	} )

} )

describe( 'offering', () => {

	it( 'refuses a kind of help it does not know', async () => {

		const p = await plant()
		assert.match( canOffer( p, 'sing' ).why, /Unknown kind of help/ )
		await p.destroy()

	} )

	it( 'cannot lend a lamp it does not have', async () => {

		const p = await plant()
		assert.equal( canOffer( p, AID.LIGHT ).able, false )
		await p.destroy()

	} )

	it( 'cannot go anywhere without a body', async () => {

		const p = await plant()
		const r = canOffer( p, AID.MOVE_ASIDE )

		assert.equal( r.able, false )
		assert.match( r.why, /cannot move/ )

		await p.destroy()

	} )

	it( 'will not strand itself being generous', async () => {

		const p = await plant()
		await p.embody( {} )
		await p.usePower( {
			capacityWh : 10,
			charge : 0.3,
		} )

		const r = canOffer( p, AID.SHELTER, { metres : 300 } )

		assert.equal( r.able, false )
		assert.match( r.why, /come back/ )

		await p.destroy()

	} )

	it( 'accepts a move that costs it nothing to give', async () => {

		const p = await plant()
		await p.embody( {} )

		const d = considerRequest( p, {
			kind : AID.MOVE_ASIDE,
			from : 'other',
		} )

		assert.equal( d.accept, true )
		assert.match( d.why, /does not require touching/ )

	} )

	it( 'refuses contact aid to a plant reporting a pest', async () => {

		const p = await plant()
		await p.embody( {} )
		await p.useVision( {} ).catch( () => {} )

		const d = considerRequest( p, {
			kind : AID.SHELTER,
			from : 'sick',
			biotic : true,
			canSee : true,
		} )

		assert.equal( d.accept, false )
		assert.equal( d.reason, 'biotic' )

		await p.destroy()

	} )

	it( 'offers light only on the receiver\'s terms', async () => {

		const p = await plant()
		await p.embody( {} )
		await p.useSpectral( { light : { driver : 'mock' } } )
		// The helper needs eyes of its own: it cannot certify itself clean either.
		await p.useVision( {} )

		const d = considerRequest( p, {
			kind : AID.LIGHT,
			from : 'other',
			biotic : false,
			canSee : true,
		} )

		assert.equal( d.accept, true )
		assert.equal( d.conditional, true )
		// The helper cannot decide the dose is safe for someone else.
		assert.match( d.why, /authorised and booked by the plant receiving it/ )

		await p.destroy()

	} )

} )

describe( 'borrowed light is still a dose', () => {

	async function lit() {

		const p = await createPlant( {
			name : 'Receiver',
			species : 'Ficus lyrata',
			sensor : {
				driver : 'mock',
				soil : 60,
				dayNight : false,
			},
			ai : { provider : 'mock' },
		} )
		await p.useSpectral( {
			light : { driver : 'mock' },
			safety : { darkHours : [ 25, 26 ] },
		} )
		await p.read()
		return p

	}

	it( 'refuses light it has no way to account for', async () => {

		const p = await plant()
		const r = await acceptLight( p, {
			band : 'red',
			seconds : 600,
		} )

		assert.equal( r.accepted, false )
		assert.match( r.why, /nothing to meter an incoming dose with/ )

		await p.destroy()

	} )

	it( 'books a neighbour\'s light against its own daily ledger', async () => {

		// The subtle failure this prevents: each half correctly metered, the
		// total unmetered, because the receiver's ledger never heard about it.
		const p = await lit()

		const before = p.spectral.safety.doses.red?.seconds ?? 0
		const r = await acceptLight( p, {
			from : 'neighbour',
			band : 'red',
			seconds : 3600,
			level : 0.6,
		} )

		assert.equal( r.accepted, true )
		assert.ok( ( p.spectral.safety.doses.red?.seconds ?? 0 ) > before )
		assert.match( r.why, /booked it against this plant's own daily dose/ )

		await p.destroy()

	} )

	it( 'lets the receiver refuse through its own safety layer', async () => {

		const p = await createPlant( {
			name : 'Dry',
			species : 'Ficus lyrata',
			sensor : {
				driver : 'mock',
				soil : 12,
				dayNight : false,
			},
			ai : { provider : 'mock' },
		} )
		await p.useSpectral( {
			light : { driver : 'mock' },
			safety : { darkHours : [ 25, 26 ] },
		} )
		await p.read()

		// Blue forces stomata open, and this plant is short of water. Only the
		// receiver knows that; the neighbour offering the light does not.
		const r = await acceptLight( p, {
			from : 'neighbour',
			band : 'blue',
			seconds : 600,
			level : 0.7,
		} )

		assert.equal( r.accepted, false )
		assert.match( r.why, /only one that knows what it has already had/ )

		await p.destroy()

	} )

} )

describe( 'across the colony', () => {

	it( 'asks everyone and sorts offers from refusals', async () => {

		const bus = new LoopbackBus()

		const helper = await plant( { name : 'Willow' } )
		await helper.embody( {} )
		await helper.joinColony( { transport : bus.endpoint( 'willow' ) } )

		const asker = await plant( { name : 'Ivy' } )
		await asker.joinColony( { transport : bus.endpoint( 'ivy' ) } )

		const r = await asker.colony.askForHelp( AID.MOVE_ASIDE )

		assert.equal( r.offers.length + r.refusals.length, 1 )

		await Promise.all( [ helper, asker ].map( p => p.destroy() ) )

	} )

	it( 'declares its own state honestly when asking', async () => {

		const p = await plant()
		const status = bioticStatus( p )

		// No camera, so it says so rather than claiming to be clean.
		assert.equal( status.canSee, false )
		assert.equal( status.biotic, null )
		assert.match( status.why, /nothing can be confirmed or ruled out/ )

		await p.destroy()

	} )

} )

describe( 'the live session', () => {

	const open = ( opts = {} ) => {

		const s = new AidSession( {
			kind : AID.LIGHT,
			helper : 'willow',
			receiver : 'ivy',
			band : 'red',
			effect : aidEffect( opts.kind ?? AID.LIGHT ),
			...opts,
		} )
		s.baseline( opts.ambient ?? 200 )
		return s

	}

	/** Run a stream, returning the frame that stopped it. */
	const run = ( s, { lux, stepMs = 10_000, steps = 60, target } ) => {

		let t = Date.now()

		for ( let i = 0; i < steps; i++ ) {

			t += stepMs
			s.emitting( { at : t } )
			s.measuring( {
				lux,
				at : t,
			} )

			const v = s.shouldStop( {
				target,
				now : t,
			} )
			if ( v.stop ) return v

		}

		return { stop : false }

	}

	it( 'needs an ambient reading before it can attribute anything', () => {

		const s = new AidSession( { kind : AID.LIGHT } )
		const r = s.baseline( undefined )

		assert.equal( r.ready, false )
		assert.match( r.why, /attributed to the helper/ )

	} )

	it( 'integrates only the excess over ambient, not the sunshine', () => {

		const s = open( { ambient : 500 } )
		run( s, {
			lux : 500,
			steps : 10,
		} )

		// The window was bright the whole time and the helper gave nothing.
		assert.equal( s.delivered, 0 )

	} )

	it( 'stops on what arrived, not on what was promised', () => {

		// The neighbour's lamp turns out stronger than either of them assumed.
		// A session that counted seconds would overshoot; one that measures does
		// not care whose lamp it is.
		const s = open()
		const v = run( s, {
			lux : 1600,
			target : 200_000,
		} )

		assert.equal( v.stop, true )
		assert.equal( v.because, CLOSED.SATISFIED )
		assert.ok( s.elapsedSeconds < 300 )
		assert.match( v.why, /what arrived rather than what was sent/ )

	} )

	it( 'runs longer when the lamp turns out to be weak', () => {

		const strong = open()
		run( strong, {
			lux : 1600,
			target : 200_000,
		} )

		const weak = open()
		run( weak, {
			lux : 400,
			target : 200_000,
		} )

		assert.ok( weak.elapsedSeconds > strong.elapsedSeconds )

	} )

	it( 'catches a lamp that reports emitting and delivers nothing', () => {

		// Not a bookkeeping discrepancy: the lamp is aimed elsewhere, something
		// is in the way, or it never came on.
		const s = open()
		const v = run( s, {
			lux : 200,
			stepMs : 5000,
			target : 100_000,
		} )

		assert.equal( v.because, CLOSED.MISMATCH )
		assert.match( v.why, /not reaching this plant/ )

	} )

	it( 'ends itself when the channel goes quiet', () => {

		const s = open( { staleMs : 15_000 } )
		s.emitting( {} )
		s.measuring( { lux : 900 } )

		const v = s.shouldStop( { now : Date.now() + 30_000 } )

		assert.equal( v.because, CLOSED.LOST )
		assert.match( v.why, /nobody is watching/ )

	} )

	it( 'keeps a ceiling regardless of what the sensor says', () => {

		// A sensor stuck low would otherwise ask for light forever.
		const s = open( { maxSeconds : 60 } )
		const v = run( s, {
			lux : 205,
			stepMs : 10_000,
			target : 10_000_000,
		} )

		assert.equal( v.because, CLOSED.TIMEOUT )

	} )

	it( 'records both halves of the accounting as what each actually is', () => {

		const s = open()
		run( s, {
			lux : 1600,
			target : 200_000,
		} )
		const r = s.record()

		assert.match( r.accounting.measured, /from this plant's own sensor/ )
		// The lux sensor is broadband; only the emitter knows which channel.
		assert.match( r.accounting.declared, /cannot confirm that/ )

	} )

	it( 'knows the difference between a dose and a condition held', () => {

		assert.equal( aidEffect( AID.LIGHT ).mode, 'accumulate' )
		assert.equal( aidEffect( AID.SHADE ).mode, 'sustain' )
		assert.equal( aidEffect( AID.SHADE ).direction, 'down' )
		assert.equal( aidEffect( AID.SHELTER ).metric, 'airflow' )
		assert.equal( aidEffect( AID.WARMTH ).metric, 'temperature' )

		// Every kind of help has to say what it changes, or a session cannot
		// check itself and is just two plants asserting things at each other.
		for ( const kind of Object.values( AID ) ) {

			const e = aidEffect( kind )
			assert.ok( e, `${kind} has no declared effect` )
			assert.ok( [ 'accumulate', 'sustain' ].includes( e.mode ) )
			assert.ok( [ 'up', 'down' ].includes( e.direction ) )

		}

	} )

	it( 'measures shade as a drop, not as a quantity received', () => {

		const s = open( {
			kind : AID.SHADE,
			ambient : 45_000,
		} )

		assert.equal( s.metric, 'light' )

		let t = Date.now()
		for ( let i = 0; i < 5; i++ ) {

			t += 10_000
			s.emitting( { at : t } )
			s.measuring( {
				value : 12_000,
				at : t,
			} )

		}

		assert.equal( s.holding.present, true )
		assert.equal( s.holding.change, 33_000 )
		assert.equal( s.holding.seconds, 40 )

		// There is no dose of shade to finish, so nothing here ends it.
		assert.equal( s.shouldStop( { now : t } ).stop, false )

		// It ends when the plant it is helping says the sun is no longer a problem.
		const done = s.shouldStop( {
			satisfied : true,
			now : t,
		} )
		assert.equal( done.stop, true )
		assert.equal( done.because, CLOSED.SATISFIED )
		assert.match( done.why, /no longer needs this/ )

	} )

	it( 'restarts the clock when a sustained effect lapses', () => {

		const s = open( {
			kind : AID.SHELTER,
			ambient : 3.2,
		} )

		let t = Date.now()
		const step = value => {

			t += 10_000
			s.emitting( { at : t } )
			s.measuring( {
				value,
				at : t,
			} )

		}

		step( 0.6 ); step( 0.6 ); step( 0.6 )
		assert.equal( s.holding.seconds, 20 )

		// The helper drifts, the draught comes back. Credit for holding it does
		// not survive that: what matters is whether it is sheltered *now*.
		step( 3.4 )
		assert.equal( s.holding.present, false )
		assert.equal( s.holding.seconds, 0 )

		step( 0.5 )
		assert.equal( s.holding.present, true )

	} )

	it( 'stops sustained help that is not doing anything either', () => {

		const s = open( {
			kind : AID.MOVE_ASIDE,
			ambient : 300,
		} )

		let t = Date.now()
		let verdict

		// The neighbour moves and the light does not change, which means the
		// neighbour was never what was in the way.
		for ( let i = 0; i < 6; i++ ) {

			t += 5000
			s.emitting( { at : t } )
			s.measuring( {
				value : 300,
				at : t,
			} )
			verdict = s.shouldStop( { now : t } )
			if ( verdict.stop ) break

		}

		assert.equal( verdict.stop, true )
		assert.equal( verdict.because, CLOSED.MISMATCH )

	} )

	it( 'reports a sustained session as held, never as delivered', () => {

		const s = open( {
			kind : AID.WARMTH,
			ambient : 14,
		} )

		const t = Date.now() + 10_000
		s.emitting( { at : t } )
		s.measuring( {
			value : 17.5,
			at : t,
		} )

		const record = s.close( CLOSED.SATISFIED ).accounting ?? s.record()

		assert.equal( record.metric ?? s.metric, 'temperature' )
		assert.equal( s.record().delivered, null )
		assert.ok( s.record().holding )
		assert.match( s.record().accounting.measured, /temperature/ )

	} )

	it( 'opens across a real colony channel', async () => {

		const bus = new LoopbackBus()

		const helper = await plant( { name : 'Willow' } )
		await helper.joinColony( { transport : bus.endpoint( 'willow' ) } )

		const asker = await plant( { name : 'Ivy' } )
		await asker.read()
		await asker.joinColony( { transport : bus.endpoint( 'ivy' ) } )

		const session = await asker.colony.openAidSession( 'willow', {
			kind : AID.LIGHT,
			band : 'red',
		} )

		assert.ok( session.id )
		// Both sides hold the same session, which is the whole point of a channel.
		assert.ok( helper.colony.sessions.get( session.id ) )

		const step = await asker.colony.streamAid( session.id, { target : 1 } )
		assert.ok( 'delivered' in step )

		await Promise.all( [ helper, asker ].map( p => p.destroy() ) )

	} )

} )
