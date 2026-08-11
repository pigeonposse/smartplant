/**
 * OpenClawBrain — the agent loop that puts OpenClaw in charge.
 *
 * This is the difference between "an AI that describes the plant" and "an AI
 * that runs the plant". The model is handed the plant's whole control surface as
 * tools and decides for itself what to look at, in what order, and what to do
 * about it. SmartPlant executes; OpenClaw reasons.
 *
 * The design principle that makes that survivable:
 *
 *   **The brain proposes. The safety layers dispose.**
 *
 * Every acting tool is routed through the same validators a human operator would
 * face — the evidence ledger, the safety supervisor, the spectral interlocks.
 * A refusal is not an error; it is fed back to the model as a tool result, so it
 * learns within the run why it cannot do the thing and reasons about what else
 * to try. That is far better than a hard failure, and far safer than obedience.
 *
 * Nothing here trusts the model with anything irreversible on its own say-so.
 */

import { EventBus } from '../../core/events.js'
import { RISK } from '../../confidence/index.js'
import { renderContext } from '../../memory/context.js'
import { OpenClawGateway } from './gateway.js'
import { findTool, selectTools, toolSchemas } from './tools.js'

const SYSTEM_PROMPT = `You are the reasoning system of a cyborg plant: a living plant fused with sensors, an electrode, a camera, spectral lighting and — sometimes — a body that can move.

You are not describing the plant to someone. You are operating it.

How to work:
- Start from evidence. Call plant_status, then whatever else you need. Never assume a reading you have not fetched.
- Rule-based findings from plant_diagnose are derived arithmetically from sensor data. Trust them over your own inference.
- Before anything irreversible, call plant_check_evidence. If it says no, do not argue — gather more evidence or explain to the human what is missing.
- When a tool refuses an action, the refusal is correct and the reason is real. Do not retry the same call. Reason about the constraint instead.
- Prefer the cheapest sufficient action. Doing nothing is often right.
- plant_emergency_stop is always available and never refused.

When you are done, reply in the plant's own voice: first person, warm, brief, grounded only in what you actually measured.`

export class OpenClawBrain {

	/**
	 * @param {object}  [config]              - Options.
	 * @param {object}  [config.gateway]      - `OpenClawGateway` config or instance.
	 * @param {object}  [config.plant]        - The plant to operate.
	 * @param {number}  [config.maxSteps]     - Tool-call rounds before stopping.
	 * @param {boolean} [config.readOnly]     - Withhold every acting tool.
	 * @param {string[]}[config.only]         - Restrict the toolset.
	 * @param {Function}[config.confirm]      - `(tool, params) => Promise<boolean>` for acting tools.
	 * @param {string}  [config.model]        - Model id.
	 */
	constructor( config = {} ) {

		this.gateway = config.gateway instanceof OpenClawGateway
			? config.gateway
			: new OpenClawGateway( config.gateway || {} )

		this.plant     = config.plant || null
		this.maxSteps  = config.maxSteps ?? 8
		this.readOnly  = config.readOnly ?? false
		this.only      = config.only || null
		this.confirm   = config.confirm || null
		this.model     = config.model || null
		this.systemPrompt = config.systemPrompt || SYSTEM_PROMPT

		this.events = new EventBus()
		/** Every run's trace, for auditing what the brain did and why. */
		this.runs   = []

	}

	attach( plant ) {

		this.plant = plant
		return this

	}

	on( event, fn ) {

		return this.events.on( event, fn )

	}

	/**
	 * Check the Gateway before relying on it.
	 *
	 * @returns {Promise<object>} `{ok, models, tools}`.
	 */
	async health() {

		const gw = await this.gateway.health()
		return {
			...gw,
			tools : selectTools( {
				readOnly : this.readOnly,
				only : this.only,
			} ).map( t => t.name ),
		}

	}

	/**
	 * Run the brain on a goal.
	 *
	 * @param   {string}          goal          - What to accomplish, in plain language.
	 * @param   {object}          [opts]        - Options.
	 * @param   {number}          [opts.maxSteps] - Override the step budget.
	 * @param   {boolean}         [opts.readOnly] - Withhold acting tools for this run.
	 * @returns {Promise<object>}               `{reply, steps, trace, refused, stopped}`.
	 */
	async run( goal, opts = {} ) {

		if ( !this.plant ) throw new Error( 'OpenClawBrain has no plant. Pass { plant } or call attach().' )

		const readOnly = opts.readOnly ?? this.readOnly
		const tools    = selectTools( {
			readOnly,
			only : opts.only || this.only,
		} )
		const schemas  = toolSchemas( {
			readOnly,
			only : opts.only || this.only,
		} )

		const ctx = this.plant.context()

		const messages = [
			{
				role : 'system',
				content : `${this.systemPrompt}\n\nCURRENT CONTEXT\n${renderContext( ctx )}`,
			},
			{
				role : 'user',
				content : goal,
			},
		]

		const trace   = []
		const refused = []
		const maxSteps = opts.maxSteps ?? this.maxSteps

		let step = 0
		let reply = null
		let stopped = null

		while ( step < maxSteps ) {

			step++

			const message = await this.gateway.chat( messages, {
				tools  : schemas.length ? schemas : undefined,
				model  : opts.model || this.model,
				signal : opts.signal,
			} )

			messages.push( message )

			const calls = message.tool_calls || []
			if ( !calls.length ) {

				reply = message.content?.trim() || ''
				break

			}

			for ( const call of calls ) {

				const outcome = await this._invoke( call, tools )

				trace.push( outcome )
				if ( outcome.refused ) refused.push( outcome )

				await this.events.emit( 'brain:tool', outcome )

				messages.push( {
					role         : 'tool',
					tool_call_id : call.id,
					content      : JSON.stringify( outcome.result ),
				} )

				// An emergency stop ends the run immediately: nothing the model
				// might say next is worth another round of tool calls.
				if ( call.function?.name === 'plant_emergency_stop' ) {

					stopped = outcome.result?.reason || 'emergency stop'

				}

			}

			if ( stopped ) {

				reply = `Stopped: ${stopped}`
				break

			}

		}

		if ( reply === null ) {

			// Out of steps. Ask for a plain answer with the tools withdrawn, so
			// the run always ends with something a human can read.
			const closing = await this.gateway.chat( [
				...messages,
				{
					role : 'user',
					content : 'You have run out of tool budget. Summarize what you found and what you recommend, in the plant\'s voice.',
				},
			], {
				model : opts.model || this.model,
				signal : opts.signal,
			} ).catch( () => null )

			reply = closing?.content?.trim() || 'The run ended without a conclusion.'

		}

		const run = {
			at      : new Date().toISOString(),
			goal,
			reply,
			steps   : step,
			trace,
			refused,
			stopped,
			readOnly,
		}

		this.runs.push( run )
		if ( this.runs.length > 100 ) this.runs.shift()

		await this.events.emit( 'brain:run', run )
		return run

	}

