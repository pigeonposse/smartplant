/**
 * Provider adapters.
 *
 * Every provider is a plain object with a `generate({ prompt, system, signal })`
 * method returning a string. Keeping them data-shaped (rather than subclasses)
 * means a user can register a custom backend without importing anything:
 *
 *   plant.ai.registerProvider('my-llm', { generate: async ({ prompt }) => '...' })
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { AIError } from '../core/errors.js'

const execFileAsync = promisify( execFile )

const DEFAULT_TIMEOUT = 60_000

async function postJSON( url, { headers, body, signal, timeout = DEFAULT_TIMEOUT } ) {

	// Compose the caller's signal with our own timeout so both can abort the call.
	const ctrl   = new AbortController()
	const timer  = setTimeout( () => ctrl.abort( new Error( `Timed out after ${timeout}ms` ) ), timeout )
	const onStop = () => ctrl.abort( signal?.reason )
	if ( signal ) signal.addEventListener( 'abort', onStop, { once : true } )

	try {

		const res = await fetch( url, {
			method  : 'POST',
			headers : {
				'Content-Type' : 'application/json',
				...headers,
			},
			body   : JSON.stringify( body ),
			signal : ctrl.signal,
		} )

		if ( !res.ok ) {

			const text = await res.text().catch( () => '' )
			throw new AIError( httpMessage( res.status, text ), {
				status : res.status,
				url,
				body   : text.slice( 0, 500 ),
			} )

		}

		return await res.json()

	}
	finally {

		clearTimeout( timer )
		if ( signal ) signal.removeEventListener( 'abort', onStop )

	}

}

function httpMessage( status, body ) {

	if ( status === 401 || status === 403 ) return `${status} - Invalid or missing API key.`
	if ( status === 429 ) return `${status} - Rate limit reached. Back off and retry.`
	if ( status === 404 ) return `${status} - Model or endpoint not found.`
	if ( status >= 500 ) return `${status} - Provider is unavailable right now.`
	return `${status} - ${body.slice( 0, 200 ) || 'Request failed'}`

}

/** Retryable failures: transient network / server-side conditions only. */
export function isRetryable( err ) {

	const status = err?.details?.status
	if ( status ) return status === 429 || status >= 500
	// Network-level failures (DNS, socket reset, abort-on-timeout) have no status.
	return err instanceof TypeError || /timed out|fetch failed|network|ECONN/i.test( err?.message || '' )

}

/** OpenAI-compatible chat completions. Covers OpenAI, xAI/Grok, and most local gateways. */
export function openAICompatible( {
	url, defaultModel, keyEnv, label,
} ) {

	return {
		label,
		needsKey     : true,
		keyEnv,
		defaultModel,
		async generate( {
			prompt, system, apiKey, model, signal, maxTokens = 800, temperature = 0.7,
		} ) {

			const messages = []
			if ( system ) messages.push( {
				role    : 'system',
				content : system,
			} )
			messages.push( {
				role    : 'user',
				content : prompt,
			} )

			const data = await postJSON( url, {
				headers : { Authorization : `Bearer ${apiKey}` },
				body    : {
					model      : model || defaultModel,
					messages,
					max_tokens : maxTokens,
					temperature,
				},
				signal,
			} )

			const text = data?.choices?.[ 0 ]?.message?.content
			if ( typeof text !== 'string' ) throw new AIError( `${label} returned an unexpected payload shape.`, { data } )
			return text.trim()

		},
	}

}

export const claude = {
	label        : 'Claude (Anthropic)',
	needsKey     : true,
	keyEnv       : 'ANTHROPIC_API_KEY',
	defaultModel : 'claude-sonnet-4-5',
	async generate( {
		prompt, system, apiKey, model, signal, maxTokens = 800, temperature = 0.7,
	} ) {

		const data = await postJSON( 'https://api.anthropic.com/v1/messages', {
			headers : {
				'x-api-key'         : apiKey,
				'anthropic-version' : '2023-06-01',
			},
			body : {
				model      : model || this.defaultModel,
				max_tokens : maxTokens,
				temperature,
				...( system ? { system } : {} ),
				messages : [ {
					role    : 'user',
					content : prompt,
				} ],
			},
			signal,
		} )

		const text = data?.content?.find( b => b.type === 'text' )?.text
		if ( typeof text !== 'string' ) throw new AIError( 'Claude returned an unexpected payload shape.', { data } )
		return text.trim()

	},
}

