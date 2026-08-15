/**
 * Making the internal processes hold together.
 *
 * Persistence of what the system worked out about itself, the year the plant is
 * actually living in, going back over the record without touching anything, one
 * place that knows who claimed what, and a profiler that exists to say the
 * optimisation is not needed.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import {
	HEMISPHERE, SEASON, seasonalRanges, seasonalWeight, seasonFromHistory, seasonNow,
} from '../src/archetypes/season.js'
import { consolidate, counterfactual, restingNow } from '../src/states/consolidation.js'
import { Profile, SLOW_MS } from '../src/states/profile.js'
import { Provenance, SUBJECT } from '../src/states/provenance.js'

const dirs = []

after( async () => {

	for ( const d of dirs ) await rm( d, { recursive : true, force : true } ).catch( () => {} )

} )

const store = async () => {

	const d = await mkdtemp( join( tmpdir(), 'sp-' ) )
	dirs.push( d )
	return join( d, 'plant.json' )

}

describe( 'what the system worked out about itself survives a restart', () => {

	it( 'carries the calibration record and the trajectory across processes', async () => {

		const path = await store()

		const first = await createPlant( {
			name : 'Persistent',
			species : 'Ficus',
			sensor : {
				driver : 'mock',
				dayNight : false,
			},
			ai : { provider : 'mock' },
			memory : { path },
		} )

		for ( let i = 0; i < 12; i++ ) {

			await first.memory.addReading( {
				timestamp : Date.now() - ( 12 - i ) * 3600_000,
				temperature : 22,
				humidity : 55,
				soil : 45,
				light : 900,
			} )

		}
		await first.read()

		first.perception.electro = { events : [ { label : 'variation_potential' } ] }
		first.perception.vision = { findings : { chewing : true } }
		first._lastRegime = {
			changed : true,
			baselineReady : true,
		}

		const forced = first.mayI( 'probe', { force : true } )
		first.settleTrial( forced.trial )
		first.trajectory( { force : true } )

		assert.equal( first.calibration.trials.get( 'defense_activation' ).length, 1 )
		await first.destroy()

		// A different process would see exactly this: the same file, nothing else.
		const second = await createPlant( {
			name : 'Persistent',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
			memory : { path },
		} )

		// Twelve overrides is months of somebody disagreeing with the system, and
		// it used to end with the process.
		assert.equal( second.calibration.trials.get( 'defense_activation' ).length, 1 )
		assert.equal( second._trajectory.entries.length, 1 )
		assert.match( second._rehydrated.why, /could have been recomputed from the readings/ )

		await second.destroy()

	} )

	it( 'says plainly when there was nothing to resume', async () => {

		const plant = await createPlant( {
			name : 'Fresh',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
			memory : { path : await store() },
		} )

		// A plant resuming from nothing and one that never had anything should
		// not look the same.
		assert.deepEqual( plant._rehydrated.restored, [] )
		assert.match( plant._rehydrated.why, /never been saved/ )

		await plant.destroy()

	} )

	it( 'reads a file written before any of this existed', async () => {

		const path = await store()

		const old = await createPlant( {
			name : 'Legacy',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
			memory : { path },
		} )
		await old.read()
		delete old.memory.data.symbiont
		await old.memory.save()
		await old.destroy()

		const now = await createPlant( {
			name : 'Legacy',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
			memory : { path },
		} )

		assert.deepEqual( now._rehydrated.restored, [] )
		assert.ok( now.memory.data.symbiont )

		await now.destroy()

	} )

} )

describe( 'the year the plant is actually living in', () => {

	it( 'runs the year the other way south of the equator', () => {

		assert.equal( seasonNow( {
			hemisphere : HEMISPHERE.NORTH,
			month : 0,
		} ).season, SEASON.WINTER )

		// The error this exists to prevent: telling somebody in Santiago to cut
		// back watering in their spring.
		assert.equal( seasonNow( {
			hemisphere : HEMISPHERE.SOUTH,
			month : 0,
		} ).season, SEASON.SUMMER )

	} )

	it( 'refuses to guess the hemisphere', () => {

		const r = seasonNow( {} )

		assert.equal( r.known, false )
		assert.match( r.why, /half the guesses would be exactly six months wrong/ )

	} )

	it( 'has no thermal season to offer near the equator', () => {

		const r = seasonNow( { hemisphere : HEMISPHERE.TROPICAL } )

		assert.equal( r.season, null )
		assert.equal( r.known, true )
		assert.match( r.why, /a wet season and a dry one/ )

	} )

	it( 'moves light most and temperature least, because this is indoors', () => {

		const ranges = {
			temperature : {
				min : 15,
				max : 30,
			},
			light : {
				min : 1000,
				max : 20_000,
			},
		}

		const winter = seasonalRanges( ranges, {
			hemisphere : HEMISPHERE.NORTH,
			month : 0,
			days : 0,
		} )

		const lightShift = 1 - winter.ranges.light.max / ranges.light.max
		const tempShift = 1 - winter.ranges.temperature.max / ranges.temperature.max

		// A grower's outdoor calendar has these the other way round, and applying
		// one indoors waters a plant on a garden's schedule.
		assert.ok( lightShift > tempShift * 5 )

	} )

	it( 'fades as the plant accumulates its own record', () => {

		assert.equal( seasonalWeight( 0 ).weight, 1 )
		assert.ok( seasonalWeight( 365 ).weight < 0.6 )
		assert.equal( seasonalWeight( 900 ).weight, 0 )
		assert.match( seasonalWeight( 900 ).why, /knows its own flat/ )

	} )

	it( 'stops adjusting entirely once the plant has seen every season twice', () => {

		const ranges = { light : {
			min : 1000,
			max : 20_000,
		} }

		const r = seasonalRanges( ranges, {
			hemisphere : HEMISPHERE.NORTH,
			month : 0,
			days : 1100,
		} )

		assert.equal( r.applied, false )
		assert.deepEqual( r.ranges, ranges )

	} )

	it( 'prefers what this plant did last January to any table', () => {

		const now = new Date()
		const rows = Array.from( { length : 40 }, ( _, i ) => ( {
			t : new Date( now.getFullYear() - 1, now.getMonth(), 1 + ( i % 28 ) ).toISOString(),
			soil : 30 + ( i % 10 ),
		} ) )

		const r = seasonFromHistory( rows, { metric : 'soil' } )

		assert.equal( r.known, true )
		assert.match( r.why, /beats any archetype average/ )

	} )

	it( 'has nothing to say about a season the plant has not lived through', () => {

		const r = seasonFromHistory( [], { metric : 'soil' } )

		assert.equal( r.known, false )
		assert.match( r.why, /has nothing of its own to say about winter/ )

	} )

} )

describe( 'going back over the record, without touching anything', () => {

	const ledger = arms => ( { history : new Map( [ [ 'plant:thirsty', arms ] ] ) } )

	it( 'never emits anything', async () => {

		const plant = await createPlant( {
			name : 'Quiet',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		await plant.read()

		const r = await plant.consolidate( { force : true } )

		assert.equal( r.emitted, false )
		await plant.destroy()

	} )

	it( 'refuses to invent the other arm of a counterfactual', () => {

		const only = counterfactual( ledger( Array.from( { length : 8 }, () => ( {
			action : 'water',
			resolved : true,
		} ) ) ), 'plant:thirsty' )

		assert.equal( only.known, false )
		// There is no simulator of a plant here, and building one would be
		// inventing the physiology.
		assert.match( only.why, /it is not a gap to be filled by imagining the other arm/ )

	} )

	it( 'compares real occasions when there are two ways it went', () => {

		const arms = [
			...Array.from( { length : 6 }, () => ( {
				action : 'water',
				resolved : true,
			} ) ),
			...Array.from( { length : 5 }, () => ( {
				action : 'nothing',
				resolved : false,
			} ) ),
		]

		const r = counterfactual( ledger( arms ), 'plant:thirsty' )

		assert.equal( r.known, true )
		assert.equal( r.best, 'water' )
		assert.match( r.why, /not a simulation/ )

	} )

	it( 'calls two approaches that worked equally a finding', () => {

		const arms = [
			...Array.from( { length : 6 }, () => ( {
				action : 'water',
				resolved : true,
			} ) ),
			...Array.from( { length : 6 }, () => ( {
				action : 'move',
				resolved : true,
			} ) ),
		]

		assert.match( counterfactual( ledger( arms ), 'plant:thirsty' ).why,
			/any preference between them is a preference rather than a result/ )

	} )

	it( 'will not act on what it worked out from its own record', async () => {

		const plant = await createPlant( {
			name : 'Circular',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		await plant.read()

		plant._resolutions = ledger( [
			...Array.from( { length : 6 }, () => ( {
				action : 'water',
				resolved : true,
			} ) ),
			...Array.from( { length : 6 }, () => ( {
				action : 'nothing',
				resolved : false,
			} ) ),
		] )

		const r = await plant.consolidate( { force : true } )

		assert.equal( r.ran, true )
		assert.ok( r.proposals.length > 0 )
		// A night of rereading its own record is not new information.
		assert.equal( r.proposals[ 0 ].actionable, false )
		assert.match( r.proposals[ 0 ].why, /a preference formed from its own conclusions/ )

		await plant.destroy()

	} )

	it( 'leaves a busy plant alone', async () => {

		const plant = await createPlant( {
			name : 'Busy',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		await plant.read()
		plant.states = () => ( { stress_load : {
			level : 'high',
			acts : true,
		} } )

		const r = restingNow( plant )
		assert.equal( r.ready, false )
		assert.match( r.why, /power the plant might need/ )

		await plant.destroy()

	} )

} )

describe( 'one place that knows who claimed what', () => {

	it( 'answers what the case for something currently is', () => {

		const p = new Provenance()

		p.add( {
			subject : 'defense_activation',
			source : 'states',
			says : 'high',
			because : [ 'variation-potential', 'visible-damage' ],
		} )

		const c = p.caseFor( 'defense_activation' )
		assert.equal( c.claims.length, 1 )
		assert.match( c.why, /variation-potential/ )

	} )

	it( 'distinguishes nothing recorded from nothing true', () => {

		assert.match( new Provenance().caseFor( 'anything' ).why,
			/different from nothing being true about it/ )

	} )

	it( 'finds two layers disagreeing, which neither can see alone', () => {

		const p = new Provenance()

		p.add( {
			subject : 'electrode',
			kind : SUBJECT.INSTRUMENT,
			source : 'continuity',
			says : 'physiology',
		} )
		p.add( {
			subject : 'electrode',
			kind : SUBJECT.INSTRUMENT,
			source : 'maintenance',
			says : 'degraded',
		} )

		const found = p.contradictions()
		assert.equal( found.length, 1 )
		assert.match( found[ 0 ].why, /right within its own view/ )

	} )

	it( 'does not count a layer changing its mind as disagreeing with itself', () => {

		const p = new Provenance()

		p.add( {
			subject : 'x',
			source : 'states',
			says : 'low',
		} )
		p.add( {
			subject : 'x',
			source : 'states',
			says : 'high',
		} )

		assert.deepEqual( p.contradictions(), [] )

	} )

	it( 'stays bounded on a machine that runs for months', () => {

		const p = new Provenance( { max : 100 } )

		for ( let i = 0; i < 400; i++ ) {

			p.add( {
				subject : `s${i % 7}`,
				source : 'states',
				says : i,
			} )

		}

		assert.ok( p.size <= 100 )
		// And the index still points at the right things after trimming.
		assert.ok( p.about( 's3' ).every( c => c.subject === 's3' ) )

	} )

	it( 'fills in as a plant is read', async () => {

		const plant = await createPlant( {
			name : 'Tracked',
			species : 'Ficus',
			sensor : {
				driver : 'mock',
				dayNight : false,
			},
			ai : { provider : 'mock' },
		} )

		for ( let i = 0; i < 30; i++ ) {

			await plant.memory.addReading( {
				timestamp : Date.now() - ( 30 - i ) * 3600_000,
				temperature : 22,
				humidity : 55,
				soil : 45,
				light : 900,
			} )

		}
		await plant.read()
		await plant._ingestLongitudinal()

		assert.ok( plant.provenance.size > 0 )
		assert.ok( plant.provenance.about( 'stress_load' ).length > 0 )

		await plant.destroy()

	} )

} )

describe( 'the profiler, which exists to say no', () => {

	it( 'is off unless asked for', () => {

		const r = new Profile().report()

		assert.equal( r.enabled, false )
		assert.match( r.why, /the same mistake as optimising a path nobody measured/ )

	} )

	it( 'costs nothing while off', async () => {

		const p = new Profile()
		assert.equal( await p.time( 'x', async () => 42 ), 42 )
		assert.equal( p.paths.size, 0 )

	} )

	it( 'reports what things cost, worst first', async () => {

		const p = new Profile( { enabled : true } )

		await p.time( 'slow', () => new Promise( r => setTimeout( r, 5 ) ) )
		await p.time( 'fast', async () => 1 )

		const r = p.report()
		assert.equal( r.paths[ 0 ].name, 'slow' )
		assert.ok( r.paths[ 0 ].meanMs > r.paths[ 1 ].meanMs )

	} )

	it( 'says the expected answer is that nothing is slow', async () => {

		const p = new Profile( { enabled : true } )
		await p.time( 'states', async () => 1 )

		const r = p.report()
		assert.deepEqual( r.slow, [] )
		assert.match( r.why, new RegExp( `${SLOW_MS}ms worth-investigating line` ) )

	} )

	it( 'still times the work when something goes wrong in it', async () => {

		const p = new Profile( { enabled : true } )

		await assert.rejects( () => p.time( 'broken', async () => {

			throw new Error( 'boom' )

		} ) )

		assert.equal( p.paths.get( 'broken' ).calls, 1 )

	} )

} )
