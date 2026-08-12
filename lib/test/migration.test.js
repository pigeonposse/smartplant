/**
 * Migration: what a plant may leave to another plant of its own kind.
 *
 * The tests that matter here are the refusals. Anything can copy a number from
 * one object to another; the value is in knowing which numbers must not travel.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import {
	compareConditions, contextDiversity, contextSignature, Inheritance,
	summarizeConditions, transferability,
} from '../src/migration/index.js'

/** Episodes for one action, all recorded in the same conditions. */
function oneWorld( n, {
	reward = 0.4, temperature = 22, soil = 45, humidity = 55,
} = {} ) {

	return Array.from( { length : n }, () => ( {
		at      : new Date().toISOString(),
		reward,
		context : {
			temperature,
			soil,
			humidity,
		},
	} ) )

}

/** Episodes spread across genuinely different conditions. */
function manyWorlds( n, reward = 0.4 ) {

	const spots = [
		{
			temperature : 14,
			soil : 25,
			humidity : 35,
		},
		{
			temperature : 22,
			soil : 45,
			humidity : 55,
		},
		{
			temperature : 27,
			soil : 62,
			humidity : 70,
		},
		{
			temperature : 18,
			soil : 55,
			humidity : 48,
		},
	]

	return Array.from( { length : n }, ( _, i ) => ( {
		at      : new Date().toISOString(),
		reward,
		context : spots[ i % spots.length ],
	} ) )

}

/** A plant with a believable history in a given environment. */
async function plantWithHistory( {
	name, species = 'ficus lyrata', days = 60, temperature = 22, humidity = 55,
	soil = 45, light = 900, episodes = [],
} = {} ) {

	const plant = await createPlant( {
		name,
		species,
		sensor : {
			driver : 'mock',
			dayNight : false,
		},
		ai : { provider : 'mock' },
	} )

	const now = Date.now()
	let seed = 7
	const jitter = span => {

		seed = ( seed * 1103515245 + 12345 ) & 0x7fffffff
		return ( seed / 0x7fffffff - 0.5 ) * span

	}

	for ( let i = 0; i < days * 4; i++ ) {

		await plant.memory.addReading( {
			timestamp   : now - ( days * 4 - i ) * 6 * 3600_000,
			temperature : temperature + jitter( 4 ),
			humidity    : humidity + jitter( 10 ),
			soil        : soil + jitter( 14 ),
			light       : light + jitter( 200 ),
		} )

	}

	// Stand in for what embody() would have accumulated.
	if ( episodes.length ) {

		plant.body = { personalization : { memory : { episodes } } }

	}

	return plant

}

// ── the gate ────────────────────────────────────────────────────────────────

describe( 'context diversity', () => {

	it( 'treats nearby values as the same situation', () => {

		// 43% and 47% soil is not a change of world, and counting it as one would
		// manufacture the very diversity this module exists to verify.
		assert.equal(
			contextSignature( {
				temperature : 22,
				soil : 43,
			} ),
			contextSignature( {
				temperature : 22,
				soil : 47,
			} ),
		)

	} )

	it( 'scores a single unchanging world at zero', () => {

		const d = contextDiversity( oneWorld( 200 ).map( e => e.context ) )

		assert.equal( d.distinct, 1 )
		assert.equal( d.score, 0 )

	} )

	it( 'notices when the spread is nominal', () => {

		// 95 trials in one spot, 5 scattered elsewhere. Distinct counts look fine;
		// the distribution says it is a single-context policy in disguise.
		const contexts = [
			...oneWorld( 95 ).map( e => e.context ),
			...manyWorlds( 5 ).map( e => e.context ),
		]
		const d = contextDiversity( contexts )

		assert.ok( d.distinct > 1 )
		assert.ok( d.dominant > 0.9, `dominant share should expose this, got ${d.dominant}` )

	} )

	it( 'rewards balanced coverage', () => {

		const d = contextDiversity( manyWorlds( 40 ).map( e => e.context ) )

		assert.ok( d.distinct >= 3 )
		assert.ok( d.score > 0.9 )

	} )

} )

describe( 'transferability — the correction that matters', () => {

	it( 'blocks a heavily-evidenced single-context policy', () => {

		// Five hundred outcomes. Enormous evidential weight. Zero transferable
		// content: it is a description of one windowsill.
		const t = transferability( { episodes : oneWorld( 500 ) } )

		assert.equal( t.score, 0 )
		assert.equal( t.band, 'blocked' )
		assert.match( t.why, /single set of conditions|describes that spot/ )

	} )

	it( 'passes a lightly-evidenced policy that survived changing conditions', () => {

		const t = transferability( { episodes : manyWorlds( 30 ) } )

		assert.ok( t.score > 0 )
		assert.ok( t.diversity.distinct >= 3 )

	} )

	it( 'ranks the diverse policy above the heavily-evidenced one', () => {

		// The whole inversion, in one assertion.
		const narrow = transferability( { episodes : oneWorld( 500 ) } )
		const broad  = transferability( { episodes : manyWorlds( 30 ) } )

		assert.ok( broad.score > narrow.score,
			'30 outcomes across four worlds must beat 500 in one' )

	} )

	it( 'refuses anything with too few outcomes, however varied', () => {

		const t = transferability( { episodes : manyWorlds( 4 ) } )

		assert.equal( t.score, 0 )
		assert.match( t.why, /only 4 outcomes/ )

	} )

	it( 'blocks a nominal spread', () => {

		const t = transferability( {
			episodes : [ ...oneWorld( 95 ), ...manyWorlds( 5 ) ],
		} )

		assert.equal( t.score, 0 )
		assert.ok( t.blockers.some( b => /one situation/.test( b ) ) )

	} )

	it( 'decays with age', () => {

		const old = manyWorlds( 30 ).map( e => ( {
			...e,
			at : new Date( Date.now() - 400 * 86_400_000 ).toISOString(),
		} ) )

		assert.ok( transferability( { episodes : old } ).score
			< transferability( { episodes : manyWorlds( 30 ) } ).score )

	} )

} )

