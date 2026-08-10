/**
 * AIService — the AI half of the bridge.
 *
 * Responsibilities beyond "call a model":
 *  - provider registry (built-ins + user-registered)
 *  - retries with backoff on transient failures
 *  - structured JSON output with schema coercion, so plugins get objects and
 *    never have to regex a paragraph
 *  - a response cache, so ten plugins reacting to one sensor tick don't fire
 *    ten identical paid requests
 */

import { AIError, ConfigError } from '../core/errors.js'
import {
	builtinProviders, isRetryable,
} from './providers.js'

const sleep = ms => new Promise( r => setTimeout( r, ms ) )

export class AIService {

	/**
	 * @param {object} [opts]              - Options.
	 * @param {string} [opts.provider]     - Provider id (`gemini`, `ollama`, `mock`…).
	 * @param {string} [opts.apiKey]       - API key. Falls back to the provider's env var.
	 * @param {string} [opts.model]        - Model id override.
	 * @param {number} [opts.retries]      - Retry attempts for transient failures.
	 * @param {number} [opts.cacheTTL]     - Response cache TTL in ms. 0 disables.
	 * @param {number} [opts.temperature]  - Sampling temperature.
	 */
	constructor( opts = {} ) {

		this.providers   = builtinProviders()
		this.provider    = opts.provider || 'mock'
		this.model       = opts.model || null
		this.retries     = opts.retries ?? 2
		this.cacheTTL    = opts.cacheTTL ?? 30_000
		this.temperature = opts.temperature ?? 0.7
		this._apiKey     = opts.apiKey || null
		this._cache      = new Map()
		this.stats       = {
			requests : 0,
			cacheHits : 0,
			failures : 0,
		}

	}

	/** Register a custom backend. `impl` needs only `{ generate({ prompt }) }`. */
	registerProvider( id, impl ) {

		if ( typeof impl?.generate !== 'function' ) throw new ConfigError( `Provider "${id}" must expose a generate() function.` )
		this.providers[ id ] = {
			label    : impl.label || id,
			needsKey : impl.needsKey ?? false,
			...impl,
		}
		return this

	}

	listProviders() {

		return Object.entries( this.providers ).map( ( [ id, p ] ) => ( {
			id,
			label    : p.label || id,
			needsKey : !!p.needsKey,
			hasKey   : !p.needsKey || !!this._resolveKey( p ),
		} ) )

	}

	use( provider, opts = {} ) {

		if ( !this.providers[ provider ] ) throw new ConfigError( `Unknown AI provider "${provider}". Known: ${Object.keys( this.providers ).join( ', ' )}` )
		this.provider = provider
		if ( opts.model !== undefined ) this.model = opts.model
		if ( opts.apiKey !== undefined ) this._apiKey = opts.apiKey
		return this

	}

	_resolveKey( p ) {

		return this._apiKey || ( p.keyEnv ? process.env[ p.keyEnv ] : null )

	}

	/** True when the current provider can actually run (key present or not needed). */
	get ready() {

		const p = this.providers[ this.provider ]
		if ( !p ) return false
		return !p.needsKey || !!this._resolveKey( p )

	}

