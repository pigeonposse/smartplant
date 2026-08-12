import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from 'smartplant'
import { LoopbackBus } from 'smartplant/colony'

import plugin from './index.js'

async function join( bus, name, sensor = {}, { electrode = false } = {} ) {

	const plant = await createPlant( {
		name,
		species : 'Ficus lyrata',
		sensor  : {
			driver : 'mock',
			dayNight : false,
			...sensor,
		},
		ai      : { provider : 'mock' },
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
	await plant.use( plugin, { transport : bus.endpoint( name.toLowerCase() ) } )
	return plant

}

const bye = plants => Promise.all( plants.map( p => p.destroy() ) )

describe( '@smartplant/colony', () => {

	it( 'refuses to install without a transport', async () => {

		const plant = await createPlant( {
			name : 'Alone',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		await assert.rejects( () => plant.use( plugin ), /needs a transport/ )

		await plant.destroy()

	} )

	it( 'joins, finds its neighbours and reports the roll', async () => {

		const bus = new LoopbackBus()
		const rosa = await join( bus, 'Rosa' )
		const lila = await join( bus, 'Lila' )

		const roll = await rosa.plugin( 'colony' ).roll()

		assert.deepEqual( roll.peers, [ 'lila' ] )
		assert.ok( roll.speak > 0 )
		assert.ok( roll.blindSpots > 0, 'a plant should know what it cannot answer' )

		await bye( [ rosa, lila ] )

	} )

	it( 'answers a named request with the fact', async () => {

		const bus = new LoopbackBus()
		const rosa = await join( bus, 'Rosa' )
		const lila = await join( bus, 'Lila', { temperature : 21, humidity : 62 } )

		const r = await rosa.plugin( 'colony' ).askPeer( 'lila', 'sense.vpd-perception' )

		assert.equal( r.ok, true )
		assert.ok( Number.isFinite( r.data.vpd ) )

		await bye( [ rosa, lila ] )

	} )

	it( 'refuses what it has no sensor for, and says which', async () => {

		const bus = new LoopbackBus()
		const rosa = await join( bus, 'Rosa' )
		const lila = await join( bus, 'Lila' )

		const r = await rosa.plugin( 'colony' ).askPeer( 'lila', 'sense.electrome-spike' )

		assert.equal( r.ok, false )
		assert.match( r.reason, /no electrode/ )

		await bye( [ rosa, lila ] )

	} )

	it( 'speaks more once there is more hardware to speak from', async () => {

		const bus = new LoopbackBus()
		const plain = await join( bus, 'Plain' )
		const wired = await join( bus, 'Wired', {}, { electrode : true } )

		const a = plain.plugin( 'colony' ).lexicon()
		const b = wired.plugin( 'colony' ).lexicon()

		assert.ok( b.speakable.length > a.speakable.length )
		assert.ok( b.speakable.includes( 'sense.electrome-spike' ) )
		assert.ok( !a.speakable.includes( 'sense.electrome-spike' ) )

		await bye( [ plain, wired ] )

	} )

	it( 'holds a conversation and keeps the transcript', async () => {

		const bus = new LoopbackBus()
		const rosa = await join( bus, 'Rosa' )
		const lila = await join( bus, 'Lila' )

		const reply = await rosa.plugin( 'colony' ).report( { to : 'lila' } )

		assert.equal( reply.ok, true )
		assert.ok( reply.text.length > 0 )
		assert.ok( rosa.plugin( 'colony' ).transcript().some( l => l.from === 'rosa' ) )

		await bye( [ rosa, lila ] )

	} )

	it( 'is a channel a person can watch but not enter', async () => {

		const bus = new LoopbackBus()
		const rosa = await join( bus, 'Rosa' )
		const lila = await join( bus, 'Lila' )

		const colony = rosa.plugin( 'colony' )

		// No method takes a sentence to send, and no persona is declared: the
		// personas exist for addressing an owner, and no owner is in here.
		assert.equal( colony.say, undefined )
		assert.equal( colony.persona, undefined )

		const seen = []
		rosa.on( 'colony:message', line => seen.push( line ) )
		await colony.report( { to : 'lila' } )
		assert.ok( seen.length > 0, 'watching works' )

		// And the window is read-only.
		const copy = colony.transcript()
		copy[ 0 ].text = 'tampered'
		assert.notEqual( colony.transcript()[ 0 ].text, 'tampered' )

		await bye( [ rosa, lila ] )

	} )

	it( 'counts a roomful of neighbours as one source, not many', async () => {

		const bus = new LoopbackBus()
		const rosa = await join( bus, 'Rosa' )
		const others = []
		for ( const n of [ 'Lila', 'Vera', 'Nina', 'Ada' ] ) others.push( await join( bus, n ) )

		const { answers, cues } = await rosa.plugin( 'colony' ).corroborate( 'sense.vpd-perception', 'air_too_dry' )

		assert.equal( answers.length, 4 )
		assert.equal( cues.length, 1, 'four neighbours, one cue' )
		assert.equal( cues[ 0 ].source, 'colony' )
		assert.match( cues[ 0 ].detail, /share a room/ )

		await bye( [ rosa, ...others ] )

	} )

	it( 'each plant gets its own colony membership', async () => {

		// The plugin definition is shared between installs; the membership must
		// not be, or two plants in one process would answer as each other.
		const bus = new LoopbackBus()
		const rosa = await join( bus, 'Rosa' )
		const lila = await join( bus, 'Lila' )

		assert.notEqual( rosa.plugin( 'colony' ), lila.plugin( 'colony' ) )
		assert.deepEqual( await rosa.plugin( 'colony' ).peers(), [ 'lila' ] )
		assert.deepEqual( await lila.plugin( 'colony' ).peers(), [ 'rosa' ] )

		const identity = await rosa.plugin( 'colony' ).askPeer( 'lila', 'consensus.identity' )
		assert.equal( identity.data.name, 'Lila' )

		await bye( [ rosa, lila ] )

	} )

	it( 'leaves the colony when the plant is destroyed', async () => {

		const bus = new LoopbackBus()
		const rosa = await join( bus, 'Rosa' )
		const lila = await join( bus, 'Lila' )

		await lila.destroy()

		assert.deepEqual( await rosa.plugin( 'colony' ).peers(), [] )

		await rosa.destroy()

	} )

} )
