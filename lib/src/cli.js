#!/usr/bin/env node
/**
 * SmartPlant CLI.
 *
 * Two modes:
 *   `smartplant`           interactive setup + live monitoring
 *   `smartplant <command>` one-shot commands for scripts and cron
 *
 * The interactive path never requires hardware or an API key: it offers the mock
 * sensor and the offline voice, so the tool is usable the moment it is installed.
 */

import chalk from 'chalk'
import enquirer from 'enquirer'

import { builtinProviders, ollama } from './ai/providers.js'
import { createPlant } from './core/kernel.js'
import { EVENTS } from './core/events.js'
import { LANGUAGE_NAMES } from './language/index.js'
import { PERSONAS } from './voice/persona.js'

const DEFAULT_MEMORY = './smartplant.json'

const HELP = `
${chalk.bold.green( '🌿 SmartPlant' )} — a bridge between AI and plants

${chalk.bold( 'Usage' )}
  smartplant                        Interactive setup and live monitoring
  smartplant status                 Print one status line and exit
  smartplant ask "<question>"       Ask the plant a question
  smartplant diary                  Write today's diary entry
  smartplant water [--amount 30]    Record a watering
  smartplant history [--hours 72]   Show stored trends
  smartplant providers              List AI providers and key status
  smartplant sensors                List available sensor drivers
  smartplant hardware               Scan this machine for boards and sensors
  smartplant openclaw [dir]         Generate an OpenClaw plugin for your plant
  smartplant brain "<goal>"         Let an OpenClaw brain operate the plant

${chalk.bold( 'Options' )}
  --memory <path>     Memory file (default: ${DEFAULT_MEMORY})
  --sensor <id>       mock | manual | serial | mqtt | http | homeassistant
  --provider <id>     gemini | openai | claude | grok | ollama | mock
  --model <id>        Model override
  --language <code>   ${Object.keys( LANGUAGE_NAMES ).join( ' | ' )}
  --persona <id>      ${Object.keys( PERSONAS ).join( ' | ' )}
  --interval <ms>     Monitoring interval (default 60000)
  --help, -h          Show this help

${chalk.dim( 'API keys are read from the environment: GEMINI_API_KEY, OPENAI_API_KEY,' )}
${chalk.dim( 'ANTHROPIC_API_KEY, XAI_API_KEY. Ollama and the mock provider need none.' )}
`

/** Minimal flag parser: `--key value` and `--flag`. */
function parseArgs( argv ) {

	const flags = {}
	const positional = []

	for ( let i = 0; i < argv.length; i++ ) {

		const arg = argv[ i ]
		if ( arg.startsWith( '--' ) ) {

			const key = arg.slice( 2 )
			const next = argv[ i + 1 ]
			if ( next === undefined || next.startsWith( '--' ) ) flags[ key ] = true
			else {

				flags[ key ] = next
				i++

			}

		}
		else if ( arg === '-h' ) flags.help = true
		else positional.push( arg )

	}

	return {
		flags,
		positional,
	}

}

function configFrom( flags ) {

	return {
		language : flags.language || 'en',
		persona  : flags.persona || 'plant',
		interval : Number( flags.interval ) || 60_000,
		sensor   : flags.sensor || 'mock',
		memory   : { path : flags.memory || DEFAULT_MEMORY },
		ai       : {
			provider : flags.provider || defaultProvider(),
			model    : flags.model || null,
		},
	}

}

/** Pick a provider that can actually run, so the CLI works out of the box. */
function defaultProvider() {

	const providers = builtinProviders()
	for ( const id of [ 'gemini', 'openai', 'claude', 'grok' ] ) {

		if ( process.env[ providers[ id ].keyEnv ] ) return id

	}
	return 'ollama'

}

