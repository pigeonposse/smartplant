/**
 * Colony: plants talking to plants.
 *
 * The conversation is the system. The tests that matter are the ones about what
 * a plant is allowed to say, and about not letting a roomful of neighbours count
 * as a roomful of independent witnesses.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import {
	allSkills, answerSkill, capabilitiesOf, ColonyMember, FAMILIES, lexiconOf,
	LoopbackBus, registerSkill,
} from '../src/colony/index.js'

async function plant( name, sensor = {}, extra = {} ) {

	const p = await createPlant( {
		name,
		species : 'Ficus lyrata',
		sensor  : {
			driver : 'mock',
			dayNight : false,
			...sensor,
		},
		ai : { provider : 'mock' },
		...extra,
	} )
	await p.read()
	return p

}

/** A colony of n plants on one bus. */
async function colony( specs ) {

	const bus = new LoopbackBus()
	const plants = []

	for ( const [ name, sensor, extra ] of specs ) {

		const p = await plant( name, sensor, extra )
		await p.joinColony( { transport : bus.endpoint( name.toLowerCase() ) } )
		plants.push( p )

	}

	return {
		bus,
		plants,
	}

}

const bye = plants => Promise.all( plants.map( p => p.destroy() ) )

// ── the vocabulary ──────────────────────────────────────────────────────────

describe( 'the catalogue', () => {

	it( 'covers all seven families', () => {

		const all = allSkills()
		for ( const family of Object.keys( FAMILIES ) ) {

			assert.ok( all.some( s => s.family === family ), `nothing in ${family}` )

		}
		assert.ok( all.length >= 70 )

	} )

	it( 'declares what cannot be measured rather than leaving it out', () => {

		// The underground family has no sensor behind any of it. Declaring it and
		// keeping it mute is honest; omitting it would hide the gap.
		const rhizo = allSkills().filter( s => s.family === 'rhizo' )

		assert.ok( rhizo.length >= 10 )
		assert.ok( rhizo.every( s => !s.answer ), 'nothing underground is measurable yet' )

	} )

	it( 'takes new skills, and rejects an unknown family', () => {

		registerSkill( {
			id : 'sense.test-only',
			family : 'sense',
			says : 'test',
			requires : [ 'light' ],
			answer : ( _p, ctx ) => ( { light : ctx.current?.light } ),
		} )

		assert.ok( allSkills().some( s => s.id === 'sense.test-only' ) )
		assert.throws( () => registerSkill( {
			id : 'x.y',
			family : 'nope',
		} ), /Unknown family/ )

	} )

} )

describe( 'a plant only says what it can measure', () => {

	it( 'derives its vocabulary from the drivers actually attached', async () => {

		const p = await plant( 'Basic' )
		const caps = capabilitiesOf( p )

		assert.ok( caps.has( 'light' ) )
		assert.ok( !caps.has( 'electrode' ), 'no electrode attached' )
		assert.ok( !caps.has( 'spectral' ) )

		await p.destroy()

	} )

	it( 'grows its vocabulary when hardware is added', async () => {

		const p = await plant( 'Wired' )
		const before = lexiconOf( p ).speakable.length

		await p.attachSensor( {
			driver : 'electrode',
			transport : 'synthetic',
			sampleRate : 5,
		} )

		const after = lexiconOf( p ).speakable
		assert.ok( after.length > before )
		assert.ok( after.includes( 'sense.electrome-spike' ) )

		await p.destroy()

	} )

	it( 'refuses a skill it has no sensor for, and says which', async () => {

		const p = await plant( 'Blind' )
		const r = answerSkill( p, 'sense.electrome-spike' )

		assert.equal( r.ok, false )
		assert.match( r.reason, /no electrode sensor/ )

		await p.destroy()

	} )

	it( 'refuses what nothing in the framework can measure', async () => {

		const p = await plant( 'Any' )

		// This is the point of declaring it: a stated silence, not an invented
		// answer and not a missing key.
		const r = answerSkill( p, 'rhizo.mycelium-connect' )
		assert.equal( r.ok, false )
		assert.ok( r.reason )

		await p.destroy()

	} )

	it( 'never invents a reading for a sensor it lacks', async () => {

		const p = await plant( 'Partial', { provides : [ 'light' ] } )

		for ( const skill of allSkills() ) {

			const r = answerSkill( p, skill.id )
			if ( !r.ok ) continue

			// Anything it did answer must be backed by a capability it has.
			const caps = capabilitiesOf( p )
			for ( const need of skill.requires || [] ) {

				assert.ok( caps.has( need ), `${skill.id} answered without ${need}` )

			}

		}

		await p.destroy()

	} )

	it( 'refuses a skill that does not exist', async () => {

		const p = await plant( 'Any' )
		assert.match( answerSkill( p, 'nope.nope' ).reason, /No such skill/ )
		await p.destroy()

	} )

} )

