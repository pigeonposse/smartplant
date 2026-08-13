/**
 * Somewhere to start, and the one archetype that is more than a number.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import {
	applyArchetype, archetype, ARCHETYPE_IDS, ARCHETYPES, guessArchetype, RHYTHM,
} from '../src/archetypes/index.js'
import { readBlueInContext } from '../src/spectral/index.js'

const plant = ( species, extra = {} ) => createPlant( {
	name : 'X',
	species,
	sensor : {
		driver : 'mock',
		dayNight : false,
	},
	ai : { provider : 'mock' },
	...extra,
} )

describe( 'the six', () => {

	it( 'covers every archetype with ranges and a summary', () => {

		assert.equal( ARCHETYPE_IDS.length, 6 )

		for ( const id of ARCHETYPE_IDS ) {

			const a = archetype( id )
			assert.ok( a.ranges.temperature && a.ranges.soil, `${id} is missing ranges` )
			assert.ok( a.summary && a.notes, `${id} has nothing to say for itself` )
			assert.ok( a.vpd.min < a.vpd.max )

		}

	} )

	it( 'gives a cactus and a fern genuinely different soil', () => {

		const cactus = archetype( 'xerophyte' ).ranges.soil
		const fern = archetype( 'hygrophyte' ).ranges.soil

		// The whole point: one generic band told both the same thing.
		assert.ok( cactus.max < fern.min )

	} )

	it( 'folds a subgroup over its archetype without restating the rest', () => {

		const base = archetype( 'xerophyte' )
		const forest = archetype( 'xerophyte', 'forest' )

		assert.notDeepEqual( forest.ranges.soil, base.ranges.soil )
		// Untouched by the subgroup, so inherited rather than repeated.
		assert.deepEqual( forest.ranges.temperature, base.ranges.temperature )
		assert.match( forest.label, /Forest cactus/ )

	} )

	it( 'matches common names, at subgroup level where it can', () => {

		assert.equal( guessArchetype( 'Monstera deliciosa' ).subgroup, 'aroid' )
		assert.equal( guessArchetype( 'Phalaenopsis' ).subgroup, 'epiphyte' )
		assert.equal( guessArchetype( 'Calathea orbifolia' ).id, 'hygrophyte' )
		assert.equal( guessArchetype( 'Ficus lyrata' ).id, 'woody' )

	} )

	it( 'refuses to guess rather than guessing wrong', () => {

		// A wrong archetype is worse than none: it swaps thresholds nobody trusts
		// for thresholds that look authoritative and are not.
		assert.equal( guessArchetype( 'Xanthosoma something' ), null )
		assert.equal( guessArchetype( '' ), null )
		assert.equal( guessArchetype( null ), null )

	} )

	it( 'keeps DLI separate from lux instead of converting', () => {

		// The factor depends on the spectrum of the source, so a converted figure
		// would carry an error nobody could see.
		for ( const id of ARCHETYPE_IDS ) {

			const a = ARCHETYPES[ id ]
			assert.ok( a.dli, `${id} has no DLI target` )
			assert.ok( a.ranges.light, `${id} has no lux guide` )
			assert.notEqual( a.dli.min, a.ranges.light.min )

		}

	} )

} )

describe( 'applying it', () => {

	it( 'starts a new plant from its archetype rather than generic defaults', async () => {

		const p = await plant( 'Echeveria elegans' )

		assert.equal( p.archetype.id, 'xerophyte' )
		assert.ok( p.ranges.soil.max <= 25 )

		await p.destroy()

	} )

	it( 'takes an explicit archetype over a guess', async () => {

		const p = await plant( 'Monstera deliciosa', { archetype : 'hygrophyte' } )

		assert.equal( p.archetype.id, 'hygrophyte' )

		await p.destroy()

	} )

	it( 'can be switched off entirely', async () => {

		const p = await plant( 'Echeveria elegans', { archetype : false } )

		assert.equal( p.archetype, undefined )
		// Back to the generic band.
		assert.equal( p.ranges.soil.min, 35 )

		await p.destroy()

	} )

	it( 'leaves a plant with its own record alone', () => {

		const grown = {
			memory : {
				plant : { species : 'Monstera' },
				data : { readings : Array.from( { length : 500 }, () => ( {} ) ) },
			},
			ranges : {},
		}

		const r = applyArchetype( grown )

		assert.equal( r.applied, false )
		assert.match( r.why, /Its own record describes it better/ )

	} )

	it( 'fills gaps around a learned profile instead of overwriting it', async () => {

		const p = await plant( 'Monstera deliciosa' )
		// A learned soil range beats a categorical one.
		p.memory.data.profile = { ranges : { soil : {
			min : 30,
			max : 60,
		} } }

		const r = applyArchetype( p )

		assert.ok( r.kept.includes( 'soil' ) || r.filled.includes( 'soil' ) )
		assert.ok( r.filled.length > 0 )

		await p.destroy()

	} )

	it( 'says plainly when nothing matches', async () => {

		const p = await plant( 'Something Unheard Of' )

		assert.equal( p.archetype, undefined )
		assert.match( p._archetypeResult.why, /worse than none/ )

		await p.destroy()

	} )

	it( 'refuses an archetype it does not have', async () => {

		await assert.rejects( () => plant( 'X', { archetype : 'aquatic' } ), /Unknown archetype/ )

	} )

} )

describe( 'the CAM inversion', () => {

	it( 'marks the nocturnal archetype and only that one', () => {

		assert.equal( archetype( 'xerophyte' ).nocturnal, true )
		assert.equal( archetype( 'xerophyte' ).rhythm, RHYTHM.NOCTURNAL )

		for ( const id of ARCHETYPE_IDS.filter( x => x !== 'xerophyte' ) ) {

			assert.equal( archetype( id ).nocturnal, false, `${id} should be diurnal` )

		}

	} )

	it( 'reads a shut stoma as stress on a C3 plant', () => {

		const r = readBlueInContext( 'weak', {
			vpd : 2.2,
			current : { soil : 20 },
		} )

		assert.equal( r.state, 'closed_under_demand' )

	} )

	it( 'reads the same shut stoma as correct behaviour on a CAM plant', () => {

		// Not an imprecise conclusion — an inverted one. No amount of further
		// data corrects it, because the model of the plant is upside down.
		const r = readBlueInContext( 'weak', {
			vpd : 2.2,
			// Daylight stated rather than taken from the host's clock, so this
			// tests the rule instead of testing what time it is here.
			current : {
				soil : 20,
				light : 12_000,
			},
			archetype : { nocturnal : true },
		} )

		assert.equal( r.state, 'cam_daytime_closure' )
		assert.match( r.verdict, /correct behaviour rather than stress/ )
		assert.match( r.verdict, /probe after dark/i )

	} )

	it( 'reads the same plant correctly after dark, whatever the host clock says', () => {

		const r = readBlueInContext( 'weak', {
			vpd : 2.2,
			current : {
				soil : 20,
				light : 0,
			},
			archetype : { nocturnal : true },
		} )

		// At night a CAM plant should have its stomata open, so a shut one is a
		// real finding rather than the expected daytime behaviour.
		assert.notEqual( r?.state, 'cam_daytime_closure' )

	} )

	it( 'uses a light reading over any clock, and a stated hour over the host\'s', () => {

		const shut = {
			vpd : 2.2,
			current : { soil : 20 },
			archetype : { nocturnal : true },
		}

		// The rule is about daylight, not about what time it is where the
		// process happens to be running.
		assert.equal( readBlueInContext( 'weak', {
			...shut,
			hour : 13,
		} ).state, 'cam_daytime_closure' )

		assert.notEqual( readBlueInContext( 'weak', {
			...shut,
			hour : 2,
		} )?.state, 'cam_daytime_closure' )

	} )

	it( 'carries the archetype into the context so the reading can see it', async () => {

		const p = await plant( 'Echeveria elegans' )
		await p.read()

		assert.equal( p.context().archetype.nocturnal, true )

		await p.destroy()

	} )

	it( 'warns about it in the system diagnosis', async () => {

		const p = await plant( 'Echeveria elegans' )
		await p.read()

		const r = await p.systemDiagnosis( { probeAI : false } )
		const a = r.checks.find( c => c.area === 'archetype' )

		assert.match( a.says, /inverted/ )
		assert.match( a.fix, /Probe after dark/ )

		await p.destroy()

	} )

	it( 'tells a plant with no archetype that it is flying blind', async () => {

		const p = await plant( 'Something Unheard Of' )
		await p.read()

		const a = ( await p.systemDiagnosis( { probeAI : false } ) ).checks.find( c => c.area === 'archetype' )

		assert.equal( a.result, 'warn' )
		assert.match( a.fix, /cactus and a fern/ )

		await p.destroy()

	} )

} )
