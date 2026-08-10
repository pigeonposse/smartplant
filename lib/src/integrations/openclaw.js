/**
 * OpenClaw integration.
 *
 * OpenClaw (https://github.com/openclaw/openclaw) is a local personal-AI gateway
 * in TypeScript: it holds sessions, tools and channel connections, and reaches
 * you over WhatsApp, Telegram, Slack, Discord and the rest. It is **not** a
 * board framework and does not run on a microcontroller — it needs Node. On a
 * Raspberry Pi it runs fine; on an Arduino it cannot.
 *
 * So the integration that makes sense is the one this file provides:
 *
 *   1. **SmartPlant as an OpenClaw plugin** — your plant becomes a set of tools
 *      the assistant can call, so you can message your plant from WhatsApp and
 *      it answers with real sensor data.
 *   2. **OpenClaw as an AI provider** — SmartPlant routes its reasoning through
 *      your existing gateway instead of holding separate API keys.
 *
 * The tool definitions here are plain data. `generatePlugin()` emits a complete
 * OpenClaw plugin package around them; nothing in the core depends on OpenClaw
 * being installed.
 */

import { SmartPlantError } from '../core/errors.js'

/**
 * The tools a plant exposes to an assistant.
 *
 * Each carries a JSON-Schema-shaped `parameters` block and a `handler` that
 * takes `(plant, params)`. `generatePlugin` converts the schema to the TypeBox
 * form OpenClaw's SDK expects; `createToolHandlers` binds them for direct use.
 */
export const PLANT_TOOLS = [
	{
		name        : 'plant_status',
		description : 'Get the current status of the plant: wellbeing, all sensor readings, and how long since it was watered.',
		parameters  : { type : 'object', properties : {} },
		async handler( plant ) {

			await plant.read().catch( () => {} )
			const ctx = plant.context()

			return {
				status    : plant.status(),
				wellbeing : ctx.happiness,
				readings  : ctx.current,
				outOfRange: ctx.deviations.map( d => `${d.metric} ${d.direction}` ),
				daysSinceWater : ctx.care?.daysSinceWater ?? null,
			}

		},
	},
	{
		name        : 'plant_ask',
		description : 'Ask the plant a question. It answers in first person using its real sensor readings and history.',
		parameters  : {
			type : 'object',
			properties : { question : {
				type : 'string',
				description : 'What to ask the plant.',
			} },
			required : [ 'question' ],
		},
		async handler( plant, params ) {

			await plant.read().catch( () => {} )
			return { reply : await plant.speak( params.question ) }

		},
	},
	{
		name        : 'plant_diagnose',
		description : 'Run the rule-based diagnosis. Returns conditions with confidence, the observations behind each, and suggested treatments.',
		parameters  : { type : 'object', properties : {} },
		async handler( plant ) {

			await plant.read().catch( () => {} )
			const d = plant.diagnose()

			return {
				conclusions : d.conclusions.map( c => ( {
					condition : c.conclusion,
					confidence: c.confidence,
					because   : c.because,
				} ) ),
				treatments : d.treatments.map( t => t.treatment ),
				explanation: d.explanation,
			}

		},
	},
	{
		name        : 'plant_water',
		description : 'Record that the plant was watered. Use this after you actually water it, so future advice accounts for it.',
		parameters  : {
			type : 'object',
			properties : { amountMl : {
				type : 'number',
				description : 'Millilitres given.',
			} },
		},
		async handler( plant, params ) {

			const event = await plant.water( { amount : params.amountMl } )
			return {
				recorded : true,
				at : event.t,
			}

		},
	},
	{
		name        : 'plant_history',
		description : 'Get statistics and trends for the plant over a time window.',
		parameters  : {
			type : 'object',
			properties : { hours : {
				type : 'number',
				description : 'Window in hours. Default 24.',
			} },
		},
		async handler( plant, params ) {

			const hours = params.hours ?? 24
			return {
				hours,
				readings : plant.memory.since( hours ).length,
				stats    : plant.memory.stats( hours ),
			}

		},
	},
	{
		name        : 'plant_diary',
		description : 'Have the plant write a short diary entry about the recent period, in its own voice.',
		parameters  : { type : 'object', properties : {} },
		async handler( plant ) {

			await plant.read().catch( () => {} )
			const entry = await plant.speak(
				'Write a short diary entry about the last day, in your own voice, based on what actually happened.',
				{ persona : 'plant' },
			)
			await plant.memory.addNote( entry, 'plant' )
			return { entry }

		},
	},
	{
		name        : 'plant_hardware',
		description : 'Scan the host for boards, sensors and cameras, and recommend a SmartPlant configuration.',
		parameters  : { type : 'object', properties : {} },
		async handler() {

			const { scan, recommend } = await import( '../hardware/index.js' )
			const report = await scan()

			return {
				board      : report.board.label,
				serial     : report.serial.map( p => `${p.path} (${p.label})` ),
				i2c        : report.i2c.map( d => `${d.address} ${d.name}` ),
				camera     : report.camera.available,
				suggestion : recommend( report ),
			}

		},
	},
]

