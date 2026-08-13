/**
 * The paper-derived mechanics: intervention signatures, regime change,
 * collective state, early infection, and fresh-data gating.
 *
 * The published work on electrome classification reports high accuracy from
 * labelled data gathered under controlled stress. None of that labelling exists
 * in someone's living room, so most of what is tested here is the boundary
 * between what the literature shows and what this library can honestly claim.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import {
	collectiveShift, collectiveState, electromeFingerprint, infectionWatch,
	InterventionSignatures, regimeChange, regimeCues,
} from '../src/signals/index.js'
import { SpectralSafety } from '../src/spectral/index.js'

const DAY = 86_400_000

function wave( noise, seed, { period = 300, amplitude = 2 } = {} ) {

	let s = seed
	const r = () => {

		s = ( s * 1103515245 + 12345 ) & 0x7fffffff
		return s / 0x7fffffff - 0.5

	}

	return Array.from( { length : 600 }, ( _, i ) =>
		-60 + amplitude * Math.sin( ( 2 * Math.PI * i ) / period ) + r() * noise )

}

const fp = ( noise, seed, o ) => electromeFingerprint( wave( noise, seed, o ), 5, { mainsHz : 0 } )

// ── intervention signatures ─────────────────────────────────────────────────

describe( 'intervention signatures', () => {

	it( 'refuses a signature until it has seen enough of the same thing', () => {

		const lib = new InterventionSignatures()
		lib.record( 'water', wave( 0.5, 1 ), 5, { mainsHz : 0 } )

		const s = lib.signature( 'water' )
		assert.equal( s.known, false )
		assert.match( s.why, /before its signature means anything/ )

	} )

	it( 'refuses a window too short to characterise', () => {

		const lib = new InterventionSignatures()
		const r = lib.record( 'water', [ 1, 2, 3 ], 5 )

		assert.equal( r.recorded, false )
		assert.match( r.why, /at least 32 electrode samples/ )

	} )

	it( 'learns a consistent intervention', () => {

		const lib = new InterventionSignatures()
		for ( let i = 0; i < 5; i++ ) lib.record( 'water', wave( 0.5, i + 1 ), 5, { mainsHz : 0 } )

		const s = lib.signature( 'water' )
		assert.equal( s.known, true )
		assert.equal( s.reliable, true )
		assert.ok( s.consistency > 0.8 )

	} )

	it( 'says when an intervention has no consistent signature at all', () => {

		// Recorded five times and looking different every time is not a signature.
		// Averaging them would produce a shape none of the occurrences has.
		const lib = new InterventionSignatures()
		for ( let i = 0; i < 5; i++ ) lib.record( 'chaos', wave( i * 6 + 0.2, i + 1 ), 5, { mainsHz : 0 } )

		const s = lib.signature( 'chaos' )
		assert.equal( s.reliable, false )
		assert.match( s.why, /look very different from each other/ )

	} )

	it( 'will not match against a signature it called unreliable', () => {

		const lib = new InterventionSignatures()
		for ( let i = 0; i < 5; i++ ) lib.record( 'chaos', wave( i * 6 + 0.2, i + 1 ), 5, { mainsHz : 0 } )

		assert.equal( lib.identify( wave( 3, 9 ), 5, { mainsHz : 0 } ).match, null )

	} )

	it( 'recognises a repeat of something it has characterised', () => {

		const lib = new InterventionSignatures()
		for ( let i = 0; i < 5; i++ ) lib.record( 'water', wave( 0.5, i + 1 ), 5, { mainsHz : 0 } )

		assert.equal( lib.identify( wave( 0.5, 99 ), 5, { mainsHz : 0 } ).match, 'water' )

	} )

	it( 'declines to name something it has never seen', () => {

		const lib = new InterventionSignatures()
		for ( let i = 0; i < 5; i++ ) lib.record( 'water', wave( 0.5, i + 1 ), 5, { mainsHz : 0 } )

		const r = lib.identify( wave( 30, 9 ), 5, { mainsHz : 0 } )
		assert.equal( r.match, null )
		assert.match( r.why, /does not look like any/ )

	} )

	it( 'declines to break a tie between two equally close signatures', () => {

		const lib = new InterventionSignatures();
		// Two interventions that look the same on this plant's electrode.
		[ 'water', 'mist' ].forEach( type => {

			for ( let i = 0; i < 5; i++ ) lib.record( type, wave( 0.5, i + 1 ), 5, { mainsHz : 0 } )

		} )

		const r = lib.identify( wave( 0.5, 3 ), 5, { mainsHz : 0 } )
		assert.equal( r.match, null )
		assert.ok( r.ambiguous?.length === 2 )
		assert.match( r.why, /not distinguishable/ )

	} )

	it( 'takes its labels from the care log, with nothing asked of anyone', async () => {

		const plant = await createPlant( {
			name : 'Labelled',
			species : 'Ficus',
			sensor : {
				driver : 'electrode',
				transport : 'synthetic',
				sampleRate : 5,
				bufferSeconds : 7200,
				mainsHz : 0,
			},
			ai : { provider : 'mock' },
		} )

		const electrode = plant.getSensor( 'electrode' )

		for ( let i = 0; i < 4; i++ ) {

			electrode.advance( 600 )
			await plant.memory.addEvent( 'water', {} )
			// The care log already records what and when; that is the label.
			plant.memory.data.events.at( -1 ).t = new Date( electrode.now() ).toISOString()
			electrode.advance( 900 )

		}

		const learned = await plant.learnInterventions( {
			types : [ 'water' ],
			windowMinutes : 10,
		} )

		assert.equal( learned.learned, true )
		assert.equal( learned.recorded, 4 )

		await plant.destroy()

	} )

	it( 'says plainly when the labels have no recording behind them', async () => {

		const plant = await createPlant( {
			name : 'Elder',
			species : 'Ficus',
			sensor : {
				driver : 'electrode',
				transport : 'synthetic',
				sampleRate : 5,
				bufferSeconds : 60,
				mainsHz : 0,
			},
			ai : { provider : 'mock' },
		} )

		await plant.memory.addEvent( 'water', {} )
		plant.memory.data.events.at( -1 ).t = new Date( Date.now() - 30 * DAY ).toISOString()

		const learned = await plant.learnInterventions( { types : [ 'water' ] } )

		assert.equal( learned.learned, false )
		assert.match( learned.why, /buffer only reaches back so far/ )

		await plant.destroy()

	} )

	it( 'needs an electrode at all', async () => {

		const plant = await createPlant( {
			name : 'Bare',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		const r = await plant.learnInterventions()
		assert.equal( r.learned, false )
		assert.match( r.why, /No electrode attached/ )

		await plant.destroy()

	} )

} )

describe( 'locating a past moment in the buffer', () => {

	it( 'refuses a moment the buffer no longer covers', async () => {

		const plant = await createPlant( {
			name : 'B',
			species : 'F',
			sensor : {
				driver : 'electrode',
				transport : 'synthetic',
				sampleRate : 5,
				bufferSeconds : 300,
				mainsHz : 0,
			},
			ai : { provider : 'mock' },
		} )

		const e = plant.getSensor( 'electrode' )
		e.advance( 300 )

		assert.equal( e.windowAround( Date.now() - 30 * DAY, 60 ), null )
		// And a window running past the end of the recording is not covered either.
		assert.equal( e.windowAround( e.now(), 600 ), null )

		await plant.destroy()

	} )

	it( 'aligns to the clock the samples were produced on, not the wall clock', async () => {

		// The synthetic transport compresses time: 300 simulated seconds pass in a
		// few milliseconds of wall time. Marking samples with wall time would put
		// every past event in the wrong place.
		const plant = await createPlant( {
			name : 'B',
			species : 'F',
			sensor : {
				driver : 'electrode',
				transport : 'synthetic',
				sampleRate : 5,
				bufferSeconds : 3600,
				mainsHz : 0,
			},
			ai : { provider : 'mock' },
		} )

		const e = plant.getSensor( 'electrode' )
		const t0 = e.now()
		for ( let i = 0; i < 10; i++ ) e.advance( 30 )

		const w = e.windowAround( t0 + 100_000, 60 )
		assert.ok( w )
		assert.ok( Math.abs( w.length - 300 ) <= 5, `expected ~300 samples, got ${w.length}` )

		await plant.destroy()

	} )

} )

// ── regime change ───────────────────────────────────────────────────────────

describe( 'regime change', () => {

	const history = build => Array.from( { length : 16 }, ( _, i ) => ( {
		at : new Date( Date.now() - ( 16 - i ) * DAY ).toISOString(),
		fingerprint : build( i ),
	} ) )

	it( 'needs enough windows to look for a boundary', () => {

		const r = regimeChange( history( i => fp( 0.5, i + 1 ) ).slice( 0, 4 ) )
		assert.equal( r.known, false )

	} )

	it( 'finds no boundary in a steady record', () => {

		const r = regimeChange( history( i => fp( 0.5, i + 1 ) ) )
		assert.equal( r.changed, false )
		assert.match( r.why, /regime is unchanged/ )

	} )

	it( 'finds the point where the plant became a different system', () => {

		const r = regimeChange( history( i => fp( i < 8 ? 0.5 : 9, i + 1 ) ) )

		assert.equal( r.changed, true )
		assert.ok( r.index >= 6 && r.index <= 10, `boundary should land near 8, got ${r.index}` )
		assert.ok( r.between > r.within )

	} )

	it( 'promises no lead time it cannot deliver', () => {

		const r = regimeChange( history( i => fp( i < 8 ? 0.5 : 9, i + 1 ) ) )

		// The published lead times come from deliberately stressed plants under
		// instrumentation nobody has at home. Reporting the change is honest;
		// promising it precedes wilting by three days is not.
		assert.match( r.why, /only this plant's own history can eventually say/ )
		assert.ok( !/before|precedes .* days/i.test( r.why.replace( 'precedes, only', '' ) ) )

	} )

	it( 'produces a cue proportional to the separation', () => {

		const r = regimeChange( history( i => fp( i < 8 ? 0.5 : 9, i + 1 ) ) )
		const [ cue ] = regimeCues( r )

		assert.equal( cue.claim, 'regime_change' )
		assert.ok( cue.strength <= 0.6 )
		assert.deepEqual( regimeCues( { changed : false } ), [] )

	} )

} )

// ── collective state ────────────────────────────────────────────────────────

describe( 'collective state', () => {

	const together = [ 'a', 'b', 'c' ].map( ( id, i ) => ( {
		id,
		fingerprint : fp( 0.5, i + 1 ),
	} ) )

	it( 'needs more than one plant', () => {

		assert.equal( collectiveState( [ together[ 0 ] ] ).known, false )

	} )

	it( 'recognises a colony in one shared state', () => {

		const s = collectiveState( together )

		assert.ok( s.coherence > 0.8 )
		// The safe direction of inference, and the only one that holds: agreement
		// between independent plants points at what they share, which is the room.
		assert.match( s.verdict, /the room, not each other/ )

	} )

	it( 'names the plant that sits apart, and says it is about that plant', () => {

		const s = collectiveState( [
			...together.slice( 0, 2 ),
			{
				id : 'rara',
				fingerprint : fp( 25, 9 ),
			},
		] )

		assert.deepEqual( s.outliers, [ 'rara' ] )
		assert.match( s.verdict, /about that plant/ )

	} )

	it( 'reads a simultaneous shift as an event in the room', () => {

		const after = together.map( m => ( {
			id : m.id,
			fingerprint : fp( 9, m.id.charCodeAt( 0 ) ),
		} ) )
		const s = collectiveShift( together, after )

		assert.equal( s.shared, true )
		assert.match( s.verdict, /this is the room/ )

	} )

	it( 'does not call one plant moving an event in the room', () => {

		const after = [
			together[ 0 ],
			together[ 1 ],
			{
				id : 'c',
				fingerprint : fp( 20, 77 ),
			},
		]
		const s = collectiveShift( together, after )

		assert.equal( s.shared, false )
		assert.match( s.verdict, /not to the room/ )

	} )

	it( 'needs the same plants at both moments', () => {

		assert.equal( collectiveShift( together, [ {
			id : 'z',
			fingerprint : fp( 0.5, 1 ),
		} ] ).known, false )

	} )

} )

// ── early infection ─────────────────────────────────────────────────────────

describe( 'infection watch', () => {

	it( 'treats one modality as a reason to look, not a finding', () => {

		const r = infectionWatch( { regime : { changed : true } } )

		assert.equal( r.suspected, true )
		assert.equal( r.corroborated, false )
		assert.deepEqual( r.cues, [] )

	} )

	it( 'corroborates when two channels with no shared failure mode agree', () => {

		const r = infectionWatch( {
			regime : { changed : true },
			vision : { chlorosis : true },
		} )

		assert.equal( r.corroborated, true )
		assert.equal( r.cues.length, 1 )
		// Capped deliberately: a reason to look closely, never grounds on its own
		// for isolating or treating a living thing.
		assert.ok( r.cues[ 0 ].strength < 0.6 )
		assert.match( r.why, /not, on its own, grounds for isolating/ )

	} )

	it( 'refuses when the electrical half is a failing electrode', () => {

		const r = infectionWatch( {
			drift : {
				cause : 'electrode',
				drifting : true,
			},
			vision : { chlorosis : true },
		} )

		assert.equal( r.suspected, false )
		assert.match( r.why, /the contact rather than the plant/ )

	} )

	it( 'stays quiet when nothing is wrong', () => {

		const r = infectionWatch( {
			regime : { changed : false },
			vision : {},
		} )

		assert.equal( r.suspected, false )

	} )

} )

// ── fresh data for anything that acts ───────────────────────────────────────

describe( 'stale readings cannot authorise a treatment', () => {

	const ctx = ageMinutes => ( {
		current : {
			soil : 60,
			temperature : 22,
			humidity : 60,
			timestamp : new Date( Date.now() - ageMinutes * 60_000 ).toISOString(),
		},
		vpd : 0.9,
	} )

	const safety = () => new SpectralSafety( { darkHours : [ 25, 26 ] } )

	const treat = ( s, age ) => s.validate( {
		band : 'blue',
		mode : 'treat',
		seconds : 600,
		level : 0.5,
	}, ctx( age ) )

	it( 'allows a treatment decided on current conditions', () => {

		assert.equal( treat( safety(), 1 ).allowed, true )

	} )

	it( 'refuses one decided on hours-old numbers', () => {

		// Blue forces stomata open. The entire point of gating it on VPD and soil
		// is knowing what the plant faces *now*; a three-hour-old reading looks
		// like knowledge and is not.
		const v = treat( safety(), 180 )

		assert.equal( v.allowed, false )
		assert.match( v.reasons.join( ' ' ), /minutes old/ )

	} )

	it( 'is configurable, and still refuses past its own limit', () => {

		const strict = new SpectralSafety( {
			darkHours : [ 25, 26 ],
			maxDataAgeMinutes : 5,
		} )

		assert.equal( treat( strict, 2 ).allowed, true )
		assert.equal( treat( strict, 10 ).allowed, false )

	} )

	it( 'does not invent an age when there is no timestamp', () => {

		// A context with no time on it is handled by the missing-data rules, which
		// already refuse to act on absent readings. Guessing an age here would turn
		// one kind of unknown into a different one.
		const v = safety().validate( {
			band : 'blue',
			mode : 'treat',
			seconds : 600,
			level : 0.5,
		}, {
			current : { soil : 60 },
			vpd : 0.9,
		} )

		assert.ok( !v.reasons.join( ' ' ).includes( 'minutes old' ) )

	} )

	it( 'leaves probes alone — reading the stomata does not force them', () => {

		const v = safety().validate( {
			band : 'blue',
			mode : 'probe',
			seconds : 240,
			level : 0.4,
		}, ctx( 180 ) )

		assert.equal( v.allowed, true )

	} )

} )
