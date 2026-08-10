/**
 * Hardware autodetection.
 *
 * Answers "what am I running on, and what is plugged into it?" so a user does
 * not have to know that their board exposes ADC1 on GPIO36, or which of four
 * `/dev/tty*` entries is the Arduino.
 *
 * Everything here is best-effort and non-destructive: it reads well-known files
 * and lists devices, never writes, never probes a bus in a way that could
 * disturb a device mid-conversation. Anything it cannot determine it reports as
 * unknown rather than guessing.
 */

import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { arch, cpus, platform, totalmem } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify( execFile )

/** Known single-board computers, matched against the device tree model string. */
const BOARD_SIGNATURES = [
	{
		match : /raspberry pi 5/i,
		id : 'rpi5',
		label : 'Raspberry Pi 5',
		gpio : true,
		i2c : true,
		spi : true,
	},
	{
		match : /raspberry pi 4/i,
		id : 'rpi4',
		label : 'Raspberry Pi 4',
		gpio : true,
		i2c : true,
		spi : true,
	},
	{
		match : /raspberry pi 3/i,
		id : 'rpi3',
		label : 'Raspberry Pi 3',
		gpio : true,
		i2c : true,
		spi : true,
	},
	{
		match : /raspberry pi zero 2/i,
		id : 'rpi-zero2',
		label : 'Raspberry Pi Zero 2 W',
		gpio : true,
		i2c : true,
		spi : true,
	},
	{
		match : /raspberry pi zero/i,
		id : 'rpi-zero',
		label : 'Raspberry Pi Zero',
		gpio : true,
		i2c : true,
		spi : true,
	},
	{
		match : /raspberry pi/i,
		id : 'rpi',
		label : 'Raspberry Pi',
		gpio : true,
		i2c : true,
		spi : true,
	},
	{
		match : /jetson|tegra/i,
		id : 'jetson',
		label : 'NVIDIA Jetson',
		gpio : true,
		i2c : true,
		spi : true,
		gpu : true,
	},
	{
		match : /orange ?pi/i,
		id : 'orangepi',
		label : 'Orange Pi',
		gpio : true,
		i2c : true,
		spi : true,
	},
	{
		match : /rock ?(pi|chip)/i,
		id : 'rockpi',
		label : 'Rock Pi',
		gpio : true,
		i2c : true,
		spi : true,
	},
	{
		match : /beaglebone/i,
		id : 'beaglebone',
		label : 'BeagleBone',
		gpio : true,
		i2c : true,
		spi : true,
	},
]

/** USB vendor/product IDs of the boards people actually plug in. */
const USB_SIGNATURES = [
	{
		vid : '10c4',
		pid : 'ea60',
		label : 'ESP32 / ESP8266 (CP210x)',
		board : 'esp32',
	},
	{
		vid : '1a86',
		pid : '7523',
		label : 'Arduino clone / ESP (CH340)',
		board : 'arduino',
	},
	{
		vid : '1a86',
		pid : '55d4',
		label : 'CH9102 serial bridge',
		board : 'esp32',
	},
	{
		vid : '2341',
		label : 'Arduino (official)',
		board : 'arduino',
	},
	{
		vid : '2a03',
		label : 'Arduino (arduino.org)',
		board : 'arduino',
	},
	{
		vid : '0403',
		pid : '6001',
		label : 'FTDI FT232 serial',
		board : 'arduino',
	},
	{
		vid : '303a',
		label : 'Espressif native USB',
		board : 'esp32',
	},
]

/** I2C addresses of sensors this library knows how to use. */
export const I2C_DEVICES = {
	0x23 : {
		name : 'BH1750',
		metrics : [ 'light' ],
		firmware : 'bh1750',
	},
	0x5c : {
		name : 'BH1750 (alt address)',
		metrics : [ 'light' ],
		firmware : 'bh1750',
	},
	0x76 : {
		name : 'BME280 / BMP280',
		metrics : [ 'temperature', 'humidity' ],
		firmware : null,
	},
	0x77 : {
		name : 'BME280 / BMP280 (alt)',
		metrics : [ 'temperature', 'humidity' ],
		firmware : null,
	},
	0x40 : {
		name : 'SHT21 / HTU21D',
		metrics : [ 'temperature', 'humidity' ],
		firmware : null,
	},
	0x44 : {
		name : 'SHT31',
		metrics : [ 'temperature', 'humidity' ],
		firmware : null,
	},
	0x48 : {
		name : 'ADS1115 ADC',
		metrics : [ 'soil', 'voltage' ],
		firmware : null,
	},
	0x36 : {
		name : 'Adafruit Seesaw soil sensor',
		metrics : [ 'soil', 'temperature' ],
		firmware : null,
	},
	0x62 : {
		name : 'SCD30 CO₂',
		metrics : [ 'co2', 'temperature', 'humidity' ],
		firmware : null,
	},
}

