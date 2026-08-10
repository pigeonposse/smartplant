/**
 * Semantic memory — the retrieval half of RAG.
 *
 * The triple store holds what is *true*. This holds what *happened*, so the
 * plant can recall "the last three times I felt like this, it was the radiator".
 *
 * Ships a local, dependency-free embedder and a flat index, because a plant on a
 * Raspberry Pi should not need a vector database to have a memory. Adapters for
 * Qdrant, Weaviate and Milvus are here for when the corpus outgrows that.
 */

import { SmartPlantError } from '../core/errors.js'

/**
 * Deterministic hashing embedder.
 *
 * Feature hashing over character n-grams: no model, no download, no network, and
 * stable across processes and machines. It captures lexical similarity rather
 * than deep semantics — enough to retrieve "soil dry, leaves drooping" when the
 * plant is dry and drooping again, which is the actual job here.
 *
 * Swap in a real embedding model via `embedder` when you have one; the index
 * does not care where the vectors came from.
 */
export class HashEmbedder {

	/**
	 * @param {object} [opts]           - Options.
	 * @param {number} [opts.dimensions]- Vector length. Default 256.
	 * @param {number} [opts.ngram]     - Character n-gram size. Default 3.
	 */
	constructor( opts = {} ) {

		this.dimensions = opts.dimensions ?? 256
		this.ngram      = opts.ngram ?? 3
		this.id         = 'hash'

	}

	/**
	 * Embed a string.
	 *
	 * @param   {string}                text - Input.
	 * @returns {Promise<Float32Array>}      Unit-length vector.
	 */
	async embed( text ) {

		const vec = new Float32Array( this.dimensions )
		const normalized = String( text ).toLowerCase().replace( /\s+/g, ' ' ).trim()
		if ( !normalized ) return vec

		// Words carry topic, character n-grams carry robustness to typos and
		// morphology. Both are hashed into the same space.
		for ( const word of normalized.split( ' ' ) ) {

			addFeature( vec, `w:${word}`, 1 )
			for ( let i = 0; i + this.ngram <= word.length; i++ ) {

				addFeature( vec, `g:${word.slice( i, i + this.ngram )}`, 0.5 )

			}

		}

		// L2 normalize so cosine similarity is a plain dot product.
		let norm = 0
		for ( const v of vec ) norm += v * v
		norm = Math.sqrt( norm )
		if ( norm > 0 ) for ( let i = 0; i < vec.length; i++ ) vec[ i ] /= norm

		return vec

	}

}

/** FNV-1a, then a signed contribution so unrelated features cancel rather than accumulate. */
function addFeature( vec, feature, weight ) {

	let hash = 0x811c9dc5
	for ( let i = 0; i < feature.length; i++ ) {

		hash ^= feature.charCodeAt( i )
		hash = Math.imul( hash, 0x01000193 ) >>> 0

	}
	const index = hash % vec.length
	const sign  = ( hash >>> 31 ) & 1 ? -1 : 1
	vec[ index ] += sign * weight

}

/**
 * Embedder backed by an AI provider that exposes an embeddings endpoint.
 *
 * @example
 * new ApiEmbedder( { url: 'https://api.openai.com/v1/embeddings', apiKey, model: 'text-embedding-3-small' } )
 */
export class ApiEmbedder {

	constructor( config = {} ) {

		this.url     = config.url
		this.apiKey  = config.apiKey
		this.model   = config.model
		this.id      = `api:${config.model || 'unknown'}`
		if ( !this.url ) throw new SmartPlantError( 'ApiEmbedder needs a { url }.', 'CONFIG_ERROR' )

	}

	async embed( text ) {

		const res = await fetch( this.url, {
			method  : 'POST',
			headers : {
				'Content-Type' : 'application/json',
				...( this.apiKey ? { Authorization : `Bearer ${this.apiKey}` } : {} ),
			},
			body : JSON.stringify( {
				model : this.model,
				input : text,
			} ),
		} )

		if ( !res.ok ) throw new SmartPlantError( `Embedding request failed: HTTP ${res.status}`, 'AI_ERROR' )

		const data = await res.json()
		const vec = data?.data?.[ 0 ]?.embedding || data?.embedding || data?.embeddings?.[ 0 ]
		if ( !Array.isArray( vec ) ) throw new SmartPlantError( 'Embedding response had an unexpected shape.', 'AI_ERROR' )

		return Float32Array.from( vec )

	}

}

