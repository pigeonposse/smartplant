import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
	detectBoard, detectCamera, detectPackages, detectSerialPorts, formatScan,
	I2C_DEVICES, recommend, scan,
} from '../src/hardware/index.js'
import {
	createToolHandlers, generatePlugin, openclawProvider, PLANT_TOOLS,
} from '../src/integrations/openclaw.js'
import { createPlant } from '../src/index.js'

describe( 'hardware detection', () => {

	it( 'identifies the host without throwing on any platform', async () => {

		const board = await detectBoard()

		assert.ok( board.id )
		assert.ok( board.label )
		assert.ok( [ 'darwin', 'linux', 'win32' ].includes( board.platform ) )
		assert.ok( board.cpus > 0 )
		assert.ok( board.memoryGB > 0 )
		assert.equal( typeof board.isSBC, 'boolean' )
		assert.ok( board.capabilities )

	} )

	it( 'lists serial ports as an array, empty if none', async () => {

		const ports = await detectSerialPorts()
		assert.ok( Array.isArray( ports ) )
		for ( const p of ports ) assert.ok( p.path )

	} )

	it( 'reports camera availability honestly', async () => {

		const cam = await detectCamera()

		assert.equal( typeof cam.available, 'boolean' )
		assert.ok( Array.isArray( cam.devices ) )
		assert.equal( typeof cam.ffmpeg, 'boolean' )
		// If ffmpeg is missing it must say so rather than failing silently.
		if ( !cam.ffmpeg ) assert.ok( cam.hint )

	} )

	it( 'reports which optional packages are installed', async () => {

		const pkgs = await detectPackages()

		assert.ok( 'serialport' in pkgs )
		assert.ok( 'mqtt' in pkgs )
		for ( const v of Object.values( pkgs ) ) assert.equal( typeof v, 'boolean' )

	} )

	it( 'a full scan returns every section', async () => {

		const report = await scan()

		assert.ok( report.at )
		assert.ok( report.board )
		assert.ok( Array.isArray( report.serial ) )
		assert.ok( Array.isArray( report.i2c ) )
		assert.ok( report.camera )
		assert.ok( report.packages )

	} )

	it( 'recommends a config with reasoning, never an empty answer', async () => {

		const report = await scan()
		const rec = recommend( report )

		assert.ok( rec.sensor?.driver, 'must always land on some driver' )
		assert.ok( rec.notes.length > 0, 'must explain itself' )
		assert.ok( rec.confidence > 0 && rec.confidence <= 1 )

	} )

	it( 'falls back to mock on a plain laptop, and says why', () => {

		const rec = recommend( {
			board : {
				label : 'macOS host',
				isSBC : false,
				capabilities : {},
			},
			serial : [],
			i2c : [],
			camera : { available : false },
			packages : {},
		} )

		assert.equal( rec.sensor.driver, 'mock' )
		assert.ok( rec.notes.some( n => /mock/.test( n ) ) )

	} )

	it( 'recommends serial and firmware when a board is on USB', () => {

		const rec = recommend( {
			board : {
				label : 'Linux host',
				isSBC : false,
				capabilities : {},
			},
			serial : [ {
				path : '/dev/ttyUSB0',
				label : 'ESP32 (CP210x)',
				board : 'esp32',
			} ],
			i2c : [],
			camera : { available : false },
			packages : { serialport : true },
		} )

		assert.equal( rec.sensor.driver, 'serial' )
		assert.equal( rec.sensor.path, '/dev/ttyUSB0' )
		assert.equal( rec.firmware.board, 'esp32' )
		assert.ok( rec.confidence >= 0.9 )

	} )

	it( 'tells you to install serialport when the driver needs it', () => {

		const rec = recommend( {
			board : {
				label : 'x',
				isSBC : false,
				capabilities : {},
			},
			serial : [ {
				path : '/dev/ttyUSB0',
				label : 'ESP32',
				board : 'esp32',
			} ],
			i2c : [],
			camera : { available : false },
			packages : { serialport : false },
		} )

		assert.ok( rec.notes.some( n => /npm install serialport/.test( n ) ) )

	} )

	it( 'uses detected I2C sensors when there is no MCU', () => {

		const rec = recommend( {
			board : {
				label : 'Raspberry Pi 4',
				isSBC : true,
				capabilities : { i2c : true },
			},
			serial : [],
			i2c : [ {
				address : '0x23',
				name : 'BH1750',
				metrics : [ 'light' ],
				known : true,
			} ],
			camera : { available : true, devices : [ '/dev/video0' ] },
			packages : {},
		} )

		assert.ok( rec.notes.some( n => /BH1750/.test( n ) ) )
		assert.ok( rec.confidence >= 0.8 )

	} )

	it( 'the I2C table covers the sensors the firmware generator supports', () => {

		const names = Object.values( I2C_DEVICES ).map( d => d.name )
		assert.ok( names.some( n => /BH1750/.test( n ) ) )
		assert.ok( Object.values( I2C_DEVICES ).every( d => Array.isArray( d.metrics ) ) )

	} )

	it( 'formats a readable report', async () => {

		const report = await scan()
		const text = formatScan( report, recommend( report ) )

		assert.match( text, /Board:/ )
		assert.match( text, /Suggested:/ )

	} )

} )

