/**
 * The OpenClaw brain: an agent that operates the plant, with the safety layers
 * standing between it and anything irreversible.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant, RISK } from '../src/index.js'
import {
	ACT_TOOLS, findTool, generatePlugin, OpenClawBrain, OpenClawGateway,
	openclawEmbedder, openclawProvider, PLANT_TOOLS, READ_TOOLS, selectTools,
	toolSchemas,
} from '../src/integrations/openclaw/index.js'

/**
 * A scripted Gateway. Each entry is one assistant turn: either tool calls or a
 * final message, so a whole agent run is deterministic.
 */
function fakeGateway( script ) {

	const gw = new OpenClawGateway( { url : 'http://fake' } )
	const seen = []
	let i = 0

	gw.chat = async ( messages, opts ) => {

		seen.push( {
			messages : [ ...messages ],
			tools : opts?.tools,
		} )

		const turn = script[ i++ ] ?? { content : 'Done.' }

		if ( turn.calls ) {

			return {
				role : 'assistant',
				content : null,
				tool_calls : turn.calls.map( ( c, n ) => ( {
					id : `call_${i}_${n}`,
					type : 'function',
					function : {
						name : c.name,
						arguments : JSON.stringify( c.params || {} ),
					},
				} ) ),
			}

		}

		return {
			role : 'assistant',
			content : turn.content,
		}

	}

	gw.seen = seen
	return gw

}

const makePlant = extra => createPlant( {
	name    : 'Ivy',
	species : 'Monstera deliciosa',
	sensor  : 'mock',
	ai      : { provider : 'mock' },
	...extra,
} )

describe( 'tool surface', () => {

	it( 'every tool declares whether it acts, and acting tools carry a risk', () => {

		for ( const t of PLANT_TOOLS ) {

			assert.match( t.name, /^plant_/ )
			assert.ok( t.description.length > 20, `${t.name} needs a description the model can use` )
			assert.equal( typeof t.acts, 'boolean' )
			assert.equal( typeof t.handler, 'function' )
			if ( t.acts ) assert.ok( t.risk, `${t.name} acts, so it needs a risk level` )

		}

	} )

	it( 'reading tools outnumber acting ones, and the split is explicit', () => {

		assert.ok( READ_TOOLS.length > ACT_TOOLS.length )
		assert.ok( READ_TOOLS.includes( 'plant_status' ) )
		assert.ok( ACT_TOOLS.includes( 'plant_water' ) )
		assert.ok( !READ_TOOLS.some( n => ACT_TOOLS.includes( n ) ) )

	} )

	it( 'readOnly withholds every acting tool', () => {

		const tools = selectTools( { readOnly : true } )
		assert.ok( tools.length > 0 )
		assert.ok( tools.every( t => !t.acts ) )

	} )

	it( 'schemas are valid OpenAI tool definitions', () => {

		for ( const s of toolSchemas() ) {

			assert.equal( s.type, 'function' )
			assert.ok( s.function.name )
			assert.ok( s.function.description )
			assert.equal( s.function.parameters.type, 'object' )
			assert.ok( Array.isArray( s.function.parameters.required ) )

		}

	} )

	it( 'the emergency stop is always present and low-friction', () => {

		const stop = findTool( 'plant_emergency_stop' )
		assert.ok( stop )
		assert.equal( stop.risk, RISK.LOW )

	} )

} )

describe( 'gateway client', () => {

	it( 'defaults to the documented port, not an invented one', () => {

		const gw = new OpenClawGateway()
		assert.match( gw.url, /18789/ )

	} )

	it( 'reads the token from the documented environment variable', () => {

		const prev = process.env.OPENCLAW_GATEWAY_TOKEN
		process.env.OPENCLAW_GATEWAY_TOKEN = 'secret'

		assert.equal( new OpenClawGateway().token, 'secret' )

		if ( prev === undefined ) delete process.env.OPENCLAW_GATEWAY_TOKEN
		else process.env.OPENCLAW_GATEWAY_TOKEN = prev

	} )

	it( 'health() reports failure rather than throwing when nothing is listening', async () => {

		const gw = new OpenClawGateway( {
			url : 'http://127.0.0.1:1',
			timeout : 800,
		} )
		const h = await gw.health()

		assert.equal( h.ok, false )
		assert.ok( h.error )
		assert.ok( h.hint )

	} )

	it( 'the provider needs no API key — that is the whole point', () => {

		const p = openclawProvider()
		assert.equal( p.needsKey, false )
		assert.equal( typeof p.generate, 'function' )

	} )

	it( 'the embedder exposes the shape VectorMemory expects', () => {

		const e = openclawEmbedder()
		assert.equal( typeof e.embed, 'function' )
		assert.ok( e.id.startsWith( 'openclaw:' ) )

	} )

	it( 'registers as a provider on a plant', async () => {

		const plant = await makePlant()
		plant.ai.registerProvider( 'openclaw', openclawProvider() )

		const listed = plant.ai.listProviders().find( p => p.id === 'openclaw' )
		assert.ok( listed )
		assert.equal( listed.needsKey, false )
		assert.equal( listed.hasKey, true, 'no key needed means it is always ready' )

		await plant.destroy()

	} )

} )