/**
 * In-process vector index.
 *
 * A flat (brute-force) index: exact, trivially correct, and fast enough for the
 * thousands-of-episodes scale a single plant produces. Approximate indexes earn
 * their complexity at millions of vectors, not here.
 */
export class VectorMemory {

	/**
	 * @param {object} [opts]           - Options.
	 * @param {object} [opts.embedder]  - Anything with `embed(text)`.
	 * @param {number} [opts.maxItems]  - Ring-buffer cap.
	 */
	constructor( opts = {} ) {

		this.embedder = opts.embedder || new HashEmbedder()
		this.maxItems = opts.maxItems ?? 5000
		/** @type {{id: string, text: string, vector: Float32Array, metadata: object, at: string}[]} */
		this.items    = []
		this._nextId  = 1

	}

	get size() {

		return this.items.length

	}

	/**
	 * Store an episode.
	 *
	 * @param   {string}          text       - What happened, in words.
	 * @param   {object}          [metadata] - Structured detail to carry along.
	 * @returns {Promise<object>}            The stored item.
	 */
	async add( text, metadata = {} ) {

		const vector = await this.embedder.embed( text )
		const item = {
			id       : metadata.id || `mem_${this._nextId++}`,
			text,
			vector,
			metadata,
			at       : metadata.at || new Date().toISOString(),
		}

		this.items.push( item )
		if ( this.items.length > this.maxItems ) this.items.splice( 0, this.items.length - this.maxItems )

		return item

	}

	/**
	 * Retrieve the most similar episodes.
	 *
	 * @param   {string}            query     - Query text.
	 * @param   {object}            [opts]    - Options.
	 * @param   {number}            [opts.k]  - How many. Default 5.
	 * @param   {number}            [opts.minScore] - Similarity floor.
	 * @param   {Function}          [opts.filter]   - `(item) => boolean`.
	 * @returns {Promise<object[]>}           Matches with scores, best first.
	 */
	async search( query, opts = {} ) {

		const k = opts.k ?? 5
		const minScore = opts.minScore ?? 0
		const qv = await this.embedder.embed( query )

		const pool = opts.filter ? this.items.filter( opts.filter ) : this.items

		return pool
			.map( item => ( {
				id       : item.id,
				text     : item.text,
				metadata : item.metadata,
				at       : item.at,
				score    : Number( cosine( qv, item.vector ).toFixed( 4 ) ),
			} ) )
			.filter( r => r.score >= minScore )
			.sort( ( a, b ) => b.score - a.score )
			.slice( 0, k )

	}

	/** Drop everything. */
	clear() {

		this.items = []
		return this

	}

	/** Serialize (vectors as plain arrays, so it round-trips through JSON). */
	toJSON() {

		return {
			embedder : this.embedder.id,
			items    : this.items.map( i => ( {
				id       : i.id,
				text     : i.text,
				metadata : i.metadata,
				at       : i.at,
				vector   : Array.from( i.vector ),
			} ) ),
		}

	}

	/**
	 * Restore from `toJSON`.
	 *
	 * @param   {object}       data   - Serialized memory.
	 * @param   {object}       [opts] - Constructor options.
	 * @returns {VectorMemory}        A new memory.
	 */
	static fromJSON( data, opts = {} ) {

		const mem = new VectorMemory( opts )
		for ( const i of data?.items || [] ) {

			mem.items.push( {
				...i,
				vector : Float32Array.from( i.vector ),
			} )

		}
		return mem

	}

}

/**
 * Cosine similarity of two equal-length vectors.
 *
 * @param   {Float32Array|number[]} a - First vector.
 * @param   {Float32Array|number[]} b - Second vector.
 * @returns {number}                  −1..1.
 */
export function cosine( a, b ) {

	const n = Math.min( a.length, b.length )
	let dot = 0, na = 0, nb = 0

	for ( let i = 0; i < n; i++ ) {

		dot += a[ i ] * b[ i ]
		na  += a[ i ] * a[ i ]
		nb  += b[ i ] * b[ i ]

	}

	if ( na === 0 || nb === 0 ) return 0
	return dot / ( Math.sqrt( na ) * Math.sqrt( nb ) )

}

/**
 * Remote vector database adapter.
 *
 * Speaks the REST APIs of Qdrant, Weaviate and Milvus behind the same `add` /
 * `search` surface as `VectorMemory`, so swapping storage never touches calling
 * code.
 */
export class RemoteVectorStore {