describe( 'openclaw integration', () => {

	const makePlant = () => createPlant( {
		name    : 'Rosa',
		species : 'Monstera deliciosa',
		sensor  : 'mock',
		ai      : { provider : 'mock' },
	} )

	it( 'every tool has a name, description, schema and handler', () => {

		assert.ok( PLANT_TOOLS.length >= 6 )
		for ( const t of PLANT_TOOLS ) {

			assert.match( t.name, /^plant_/ )
			assert.ok( t.description.length > 10 )
			assert.equal( t.parameters.type, 'object' )
			assert.equal( typeof t.handler, 'function' )

		}

	} )

	it( 'bound tools execute against a real plant', async () => {

		const plant = await makePlant()
		const tools = createToolHandlers( plant )

		const status = await tools.find( t => t.name === 'plant_status' ).execute( {} )
		assert.equal( status.ok, true )
		assert.ok( Number.isFinite( status.wellbeing ) )
		assert.ok( status.status.length > 0 )

		await plant.destroy()

	} )

	it( 'plant_ask returns the plant\'s reply', async () => {

		const plant = await makePlant()
		const tools = createToolHandlers( plant )

		const res = await tools.find( t => t.name === 'plant_ask' ).execute( { question : 'how are you?' } )
		assert.equal( res.ok, true )
		assert.ok( res.reply.length > 0 )

		await plant.destroy()

	} )

	it( 'plant_diagnose returns conclusions with their reasons', async () => {

		const plant = await createPlant( {
			name : 'Rosa',
			sensor : {
				driver : 'mock',
				soil : 2,
				humidity : 5,
			},
			ai : { provider : 'mock' },
		} )
		const tools = createToolHandlers( plant )

		const res = await tools.find( t => t.name === 'plant_diagnose' ).execute( {} )
		assert.equal( res.ok, true )
		assert.ok( res.conclusions.length > 0 )
		assert.ok( res.conclusions[ 0 ].because.length > 0 )

		await plant.destroy()

	} )

	it( 'a failing tool returns an error as data, not a throw', async () => {

		const plant = await makePlant()
		// Knowledge disabled makes diagnose() throw; the tool must not.
		plant.knowledge = null

		const tools = createToolHandlers( plant )
		const res = await tools.find( t => t.name === 'plant_diagnose' ).execute( {} )

		assert.equal( res.ok, false )
		assert.ok( res.error.length > 0 )

		await plant.destroy()

	} )

	it( 'only:[] restricts the exposed tools', async () => {

		const plant = await makePlant()
		const tools = createToolHandlers( plant, { only : [ 'plant_status' ] } )

		assert.equal( tools.length, 1 )
		assert.equal( tools[ 0 ].name, 'plant_status' )

		await plant.destroy()

	} )

	it( 'generates a plugin package with the files OpenClaw expects', () => {

		const files = generatePlugin()

		assert.ok( 'package.json' in files )
		assert.ok( 'openclaw.plugin.json' in files )
		assert.ok( 'index.js' in files )
		assert.ok( 'README.md' in files )

	} )

	it( 'the generated package.json declares the openclaw block', () => {

		const pkg = JSON.parse( generatePlugin()[ 'package.json' ] )

		assert.ok( pkg.openclaw.extensions.includes( './index.js' ) )
		assert.ok( pkg.openclaw.compat.pluginApi )
		assert.ok( pkg.peerDependencies.openclaw )
		assert.equal( pkg.type, 'module' )

	} )

	it( 'the manifest declares every registered tool', () => {

		const files = generatePlugin()
		const manifest = JSON.parse( files[ 'openclaw.plugin.json' ] )

		assert.equal( manifest.contracts.tools.length, PLANT_TOOLS.length )
		for ( const t of PLANT_TOOLS ) assert.ok( manifest.contracts.tools.includes( t.name ) )

	} )

	it( 'the entry point uses definePluginEntry and registerTool', () => {

		const entry = generatePlugin()[ 'index.js' ]

		assert.match( entry, /definePluginEntry/ )
		assert.match( entry, /api\.registerTool/ )
		assert.match( entry, /Type\.Object/ )
		assert.match( entry, /createPlant/ )

	} )

	it( 'restricting tools shrinks both the manifest and the entry point', () => {

		const files = generatePlugin( { tools : [ 'plant_status' ] } )
		const manifest = JSON.parse( files[ 'openclaw.plugin.json' ] )

		assert.deepEqual( manifest.contracts.tools, [ 'plant_status' ] )
		assert.ok( !files[ 'index.js' ].includes( 'plant_diagnose' ) )

	} )

	it( 'the generated entry point is syntactically valid JavaScript', async () => {

		const { writeFile, mkdtemp, rm } = await import( 'node:fs/promises' )
		const { tmpdir } = await import( 'node:os' )
		const { join } = await import( 'node:path' )
		const { execFile } = await import( 'node:child_process' )
		const { promisify } = await import( 'node:util' )

		const dir = await mkdtemp( join( tmpdir(), 'oc-' ) )
		const file = join( dir, 'index.mjs' )
		await writeFile( file, generatePlugin()[ 'index.js' ] )

		// --check parses without resolving imports, which is exactly what we want:
		// openclaw is not installed here.
		await promisify( execFile )( process.execPath, [ '--check', file ] )

		await rm( dir, {
			recursive : true,
			force : true,
		} )

	} )

	it( 'the gateway provider is shaped like any other AI provider', () => {

		const p = openclawProvider( { url : 'http://localhost:4747' } )

		assert.equal( typeof p.generate, 'function' )
		assert.equal( p.needsKey, false )
		assert.ok( p.label )

	} )

	it( 'the gateway provider registers on a plant', async () => {

		const plant = await makePlant()
		plant.ai.registerProvider( 'openclaw', openclawProvider() )

		assert.ok( plant.ai.listProviders().some( p => p.id === 'openclaw' ) )

		await plant.destroy()

	} )

} )