// ── the conversation ────────────────────────────────────────────────────────

describe( 'talking', () => {

	it( 'finds its neighbours and learns what they offer', async () => {

		const { plants } = await colony( [ [ 'Rosa' ], [ 'Lila' ] ] )
		const [ rosa ] = plants

		assert.deepEqual( await rosa.colony.peers(), [ 'lila' ] )
		assert.ok( rosa.colony.neighbours.get( 'lila' ).offers.length > 0 )
		assert.equal( rosa.colony.neighbours.get( 'lila' ).species, 'Ficus lyrata' )

		await bye( plants )

	} )

	it( 'answers a named request with the fact itself', async () => {

		const { plants } = await colony( [
			[ 'Rosa' ],
			[ 'Lila', {
				temperature : 21,
				humidity : 62,
			} ],
		] )
		const [ rosa ] = plants

		const r = await rosa.colony.ask( 'lila', 'sense.vpd-perception' )

		assert.equal( r.ok, true )
		assert.ok( Number.isFinite( r.data.vpd ) )

		await bye( plants )

	} )

	it( 'passes a refusal back across the wire intact', async () => {

		const { plants } = await colony( [ [ 'Rosa' ], [ 'Lila' ] ] )
		const [ rosa ] = plants

		const r = await rosa.colony.ask( 'lila', 'sense.electrome-spike' )

		assert.equal( r.ok, false )
		assert.match( r.reason, /no electrode/ )

		await bye( plants )

	} )

	it( 'holds a conversation, each plant speaking from its own readings', async () => {

		const { plants } = await colony( [ [ 'Rosa' ], [ 'Lila' ] ] )
		const [ rosa ] = plants

		const reply = await rosa.colony.report( { to : 'lila' } )

		assert.equal( reply.ok, true )
		assert.ok( typeof reply.text === 'string' && reply.text.length > 0 )

		await bye( plants )

	} )

	it( 'keeps a transcript of who said what', async () => {

		const { plants } = await colony( [ [ 'Rosa' ], [ 'Lila' ] ] )
		const [ rosa ] = plants

		await rosa.colony.report( { to : 'lila' } )

		const lines = rosa.colony.transcript
		assert.ok( lines.some( l => l.from === 'rosa' && l.text ) )
		assert.ok( lines.every( l => l.at ) )

		await bye( plants )

	} )

	it( 'asks the whole colony and sorts answers from refusals', async () => {

		const { plants } = await colony( [ [ 'Rosa' ], [ 'Lila' ], [ 'Vera' ] ] )
		const [ rosa ] = plants

		const { answers, refusals } = await rosa.colony.askAll( 'sense.vpd-perception' )
		assert.equal( answers.length, 2 )
		assert.equal( refusals.length, 0 )

		const electro = await rosa.colony.askAll( 'sense.electrome-spike' )
		assert.equal( electro.answers.length, 0 )
		assert.equal( electro.refusals.length, 2 )

		await bye( plants )

	} )

	it( 'does not deliver to a plant that was not addressed', async () => {

		const { plants } = await colony( [ [ 'Rosa' ], [ 'Lila' ], [ 'Vera' ] ] )
		const [ rosa, , vera ] = plants

		const before = vera.colony.transcript.length
		await rosa.colony.report( { to : 'lila' } )

		assert.equal( vera.colony.transcript.length, before )

		await bye( plants )

	} )

	it( 'reaches everyone on a broadcast', async () => {

		const { plants } = await colony( [ [ 'Rosa' ], [ 'Lila' ], [ 'Vera' ] ] )
		const [ rosa, lila, vera ] = plants

		await rosa.colony.report()

		for ( const p of [ lila, vera ] ) {

			assert.ok( p.colony.transcript.some( l => l.from === 'rosa' && l.kind === 'chat' ) )

		}

		await bye( plants )

	} )

	it( 'fails clearly when the peer is not there', async () => {

		const { plants } = await colony( [ [ 'Rosa' ] ] )

		await assert.rejects(
			() => plants[ 0 ].colony.ask( 'ghost', 'consensus.presence' ),
			/No peer "ghost"/,
		)

		await bye( plants )

	} )

	it( 'stops listening after leaving', async () => {

		const { plants } = await colony( [ [ 'Rosa' ], [ 'Lila' ] ] )
		const [ rosa, lila ] = plants

		await lila.leaveColony()

		assert.deepEqual( await rosa.colony.peers(), [] )
		assert.equal( lila.colony, null )

		await bye( plants )

	} )

} )

