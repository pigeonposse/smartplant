/**
 * Getting a message there by another route when one route stops working.
 *
 * The failover itself is the easy half. What is tested hardest here is the
 * three places where a general delivery layer would be wrong for a colony:
 * messages that have gone off, duplicates that act, and links that bill the
 * plant at the other end.
 */

import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import {
	Breaker, candidates, ColonyTransport, deliver, deliveryHealth, drainSpool,
	LINK, link, LoopbackBus, Seen, SHELF_LIFE, Spool, stillWorthIt,
} from '../src/colony/index.js'

const shut = []

after( async () => {

	for ( const f of shut ) await f()?.catch?.( () => {} )

} )

/** A transport that can be broken on demand. */
class Flaky extends ColonyTransport {

	constructor( opts = {} ) {

		super( opts )
		this.broken = opts.broken ?? false
		this.sent = []

	}

	async send( env ) {

		if ( this.broken ) throw new Error( 'link down' )
		this.sent.push( env )

	}

	async peers() {

		return []

	}

}

const envelope = ( kind, extra = {} ) => ( {
	id : `m_${Math.random().toString( 36 ).slice( 2 )}`,
	from : 'ivy',
	to : '*',
	kind,
	body : {},
	...extra,
} )

describe( 'messages go off', () => {

	it( 'knows which kinds describe a moment and which do not', () => {

		// The distinction is the whole reason a spool cannot simply be replayed.
		assert.ok( SHELF_LIFE[ 'aid-frame' ] < SHELF_LIFE.priming )
		assert.equal( SHELF_LIFE.lesson, null )
		assert.equal( SHELF_LIFE.sos, null )

	} )

	it( 'refuses to deliver a stale request as though it were current', () => {

		const old = envelope( 'chat', { at : Date.now() - 60 * 60_000 } )
		const r = stillWorthIt( old )

		assert.equal( r.fresh, false )
		assert.match( r.why, /worse than never delivering it, because the receiver would act on it/ )

	} )

	it( 'still delivers a warning hours later', () => {

		assert.equal( stillWorthIt( envelope( 'priming', { at : Date.now() - 3 * 3600_000 } ) ).fresh, true )
		assert.equal( stillWorthIt( envelope( 'lesson', { at : Date.now() - 400 * 3600_000 } ) ).fresh, true )

	} )

	it( 'delivers rather than drops when it cannot tell the age', () => {

		const r = stillWorthIt( envelope( 'chat' ) )

		assert.equal( r.fresh, true )
		assert.equal( r.ageMs, null )

	} )

	it( 'will not send one that has already gone off', async () => {

		const l = new Flaky( { id : 'a' } )
		const r = await deliver( [ link( l, { name : 'a' } ) ], envelope( 'aid-frame', {
			at : Date.now() - 10 * 60_000,
		} ) )

		assert.equal( r.ok, false )
		assert.equal( r.stale, true )
		assert.equal( l.sent.length, 0 )

	} )

} )

