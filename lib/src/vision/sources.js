/**
 * Frame sources.
 *
 * The universal one is `FFmpegSource`: ffmpeg reads essentially every camera and
 * stream that exists — V4L2 webcams (including the PS3 Eye), AVFoundation on
 * macOS, DirectShow on Windows, RTSP from an IP camera, an MJPEG URL, or a video
 * file — and emits raw `rgb24`, which needs no image decoder on our side.
 *
 * That single indirection is what lets this library take video input on any
 * platform without a native dependency.
 */

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

import { SmartPlantError } from '../core/errors.js'
import { createFrame } from './analysis.js'

/** Base contract: `grab()` returns one `Frame`. */
export class VisionSource {

	constructor( config = {} ) {

		this.config = config
		this.id     = config.id || this.constructor.id || 'vision'

	}

	async open() {

		return this

	}

	async grab() {

		throw new Error( `${this.constructor.name} must implement grab()` )

	}

	async close() {

		return this

	}

}

/**
 * Grab frames through ffmpeg.
 *
 * @example
 * // Linux webcam / PS3 Eye
 * new FFmpegSource( { input: '/dev/video0', format: 'v4l2', width: 640, height: 480 } )
 * // macOS
 * new FFmpegSource( { input: '0', format: 'avfoundation' } )
 * // IP camera
 * new FFmpegSource( { input: 'rtsp://192.168.1.50/stream' } )
 * // A still image or video file
 * new FFmpegSource( { input: './plant.jpg' } )
 */
export class FFmpegSource extends VisionSource {

	static id = 'ffmpeg'

	/**
	 * @param {object} [config]              - Options.
	 * @param {string} [config.input]        - ffmpeg input (device, URL or path).
	 * @param {string} [config.format]       - Input format (`v4l2`, `avfoundation`, `dshow`…).
	 * @param {number} [config.width]        - Output width. Default 640.
	 * @param {number} [config.height]       - Output height. Default 480.
	 * @param {string} [config.binary]       - ffmpeg binary. Default `ffmpeg`.
	 * @param {number} [config.timeout]      - Grab timeout in ms.
	 * @param {string[]} [config.inputArgs]  - Extra args placed before `-i`.
	 */
	constructor( config = {} ) {

		super( {
			id : FFmpegSource.id,
			...config,
		} )

		this.input   = config.input || '/dev/video0'
		this.format  = config.format || null
		this.width   = config.width || 640
		this.height  = config.height || 480
		this.binary  = config.binary || 'ffmpeg'
		this.timeout = config.timeout ?? 15_000

	}

	_args() {

		const args = [ '-hide_banner', '-loglevel', 'error' ]
		if ( this.format ) args.push( '-f', this.format )
		if ( this.config.inputArgs ) args.push( ...this.config.inputArgs )
		args.push( '-i', this.input )
		args.push(
			'-frames:v', '1',
			'-vf', `scale=${this.width}:${this.height}`,
			'-pix_fmt', 'rgb24',
			'-f', 'rawvideo',
			'pipe:1',
		)
		return args

	}

	async grab() {

		const expected = this.width * this.height * 3
		const chunks   = []
		let stderr     = ''

		await new Promise( ( resolve, reject ) => {

			const proc = spawn( this.binary, this._args() )
			const timer = setTimeout( () => {

				proc.kill( 'SIGKILL' )
				reject( new SmartPlantError( `ffmpeg timed out after ${this.timeout}ms grabbing from "${this.input}".`, 'VISION_ERROR' ) )

			}, this.timeout )

			proc.stdout.on( 'data', c => chunks.push( c ) )
			proc.stderr.on( 'data', c => {

				stderr += c.toString()

			} )

			proc.on( 'error', err => {

				clearTimeout( timer )
				reject( err.code === 'ENOENT'
					? new SmartPlantError( `ffmpeg not found. Install it, or set { binary } to its path.`, 'VISION_ERROR' )
					: err )

			} )

			proc.on( 'close', code => {

				clearTimeout( timer )
				if ( code === 0 ) resolve()
				else reject( new SmartPlantError( `ffmpeg exited ${code}: ${stderr.trim().slice( 0, 300 )}`, 'VISION_ERROR' ) )

			} )

		} )

		const buf = Buffer.concat( chunks )
		if ( buf.length < expected ) {

			throw new SmartPlantError( `ffmpeg returned ${buf.length} bytes, expected ${expected}.`, 'VISION_ERROR' )

		}

		return createFrame( buf.subarray( 0, expected ), this.width, this.height, 3 )

	}

}