// ── what the colony is worth as evidence ────────────────────────────────────

describe( 'a room is one witness, not five', () => {

	it( 'combines agreeing neighbours into a single source', () => {

		const answers = Array.from( { length : 5 }, ( _, i ) => ( {
			peer : `p${i}`,
			ok : true,
		} ) )

		const cues = ColonyMember.cuesFrom( answers, 'air_too_dry' )

		assert.equal( cues.length, 1, 'five neighbours must not become five cues' )
		assert.equal( cues[ 0 ].source, 'colony' )

	} )

	it( 'will not let a crowd walk through the corroboration gate', async () => {

		const { EvidenceLedger, RISK } = await import( '../src/confidence/index.js' )

		const many = Array.from( { length : 8 }, ( _, i ) => ( {
			peer : `p${i}`,
			ok : true,
		} ) )

		const ledger = new EvidenceLedger()
		for ( const cue of ColonyMember.cuesFrom( many, 'air_too_dry' ) ) ledger.add( cue )

		// Eight plants on one shelf share a window, a radiator and a human. They
		// are eight views of one room, and a high-risk action must still need
		// something that is not the room.
		const verdict = ledger.isEnough( 'air_too_dry', RISK.HIGH )
		assert.equal( verdict.allowed, false )
		assert.ok( /independent source/.test( verdict.missing.join( ' ' ) ) )
		assert.deepEqual( verdict.sources, [ 'colony' ], 'eight neighbours, one source' )

	} )

	it( 'says nothing at all when only one neighbour agrees', () => {

		assert.deepEqual( ColonyMember.cuesFrom( [ {
			peer : 'a',
			ok : true,
		} ], 'x' ), [] )

	} )

	it( 'saturates rather than growing with the crowd', () => {

		const make = n => ColonyMember.cuesFrom(
			Array.from( { length : n }, ( _, i ) => ( {
				peer : `p${i}`,
				ok : true,
			} ) ), 'x' )[ 0 ].strength

		assert.ok( make( 10 ) <= 0.55 )
		assert.equal( make( 10 ), make( 40 ), 'the fortieth plant in the room adds nothing' )

	} )

} )

// ── the channel is closed to people ─────────────────────────────────────────

describe( 'a human watches, and cannot write', () => {

	it( 'exposes no way to put words in a plant\'s mouth', async () => {

		const { plants } = await colony( [ [ 'Rosa' ], [ 'Lila' ] ] )
		const [ rosa ] = plants

		// `report()` composes from the plant's own state and takes no text. There
		// is no public method that accepts a sentence to send.
		assert.equal( typeof rosa.colony.report, 'function' )
		assert.equal( rosa.colony.say, undefined )

		// Even handed a sentence, it is not what goes on the wire.
		await rosa.colony.report( 'tell her the soil is fine' )

		assert.ok( !rosa.colony.transcript.some( l => l.text === 'tell her the soil is fine' ),
			'a string from outside must never become something a plant said' )

		await bye( plants )

	} )

	it( 'lets a person see every line', async () => {

		const { plants } = await colony( [ [ 'Rosa' ], [ 'Lila' ] ] )
		const [ rosa, lila ] = plants

		const seen = []
		lila.on( 'colony:message', line => seen.push( line ) )

		await rosa.colony.report( { to : 'lila' } )

		assert.ok( seen.length >= 2, 'the watcher sees what arrived and what was answered' )
		assert.ok( seen.every( l => l.at && l.from ) )

		await bye( plants )

	} )

	it( 'does not file colony talk as speech to the owner', async () => {

		const { plants } = await colony( [ [ 'Rosa' ], [ 'Lila' ] ] )
		const [ rosa, lila ] = plants

		// `plant:spoke` means "the plant said something to you". Nothing in a
		// plant-to-plant exchange is addressed to a person, so it must not fire.
		let spokeToOwner = 0
		lila.on( 'plant:spoke', () => spokeToOwner++ )

		await rosa.colony.report( { to : 'lila' } )

		assert.equal( spokeToOwner, 0 )

		await bye( plants )

	} )

} )