describe( 'when one route stops working', () => {

	it( 'goes by the other one, and says the primary did not take it', async () => {

		const primary = new Flaky( {
			id : 'p',
			broken : true,
		} )
		const backup = new Flaky( { id : 'b' } )

		const r = await deliver( [
			link( primary, {
				name : 'primary',
				priority : 1,
			} ),
			link( backup, {
				name : 'backup',
				priority : 20,
			} ),
		], envelope( 'priming' ) )

		assert.equal( r.ok, true )
		assert.deepEqual( r.delivered, [ 'backup' ] )
		assert.equal( r.failed.primary, 'link down' )
		// It arrived, and nothing here can promise it arrived by the route that
		// was meant to carry it.
		assert.equal( r.confirmedBy, null )
		assert.match( r.why, /nothing here can promise it went by the route that matters/ )

	} )

	it( 'confirms when a priority link takes it', async () => {

		const r = await deliver( [ link( new Flaky( { id : 'p' } ), {
			name : 'primary',
			priority : 1,
		} ) ], envelope( 'priming' ) )

		assert.equal( r.confirmedBy, 'primary' )

	} )

	it( 'holds what nobody accepted, rather than losing it quietly', async () => {

		const spool = new Spool()
		const r = await deliver( [ link( new Flaky( {
			id : 'p',
			broken : true,
		} ), { name : 'primary' } ) ], envelope( 'priming' ), { spool } )

		assert.equal( r.ok, false )
		assert.equal( r.spooled, true )
		assert.equal( spool.size, 1 )

	} )

	it( 'says so plainly when there is no spool at all', async () => {

		const r = await deliver( [ link( new Flaky( {
			id : 'p',
			broken : true,
		} ), { name : 'primary' } ) ], envelope( 'priming' ) )

		assert.match( r.why, /simply lost — which is worth knowing rather than hiding/ )

	} )

	it( 'delivers the backlog marked late, carrying when it was written', async () => {

		const spool = new Spool()
		const backup = new Flaky( { id : 'b' } )
		const links = [ link( backup, { name : 'backup' } ) ]

		backup.broken = true
		await deliver( links, envelope( 'priming' ), { spool } )
		assert.equal( spool.size, 1 )

		backup.broken = false
		const drained = await drainSpool( links, spool )

		assert.equal( drained.sent, 1 )
		assert.equal( spool.size, 0 )

		// Late and current are different facts, and the receiver is told which.
		assert.equal( backup.sent.at( -1 ).late, true )
		assert.equal( typeof backup.sent.at( -1 ).delayedMs, 'number' )

	} )

	it( 'drops the backlog that went off while it waited', async () => {

		const spool = new Spool()
		spool.items.set( 'old', envelope( 'chat', {
			id : 'old',
			at : Date.now() - 60 * 60_000,
		} ) )

		const backup = new Flaky( { id : 'b' } )
		const drained = await drainSpool( [ link( backup, { name : 'backup' } ) ], spool )

		assert.equal( drained.sent, 0 )
		assert.equal( backup.sent.length, 0 )
		assert.equal( spool.size, 0 )

	} )

} )

describe( 'a link that keeps failing gets rested', () => {

	it( 'opens after enough failures and closes after the wait', () => {

		const b = new Breaker( {
			threshold : 3,
			resetMs : 1000,
		} )

		assert.equal( b.stateAt( 0 ), LINK.UP )
		b.failed( 0 )
		assert.equal( b.stateAt( 0 ), LINK.DEGRADED )
		b.failed( 0 )
		b.failed( 0 )
		assert.equal( b.ready( 0 ), false )
		assert.equal( b.stateAt( 0 ), LINK.OPEN )

		// One trial run after the rest, rather than staying shut forever.
		assert.equal( b.ready( 1200 ), true )
		assert.equal( b.stateAt( 1200 ), LINK.DEGRADED )
		b.succeeded()
		assert.equal( b.stateAt( 1200 ), LINK.UP )

	} )

	it( 'is skipped while it is resting, with the reason', () => {

		const l = link( new Flaky( { id : 'p' } ), { name : 'primary' } )
		for ( let i = 0; i < 5; i++ ) l.breaker.failed( 0 )

		const { candidates : c, skipped } = candidates( [ l ], envelope( 'chat' ), { now : 0 } )

		assert.deepEqual( c, [] )
		assert.match( skipped.primary, /resting after 5 failures/ )

	} )

} )

describe( 'a message does not go round in circles', () => {

	it( 'does not go back the way it came', () => {

		const l = link( new Flaky( { id : 'a' } ), { name : 'a' } )
		const { skipped } = candidates( [ l ], envelope( 'chat', { via : 'a' } ) )

		assert.match( skipped.a, /where the message came from/ )

	} )

	it( 'does not recross a link its trail says it has crossed', () => {

		const l = link( new Flaky( { id : 'a' } ), { name : 'a' } )
		const { skipped } = candidates( [ l ], envelope( 'chat', { hops : [ 'a' ] } ) )

		assert.match( skipped.a, /already crossed/ )

	} )

	it( 'gives every copy its own trail', async () => {

		const a = new Flaky( { id : 'a' } ), b = new Flaky( { id : 'b' } )

		await deliver( [
			link( a, { name : 'a' } ),
			link( b, { name : 'b' } ),
		], envelope( 'priming' ) )

		assert.deepEqual( a.sent[ 0 ].hops, [ 'a' ] )
		assert.deepEqual( b.sent[ 0 ].hops, [ 'b' ] )

	} )

} )