describe( 'the agent loop', () => {

	it( 'calls a tool, feeds the result back, and answers', async () => {

		const plant = await makePlant()
		const gateway = fakeGateway( [
			{ calls : [ { name : 'plant_status' } ] },
			{ content : 'I am comfortable today.' },
		] )

		const brain = new OpenClawBrain( {
			gateway,
			plant,
		} )
		const run = await brain.run( 'How are you?' )

		assert.equal( run.steps, 2 )
		assert.equal( run.trace.length, 1 )
		assert.equal( run.trace[ 0 ].tool, 'plant_status' )
		assert.equal( run.trace[ 0 ].refused, false )
		assert.match( run.reply, /comfortable/ )

		// The tool result must be handed back as a tool message.
		const last = gateway.seen.at( -1 ).messages
		assert.ok( last.some( m => m.role === 'tool' ) )

		await plant.destroy()

	} )

	it( 'chains several tools across turns', async () => {

		const plant = await makePlant()
		const brain = new OpenClawBrain( {
			gateway : fakeGateway( [
				{ calls : [ { name : 'plant_status' } ] },
				{ calls : [ { name : 'plant_diagnose' }, {
					name : 'plant_history',
					params : { hours : 48 },
				} ] },
				{ content : 'Everything checks out.' },
			] ),
			plant,
		} )

		const run = await brain.run( 'Check on the plant.' )

		assert.equal( run.trace.length, 3 )
		assert.deepEqual( run.trace.map( t => t.tool ), [ 'plant_status', 'plant_diagnose', 'plant_history' ] )

		await plant.destroy()

	} )

	it( 'the system prompt carries the plant context', async () => {

		const plant = await makePlant()
		await plant.read()

		const gateway = fakeGateway( [ { content : 'ok' } ] )
		await new OpenClawBrain( {
			gateway,
			plant,
		} ).run( 'hello' )

		const system = gateway.seen[ 0 ].messages[ 0 ]
		assert.equal( system.role, 'system' )
		assert.match( system.content, /CURRENT CONTEXT/ )
		assert.match( system.content, /WELLBEING/ )

		await plant.destroy()

	} )

	it( 'stops at the step budget and still returns something readable', async () => {

		const plant = await makePlant()
		// A model stuck in a loop, calling forever.
		const gateway = fakeGateway( Array.from( { length : 20 }, () => ( { calls : [ { name : 'plant_status' } ] } ) ) )

		const brain = new OpenClawBrain( {
			gateway,
			plant,
			maxSteps : 3,
		} )
		const run = await brain.run( 'go' )

		assert.equal( run.steps, 3 )
		assert.ok( run.reply.length > 0 )

		await plant.destroy()

	} )

	it( 'an unknown tool name is refused as data, not a crash', async () => {

		const plant = await makePlant()
		const brain = new OpenClawBrain( {
			gateway : fakeGateway( [
				{ calls : [ { name : 'plant_launch_rocket' } ] },
				{ content : 'Understood.' },
			] ),
			plant,
		} )

		const run = await brain.run( 'do something odd' )

		assert.equal( run.trace[ 0 ].refused, true )
		assert.match( run.trace[ 0 ].result.error, /No tool named/ )

		await plant.destroy()

	} )

	it( 'malformed arguments are refused as data', async () => {

		const plant = await makePlant()
		const gateway = fakeGateway( [ { content : 'x' } ] )
		const brain = new OpenClawBrain( {
			gateway,
			plant,
		} )

		const outcome = await brain._invoke( {
			id : 'c1',
			function : {
				name : 'plant_history',
				arguments : '{not json',
			},
		}, selectTools( {} ) )

		assert.equal( outcome.refused, true )
		assert.match( outcome.result.error, /valid JSON/ )

		await plant.destroy()

	} )

	it( 'a tool that throws is handed back as data so the model can route around it', async () => {

		const plant = await makePlant()
		// No camera attached, so plant_vision throws.
		const brain = new OpenClawBrain( {
			gateway : fakeGateway( [
				{ calls : [ { name : 'plant_vision' } ] },
				{ content : 'I could not see.' },
			] ),
			plant,
		} )

		const run = await brain.run( 'look at yourself' )

		assert.equal( run.trace[ 0 ].refused, true )
		assert.equal( run.trace[ 0 ].gate, 'error' )
		assert.ok( run.trace[ 0 ].result.error )

		await plant.destroy()

	} )

} )