/**
 * Identify the host board.
 *
 * @returns {Promise<object>} `{id, label, platform, arch, cpus, memoryGB, capabilities}`.
 */
export async function detectBoard() {

	const base = {
		platform : platform(),
		arch     : arch(),
		cpus     : cpus().length,
		cpuModel : cpus()[ 0 ]?.model?.trim() || 'unknown',
		memoryGB : Number( ( totalmem() / 1024 ** 3 ).toFixed( 2 ) ),
	}

	// The device tree model is the authoritative identifier on ARM SBCs.
	const model = await readFirst( [
		'/proc/device-tree/model',
		'/sys/firmware/devicetree/base/model',
		'/proc/cpuinfo',
	] )

	if ( model ) {

		for ( const sig of BOARD_SIGNATURES ) {

			if ( sig.match.test( model ) ) {

				return {
					...base,
					id     : sig.id,
					label  : sig.label,
					model  : model.split( '\u0000' ).join( '' ).split( '\n' )[ 0 ].trim(),
					isSBC  : true,
					capabilities : {
						gpio : sig.gpio ?? false,
						i2c  : sig.i2c ?? false,
						spi  : sig.spi ?? false,
						gpu  : sig.gpu ?? false,
					},
				}

			}

		}

	}

	return {
		...base,
		id    : base.platform === 'darwin' ? 'mac' : base.platform === 'win32' ? 'windows' : 'linux',
		label : base.platform === 'darwin'
			? 'macOS host'
			: base.platform === 'win32' ? 'Windows host' : 'Linux host',
		isSBC : false,
		capabilities : {
			gpio : false,
			i2c  : false,
			spi  : false,
			gpu  : false,
		},
	}

}

/**
 * List serial ports, identifying known boards by USB id where possible.
 *
 * @returns {Promise<object[]>} `[{path, label, board, vid, pid}]`.
 */
export async function detectSerialPorts() {

	// Prefer the serialport package when it is installed: it gives USB ids on
	// every platform. Fall back to listing device nodes.
	try {

		const { SerialPort } = await import( 'serialport' )
		const ports = await SerialPort.list()

		return ports.map( p => {

			const vid = ( p.vendorId || '' ).toLowerCase()
			const pid = ( p.productId || '' ).toLowerCase()
			const sig = USB_SIGNATURES.find( s =>
				s.vid === vid && ( !s.pid || s.pid === pid ) )

			return {
				path         : p.path,
				label        : sig?.label || p.manufacturer || 'unknown serial device',
				board        : sig?.board || null,
				vid          : vid || null,
				pid          : pid || null,
				serialNumber : p.serialNumber || null,
			}

		} )

	}
	catch { /* serialport not installed — fall through */ }

	const candidates = []
	try {

		const entries = await readdir( '/dev' )
		for ( const e of entries ) {

			if ( /^(ttyUSB|ttyACM|ttyAMA|ttyS)\d+$/.test( e ) || /^cu\.(usbserial|usbmodem|SLAB|wchusb)/i.test( e ) ) {

				candidates.push( {
					path  : `/dev/${e}`,
					label : 'serial device (install "serialport" for identification)',
					board : null,
					vid   : null,
					pid   : null,
				} )

			}

		}

	}
	catch { /* not a POSIX host */ }

	return candidates

}

/**
 * Scan the I2C bus for known sensors.
 *
 * Uses `i2cdetect` in quick mode, which is a read-only address probe.
 *
 * @param   {number}            [bus] - Bus number.
 * @returns {Promise<object[]>}       `[{address, name, metrics}]`.
 */