async function main() {

	const { flags, positional } = parseArgs( process.argv.slice( 2 ) )
	const command = positional[ 0 ]

	if ( flags.help ) {

		console.log( HELP )
		return

	}

	switch ( command ) {

		case undefined      : return interactive( flags )
		case 'status'       : return cmdStatus( flags )
		case 'ask'          : return cmdAsk( flags, positional.slice( 1 ).join( ' ' ) )
		case 'diary'        : return cmdDiary( flags )
		case 'water'        : return cmdWater( flags )
		case 'history'      : return cmdHistory( flags )
		case 'providers'    : return cmdProviders()
		case 'sensors'      : return cmdSensors( flags )
		case 'hardware'     : return cmdHardware( flags )
		case 'openclaw'     : return cmdOpenclaw( flags, positional[ 1 ] )
		case 'brain'        : return cmdBrain( flags, positional.slice( 1 ).join( ' ' ) )
		default:
			console.log( chalk.red( `Unknown command "${command}".` ) )
			console.log( HELP )
			process.exitCode = 1

	}

}

// ── one-shot commands ────────────────────────────────────────────────────────

async function cmdStatus( flags ) {

	const plant = await createPlant( configFrom( flags ) )
	await plant.read().catch( err => console.log( chalk.yellow( `Sensor: ${err.message}` ) ) )
	console.log( plant.status() )
	await plant.destroy()

}

async function cmdAsk( flags, question ) {

	if ( !question ) {

		console.log( chalk.red( 'Usage: smartplant ask "how are you?"' ) )
		process.exitCode = 1
		return

	}

	const plant = await createPlant( configFrom( flags ) )
	await plant.read().catch( () => {} )
	console.log( chalk.dim( plant.status() ) )
	console.log()
	console.log( chalk.green( await plant.speak( question ) ) )
	await plant.destroy()

}

async function cmdDiary( flags ) {

	const plant = await createPlant( configFrom( flags ) )
	await plant.read().catch( () => {} )

	// Written inline rather than through @smartplant/diary so the CLI keeps
	// working on a bare `smartplant` install with no plugins present.
	const entry = await plant.speak(
		'Write a short diary entry for today in your own voice, based on what actually happened.',
		{ persona : 'plant' },
	)
	await plant.memory.addNote( entry, 'plant' )
	console.log( chalk.green( entry ) )
	await plant.destroy()

}

async function cmdWater( flags ) {

	const plant = await createPlant( configFrom( flags ) )
	const event = await plant.water( { amount : Number( flags.amount ) || undefined } )
	console.log( chalk.blue( `💧 Watering recorded at ${new Date( event.t ).toLocaleString()}` ) )
	await plant.destroy()

}

async function cmdHistory( flags ) {

	const hours = Number( flags.hours ) || 72
	const plant = await createPlant( configFrom( flags ) )
	const stats = plant.memory.stats( hours )

	if ( !Object.keys( stats ).length ) {

		console.log( chalk.yellow( `No readings stored in the last ${hours}h.` ) )

	}
	else {

		console.log( chalk.bold( `\nLast ${hours}h (${plant.memory.since( hours ).length} readings)\n` ) )
		for ( const [ metric, s ] of Object.entries( stats ) ) {

			const arrow = s.trend > 0.05 ? chalk.red( '↑' ) : s.trend < -0.05 ? chalk.blue( '↓' ) : chalk.dim( '→' )
			console.log( `  ${metric.padEnd( 13 )} avg ${String( s.avg ).padStart( 7 )}   min ${String( s.min ).padStart( 6 )}   max ${String( s.max ).padStart( 6 )}   ${arrow}` )

		}
		console.log()

	}
	await plant.destroy()

}

async function cmdProviders() {

	const providers = builtinProviders()
	console.log( chalk.bold( '\nAI providers\n' ) )
	for ( const [ id, p ] of Object.entries( providers ) ) {

		if ( id === 'local' ) continue // alias of ollama
		const ready = !p.needsKey || !!process.env[ p.keyEnv ]
		const mark  = ready ? chalk.green( '●' ) : chalk.dim( '○' )
		const note  = p.needsKey ? ( ready ? `key from ${p.keyEnv}` : `set ${p.keyEnv}` ) : 'no key needed'
		console.log( `  ${mark} ${id.padEnd( 10 )} ${( p.label || '' ).padEnd( 22 )} ${chalk.dim( note )}` )

	}
	console.log()

}