describe( 'links that cost the plant at the other end', () => {

	const optical = () => link( new Flaky( { id : 'o' } ), {
		name : 'optical',
		priority : 30,
		costsReceiver : 1,
	} )

	it( 'is not used for ordinary talk', () => {

		const { candidates : c, skipped } = candidates( [ optical() ], envelope( 'chat' ) )

		assert.deepEqual( c, [] )
		// A cheaper route for the sender is a bill somebody else pays.
		assert.match( skipped.optical, /costs the receiving plant/ )

	} )

	it( 'is used when the message is worth it', () => {

		const { candidates : c } = candidates( [ optical() ], envelope( 'sos' ), { urgent : true } )

		assert.equal( c.length, 1 )

	} )

} )

describe( 'an emulated link never claims delivery', () => {

	it( 'accepts the message and reports it as held, not delivered', async () => {

		const fake = new Flaky( { id : 'e' } )
		const r = await deliver( [ link( fake, {
			name : 'stand-in',
			emulated : true,
		} ) ], envelope( 'sos' ) )

		// It took the message.
		assert.equal( fake.sent.length, 1 )
		assert.equal( fake.sent[ 0 ].emulated, true )

		// And it did not pretend that means anything arrived. The alternative
		// recreates the failure the beacon layer exists to prevent: a plant that
		// believes it called for help.
		assert.equal( r.ok, false )
		assert.match( r.failed[ 'stand-in' ], /buffered, not delivered/ )

	} )

} )

describe( 'duplicates, which here act', () => {

	it( 'drops a repeat of an id already seen', () => {

		const seen = new Seen()
		const env = envelope( 'priming' )

		assert.equal( seen.duplicate( env ), false )
		assert.equal( seen.duplicate( env ), true )

	} )

	it( 'does not choke on an envelope with no id', () => {

		assert.equal( new Seen().duplicate( {} ), false )

	} )

	it( 'a fanned-out warning primes a neighbour once, not twice', async () => {

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
			shut.push( () => p.destroy() )
			return p

		}

		const sick = await make( 'Ivy' )
		const well = await make( 'Willow' )
		await new Promise( r => setTimeout( r, 40 ) )

		// A second route onto the same bus, which is exactly what fan-out
		// produces once a colony has more than one way of reaching a peer.
		sick.colony.addLink( bus.endpoint( 'ivy-alt' ), {
			name : 'second',
			priority : 20,
		} )

		sick._lastInfectionWatch = {
			suspected : true,
			what : 'spider mites',
		}
		await sick.colony.warnNeighbours( { near : { willow : 0.25 } } )
		await new Promise( r => setTimeout( r, 60 ) )

		const primings = well.colony.transcript.filter( t => t.kind === 'priming' )
		assert.equal( primings.length, 1, 'the warning was recorded more than once' )

	} )

} )

describe( 'saying whether anything is getting through', () => {

	it( 'reports every link and what it has been doing', async () => {

		const good = link( new Flaky( { id : 'a' } ), { name : 'a' } )
		const bad = link( new Flaky( {
			id : 'b',
			broken : true,
		} ), { name : 'b' } )
		const spool = new Spool()

		await deliver( [ good, bad ], envelope( 'priming' ), { spool } )

		const h = deliveryHealth( [ good, bad ], spool )

		assert.equal( h.ok, true )
		assert.equal( h.links.find( l => l.name === 'a' ).sent, 1 )
		assert.equal( h.links.find( l => l.name === 'b' ).failed, 1 )

	} )

	it( 'says plainly when nothing this plant says is reaching anybody', () => {

		const dead = link( new Flaky( {
			id : 'x',
			broken : true,
		} ), { name : 'x' } )
		for ( let i = 0; i < 5; i++ ) dead.breaker.failed()

		const h = deliveryHealth( [ dead ], new Spool() )

		assert.equal( h.ok, false )
		assert.match( h.why, /Nothing this plant says is reaching anybody/ )

	} )

	it( 'a failed send is no longer silent', async () => {

		const p = await createPlant( {
			name : 'Mute',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		shut.push( () => p.destroy() )
		await p.read()
		await p.joinColony( { transport : new LoopbackBus().endpoint( 'mute' ) } )

		p.colony._links()
		p.colony._primary.transport.send = async () => {

			throw new Error( 'socket closed')

		}

		const r = await p.colony._send( '*', 'priming', {} )

		assert.equal( r.ok, false )
		// The whole point: six call sites used to swallow this, so a colony could
		// be completely broken and look like it was working.
		assert.equal( p.colony.undelivered.length, 1 )
		assert.equal( p.colony.undelivered[ 0 ].kind, 'priming' )

	} )

} )
