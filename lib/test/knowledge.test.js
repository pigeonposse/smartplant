import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
	cosine, HashEmbedder, loadOntology, PlantKnowledge, PREDICATES, Reasoner,
	TripleStore, VectorMemory,
} from '../src/knowledge/index.js'

describe( 'triple store', () => {

	it( 'stores, queries and retracts', () => {

		const s = new TripleStore()
		s.add( 'monstera', 'likes', 'shade' )
		s.add( 'monstera', 'likes', 'humidity' )
		s.add( 'cactus', 'likes', 'sun' )

		assert.equal( s.size, 3 )
		assert.equal( s.query( 'monstera', 'likes' ).length, 2 )
		assert.equal( s.query( undefined, 'likes', 'sun' )[ 0 ].subject, 'cactus' )

		assert.equal( s.remove( 'cactus', 'likes', 'sun' ), true )
		assert.equal( s.remove( 'cactus', 'likes', 'sun' ), false )
		assert.equal( s.size, 2 )

	} )

	it( 're-asserting keeps the highest confidence rather than duplicating', () => {

		const s = new TripleStore()
		s.add( 'a', 'p', 'b', { confidence : 0.4 } )
		s.add( 'a', 'p', 'b', { confidence : 0.9 } )

		assert.equal( s.size, 1 )
		assert.equal( s.query( 'a', 'p' )[ 0 ].confidence, 0.9 )
		assert.equal( s.query( 'a', 'p' )[ 0 ].count, 2 )

	} )

	it( 'follows a predicate transitively', () => {

		const s = new TripleStore()
		s.add( 'a', 'causes', 'b' )
		s.add( 'b', 'causes', 'c' )
		s.add( 'c', 'causes', 'd' )

		assert.deepEqual( s.transitive( 'a', 'causes' ), [ 'b', 'c', 'd' ] )

	} )

	it( 'does not loop forever on a cycle', () => {

		const s = new TripleStore()
		s.add( 'a', 'causes', 'b' )
		s.add( 'b', 'causes', 'a' )

		assert.deepEqual( s.transitive( 'a', 'causes' ), [ 'b' ] )

	} )

	it( 'finds an explanatory path between two nodes', () => {

		const s = loadOntology()
		const path = s.path( 'high_soil_moisture', 'wilting' )

		assert.ok( path, 'expected a path from overwatering to wilting' )
		assert.ok( path.length >= 2 )

	} )

	it( 'round-trips through JSON', () => {

		const s = new TripleStore()
		s.add( 'a', 'p', 'b', { confidence : 0.7 } )

		const restored = TripleStore.fromJSON( s.toJSON() )
		assert.equal( restored.size, 1 )
		assert.equal( restored.get( 'a', 'p' ), 'b' )

	} )

} )

describe( 'ontology', () => {

	it( 'knows that overwatering leads to root rot', () => {

		const s = loadOntology()
		assert.ok( s.has( 'overwatering', PREDICATES.CAUSES, 'root_rot' ) )

	} )

	it( 'refuses to recommend contradictory treatments', () => {

		const k = new PlantKnowledge()
		const result = k.reasoner.infer( {
			// Both dry and wet cannot be acted on together.
			deviations : [
				{
					metric : 'soil',
					direction : 'low',
					value : 5,
					unit : '%',
					range : {
						min : 35,
						max : 70,
					},
					score : 10,
				},
				{
					metric : 'temperature',
					direction : 'high',
					value : 35,
					unit : '°C',
					range : {
						min : 18,
						max : 26,
					},
					score : 20,
				},
			],
			current : {
				soil : 5,
				temperature : 35,
			},
			care : {},
		} )

		const names = result.treatments.map( t => t.treatment )
		assert.ok( names.includes( 'water_thoroughly' ) )
		assert.ok( !names.includes( 'let_soil_dry' ), 'must not advise watering and drying at once' )

	} )

} )