async function cmdSensors( flags ) {

	const plant = await createPlant( {
		...configFrom( flags ),
		sensor : null,
	} )
	console.log( chalk.bold( '\nSensor drivers\n' ) )
	for ( const id of plant.sensors.list() ) console.log( `  • ${id}` )
	console.log( chalk.dim( '\n  mock and manual need no hardware.\n' ) )
	await plant.destroy()

}

async function cmdHardware() {

	const { scan, recommend, formatScan } = await import( './hardware/index.js' )

	console.log( chalk.dim( '\nScanning...' ) )
	const report = await scan()
	const suggestion = recommend( report )

	console.log()
	console.log( formatScan( report, suggestion ) )

	if ( suggestion.firmware ) {

		console.log( chalk.dim( `\n  Generate matching firmware with:` ) )
		console.log( chalk.dim( `  node -e "import('smartplant/firmware').then(m=>console.log(m.generateProject(${JSON.stringify( suggestion.firmware )})['src/main.cpp']))"` ) )

	}
	console.log()

}

async function cmdOpenclaw( flags, dir ) {

	const { generatePlugin } = await import( './integrations/openclaw/index.js' )
	const { mkdir, writeFile } = await import( 'node:fs/promises' )
	const { dirname, join } = await import( 'node:path' )

	const target = dir || './smartplant-openclaw-plugin'
	const files = generatePlugin( { plant : {
		name    : flags.name || 'Rosa',
		species : flags.species || 'Monstera deliciosa',
		sensor  : flags.sensor || 'mock',
		ai      : { provider : flags.provider || 'ollama' },
		memory  : { path : './smartplant.json' },
	} } )

	for ( const [ path, content ] of Object.entries( files ) ) {

		const full = join( target, path )
		await mkdir( dirname( full ), { recursive : true } )
		await writeFile( full, content, 'utf-8' )

	}

	console.log( chalk.green( `\n🦞 OpenClaw plugin written to ${target}\n` ) )
	for ( const path of Object.keys( files ) ) console.log( `  ${path}` )
	console.log( chalk.dim( '\n  Edit PLANT_CONFIG in index.js, then register it with your gateway.\n' ) )

}

async function cmdBrain( flags, goal ) {

	const plant = await createPlant( configFrom( flags ) )

	const brain = await plant.useBrain( {
		gateway  : {
			url : flags.gateway,
			token : flags.token,
		},
		readOnly : !!flags[ 'read-only' ],
	} )

	const health = await brain.health()
	if ( !health.ok ) {

		console.log( chalk.red( `\n❌ ${health.error}` ) )
		console.log( chalk.dim( `   ${health.hint}\n` ) )
		await plant.destroy()
		process.exitCode = 1
		return

	}

	console.log( chalk.dim( `\n🦞 Gateway at ${health.url} — ${health.models.length} model(s), ${health.tools.length} tool(s)\n` ) )

	brain.on( 'brain:tool', t => {

		console.log( t.refused
			? chalk.yellow( `  → ${t.tool} refused (${t.gate})` )
			: chalk.dim( `  → ${t.tool}` ) )

	} )

	const run = await brain.run(
		goal || 'Check on the plant and report. Act only if the evidence supports it.',
	)

	console.log( '\n' + chalk.green( run.reply ) + '\n' )
	await plant.destroy()

}

// ── interactive ──────────────────────────────────────────────────────────────