	/**
	 * @param {object} [config]              - Options.
	 * @param {string} [config.backend]      - `'qdrant'` | `'weaviate'` | `'milvus'`.
	 * @param {string} [config.url]          - Base URL.
	 * @param {string} [config.collection]   - Collection/class name.
	 * @param {string} [config.apiKey]       - API key, if the deployment needs one.
	 * @param {object} [config.embedder]     - Anything with `embed(text)`.
	 */
	constructor( config = {} ) {

		this.backend    = config.backend || 'qdrant'
		this.url        = ( config.url || 'http://localhost:6333' ).replace( /\/+$/, '' )
		this.collection = config.collection || 'smartplant'
		this.apiKey     = config.apiKey
		this.embedder   = config.embedder || new HashEmbedder()

		if ( ![ 'qdrant', 'weaviate', 'milvus' ].includes( this.backend ) ) {

			throw new SmartPlantError( `Unknown vector backend "${this.backend}".`, 'CONFIG_ERROR' )

		}

	}

	_headers() {

		return {
			'Content-Type' : 'application/json',
			...( this.apiKey
				? ( this.backend === 'qdrant'
					? { 'api-key' : this.apiKey }
					: { Authorization : `Bearer ${this.apiKey}` } )
				: {} ),
		}

	}

	async _request( path, options = {} ) {

		const res = await fetch( `${this.url}${path}`, {
			headers : this._headers(),
			...options,
			body    : options.body ? JSON.stringify( options.body ) : undefined,
		} )

		if ( !res.ok ) {

			const text = await res.text().catch( () => '' )
			throw new SmartPlantError(
				`${this.backend} returned HTTP ${res.status}: ${text.slice( 0, 200 )}`,
				'VECTOR_STORE_ERROR',
			)

		}
		return res.json().catch( () => ( {} ) )

	}

	/**
	 * Store an episode remotely.
	 *
	 * @param   {string}          text       - Episode text.
	 * @param   {object}          [metadata] - Payload.
	 * @returns {Promise<object>}            Store response.
	 */
	async add( text, metadata = {} ) {

		const vector = Array.from( await this.embedder.embed( text ) )
		const id = metadata.id || Date.now() + Math.floor( Math.random() * 1000 )

		if ( this.backend === 'qdrant' ) {

			return this._request( `/collections/${this.collection}/points?wait=true`, {
				method : 'PUT',
				body   : { points : [ {
					id,
					vector,
					payload : {
						text,
						...metadata,
					},
				} ] },
			} )

		}

		if ( this.backend === 'weaviate' ) {

			return this._request( '/v1/objects', {
				method : 'POST',
				body   : {
					class      : this.collection,
					properties : {
						text,
						...metadata,
					},
					vector,
				},
			} )

		}

		return this._request( '/v1/vector/insert', {
			method : 'POST',
			body   : {
				collectionName : this.collection,
				data : [ {
					id,
					vector,
					text,
					...metadata,
				} ],
			},
		} )

	}

	/**
	 * Search remotely.
	 *
	 * @param   {string}            query  - Query text.
	 * @param   {object}            [opts] - `{ k }`.
	 * @returns {Promise<object[]>}        Matches, best first.
	 */
	async search( query, opts = {} ) {

		const k = opts.k ?? 5
		const vector = Array.from( await this.embedder.embed( query ) )

		if ( this.backend === 'qdrant' ) {

			const data = await this._request( `/collections/${this.collection}/points/search`, {
				method : 'POST',
				body   : {
					vector,
					limit : k,
					with_payload : true,
				},
			} )
			return ( data.result || [] ).map( r => ( {
				id       : r.id,
				score    : r.score,
				text     : r.payload?.text,
				metadata : r.payload,
			} ) )

		}

		if ( this.backend === 'weaviate' ) {

			const data = await this._request( '/v1/graphql', {
				method : 'POST',
				body   : {
					query : `{ Get { ${this.collection}( nearVector: { vector: [${vector.join( ',' )}] }, limit: ${k} ) { text _additional { distance id } } } }`,
				},
			} )
			return ( data?.data?.Get?.[ this.collection ] || [] ).map( r => ( {
				id    : r._additional?.id,
				// Weaviate reports distance; convert so higher is always better.
				score : 1 - ( r._additional?.distance ?? 1 ),
				text  : r.text,
				metadata : r,
			} ) )

		}

		const data = await this._request( '/v1/vector/search', {
			method : 'POST',
			body   : {
				collectionName : this.collection,
				vector,
				limit          : k,
				outputFields   : [ 'text' ],
			},
		} )
		return ( data.data || [] ).map( r => ( {
			id    : r.id,
			score : r.distance,
			text  : r.text,
			metadata : r,
		} ) )

	}

}
