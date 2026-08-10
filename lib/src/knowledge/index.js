/**
 * Knowledge layer: symbolic facts, rules, and semantic recall.
 *
 * `PlantKnowledge` composes the three so the kernel has one thing to talk to.
 */

export {
	ANY, TripleStore,
} from './triples.js'
export {
	explainCondition, loadOntology, PREDICATES, resolveConflicts,
} from './ontology.js'
export {
	DEFAULT_RULES, Reasoner,
} from './reasoner.js'
export {
	ApiEmbedder, cosine, HashEmbedder, RemoteVectorStore, VectorMemory,
} from './vectors.js'

import { explainCondition, loadOntology, PREDICATES } from './ontology.js'
import { Reasoner } from './reasoner.js'
import { TripleStore } from './triples.js'
import { VectorMemory } from './vectors.js'

export class PlantKnowledge {

	/**
	 * @param {object} [config]           - Options.
	 * @param {object} [config.vectors]   - `VectorMemory` options, or an instance.
	 * @param {Array}  [config.rules]     - Extra reasoner rules.
	 * @param {boolean}[config.ontology]  - Preload the core ontology. Default true.
	 */
	constructor( config = {} ) {

		this.store = new TripleStore()
		if ( config.ontology !== false ) loadOntology( this.store )

		this.vectors = config.vectors instanceof VectorMemory
			? config.vectors
			: new VectorMemory( config.vectors || {} )

		// Extra rules are appended to the defaults rather than replacing them, so
		// adding one domain rule never silently disables the built-in reasoning.
		this.reasoner = new Reasoner( { store : this.store } )
		for ( const rule of config.rules || [] ) this.reasoner.addRule( rule )

	}

	/**
	 * Assert a fact about this plant.
	 *
	 * @param   {string} subject   - Subject.
	 * @param   {string} predicate - Predicate.
	 * @param   {*}      object    - Object.
	 * @param   {object} [meta]    - Provenance.
	 * @returns {object}           The triple.
	 */
	assert( subject, predicate, object, meta ) {

		return this.store.add( subject, predicate, object, meta )

	}

	/**
	 * Draw conclusions from the current situation.
	 *
	 * @param   {object} ctx    - Plant context, optionally with `vision` / `electro`.
	 * @param   {object} [opts] - Reasoner options.
	 * @returns {object}        `{conclusions, treatments, explanation}`.
	 */
	infer( ctx, opts ) {

		const result = this.reasoner.infer( ctx, opts )

		// Record conclusions as timestamped facts, so the graph accumulates a
		// history that later queries and explanations can draw on.
		const at = new Date().toISOString()
		for ( const c of result.conclusions ) {

			this.store.add( 'plant', PREDICATES.HAS_VALUE, c.conclusion, {
				source     : 'reasoner',
				confidence : c.confidence,
				at,
			} )

		}

		return result

	}

	/**
	 * Everything known about a condition.
	 *
	 * @param   {string} condition - Condition id.
	 * @returns {object}           Explanation.
	 */
	explain( condition ) {

		return explainCondition( this.store, condition )

	}

	/**
	 * Why might this symptom be happening? Walks `indicates` and `causes` back
	 * from an observation to its possible roots.
	 *
	 * @param   {string}   symptom - Observed sign, e.g. `'wilting'`.
	 * @returns {object[]}         Candidate causes with their chains.
	 */
	diagnose( symptom ) {

		const direct = this.store.query( symptom, PREDICATES.INDICATES ).map( t => String( t.object ) )
		const viaCause = this.store.query( undefined, PREDICATES.CAUSES, symptom ).map( t => t.subject )

		const candidates = [ ...new Set( [ ...direct, ...viaCause ] ) ]

		return candidates.map( cause => ( {
			cause,
			kind       : this.store.get( cause, PREDICATES.IS_A ),
			rootCauses : this.store.query( undefined, PREDICATES.CAUSES, cause ).map( t => t.subject ),
			treatments : this.store.query( cause, PREDICATES.TREATED_BY ).map( t => String( t.object ) ),
			sensors    : this.store.query( cause, PREDICATES.MEASURED_BY ).map( t => String( t.object ) ),
			path       : this.store.path( symptom, cause ),
		} ) )

	}

	/**
	 * Record an episode in semantic memory.
	 *
	 * @param   {string}          text       - What happened.
	 * @param   {object}          [metadata] - Structured detail.
	 * @returns {Promise<object>}            Stored item.
	 */
	async remember( text, metadata ) {

		return this.vectors.add( text, metadata )

	}

	/**
	 * Recall similar past episodes.
	 *
	 * @param   {string}            query  - Situation description.
	 * @param   {object}            [opts] - `{ k, minScore }`.
	 * @returns {Promise<object[]>}        Matches.
	 */
	async recall( query, opts ) {

		return this.vectors.search( query, opts )

	}

	toJSON() {

		return {
			store   : this.store.toJSON(),
			vectors : this.vectors.toJSON(),
		}

	}

	/**
	 * Restore from `toJSON`.
	 *
	 * @param   {object}         data   - Serialized knowledge.
	 * @param   {object}         [opts] - Constructor options.
	 * @returns {PlantKnowledge}        A restored instance.
	 */
	static fromJSON( data, opts = {} ) {

		const k = new PlantKnowledge( {
			...opts,
			ontology : false,
		} )
		k.store = TripleStore.fromJSON( data?.store )
		k.vectors = VectorMemory.fromJSON( data?.vectors, opts.vectors )
		k.reasoner.store = k.store
		return k

	}

}