async function interactive( flags ) {

	console.log( chalk.bold.green( '\n🌿 SmartPlant\n' ) )

	const { language } = await enquirer.prompt( {
		type    : 'select',
		name    : 'language',
		message : 'Language',
		choices : Object.entries( LANGUAGE_NAMES ).map( ( [ value, message ] ) => ( {
			name : value,
			message,
		} ) ),
	} )

	const { sensor } = await enquirer.prompt( {
		type    : 'select',
		name    : 'sensor',
		message : 'How are you measuring the plant?',
		choices : [
			{
				name : 'mock',
				message : 'Simulated (no hardware — recommended to try it)',
			},
			{
				name : 'manual',
				message : 'I will enter the values myself',
			},
			{
				name : 'serial',
				message : 'Arduino / ESP32 over USB',
			},
			{
				name : 'homeassistant',
				message : 'Home Assistant',
			},
			{
				name : 'mqtt',
				message : 'MQTT broker',
			},
		],
	} )

	const sensorConfig = await sensorSetup( sensor )

	const providers = builtinProviders()
	const { provider } = await enquirer.prompt( {
		type    : 'select',
		name    : 'provider',
		message : 'AI provider',
		choices : Object.entries( providers )
			.filter( ( [ id ] ) => id !== 'local' )
			.map( ( [ id, p ] ) => {

				const ready = !p.needsKey || !!process.env[ p.keyEnv ]
				return {
					name    : id,
					message : `${p.label}${ready ? '' : chalk.dim( `  (needs ${p.keyEnv})` )}`,
				}

			} ),
	} )

	let apiKey = null
	let model  = null
	const chosen = providers[ provider ]

	if ( chosen.needsKey && !process.env[ chosen.keyEnv ] ) {

		const answer = await enquirer.prompt( {
			type    : 'password',
			name    : 'key',
			message : `${chosen.keyEnv} (leave empty to run offline)`,
		} )
		apiKey = answer.key || null

	}

	if ( provider === 'ollama' ) {

		const models = await ollama.listModels()
		if ( models.length ) {

			( { model } = await enquirer.prompt( {
				type    : 'select',
				name    : 'model',
				message : 'Local model',
				choices : models,
			} ) )

		}
		else console.log( chalk.yellow( 'No Ollama models found — the plant will use its offline voice.' ) )

	}

	const { persona } = await enquirer.prompt( {
		type    : 'select',
		name    : 'persona',
		message : 'How should it talk to you?',
		choices : Object.entries( PERSONAS ).map( ( [ value, p ] ) => ( {
			name : value,
			message : p.label,
		} ) ),
	} )

	const { name } = await enquirer.prompt( {
		type    : 'input',
		name    : 'name',
		message : 'Plant name',
	} )

	const { species } = await enquirer.prompt( {
		type    : 'input',
		name    : 'species',
		message : 'Species (optional, improves advice)',
	} )

	const { type } = await enquirer.prompt( {
		type    : 'select',
		name    : 'type',
		message : 'Indoor or outdoor?',
		choices : [ {
			name : 'indoor',
			message : 'Indoor',
		}, {
			name : 'outdoor',
			message : 'Outdoor',
		} ],
	} )

	const plant = await createPlant( {
		name,
		species : species || name,
		type,
		language,
		persona,
		interval : Number( flags.interval ) || 60_000,
		sensor   : {
			driver : sensor,
			...sensorConfig,
		},
		memory   : { path : flags.memory || DEFAULT_MEMORY },
		ai       : {
			provider,
			apiKey,
			model,
		},
	} )

	if ( plant.ai.ready ) {

		console.log( chalk.dim( '\n🔍 Learning about this species...' ) )
		const profile = await plant.learnSpecies().catch( () => null )
		if ( profile && !profile.generic ) console.log( chalk.green( '✅ Care profile stored.\n' ) )
		else console.log( chalk.yellow( '⚠️  Using generic comfort ranges.\n' ) )

	}
	else console.log( chalk.yellow( '\n⚠️  No AI configured — running with the offline voice.\n' ) )

	plant.on( EVENTS.ALERT, e => {

		if ( e.critical ) console.log( chalk.red( `🔔 ${e.metric} ${e.direction}: ${e.value}${e.unit} (ideal ${e.range.min}-${e.range.max}${e.unit})` ) )

	} )
	plant.on( EVENTS.ERROR, e => console.log( chalk.dim( `   (${e.stage || 'error'}: ${e.error?.message})` ) ) )

	await plant.startMonitoring()
	console.log( plant.status() )
	console.log( chalk.dim( '\n  [t] talk   [w] water   [h] history   [q] quit\n' ) )

	plant.on( EVENTS.READING, () => console.log( plant.status() ) )

	attachKeys( plant )

}