	/**
	 * Execute one tool call, through every gate that applies.
	 *
	 * @param   {object}          call  - The model's tool call.
	 * @param   {object[]}        tools - Tools available this run.
	 * @returns {Promise<object>}       `{tool, params, result, refused}`.
	 */
	async _invoke( call, tools ) {

		const name = call.function?.name
		const tool = findTool( name )

		if ( !tool || !tools.includes( tool ) ) {

			return {
				tool   : name,
				params : null,
				refused: true,
				result : {
					ok : false,
					error : `No tool named "${name}" is available in this run.`,
				},
			}

		}

		let params = {}
		try {

			params = call.function.arguments ? JSON.parse( call.function.arguments ) : {}

		}
		catch {

			return {
				tool   : name,
				params : call.function.arguments,
				refused: true,
				result : {
					ok : false,
					error : 'Arguments were not valid JSON.',
				},
			}

		}

		// ── gate 1: evidence ──────────────────────────────────────────────────
		// Only for acting tools that rest on a claim. A read never needs a
		// second opinion, and neither does an emergency stop.
		if ( tool.acts && tool.claim && this.plant.body?.evidence ) {

			const verdict = this.plant.justifies( tool.claim, tool.risk || RISK.MEDIUM )

			if ( !verdict.allowed ) {

				return {
					tool    : name,
					params,
					refused : true,
					gate    : 'evidence',
					result  : {
						ok      : false,
						refused : 'Not enough independent evidence for this action yet.',
						missing : verdict.missing,
						score   : verdict.score,
						advice  : 'Gather more evidence with other tools, or explain to the human what is missing. Do not retry this call.',
					},
				}

			}

		}

		// ── gate 2: human confirmation ────────────────────────────────────────
		if ( tool.acts && this.confirm ) {

			const ok = await this.confirm( tool, params ).catch( () => false )
			if ( !ok ) {

				return {
					tool    : name,
					params,
					refused : true,
					gate    : 'human',
					result  : {
						ok : false,
						refused : 'A human declined this action.',
					},
				}

			}

		}

		// ── execute; gate 3 lives inside the subsystems themselves ────────────
		try {

			const result = await tool.handler( this.plant, params )

			// The subsystem may have refused on its own (spectral interlocks, the
			// safety supervisor). That is still a refusal worth surfacing.
			const refused = result?.applied === false || !!result?.refused

			return {
				tool    : name,
				params,
				refused,
				gate    : refused ? 'subsystem' : null,
				result  : {
					ok : !refused,
					...result,
				},
			}

		}
		catch ( err ) {

			// Never throw out of the loop: hand the failure back as data so the
			// model can route around it.
			return {
				tool    : name,
				params,
				refused : true,
				gate    : 'error',
				result  : {
					ok : false,
					error : err.message,
				},
			}

		}

	}

	/**
	 * Have the brain look after the plant on a schedule.
	 *
	 * @param   {object}   [opts]           - Options.
	 * @param   {number}   [opts.intervalMs]- How often. Default 6h.
	 * @param   {string}   [opts.goal]      - The standing instruction.
	 * @returns {Function}                  Stop function.
	 */
	supervise( opts = {} ) {

		const intervalMs = opts.intervalMs ?? 6 * 3600_000
		const goal = opts.goal
			|| 'Check on the plant. Investigate anything that looks wrong, act only if the evidence supports it, and report briefly.'

		const tick = async () => {

			try {

				await this.run( goal, opts )

			}
			catch ( err ) {

				await this.events.emit( 'brain:error', { error : err } )

			}

		}

		void tick()
		const timer = setInterval( tick, intervalMs )
		timer.unref?.()

		return () => clearInterval( timer )

	}

	/** What the brain has done: calls, refusals and which gate stopped them. */
	stats() {

		const calls = this.runs.flatMap( r => r.trace )
		const byGate = {}
		for ( const c of calls ) if ( c.gate ) byGate[ c.gate ] = ( byGate[ c.gate ] || 0 ) + 1

		return {
			runs      : this.runs.length,
			toolCalls : calls.length,
			refused   : calls.filter( c => c.refused ).length,
			byGate,
			mostUsed  : Object.entries(
				calls.reduce( ( a, c ) => ( {
					...a,
					[ c.tool ] : ( a[ c.tool ] || 0 ) + 1,
				} ), {} ),
			).sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 5 ),
		}

	}

}