export async function detectI2C( bus = 1 ) {

	try {

		const { stdout } = await execFileAsync( 'i2cdetect', [ '-y', String( bus ) ], { timeout : 5000 } )
		const found = []

		for ( const line of stdout.split( '\n' ).slice( 1 ) ) {

			const [ prefix, ...cells ] = line.split( /\s+/ ).filter( Boolean )
			if ( !/^[0-9a-f]{2}:$/i.test( prefix ) ) continue

			const rowBase = parseInt( prefix, 16 )
			cells.forEach( ( cell, i ) => {

				if ( cell === '--' || cell === 'UU' ) return
				const address = rowBase + i
				const known = I2C_DEVICES[ address ]

				found.push( {
					address    : `0x${address.toString( 16 ).padStart( 2, '0' )}`,
					addressInt : address,
					name       : known?.name || 'unknown device',
					metrics    : known?.metrics || [],
					firmware   : known?.firmware || null,
					known      : !!known,
				} )

			} )

		}

		return found

	}
	catch {

		// i2cdetect missing, no bus, or no permission — all normal off a Pi.
		return []

	}

}

/**
 * Look for a camera.
 *
 * @returns {Promise<object>} `{available, devices, ffmpeg}`.
 */
export async function detectCamera() {

	const devices = []

	try {

		const entries = await readdir( '/dev' )
		for ( const e of entries ) {

			if ( /^video\d+$/.test( e ) ) devices.push( `/dev/${e}` )

		}

	}
	catch { /* not a POSIX host */ }

	let ffmpeg = false
	try {

		await execFileAsync( 'ffmpeg', [ '-version' ], { timeout : 5000 } )
		ffmpeg = true

	}
	catch { /* not installed */ }

	// On macOS the device list is not in /dev; ffmpeg with AVFoundation is the
	// only portable way in, so its presence is what matters there.
	const available = devices.length > 0 || ( platform() === 'darwin' && ffmpeg )

	return {
		available,
		devices,
		ffmpeg,
		hint : ffmpeg
			? null
			: 'Install ffmpeg to use the vision layer with a camera.',
	}

}

/**
 * Which optional JavaScript packages are installed.
 *
 * @returns {Promise<object>} Package → boolean.
 */
export async function detectPackages() {

	const packages = [ 'serialport', '@serialport/parser-readline', 'mqtt', 'onnxruntime-node' ]
	const out = {}

	await Promise.all( packages.map( async name => {

		try {

			await import( name )
			out[ name ] = true

		}
		catch {

			out[ name ] = false

		}

	} ) )

	return out

}

/**
 * Full scan: board, ports, I2C, camera, packages.
 *
 * @param   {object}          [opts]     - Options.
 * @param   {number}          [opts.i2cBus] - I2C bus to scan.
 * @returns {Promise<object>}            The report.
 */
export async function scan( opts = {} ) {

	const board = await detectBoard()

	const [ serial, i2c, camera, packages ] = await Promise.all( [
		detectSerialPorts(),
		board.capabilities.i2c ? detectI2C( opts.i2cBus ?? 1 ) : Promise.resolve( [] ),
		detectCamera(),
		detectPackages(),
	] )

	return {
		at : new Date().toISOString(),
		board,
		serial,
		i2c,
		camera,
		packages,
	}

}

/**
 * Turn a scan into a SmartPlant config and a firmware recommendation.
 *
 * This is the payoff: the user runs one command and gets a configuration that
 * matches the hardware actually present, with the reasoning shown.
 *
 * @param   {object} report - Output of `scan()`.
 * @returns {object}        `{sensor, firmware, notes, confidence}`.
 */