/**
 * Read raw frames from a file. Useful for tests, for replaying a recording, and
 * for pipelines where another process already produced raw pixels.
 */
export class RawFileSource extends VisionSource {

	static id = 'raw-file'

	constructor( config = {} ) {

		super( {
			id : RawFileSource.id,
			...config,
		} )

		if ( !config.path ) throw new SmartPlantError( 'RawFileSource needs a { path }.', 'VISION_ERROR' )
		this.path     = config.path
		this.width    = config.width
		this.height   = config.height
		this.channels = config.channels ?? 3

	}

	async grab() {

		const buf = await readFile( this.path )

		// Support binary PPM (P6), which ffmpeg and ImageMagick both write and
		// which carries its own dimensions.
		if ( buf[ 0 ] === 0x50 && buf[ 1 ] === 0x36 ) return parsePPM( buf )

		if ( !this.width || !this.height ) {

			throw new SmartPlantError( 'RawFileSource needs { width, height } for headerless raw data.', 'VISION_ERROR' )

		}
		return createFrame( buf, this.width, this.height, this.channels )

	}

}

/**
 * Grab a frame from an in-process callback. The escape hatch for anyone who
 * already has pixels — from `sharp`, `jimp`, a canvas, a GPU pipeline.
 */
export class CallbackSource extends VisionSource {

	static id = 'callback'

	constructor( config = {} ) {

		super( {
			id : CallbackSource.id,
			...config,
		} )

		if ( typeof config.grab !== 'function' ) throw new SmartPlantError( 'CallbackSource needs a { grab } function returning a Frame.', 'VISION_ERROR' )
		this._grab = config.grab

	}

	async grab() {

		return this._grab()

	}

}

/**
 * Parse a binary PPM (P6).
 *
 * @param   {Buffer} buf - File contents.
 * @returns {object}     Frame.
 */
export function parsePPM( buf ) {

	let pos = 2
	const tokens = []

	// Header: three integers (width, height, maxval), with '#' comments allowed
	// anywhere between them.
	while ( tokens.length < 3 && pos < buf.length ) {

		while ( pos < buf.length && /\s/.test( String.fromCharCode( buf[ pos ] ) ) ) pos++
		if ( buf[ pos ] === 0x23 ) {

			while ( pos < buf.length && buf[ pos ] !== 0x0a ) pos++
			continue

		}
		let token = ''
		while ( pos < buf.length && !/\s/.test( String.fromCharCode( buf[ pos ] ) ) ) {

			token += String.fromCharCode( buf[ pos ] )
			pos++

		}
		if ( token ) tokens.push( Number( token ) )

	}

	pos++ // single whitespace byte after maxval
	const [ width, height, maxval ] = tokens

	if ( !width || !height ) throw new SmartPlantError( 'Malformed PPM header.', 'VISION_ERROR' )
	if ( maxval > 255 ) throw new SmartPlantError( '16-bit PPM is not supported.', 'VISION_ERROR' )

	return createFrame( buf.subarray( pos, pos + width * height * 3 ), width, height, 3 )

}

/**
 * Build a source from a short config.
 *
 * @param   {object|VisionSource} spec - `{ source: 'ffmpeg', ... }` or an instance.
 * @returns {VisionSource}             The source.
 */
export function createSource( spec ) {

	if ( spec instanceof VisionSource ) return spec

	const { source = 'ffmpeg', ...config } = spec || {}

	switch ( source ) {

		case 'ffmpeg'  : return new FFmpegSource( config )
		case 'raw-file': return new RawFileSource( config )
		case 'callback': return new CallbackSource( config )
		default:
			throw new SmartPlantError( `Unknown vision source "${source}". Use ffmpeg, raw-file or callback.`, 'VISION_ERROR' )

	}

}