// ── conditions ──────────────────────────────────────────────────────────────

describe( 'environment comparison', () => {

	it( 'summarises with percentiles, not extremes', () => {

		const readings = Array.from( { length : 100 }, ( _, i ) => ( {
			temperature : i === 0 ? -50 : 22,
			humidity : 55,
			soil : 45,
			light : 900,
		} ) )

		const c = summarizeConditions( readings )
		// One absurd reading must not define the band.
		assert.ok( c.temperature.p10 > 0 )

	} )

	it( 'returns null rather than guessing from too little data', () => {

		assert.equal( summarizeConditions( [ { temperature : 20 } ] ), null )

	} )

	it( 'scores two similar rooms as compatible', () => {

		const a = summarizeConditions( Array.from( { length : 50 }, () => ( {
			temperature : 22,
			humidity : 55,
			soil : 45,
			light : 900,
		} ) ) )

		assert.equal( compareConditions( a, a ).compatible, true )

	} )

	it( 'names the mismatch between a bright windowsill and a shaded corner', () => {

		const bright = summarizeConditions( Array.from( { length : 50 }, ( _, i ) => ( {
			temperature : 24,
			humidity : 45,
			soil : 40,
			light : 4000 + i,
		} ) ) )
		const shade = summarizeConditions( Array.from( { length : 50 }, ( _, i ) => ( {
			temperature : 19,
			humidity : 65,
			soil : 60,
			light : 250 + i,
		} ) ) )

		const c = compareConditions( bright, shade )

		assert.equal( c.compatible, false )
		assert.ok( c.mismatches.length > 0 )
		assert.match( c.verdict, /differ where it matters/ )

	} )

	it( 'calls an unverifiable comparison unverified, not compatible', () => {

		const c = compareConditions( {}, {} )

		assert.equal( c.compatible, false )
		assert.match( c.verdict, /nothing can be checked|unverified/ )

	} )

} )

// ── export ──────────────────────────────────────────────────────────────────