/**
 * Bind the tools to a plant, ready to call.
 *
 * @param   {object} plant   - A `SmartPlant` instance.
 * @param   {object} [opts]  - Options.
 * @param   {string[]} [opts.only] - Restrict to these tool names.
 * @returns {object[]}       `[{name, description, parameters, execute}]`.
 */
export function createToolHandlers( plant, opts = {} ) {

	if ( !plant ) throw new SmartPlantError( 'createToolHandlers needs a plant.', 'CONFIG_ERROR' )

	return PLANT_TOOLS
		.filter( t => !opts.only || opts.only.includes( t.name ) )
		.map( tool => ( {
			name        : tool.name,
			description : tool.description,
			parameters  : tool.parameters,
			async execute( params = {} ) {

				try {

					const result = await tool.handler( plant, params )
					return {
						ok : true,
						...result,
					}

				}
				catch ( err ) {

					// A tool that throws inside an assistant turn is a bad experience;
					// return the failure as data so the model can explain it.
					return {
						ok : false,
						error : err.message,
					}

				}

			},
		} ) )

}

/**
 * Generate a complete OpenClaw plugin package.
 *
 * Emits the three files OpenClaw's plugin SDK expects: a `package.json` with the
 * `openclaw` block, an `openclaw.plugin.json` manifest declaring the tool
 * contracts, and an entry point using `definePluginEntry` + `api.registerTool`.
 *
 * @param   {object} [config]              - Options.
 * @param   {string} [config.id]           - Plugin id.
 * @param   {string} [config.name]         - Display name.
 * @param   {string} [config.packageName]  - npm package name.
 * @param   {object} [config.plant]        - Plant config baked into the plugin.
 * @param   {string[]} [config.tools]      - Restrict to these tools.
 * @param   {string} [config.pluginApi]    - Required plugin API range.
 * @returns {object}                       Path → file contents.
 */
export function generatePlugin( config = {} ) {

	const id          = config.id || 'smartplant'
	const name        = config.name || 'SmartPlant'
	const packageName = config.packageName || '@smartplant/openclaw-plugin'
	const pluginApi   = config.pluginApi || '>=2026.3.24-beta.2'

	const tools = PLANT_TOOLS.filter( t => !config.tools || config.tools.includes( t.name ) )

	const plantConfig = {
		name    : 'Rosa',
		species : 'Monstera deliciosa',
		sensor  : 'mock',
		ai      : { provider : 'mock' },
		memory  : { path : './smartplant.json' },
		...config.plant,
	}

	const pkg = {
		name    : packageName,
		version : '1.0.0',
		description : 'Talk to your plants from any OpenClaw channel.',
		type    : 'module',
		peerDependencies : {
			openclaw : pluginApi,
		},
		dependencies : { smartplant : '^3.0.0' },
		openclaw : {
			extensions : [ './index.js' ],
			compat     : { pluginApi },
		},
		license : 'MIT',
	}

	const manifest = {
		id,
		name,
		description : 'Sensor readings, diagnosis and conversation for your plants.',
		contracts   : { tools : tools.map( t => t.name ) },
		activation  : { onStartup : true },
	}

	const entry = `/**
 * ${name} — OpenClaw plugin.
 *
 * Generated by SmartPlant. Registers ${tools.length} tool(s) so the assistant can
 * read, diagnose and talk to your plants from any connected channel.
 *
 * Edit PLANT_CONFIG below to point at your real sensor and AI provider.
 */

import { definePluginEntry } from 'openclaw/plugin'
import { Type } from '@sinclair/typebox'
import { createPlant } from 'smartplant'
import { createToolHandlers } from 'smartplant/integrations/openclaw'

const PLANT_CONFIG = ${JSON.stringify( plantConfig, null, 2 ).split( '\n' ).join( '\n' )}

// One shared plant across the process: the memory file and the sensor
// connection should not be opened once per tool call.
let plantPromise = null
const getPlant = () => {

	if ( !plantPromise ) plantPromise = createPlant( PLANT_CONFIG )
	return plantPromise

}

export default definePluginEntry( {
	id          : ${JSON.stringify( id )},
	name        : ${JSON.stringify( name )},
	description : 'Sensor readings, diagnosis and conversation for your plants.',

	register( api ) {

${tools.map( t => `		api.registerTool( {
			name        : ${JSON.stringify( t.name )},
			description : ${JSON.stringify( t.description )},
			parameters  : ${typeboxFor( t.parameters )},
			async execute( _id, params ) {

				const plant = await getPlant()
				const [ tool ] = createToolHandlers( plant, { only : [ ${JSON.stringify( t.name )} ] } )
				const result = await tool.execute( params || {} )

				return {
					content : [ { type : 'text', text : JSON.stringify( result, null, 2 ) } ],
					details : result,
				}

			},
		} )` ).join( '\n\n' )}

	},
} )
`

	const readme = `# ${name} — OpenClaw plugin

Talk to your plants from WhatsApp, Telegram, Slack, Discord — any channel your
OpenClaw gateway is connected to.

## Install

\`\`\`bash
npm install ${packageName}
\`\`\`

Then register it with your gateway (see the OpenClaw plugin docs for the exact
command in your version).

## Configure

Edit \`PLANT_CONFIG\` in \`index.js\`:

\`\`\`js
const PLANT_CONFIG = {
  name    : 'Rosa',
  species : 'Monstera deliciosa',
  sensor  : { driver: 'serial', path: '/dev/ttyUSB0' },   // your real sensor
  ai      : { provider: 'ollama' },
  memory  : { path: './smartplant.json' },
}
\`\`\`

Not sure what hardware you have? Ask the assistant to run \`plant_hardware\`, or
run \`smartplant hardware\` in a terminal.

## Tools

${tools.map( t => `- **${t.name}** — ${t.description}` ).join( '\n' )}

## Try it

> "How's Rosa doing?"
> "Ask my plant how it feels about the new spot"
> "Diagnose Rosa"
> "I just watered Rosa, 200ml"
`

	return {
		'package.json'         : JSON.stringify( pkg, null, 2 ) + '\n',
		'openclaw.plugin.json' : JSON.stringify( manifest, null, 2 ) + '\n',
		'index.js'             : entry,
		'README.md'            : readme,
	}

}