describe( 'the brain proposes, safety disposes', () => {

	it( 'readOnly withholds acting tools from the model entirely', async () => {

		const plant = await makePlant()
		const gateway = fakeGateway( [ { content : 'ok' } ] )

		await new OpenClawBrain( {
			gateway,
			plant,
			readOnly : true,
		} ).run( 'go' )

		const names = gateway.seen[ 0 ].tools.map( t => t.function.name )
		assert.ok( names.includes( 'plant_status' ) )
		assert.ok( !names.includes( 'plant_water' ), 'an acting tool must not even be offered' )

		await plant.destroy()

	} )

	it( 'the evidence gate blocks an action the data does not support', async () => {

		const plant = await makePlant( { sensor : {
			driver : 'mock',
			soil : 55,
			humidity : 50,
			temperature : 21,
			light : 400,
			dayNight : false,
		} } )
		await plant.embody()
		await plant.read()

		// The plant is fine, so there is no evidence for `soil_low`.
		const brain = new OpenClawBrain( {
			gateway : fakeGateway( [
				{ calls : [ {
					name : 'plant_water',
					params : { amountMl : 500 },
				} ] },
				{ content : 'I will not water it.' },
			] ),
			plant,
		} )

		const run = await brain.run( 'water the plant' )

		assert.equal( run.trace[ 0 ].refused, true )
		assert.equal( run.trace[ 0 ].gate, 'evidence' )
		assert.ok( run.trace[ 0 ].result.missing.length )
		assert.match( run.trace[ 0 ].result.advice, /Do not retry/ )

		await plant.destroy()

	} )

	it( 'a human confirmation hook can veto any acting tool', async () => {

		const plant = await makePlant()
		const asked = []

		const brain = new OpenClawBrain( {
			gateway : fakeGateway( [
				{ calls : [ {
					name : 'plant_remember',
					params : { note : 'hello' },
				} ] },
				{ content : 'ok' },
			] ),
			plant,
			confirm : async tool => {

				asked.push( tool.name )
				return false

			},
		} )

		const run = await brain.run( 'remember something' )

		assert.deepEqual( asked, [ 'plant_remember' ] )
		assert.equal( run.trace[ 0 ].refused, true )
		assert.equal( run.trace[ 0 ].gate, 'human' )

		await plant.destroy()

	} )

	it( 'reads are never gated by the confirmation hook', async () => {

		const plant = await makePlant()
		let asked = 0

		await new OpenClawBrain( {
			gateway : fakeGateway( [
				{ calls : [ { name : 'plant_status' } ] },
				{ content : 'ok' },
			] ),
			plant,
			confirm : async () => {

				asked++
				return true

			},
		} ).run( 'status' )

		assert.equal( asked, 0, 'a read must not ask a human for permission' )

		await plant.destroy()

	} )

	it( 'the spectral interlock refuses blue on a dry plant, through the brain', async () => {

		const plant = await makePlant( { sensor : {
			driver : 'mock',
			soil : 10,
			humidity : 40,
			temperature : 21,
			light : 300,
			dayNight : false,
		} } )
		await plant.useSpectral( {
			light : { driver : 'mock' },
			safety : { darkHours : [ 25, 26 ] },
		} )
		await plant.read()

		const brain = new OpenClawBrain( {
			gateway : fakeGateway( [
				{ calls : [ {
					name : 'plant_light_treat',
					params : {
						band : 'blue',
						seconds : 300,
					},
				} ] },
				{ content : 'Refused, and rightly.' },
			] ),
			plant,
		} )

		const run = await brain.run( 'open her stomata with blue light' )

		assert.equal( run.trace[ 0 ].refused, true )
		assert.equal( run.trace[ 0 ].gate, 'subsystem' )
		assert.match( run.trace[ 0 ].result.refused, /conserve water/ )

		await plant.destroy()

	} )

	it( 'the safety supervisor caps an over-large watering', async () => {

		const plant = await makePlant( { sensor : {
			driver : 'mock',
			soil : 3,
			humidity : 8,
		} } )
		await plant.embody( { safety : { limits : { maxWaterMl : 500 } } } )
		await plant.read()

		// Build the evidence the gate needs, from independent sources.
		const long = Date.now() - 3 * 3600_000
		for ( const source of [ 'soil', 'vision' ] ) {

			plant.body.evidence.add( {
				source,
				claim : 'soil_low',
				strength : 0.9,
				since : long,
			} )

		}

		const brain = new OpenClawBrain( {
			gateway : fakeGateway( [
				{ calls : [ {
					name : 'plant_water',
					params : { amountMl : 5000 },
				} ] },
				{ content : 'Watered.' },
			] ),
			plant,
		} )

		const run = await brain.run( 'water it a lot' )
		const result = run.trace[ 0 ].result

		assert.equal( result.applied, true )
		assert.equal( result.amountMl, 500, 'five litres must be capped' )
		assert.equal( result.adjusted, true )

		await plant.destroy()

	} )

	it( 'an emergency stop ends the run immediately', async () => {

		const plant = await makePlant()
		await plant.embody()

		const brain = new OpenClawBrain( {
			gateway : fakeGateway( [
				{ calls : [ {
					name : 'plant_emergency_stop',
					params : { reason : 'smoke' },
				} ] },
				{ calls : [ { name : 'plant_status' } ] },
				{ content : 'should never get here' },
			] ),
			plant,
		} )

		const run = await brain.run( 'something is on fire' )

		assert.equal( run.stopped, 'smoke' )
		assert.equal( run.trace.length, 1, 'nothing runs after a stop' )
		assert.equal( plant.body.safety.stopped, true )

		await plant.destroy()

	} )

	it( 'reports which gate stopped what', async () => {

		const plant = await makePlant()
		await plant.embody()
		await plant.read()

		const brain = new OpenClawBrain( {
			gateway : fakeGateway( [
				{ calls : [ {
					name : 'plant_water',
					params : { amountMl : 100 },
				} ] },
				{ content : 'ok' },
			] ),
			plant,
		} )

		await brain.run( 'water' )
		const stats = brain.stats()

		assert.equal( stats.runs, 1 )
		assert.equal( stats.toolCalls, 1 )
		assert.equal( stats.refused, 1 )
		assert.equal( stats.byGate.evidence, 1 )

		await plant.destroy()

	} )

} )