/** Collect the extra config a driver needs before it can connect. */
async function sensorSetup( sensor ) {

	if ( sensor === 'serial' ) {

		const { path } = await enquirer.prompt( {
			type    : 'input',
			name    : 'path',
			message : 'Serial port',
			initial : process.platform === 'win32' ? 'COM3' : '/dev/ttyACM0',
		} )
		return { path }

	}

	if ( sensor === 'homeassistant' ) {

		const answers = await enquirer.prompt( [
			{
				type    : 'input',
				name    : 'url',
				message : 'Home Assistant URL',
				initial : process.env.HASS_URL || 'http://homeassistant.local:8123',
			},
			{
				type    : 'password',
				name    : 'token',
				message : 'Long-lived access token',
			},
			{
				type    : 'input',
				name    : 'soil',
				message : 'Soil moisture entity id (optional)',
			},
			{
				type    : 'input',
				name    : 'temperature',
				message : 'Temperature entity id (optional)',
			},
		] )
		const entities = {}
		if ( answers.soil ) entities.soil = answers.soil
		if ( answers.temperature ) entities.temperature = answers.temperature
		return {
			url   : answers.url,
			token : answers.token || process.env.HASS_TOKEN,
			entities,
		}

	}

	if ( sensor === 'mqtt' ) {

		const answers = await enquirer.prompt( [
			{
				type    : 'input',
				name    : 'url',
				message : 'Broker URL',
				initial : process.env.MQTT_URL || 'mqtt://localhost:1883',
			},
			{
				type    : 'input',
				name    : 'topic',
				message : 'Topic publishing a JSON reading',
			},
		] )
		return answers

	}

	return {}

}

/** Raw-mode key handling for the live view. */
function attachKeys( plant ) {

	if ( !process.stdin.isTTY ) return

	process.stdin.setRawMode( true )
	process.stdin.resume()
	process.stdin.setEncoding( 'utf8' )

	let busy = false

	process.stdin.on( 'data', async key => {

		if ( key === '' || key === 'q' ) {

			await plant.destroy()
			process.exit( 0 )

		}

		if ( busy ) return

		if ( key === 't' ) {

			busy = true
			process.stdin.setRawMode( false )
			const { message } = await enquirer.prompt( {
				type    : 'input',
				name    : 'message',
				message : 'Say something to your plant',
			} ).catch( () => ( { message : null } ) )

			if ( message ) console.log( chalk.green( `\n${await plant.speak( message )}\n` ) )
			process.stdin.setRawMode( true )
			busy = false

		}

		if ( key === 'w' ) {

			await plant.water()
			console.log( chalk.blue( '💧 Watering recorded.' ) )

		}

		if ( key === 'h' ) {

			const stats = plant.memory.stats( 24 )
			if ( !Object.keys( stats ).length ) console.log( chalk.yellow( 'No history yet.' ) )
			else {

				for ( const [ metric, s ] of Object.entries( stats ) ) {

					console.log( `  ${metric.padEnd( 13 )} avg ${s.avg}  (min ${s.min} / max ${s.max})` )

				}

			}

		}

	} )

}

main().catch( err => {

	console.error( chalk.red( `\n❌ ${err.message}` ) )
	if ( process.env.DEBUG ) console.error( err )
	process.exit( 1 )

} )
