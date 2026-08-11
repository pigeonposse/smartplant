/**
 * OpenClaw Gateway client.
 *
 * The Gateway is a local control plane that speaks OpenAI-compatible HTTP on
 * port 18789 by default. For SmartPlant that means one thing above all: **a way
 * to have AI with no API key and no Ollama install** — the models, the keys and
 * the routing all live in the Gateway the user already runs.
 *
 * Endpoints used here:
 *   GET  /v1/models        — what the Gateway can route to
 *   POST /v1/chat/completions — generation, and tool calling
 *   POST /v1/embeddings    — vectors for semantic memory
 */

import { AIError, SmartPlantError } from '../../core/errors.js'

export const DEFAULT_GATEWAY_URL  = 'http://127.0.0.1:18789'
export const DEFAULT_GATEWAY_PORT = 18789

export class OpenClawGateway {

	/**
	 * @param {object} [config]         - Options.
	 * @param {string} [config.url]     - Base URL. Default `http://127.0.0.1:18789`.
	 * @param {string} [config.token]   - Auth token. Falls back to `OPENCLAW_GATEWAY_TOKEN`.
	 * @param {string} [config.model]   - Model id to request.
	 * @param {number} [config.timeout] - Request timeout in ms.
	 */
	constructor( config = {} ) {

		this.url = ( config.url || process.env.OPENCLAW_URL || DEFAULT_GATEWAY_URL ).replace( /\/+$/, '' )
		// The Gateway requires auth by default; both names appear in its config.
		this.token = config.token
			|| process.env.OPENCLAW_GATEWAY_TOKEN
			|| process.env.OPENCLAW_GATEWAY_PASSWORD
			|| null
		this.model   = config.model || null
		this.timeout = config.timeout ?? 120_000

	}

	_headers() {

		return {
			'Content-Type' : 'application/json',
			...( this.token ? { Authorization : `Bearer ${this.token}` } : {} ),
		}

	}

	async _request( path, {
		method = 'POST', body, signal,
	} = {} ) {

		const ctrl  = new AbortController()
		const timer = setTimeout( () => ctrl.abort(), this.timeout )
		const onStop = () => ctrl.abort( signal?.reason )
		if ( signal ) signal.addEventListener( 'abort', onStop, { once : true } )

		try {

			const res = await fetch( `${this.url}${path}`, {
				method,
				headers : this._headers(),
				// Only attach a body when there is one: a GET carrying `body`
				// (even undefined) is invalid per the fetch spec.
				...( body ? { body : JSON.stringify( body ) } : {} ),
				signal  : ctrl.signal,
			} )

			if ( !res.ok ) {

				const text = await res.text().catch( () => '' )
				throw new AIError( this._explain( res.status, text ), {
					status : res.status,
					url : this.url,
				} )

			}

			return await res.json()

		}
		catch ( err ) {

			if ( err instanceof AIError ) throw err
			if ( err.name === 'AbortError' ) throw new AIError( `OpenClaw Gateway timed out after ${this.timeout}ms.`, { url : this.url } )

			throw new AIError(
				`Cannot reach the OpenClaw Gateway at ${this.url}. Is it running? (${err.message})`,
				{ url : this.url, cause : err.message },
			)

		}
		finally {

			clearTimeout( timer )
			if ( signal ) signal.removeEventListener( 'abort', onStop )

		}

	}

	_explain( status, body ) {

		if ( status === 401 || status === 403 ) {

			return `OpenClaw Gateway rejected the request (${status}). It requires auth by default — set OPENCLAW_GATEWAY_TOKEN, or pass { token }.`

		}
		if ( status === 404 ) return `OpenClaw Gateway has no such endpoint (404). Check the URL: ${this.url}`
		if ( status === 429 ) return 'OpenClaw Gateway is rate limiting.'
		if ( status >= 500 ) return `OpenClaw Gateway error ${status}. ${body.slice( 0, 200 )}`
		return `OpenClaw Gateway returned ${status}: ${body.slice( 0, 200 )}`

	}