export const gemini = {
	label        : 'Gemini (Google)',
	needsKey     : true,
	keyEnv       : 'GEMINI_API_KEY',
	defaultModel : 'gemini-2.5-flash',
	async generate( {
		prompt, system, apiKey, model, signal, maxTokens = 800, temperature = 0.7,
	} ) {

		const id  = model || this.defaultModel
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent`
		const data = await postJSON( url, {
			// Key goes in a header, not the query string, so it never lands in logs.
			headers : { 'x-goog-api-key' : apiKey },
			body    : {
				contents : [ {
					role  : 'user',
					parts : [ { text : prompt } ],
				} ],
				...( system ? { systemInstruction : { parts : [ { text : system } ] } } : {} ),
				generationConfig : {
					maxOutputTokens : maxTokens,
					temperature,
				},
			},
			signal,
		} )

		const text = data?.candidates?.[ 0 ]?.content?.parts?.map( p => p.text ).filter( Boolean ).join( '' )
		if ( !text ) throw new AIError( 'Gemini returned an unexpected payload shape.', { data } )
		return text.trim()

	},
}

/**
 * Ollama. Prefers the HTTP API (streaming-free) and falls back to the CLI, so it
 * works both against a running daemon and a bare local install.
 */
export const ollama = {
	label        : 'Local (Ollama)',
	needsKey     : false,
	defaultModel : 'llama3.2',
	host         : process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
	async generate( {
		prompt, system, model, signal, temperature = 0.7,
	} ) {

		const id = model || this.defaultModel
		try {

			const data = await postJSON( `${this.host}/api/generate`, {
				body : {
					model  : id,
					prompt,
					system,
					stream : false,
					options : { temperature },
				},
				signal,
				timeout : 180_000, // local models on CPU are slow; be generous
			} )
			if ( typeof data?.response === 'string' ) return data.response.trim()

		}
		catch {

			// Daemon not reachable — fall through to the CLI.

		}

		// execFile (not execSync+string) keeps the prompt out of a shell, so quotes
		// and newlines in plant data can't break or inject into the command.
		const input = system ? `${system}\n\n${prompt}` : prompt
		try {

			const { stdout } = await execFileAsync( 'ollama', [ 'run', id ], {
				input,
				encoding  : 'utf-8',
				maxBuffer : 10 * 1024 * 1024,
			} )
			return stdout.trim()

		}
		catch ( err ) {

			throw new AIError( `Ollama is not reachable (tried ${this.host} and the CLI). Is it installed and running?`, { cause : err.message } )

		}

	},
	async listModels() {

		try {

			const res = await fetch( `${this.host}/api/tags` )
			if ( res.ok ) {

				const data = await res.json()
				return ( data.models || [] ).map( m => m.name )

			}

		}
		catch { /* fall through to CLI */ }

		try {

			const { stdout } = await execFileAsync( 'ollama', [ 'list' ], { encoding : 'utf-8' } )
			return stdout.split( '\n' ).slice( 1 ).map( l => l.split( /\s+/ )[ 0 ] ).filter( Boolean )

		}
		catch {

			return []

		}

	},
}

/**
 * Deterministic offline provider. Makes the whole library testable and usable
 * with zero API keys and zero network — the difference between "a demo you can
 * run" and "a demo you must sign up for".
 */
export const mock = {
	label        : 'Mock (offline)',
	needsKey     : false,
	defaultModel : 'mock',
	async generate( { prompt } ) {

		const wantsJSON = /respond with .*json|json only/i.test( prompt )
		if ( wantsJSON ) {

			return JSON.stringify( {
				advice    : 'Conditions look stable. Keep the current routine and check again tomorrow.',
				emoji     : '🌿',
				severity  : 'low',
				happiness : 78,
				reasons   : [ 'All readings sit inside the configured comfort ranges.' ],
			} )

		}
		return 'Conditions look stable. Keep the current routine and check again tomorrow. 🌿'

	},
}

/** Built-in provider table. */
export function builtinProviders() {

	return {
		openai : openAICompatible( {
			url          : 'https://api.openai.com/v1/chat/completions',
			defaultModel : 'gpt-4o-mini',
			keyEnv       : 'OPENAI_API_KEY',
			label        : 'OpenAI',
		} ),
		grok : openAICompatible( {
			url          : 'https://api.x.ai/v1/chat/completions',
			defaultModel : 'grok-2-latest',
			keyEnv       : 'XAI_API_KEY',
			label        : 'Grok (xAI)',
		} ),
		claude,
		gemini,
		ollama,
		// `local` kept as an alias: it is the provider id the 1.x CLI shipped with.
		local : ollama,
		mock,
	}

}