describe( 'kernel integration', () => {

	it( 'useBrain() attaches the brain and makes OpenClaw the AI provider', async () => {

		const plant = await makePlant()
		const brain = await plant.useBrain( { gateway : { url : 'http://127.0.0.1:1' } } )

		assert.ok( brain )
		assert.equal( plant.brain, brain )
		assert.equal( plant.ai.provider, 'openclaw', 'the gateway becomes the plant\'s model too' )
		assert.equal( plant.ai.ready, true, 'no key required' )

		await plant.destroy()

	} )

	it( 'provider:false attaches the brain without hijacking the AI provider', async () => {

		const plant = await makePlant()
		await plant.useBrain( {
			gateway : { url : 'http://127.0.0.1:1' },
			provider : false,
		} )

		assert.equal( plant.ai.provider, 'mock' )
		await plant.destroy()

	} )

	it( 'health() reports the gateway and the tools it would offer', async () => {

		const plant = await makePlant()
		const brain = await plant.useBrain( {
			gateway : {
				url : 'http://127.0.0.1:1',
				timeout : 800,
			},
			readOnly : true,
		} )

		const h = await brain.health()

		assert.equal( h.ok, false )
		assert.ok( h.tools.includes( 'plant_status' ) )
		assert.ok( !h.tools.includes( 'plant_water' ) )

		await plant.destroy()

	} )

} )

describe( 'plugin generation', () => {

	it( 'emits the files OpenClaw expects, with the full tool surface', () => {

		const files = generatePlugin()
		const manifest = JSON.parse( files[ 'openclaw.plugin.json' ] )
		const pkg = JSON.parse( files[ 'package.json' ] )

		assert.equal( manifest.contracts.tools.length, PLANT_TOOLS.length )
		assert.ok( pkg.openclaw.extensions.includes( './index.js' ) )
		assert.match( files[ 'index.js' ], /definePluginEntry/ )
		assert.match( files[ 'index.js' ], /api\.registerTool/ )

	} )

	it( 'readOnly produces a plugin that cannot act', () => {

		const files = generatePlugin( { readOnly : true } )
		const manifest = JSON.parse( files[ 'openclaw.plugin.json' ] )

		assert.ok( !manifest.contracts.tools.includes( 'plant_water' ) )
		assert.ok( manifest.contracts.tools.includes( 'plant_status' ) )
		assert.match( files[ 'README.md' ], /generated read-only/ )

	} )

	it( 'the generated entry point parses as valid JavaScript', async () => {

		const { writeFile, mkdtemp, rm } = await import( 'node:fs/promises' )
		const { tmpdir } = await import( 'node:os' )
		const { join } = await import( 'node:path' )
		const { execFile } = await import( 'node:child_process' )
		const { promisify } = await import( 'node:util' )

		const dir = await mkdtemp( join( tmpdir(), 'oc-' ) )
		const file = join( dir, 'index.mjs' )
		await writeFile( file, generatePlugin()[ 'index.js' ] )

		await promisify( execFile )( process.execPath, [ '--check', file ] )

		await rm( dir, {
			recursive : true,
			force : true,
		} )

	} )

} )