describe( 'export', () => {

	it( 'refuses without a species', async () => {

		const plant = await createPlant( {
			name : 'Anon',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		await assert.rejects( () => plant.exportInheritance(), /without a species/ )
		await plant.destroy()

	} )

	it( 'carries priors, conditions and the withheld list', async () => {

		const plant = await plantWithHistory( {
			name : 'Vieja',
			episodes : [
				...manyWorlds( 30 ).map( e => ( {
					...e,
					action : 'move_to_light',
				} ) ),
				...oneWorld( 400 ).map( e => ( {
					...e,
					action : 'water_early',
				} ) ),
			],
		} )

		const bundle = await plant.exportInheritance()

		assert.equal( bundle.manifest.species, 'ficus lyrata' )
		assert.ok( bundle.conditions.temperature )
		assert.ok( bundle.ranges.temperature )

		const shipped = bundle.policies.map( p => p.action )
		const held    = bundle.withheld.map( p => p.action )

		assert.deepEqual( shipped, [ 'move_to_light' ] )
		assert.deepEqual( held, [ 'water_early' ],
			'400 single-context outcomes must not travel' )

		await plant.destroy()

	} )

	it( 'leaves the plant behind: no identity, no raw readings', async () => {

		const plant = await plantWithHistory( { name : 'Rosa' } )
		await plant.note( 'the human watered me on Tuesday' )

		const json = JSON.stringify( await plant.exportInheritance() )

		assert.ok( !json.includes( 'Rosa' ), 'the name must not travel' )
		assert.ok( !json.includes( 'Tuesday' ), 'episodic notes must not travel' )
		assert.ok( !/"readings":\s*\[/.test( json ), 'raw readings must not travel' )

		await plant.destroy()

	} )

} )

// ── import ──────────────────────────────────────────────────────────────────

describe( 'import', () => {

	it( 'refuses a different species', async () => {

		const source = await plantWithHistory( {
			name : 'A',
			species : 'ficus lyrata',
		} )
		const target = await plantWithHistory( {
			name : 'B',
			species : 'monstera deliciosa',
		} )

		const bundle = await source.exportInheritance()

		await assert.rejects( () => target.inherit( bundle ), /Species mismatch/ )

		await source.destroy()
		await target.destroy()

	} )

	it( 'refuses a bundle from a future schema', async () => {

		const target = await plantWithHistory( { name : 'B' } )

		await assert.rejects(
			() => target.inherit( {
				manifest : {
					schemaVersion : 99,
					species : 'ficus lyrata',
				},
			} ),
			/cannot be read by this version/,
		)

		await target.destroy()

	} )

	it( 'moves comfort ranges part of the way, never all of it', async () => {

		const source = await plantWithHistory( {
			name : 'A',
			temperature : 26,
		} )
		const target = await plantWithHistory( {
			name : 'B',
			temperature : 26,
		} )

		const before = { ...target.ranges.temperature }
		const bundle = await source.exportInheritance()
		await target.inherit( bundle )

		const after = target.ranges.temperature
		assert.notDeepEqual( after, before, 'the inheritance should move something' )
		assert.notDeepEqual( after, {
			min : bundle.ranges.temperature.min,
			max : bundle.ranges.temperature.max,
		}, 'but must not adopt the source wholesale' )

		await source.destroy()
		await target.destroy()

	} )

	it( 'holds back a policy whose subject is where the two spots differ', async () => {

		// The inherited pathology case: a plant that learned a soil policy in a
		// pot that drained badly, arriving at a pot that does not.
		const dry = await plantWithHistory( {
			name : 'Dry',
			soil : 20,
			episodes : manyWorlds( 30 ).map( e => ( {
				...e,
				action : 'soil_early_water',
			} ) ),
		} )
		const wet = await plantWithHistory( {
			name : 'Wet',
			soil : 70,
		} )

		const bundle = await dry.exportInheritance()
		assert.deepEqual( bundle.policies.map( p => p.action ), [ 'soil_early_water' ] )

		const { inheritance, compatibility } = await wet.inherit( bundle )

		assert.ok( compatibility.mismatches.some( m => m.metric === 'soil' ) )
		assert.equal( inheritance.priors.has( 'soil_early_water' ), false )
		assert.match( inheritance.held[ 0 ].reason, /fix for a problem this plant may not have/ )

		await dry.destroy()
		await wet.destroy()

	} )

} )

// ── living with an inheritance ──────────────────────────────────────────────

describe( 'the new body wins', () => {

	const bundle = {
		manifest : {
			schemaVersion : 1,
			species : 'ficus lyrata',
			sourceHash : 'abc',
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

	const fresh = () => new Inheritance( bundle, {
		compatibility : {
			mean : 1,
			mismatches : [],
		},
	} )

	it( 'starts advisory, not commanding', () => {

		const inh = fresh()
		const p = inh.prior( 'move_to_light' )

		assert.equal( p.advisory, true )
		assert.match( p.why, /Advisory only/ )

	} )

	it( 'leaves the shadow period once the plant has its own outcomes', () => {

		const inh = fresh()
		for ( let i = 0; i < 5; i++ ) inh.recordLocal( 'move_to_light', 0.1 )

		assert.equal( inh.prior( 'move_to_light' ).advisory, false )

	} )

	it( 'dilutes monotonically as local evidence accumulates', () => {

		const inh = fresh()
		let last = inh.prior( 'move_to_light' ).weight

		for ( let i = 0; i < 40; i++ ) {

			inh.recordLocal( 'move_to_light', 0.1 )
			const now = inh.prior( 'move_to_light' ).weight
			assert.ok( now <= last, 'inherited weight must never grow' )
			last = now

		}

		// 10 inherited pseudo-trials against 40 real ones leaves the inheritance
		// at a fifth of its weight. It fades on a schedule, it does not vanish.
		assert.ok( last < 0.15, `should have faded, still ${last}` )

	} )

	it( 'lets contradicting local measurements win in the end', () => {

		const inh = fresh()

		// Inherited says this action is excellent (0.8). This plant keeps finding
		// it useless (0.0). The blend must end up near what this body measured.
		assert.ok( inh.blend( 'move_to_light', 0 ).expected > 0.3, 'starts near the inheritance' )

		for ( let i = 0; i < 60; i++ ) inh.recordLocal( 'move_to_light', 0 )

		assert.ok( inh.blend( 'move_to_light', 0 ).expected < 0.1,
			'this pot, in this room, is the only evidence that is actually about it' )

	} )

	it( 'says plainly when it has nothing to offer', () => {

		const b = fresh().blend( 'fertilize', 0.5 )

		assert.equal( b.fromInheritance, false )
		assert.match( b.why, /on its own record/ )

	} )

	it( 'reports what it inherited and what it refused', () => {

		const inh = fresh()
		const r = inh.report()

		assert.equal( r.admitted, 1 )
		assert.equal( r.species, 'ficus lyrata' )
		assert.deepEqual( r.shadow, [ 'move_to_light' ] )

	} )

	it( 'admits unverified priors at reduced weight when nothing can be checked', () => {

		const unchecked = new Inheritance( bundle, { compatibility : null } )
		const checked   = fresh()

		assert.ok( unchecked.prior( 'move_to_light' ).weight
			< checked.prior( 'move_to_light' ).weight )

	} )

} )