export function recommend( report ) {

	const notes = []
	let sensor = null
	let firmware = null

	const i2cKnown = ( report.i2c || [] ).filter( d => d.known )
	const board = report.board

	// A microcontroller on USB is the most common real rig: it does the sensing,
	// the host does the thinking.
	const mcu = ( report.serial || [] ).find( p => p.board )

	if ( mcu ) {

		sensor = {
			driver   : 'serial',
			path     : mcu.path,
			baudRate : 115200,
		}
		firmware = {
			target : 'platformio',
			board  : mcu.board === 'arduino' ? 'arduino' : 'esp32',
			transport : 'serial',
			sensors : [ 'dht22', 'capacitive_soil' ],
		}
		notes.push( `Found ${mcu.label} on ${mcu.path}. Flash it with the generated firmware and read over USB.` )

		if ( !report.packages.serialport ) {

			notes.push( 'Install "serialport" to use the serial driver: npm install serialport @serialport/parser-readline' )

		}

	}
	else if ( i2cKnown.length ) {

		// Sensors wired straight to the SBC's own bus.
		const metrics = [ ...new Set( i2cKnown.flatMap( d => d.metrics ) ) ]
		sensor = {
			driver : 'http',
			note   : 'I2C sensors need a small reader process; see the notes.',
		}
		notes.push( `Found ${i2cKnown.length} known I2C sensor(s): ${i2cKnown.map( d => `${d.name} at ${d.address}` ).join( ', ' )}.` )
		notes.push( `They cover: ${metrics.join( ', ' )}. Read them with a small script and expose the values as JSON, then point the "http" driver at it.` )

	}
	else if ( board.isSBC ) {

		sensor = { driver : 'manual' }
		notes.push( `Running on ${board.label} but no sensors were detected. Wire a sensor and re-scan, or use the "manual" driver meanwhile.` )

	}
	else {

		sensor = { driver : 'mock' }
		notes.push( `Running on ${board.label} with no sensor hardware. The "mock" driver simulates a plant so everything works while you build the rig.` )

	}

	if ( report.camera?.available ) {

		notes.push( report.camera.devices.length
			? `Camera available at ${report.camera.devices[ 0 ]} — the vision layer can use it.`
			: 'Camera available through ffmpeg — the vision layer can use it.' )

	}
	else if ( report.camera?.hint ) notes.push( report.camera.hint )

	if ( board.capabilities.gpu ) {

		notes.push( 'This board has a GPU: ONNX models will run comfortably on it.' )

	}
	else if ( board.isSBC ) {

		notes.push( 'No GPU: prefer the classical vision tier, or a small quantized ONNX model.' )

	}

	return {
		sensor,
		firmware,
		notes,
		// High when a board was positively identified by USB id; low when we are
		// inferring from the absence of evidence.
		confidence : mcu ? 0.9 : i2cKnown.length ? 0.8 : board.isSBC ? 0.5 : 0.3,
	}

}

/**
 * Human-readable scan report.
 *
 * @param   {object} report        - Output of `scan()`.
 * @param   {object} [suggestion]  - Output of `recommend()`.
 * @returns {string}               Report text.
 */
export function formatScan( report, suggestion ) {

	const lines = [
		`Board:     ${report.board.label}${report.board.model ? ` (${report.board.model})` : ''}`,
		`Platform:  ${report.board.platform}/${report.board.arch}, ${report.board.cpus} core(s), ${report.board.memoryGB}GB`,
	]

	lines.push( report.serial?.length
		? `Serial:    ${report.serial.map( p => `${p.path} — ${p.label}` ).join( '\n           ' )}`
		: 'Serial:    none detected' )

	lines.push( report.i2c?.length
		? `I2C:       ${report.i2c.map( d => `${d.address} ${d.name}` ).join( ', ' )}`
		: `I2C:       ${report.board.capabilities.i2c ? 'bus present, nothing detected' : 'not available on this host'}` )

	lines.push( `Camera:    ${report.camera.available ? ( report.camera.devices[ 0 ] || 'via ffmpeg' ) : 'none'}` )

	const missing = Object.entries( report.packages ).filter( ( [ , v ] ) => !v ).map( ( [ k ] ) => k )
	lines.push( `Packages:  ${missing.length ? `missing ${missing.join( ', ' )}` : 'all optional packages installed'}` )

	if ( suggestion ) {

		lines.push( '', `Suggested: sensor "${suggestion.sensor?.driver}" (confidence ${suggestion.confidence})` )
		for ( const note of suggestion.notes ) lines.push( `  · ${note}` )

	}

	return lines.join( '\n' )

}

async function readFirst( paths ) {

	for ( const p of paths ) {

		try {

			return await readFile( p, 'utf-8' )

		}
		catch { /* try the next one */ }

	}
	return null

}