/** Render a JSON-Schema-ish parameter block as a TypeBox expression. */
function typeboxFor( schema ) {

	const props = schema?.properties || {}
	const required = schema?.required || []

	if ( !Object.keys( props ).length ) return 'Type.Object( {} )'

	const fields = Object.entries( props ).map( ( [ key, def ] ) => {

		const base = def.type === 'number'
			? 'Type.Number()'
			: def.type === 'boolean' ? 'Type.Boolean()' : 'Type.String()'

		const withDesc = def.description
			? base.replace( ')', `{ description: ${JSON.stringify( def.description )} } )` )
			: base

		return `\t\t\t\t${key} : ${required.includes( key ) ? withDesc : `Type.Optional( ${withDesc} )`}`

	} )

	return `Type.Object( {\n${fields.join( ',\n' )},\n\t\t\t} )`

}

/**
 * Use an OpenClaw gateway as SmartPlant's AI provider.
 *
 * Lets the plant reason through the same models and keys the rest of your
 * assistant already uses, instead of holding its own.
 *
 * @param   {object} [config]         - Options.
 * @param   {string} [config.url]     - Gateway base URL.
 * @param   {string} [config.apiKey]  - Gateway token, if it requires one.
 * @param   {string} [config.model]   - Model to request.
 * @param   {string} [config.path]    - Chat completions path.
 * @returns {object}                  A provider for `plant.ai.registerProvider`.
 */
export function openclawProvider( config = {} ) {

	const url    = ( config.url || process.env.OPENCLAW_URL || 'http://localhost:4747' ).replace( /\/+$/, '' )
	const path   = config.path || '/v1/chat/completions'
	const apiKey = config.apiKey || process.env.OPENCLAW_TOKEN

	return {
		label        : 'OpenClaw gateway',
		needsKey     : false,
		defaultModel : config.model || 'default',

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

			const res = await fetch( `${url}${path}`, {
				method  : 'POST',
				headers : {
					'Content-Type' : 'application/json',
					...( apiKey ? { Authorization : `Bearer ${apiKey}` } : {} ),
				},
				body : JSON.stringify( {
					model : model || config.model || 'default',
					messages,
					max_tokens : maxTokens,
					temperature,
				} ),
				signal,
			} )

			if ( !res.ok ) {

				const text = await res.text().catch( () => '' )
				throw new SmartPlantError(
					`OpenClaw gateway returned HTTP ${res.status}. Is it running at ${url}? ${text.slice( 0, 200 )}`,
					'AI_ERROR',
					{ status : res.status },
				)

			}

			const data = await res.json()
			const out = data?.choices?.[ 0 ]?.message?.content ?? data?.content ?? data?.text

			if ( typeof out !== 'string' ) {

				throw new SmartPlantError( 'OpenClaw gateway returned an unexpected payload shape.', 'AI_ERROR', { data } )

			}

			return out.trim()

		},
	}

}