describe( 'reasoner', () => {

	const dryContext = {
		deviations : [ {
			metric : 'soil',
			direction : 'low',
			value : 4,
			unit : '%',
			range : {
				min : 35,
				max : 70,
			},
			score : 10,
		} ],
		current : {
			soil : 4,
			temperature : 21,
		},
		happiness : 30,
		care      : { daysSinceWater : 12 },
	}

	it( 'derives drought stress from dry soil, with its reason', () => {

		const r = new Reasoner( { store : loadOntology() } )
		const result = r.infer( dryContext )

		const drought = result.conclusions.find( c => c.conclusion === 'drought_stress' )
		assert.ok( drought, 'expected drought_stress' )
		assert.ok( drought.confidence > 0.8 )
		assert.ok( drought.because[ 0 ].includes( '4%' ), 'the reason must cite the reading' )

	} )

	it( 'suggests watering for drought', () => {

		const r = new Reasoner( { store : loadOntology() } )
		const result = r.infer( dryContext )

		assert.ok( result.treatments.some( t => t.treatment === 'water_thoroughly' ) )

	} )

	it( 'discounts a wet reading taken right after watering', () => {

		const r = new Reasoner( { store : loadOntology() } )

		const wet = dev => ( {
			deviations : [ {
				metric : 'soil',
				direction : 'high',
				value : 95,
				unit : '%',
				range : {
					min : 35,
					max : 70,
				},
				score : 40,
			} ],
			current : { soil : 95 },
			care    : { daysSinceWater : dev },
		} )

		const justWatered = r.infer( wet( 0 ) ).conclusions.find( c => c.conclusion === 'overwatering' )
		const longAgo     = r.infer( wet( 20 ) ).conclusions.find( c => c.conclusion === 'overwatering' )

		assert.ok( justWatered.confidence < longAgo.confidence, 'a fresh watering explains wet soil' )

	} )

	it( 'concludes nothing when everything is in range', () => {

		const r = new Reasoner( { store : loadOntology() } )
		const result = r.infer( {
			deviations : [],
			current : {
				soil : 50,
				temperature : 21,
			},
			care : {},
		} )

		assert.equal( result.conclusions.length, 0 )
		assert.match( result.explanation, /No conditions inferred/ )

	} )

	it( 'reads vision and electrophysiology evidence', () => {

		const r = new Reasoner( { store : loadOntology() } )
		const result = r.infer( {
			deviations : [],
			current    : {},
			care       : {},
			vision     : {
				change : { droopDelta : 0.05 },
				phenotype : { tissue : { chlorotic : 0.2 } },
			},
			electro    : { summary : {
				damageSignal : true,
				counts : { variation_potential : 2 },
			} },
		} )

		const labels = result.conclusions.map( c => c.conclusion )
		assert.ok( labels.includes( 'canopy_droop' ) )
		assert.ok( labels.includes( 'chlorosis' ) )
		assert.ok( labels.includes( 'tissue_damage' ) )

	} )

	it( 'a rule that throws does not stop the others', () => {

		const r = new Reasoner( { store : loadOntology() } )
		r.addRule( {
			id   : 'broken',
			when : () => {

				throw new Error( 'boom' )

			},
			conclude : () => ( {} ),
		} )

		const result = r.infer( dryContext )
		assert.ok( result.conclusions.some( c => c.conclusion === 'drought_stress' ) )

	} )

	it( 'explanations cite the observations behind every conclusion', () => {

		const r = new Reasoner( { store : loadOntology() } )
		const text = r.infer( dryContext ).explanation

		assert.match( text, /drought stress/ )
		assert.match( text, /confidence/ )
		assert.match( text, /soil at 4%/ )

	} )

} )

describe( 'vector memory', () => {

	it( 'retrieves the most similar episode', async () => {

		const m = new VectorMemory()
		await m.add( 'soil very dry, leaves drooping, needs water urgently' )
		await m.add( 'bright sunlight, warm, everything comfortable and healthy' )
		await m.add( 'cold draft from the window, temperature falling' )

		const hits = await m.search( 'the soil is dry and the leaves droop', { k : 1 } )

		assert.equal( hits.length, 1 )
		assert.match( hits[ 0 ].text, /dry/ )

	} )

	it( 'the hash embedder is deterministic across instances', async () => {

		const a = await new HashEmbedder().embed( 'monstera needs water' )
		const b = await new HashEmbedder().embed( 'monstera needs water' )

		assert.equal( cosine( a, b ), 1 )

	} )

	it( 'unrelated text scores lower than related text', async () => {

		const e = new HashEmbedder()
		const base = await e.embed( 'soil dry leaves drooping' )
		const near = await e.embed( 'dry soil and drooping leaves' )
		const far  = await e.embed( 'quarterly financial report earnings' )

		assert.ok( cosine( base, near ) > cosine( base, far ) )

	} )

	it( 'honours the ring-buffer cap', async () => {

		const m = new VectorMemory( { maxItems : 5 } )
		for ( let i = 0; i < 20; i++ ) await m.add( `episode ${i}` )

		assert.equal( m.size, 5 )

	} )

	it( 'round-trips through JSON', async () => {

		const m = new VectorMemory()
		await m.add( 'dry soil episode', { tag : 'x' } )

		const restored = VectorMemory.fromJSON( m.toJSON() )
		const hits = await restored.search( 'dry soil', { k : 1 } )

		assert.equal( hits[ 0 ].metadata.tag, 'x' )

	} )

} )

describe( 'PlantKnowledge', () => {

	it( 'diagnoses a symptom back to its possible causes', () => {

		const k = new PlantKnowledge()
		const causes = k.diagnose( 'wilting' ).map( c => c.cause )

		assert.ok( causes.includes( 'drought_stress' ) )
		assert.ok( causes.includes( 'root_rot' ), 'wilting is not always thirst' )

	} )

	it( 'explains a condition with causes, signs and treatments', () => {

		const k = new PlantKnowledge()
		const e = k.explain( 'root_rot' )

		assert.equal( e.kind, 'disease' )
		assert.ok( e.causedBy.includes( 'overwatering' ) )
		assert.ok( e.treatments.length > 0 )

	} )

	it( 'records conclusions as timestamped facts', () => {

		const k = new PlantKnowledge()
		k.infer( {
			deviations : [ {
				metric : 'soil',
				direction : 'low',
				value : 3,
				unit : '%',
				range : {
					min : 35,
					max : 70,
				},
				score : 5,
			} ],
			current : { soil : 3 },
			care    : {},
		} )

		assert.ok( k.store.has( 'plant', PREDICATES.HAS_VALUE, 'drought_stress' ) )

	} )

	it( 'remembers and recalls episodes', async () => {

		const k = new PlantKnowledge()
		await k.remember( 'radiator turned on, air went very dry, tips browned' )
		await k.remember( 'repotted into a larger pot with fresh substrate' )

		const hits = await k.recall( 'the air is very dry', { k : 1 } )
		assert.match( hits[ 0 ].text, /dry/ )

	} )

} )
