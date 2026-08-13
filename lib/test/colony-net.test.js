/**
 * A colony that spans machines.
 *
 * `LoopbackBus` never leaves the process, so it cannot prove that any of this
 * survives a real socket: framing, discovery, relaying between two nodes that
 * cannot see each other directly, and a member leaving. Those are the parts that
 * break, and none of them are exercised in-process.
 */

import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import { ColonyClient, ColonyServer } from '../src/colony/index.js'

const HOUR = 3600_000
const open = []

let seed = 3
const rnd = () => {

	seed = ( seed * 1103515245 + 12345 ) & 0x7fffffff
	return seed / 0x7fffffff - 0.5

}

async function plant( name, days = 40 ) {

	const p = await createPlant( {
		name,
		species : 'Ficus lyrata',
		sensor  : {
			driver : 'mock',
			dayNight : false,
		},
		ai      : { provider : 'mock' },
	} )

	for ( let i = 0; i < days * 4; i++ ) {

		await p.memory.addReading( {
			timestamp : Date.now() - ( days * 4 - i ) * 6 * HOUR,
			temperature : 22 + rnd() * 2,
			humidity : 55 + rnd() * 4,
			soil : 45 + rnd() * 5,
			light : 900 + rnd() * 80,
		} )

	}

	await p.read()
	open.push( p )
	return p

}

/** Give the sockets a moment to settle. */
const settle = () => new Promise( r => setTimeout( r, 120 ) )

after( async () => {

	await Promise.all( open.map( p => p.destroy().catch( () => {} ) ) )

} )

describe( 'colony over a real socket', () => {

	it( 'refuses to dial without a port', async () => {

		await assert.rejects( () => new ColonyClient( { id : 'x' } ).connect(), /needs the \{ port \}/ )

	} )

	it( 'says so when nothing is listening', async () => {

		await assert.rejects(
			() => new ColonyClient( {
				id : 'x',
				port : 1,
			} ).connect(),
			/Cannot reach the colony/,
		)

	} )

	it( 'binds loopback by default rather than the whole network', async () => {

		// A colony is a private conversation between someone's own plants. Binding
		// every interface by default would put it on the network unasked.
		const s = new ColonyServer( { id : 'solo' } )
		await s.connect()

		assert.equal( s.host, '127.0.0.1' )
		await s.disconnect()

	} )

	it( 'carries the whole colony across sockets', async () => {

		const ivy = await plant( 'Ivy', 90 )
		const hazel = await plant( 'Hazel', 80 )
		const newcomer = await plant( 'Newcomer', 1 )

		const server = new ColonyServer( { id : 'ivy' } )
		await ivy.joinColony( { transport : server } )
		await hazel.joinColony( { transport : new ColonyClient( {
			id : 'hazel',
			port : server.port,
		} ) } )
		await newcomer.joinColony( { transport : new ColonyClient( {
			id : 'newcomer',
			port : server.port,
		} ) } )
		await settle()

		// Discovery has to work in both directions. A client that only learns of a
		// peer when spoken to would make askAll, newcomers and learnFromColony
		// silently do nothing.
		assert.deepEqual( ( await ivy.colony.peers() ).sort(), [ 'hazel', 'newcomer' ] )
		assert.deepEqual( ( await hazel.colony.peers() ).sort(), [ 'ivy', 'newcomer' ] )

		assert.equal( ( await ivy.colony.ask( 'hazel', 'sense.vpd-perception' ) ).ok, true )
		assert.equal( ( await hazel.colony.ask( 'ivy', 'consensus.identity' ) ).data.name, 'Ivy' )
		// Neither client has a socket to the other; the listener relays.
		assert.equal( ( await hazel.colony.ask( 'newcomer', 'consensus.presence' ) ).ok, true )

		const all = await newcomer.colony.askAll( 'sense.vpd-perception' )
		assert.equal( all.answers.length, 2 )

		const refused = await ivy.colony.ask( 'hazel', 'rhizo.mycelium-connect' )
		assert.equal( refused.ok, false )
		assert.match( refused.reason, /cannot tell you/ )

	} )

	it( 'teaches a newcomer across the wire', async () => {

		const old = await plant( 'Elder', 90 )
		const young = await plant( 'Young', 1 )

		const server = new ColonyServer( { id : 'elder' } )
		await old.joinColony( { transport : server } )
		await young.joinColony( { transport : new ColonyClient( {
			id : 'joven',
			port : server.port,
		} ) } )
		await settle()

		assert.ok( ( await old.colony.newcomers() ).some( n => n.peer === 'joven' ) )

		const learned = await young.colony.learnFromColony()
		assert.equal( learned.learned, true )

	} )

	it( 'updates the roster when a member leaves', async () => {

		const host = await plant( 'Host' )
		const a = await plant( 'A' )
		const b = await plant( 'B' )

		const server = new ColonyServer( { id : 'host' } )
		await host.joinColony( { transport : server } )
		await a.joinColony( { transport : new ColonyClient( {
			id : 'a',
			port : server.port,
		} ) } )
		await b.joinColony( { transport : new ColonyClient( {
			id : 'b',
			port : server.port,
		} ) } )
		await settle()

		assert.equal( ( await b.colony.peers() ).length, 2 )

		// destroy() must leave the colony, or the socket stays open and every
		// neighbour keeps a plant that no longer exists on its roster.
		await a.destroy()
		await settle()

		assert.deepEqual( await b.colony.peers(), [ 'host' ] )

	} )

	it( 'survives a peer sending nonsense', async () => {

		const host = await plant( 'Host2' )
		const server = new ColonyServer( { id : 'host2' } )
		await host.joinColony( { transport : server } )

		const client = new ColonyClient( {
			id : 'noisy',
			port : server.port,
		} )
		await client.connect()
		await settle()

		// One unparseable frame must not take the link down.
		client.socket.write( 'this is not json\n' )
		await settle()

		assert.deepEqual( await host.colony.peers(), [ 'noisy' ] )
		await client.disconnect()

	} )

	it( 'drops a peer that never sends a frame boundary', async () => {

		const host = await plant( 'Host3' )
		const server = new ColonyServer( { id : 'host3' } )
		await host.joinColony( { transport : server } )

		const client = new ColonyClient( {
			id : 'flood',
			port : server.port,
		} )
		await client.connect()
		await settle()

		// Without a ceiling, a peer that never sends a newline grows the read
		// buffer until the process dies.
		client.socket.write( 'x'.repeat( 600 * 1024 ) )
		await settle()

		assert.deepEqual( await host.colony.peers(), [] )
		await client.disconnect()

	} )

} )