	/**
	 * Is the Gateway reachable, and what can it route to?
	 *
	 * @returns {Promise<object>} `{ok, models, url}`.
	 */
	async health() {

		try {

			const data = await this._request( '/v1/models', { method : 'GET' } )
			const models = ( data?.data || [] ).map( m => m.id )

			return {
				ok : true,
				url : this.url,
				models,
				authenticated : !!this.token,
			}

		}
		catch ( err ) {

			return {
				ok : false,
				url : this.url,
				error : err.message,
				hint : this.token
					? 'Check the Gateway is running and the token is correct.'
					: 'The Gateway requires auth by default — set OPENCLAW_GATEWAY_TOKEN.',
			}

		}

	}

	/**
	 * Chat completion, optionally with tools.
	 *
	 * @param   {object[]}        messages       - OpenAI-shaped message list.
	 * @param   {object}          [opts]         - Options.
	 * @param   {object[]}        [opts.tools]   - Tool definitions.
	 * @param   {string}          [opts.model]   - Model override.
	 * @returns {Promise<object>}                The assistant message.
	 */
	async chat( messages, opts = {} ) {

		const body = {
			model       : opts.model || this.model || 'default',
			messages,
			temperature : opts.temperature ?? 0.7,
			max_tokens  : opts.maxTokens ?? 1200,
		}

		if ( opts.tools?.length ) {

			body.tools = opts.tools
			body.tool_choice = opts.toolChoice || 'auto'

		}

		const data = await this._request( '/v1/chat/completions', {
			body,
			signal : opts.signal,
		} )

		const message = data?.choices?.[ 0 ]?.message
		if ( !message ) throw new AIError( 'OpenClaw Gateway returned no message.', { data } )

		return message

	}

	/**
	 * Embed text through the Gateway.
	 *
	 * This is what lets semantic memory work with no API key at all — the same
	 * Gateway that supplies the brain supplies the vectors.
	 *
	 * @param   {string}                  text     - Input.
	 * @param   {object}                  [opts]   - Options.
	 * @returns {Promise<Float32Array>}            The embedding.
	 */
	async embed( text, opts = {} ) {

		const data = await this._request( '/v1/embeddings', {
			body : {
				model : opts.model || this.model || 'default',
				input : text,
			},
			signal : opts.signal,
		} )

		const vec = data?.data?.[ 0 ]?.embedding
		if ( !Array.isArray( vec ) ) throw new AIError( 'OpenClaw Gateway returned an unexpected embedding shape.', { data } )

		return Float32Array.from( vec )

	}

}

/**
 * An AI provider backed by the Gateway.
 *
 * Register it and SmartPlant reasons through OpenClaw instead of holding its
 * own key:
 *
 * @example
 * plant.ai.registerProvider( 'openclaw', openclawProvider() )
 * plant.ai.use( 'openclaw' )
 *
 * @param   {object} [config] - `OpenClawGateway` config.
 * @returns {object}          A provider for `AIService.registerProvider`.
 */
export function openclawProvider( config = {} ) {

	const gateway = new OpenClawGateway( config )

	return {
		label        : 'OpenClaw Gateway',
		// The Gateway holds the keys, so SmartPlant needs none of its own.
		needsKey     : false,
		defaultModel : config.model || 'default',
		gateway,

		async generate( {
			prompt, system, model, signal, maxTokens = 800, temperature = 0.7,
		} ) {

			const messages = []
			if ( system ) messages.push( {
				role : 'system',
				content : system,
			} )
			messages.push( {
				role : 'user',
				content : prompt,
			} )

			const message = await gateway.chat( messages, {
				model,
				signal,
				maxTokens,
				temperature,
			} )

			const text = message.content
			if ( typeof text !== 'string' ) throw new AIError( 'OpenClaw Gateway returned a non-text reply.', { message } )
			return text.trim()

		},
	}

}

/**
 * An embedder backed by the Gateway, for `VectorMemory` and `EpisodicMemory`.
 *
 * @example
 * const plant = await createPlant( {
 *   knowledge : { vectors : { embedder : openclawEmbedder() } },
 * } )
 *
 * @param   {object} [config] - `OpenClawGateway` config.
 * @returns {object}          An embedder with `embed(text)`.
 */
export function openclawEmbedder( config = {} ) {

	const gateway = config.gateway instanceof OpenClawGateway
		? config.gateway
		: new OpenClawGateway( config )

	return {
		id      : `openclaw:${config.model || 'default'}`,
		gateway,
		async embed( text ) {

			return gateway.embed( text, { model : config.model } )

		},
	}

}

export { SmartPlantError }