	/**
	 * Free-form generation.
	 *
	 * @param   {string}          prompt           - User prompt.
	 * @param   {object}          [opts]           - Options.
	 * @param   {string}          [opts.system]    - System instruction.
	 * @param   {string}          [opts.language]  - Reply language hint.
	 * @param   {AbortSignal}     [opts.signal]    - Abort signal.
	 * @returns {Promise<string>}                  Model text.
	 */
	async generate( prompt, opts = {} ) {

		const p = this.providers[ this.provider ]
		if ( !p ) throw new ConfigError( `Unknown AI provider "${this.provider}".` )

		const apiKey = this._resolveKey( p )
		if ( p.needsKey && !apiKey ) {

			throw new AIError(
				`Provider "${this.provider}" needs an API key. Pass it as { ai: { apiKey } } or set ${p.keyEnv}.`,
				{ provider : this.provider },
			)

		}

		const system = [ opts.system, opts.language ? `Always reply in ${opts.language}.` : null ]
			.filter( Boolean ).join( '\n' ) || undefined

		const cacheKey = this.cacheTTL > 0
			? `${this.provider}:${this.model || ''}:${system || ''}:${prompt}`
			: null

		if ( cacheKey ) {

			const hit = this._cache.get( cacheKey )
			if ( hit && hit.expires > Date.now() ) {

				this.stats.cacheHits++
				return hit.value

			}
			if ( hit ) this._cache.delete( cacheKey )

		}

		let lastErr
		for ( let attempt = 0; attempt <= this.retries; attempt++ ) {

			try {

				this.stats.requests++
				const text = await p.generate( {
					prompt,
					system,
					apiKey,
					model       : this.model || p.defaultModel,
					temperature : opts.temperature ?? this.temperature,
					maxTokens   : opts.maxTokens,
					signal      : opts.signal,
				} )

				if ( cacheKey ) this._cache.set( cacheKey, {
					value   : text,
					expires : Date.now() + this.cacheTTL,
				} )
				return text

			}
			catch ( err ) {

				lastErr = err
				this.stats.failures++
				if ( attempt === this.retries || !isRetryable( err ) ) break
				// Exponential backoff: 500ms, 1s, 2s…
				await sleep( 500 * 2 ** attempt )

			}

		}

		throw lastErr instanceof AIError
			? lastErr
			: new AIError( `AI request failed: ${lastErr?.message || 'unknown error'}`, { cause : lastErr } )

	}

	/**
	 * Structured generation. Asks for JSON, parses defensively, and fills in any
	 * key the model omitted from `schema` — plugins can then treat the result as
	 * a plain object with guaranteed keys.
	 *
	 * @param   {string}          prompt   - User prompt.
	 * @param   {object}          schema   - Key → default value. Doubles as documentation for the model.
	 * @param   {object}          [opts]   - Same options as `generate`.
	 * @returns {Promise<object>}          Parsed object, always with every `schema` key.
	 */
	async generateStructured( prompt, schema, opts = {} ) {

		const keys = Object.keys( schema )
		const instruction = [
			prompt,
			'',
			`Respond with JSON only — no prose, no markdown fences. Use exactly these keys: ${keys.join( ', ' )}.`,
			`Shape: ${JSON.stringify( schema )}`,
		].join( '\n' )

		const raw = await this.generate( instruction, opts )
		const parsed = parseJSONLoose( raw )

		if ( !parsed ) {

			// Never throw on an unparseable reply: degrade to the schema defaults and
			// hand the raw text back so the caller can still show something useful.
			return {
				...schema,
				advice : typeof schema.advice === 'string' ? stripFences( raw ) : schema.advice,
				_raw   : raw,
				_parsed : false,
			}

		}

		return {
			...schema,
			...parsed,
			_parsed : true,
		}

	}

	clearCache() {

		this._cache.clear()

	}

}

function stripFences( text ) {

	return String( text ).replace( /^\s*```(?:json)?\s*/i, '' ).replace( /\s*```\s*$/, '' ).trim()

}

/**
 * Parse JSON out of a model reply that may be fenced, prefixed with prose, or
 * both. Returns null when nothing object-shaped can be recovered.
 */
export function parseJSONLoose( text ) {

	if ( typeof text !== 'string' ) return null
	const cleaned = stripFences( text )

	try {

		const direct = JSON.parse( cleaned )
		return typeof direct === 'object' && direct !== null ? direct : null

	}
	catch { /* fall through to brace scanning */ }

	// Scan for the first balanced {...} block, respecting strings and escapes so a
	// brace inside an advice string doesn't truncate the object.
	const start = cleaned.indexOf( '{' )
	if ( start === -1 ) return null

	let depth = 0, inString = false, escaped = false
	for ( let i = start; i < cleaned.length; i++ ) {

		const ch = cleaned[ i ]

		if ( escaped ) {

			escaped = false
			continue

		}
		if ( ch === '\\' ) {

			escaped = true
			continue

		}
		if ( ch === '"' ) inString = !inString
		if ( inString ) continue

		if ( ch === '{' ) depth++
		else if ( ch === '}' ) {

			depth--
			if ( depth === 0 ) {

				try {

					return JSON.parse( cleaned.slice( start, i + 1 ) )

				}
				catch {

					return null

				}

			}

		}

	}

	return null

}
