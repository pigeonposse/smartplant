/**
 * Node side of the Python bridge.
 *
 * Keeps one long-lived Python process and multiplexes JSON requests over its
 * stdio. A persistent process matters: importing torch or loading a YOLO model
 * costs seconds, and per-call spawning would make continuous monitoring
 * unusable.
 */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SmartPlantError } from '../core/errors.js'

const HERE = dirname( fileURLToPath( import.meta.url ) )

export class PythonBridge {

	/**
	 * @param {object} [config]           - Options.
	 * @param {string} [config.python]    - Interpreter. Default `python3`.
	 * @param {string} [config.script]    - Bridge script path.
	 * @param {number} [config.timeout]   - Per-request timeout in ms.
	 */
	constructor( config = {} ) {

		this.python  = config.python || process.env.SMARTPLANT_PYTHON || 'python3'
		this.script  = config.script || join( HERE, 'bridge.py' )
		this.timeout = config.timeout ?? 120_000

		this.proc     = null
		this._pending = new Map()
		this._nextId  = 1
		this._stderr  = ''

	}

	get running() {

		return !!this.proc && !this.proc.killed

	}

	/**
	 * Start the interpreter.
	 *
	 * @returns {Promise<PythonBridge>} this
	 */
	async start() {

		if ( this.running ) return this

		this.proc = spawn( this.python, [ this.script ], { stdio : [ 'pipe', 'pipe', 'pipe' ] } )

		this.proc.on( 'error', err => {

			const message = err.code === 'ENOENT'
				? `Python interpreter "${this.python}" not found. Install Python 3, or set { python } / SMARTPLANT_PYTHON.`
				: err.message
			this._failAll( new SmartPlantError( message, 'BRIDGE_ERROR' ) )

		} )

		this.proc.stderr.on( 'data', c => {

			// Keep only the tail: a torch import warning can be enormous.
			this._stderr = ( this._stderr + c.toString() ).slice( -4000 )

		} )

		this.proc.on( 'close', code => {

			this._failAll( new SmartPlantError(
				`Python bridge exited (code ${code}). ${this._stderr.trim().slice( -400 )}`,
				'BRIDGE_ERROR',
			) )
			this.proc = null

		} )

		createInterface( { input : this.proc.stdout } ).on( 'line', line => this._onLine( line ) )

		return this

	}

	_onLine( line ) {

		if ( !line.trim() ) return

		let msg
		try {

			msg = JSON.parse( line )

		}
		catch {

			// Anything the backend printed to stdout that isn't our protocol.
			return

		}

		const entry = this._pending.get( msg.id )
		if ( !entry ) return

		this._pending.delete( msg.id )
		clearTimeout( entry.timer )

		if ( msg.ok ) entry.resolve( msg.result )
		else {

			entry.reject( new SmartPlantError(
				msg.hint ? `${msg.error}  →  ${msg.hint}` : msg.error,
				'BRIDGE_ERROR',
				{ traceback : msg.traceback },
			) )

		}

	}

	_failAll( err ) {

		for ( const { reject, timer } of this._pending.values() ) {

			clearTimeout( timer )
			reject( err )

		}
		this._pending.clear()

	}

	/**
	 * Send a request.
	 *
	 * @param   {string}          op        - Operation name.
	 * @param   {object}          [payload] - Operation payload.
	 * @returns {Promise<object>}           The result.
	 */
	async call( op, payload = {} ) {

		await this.start()

		const id = this._nextId++
		const request = JSON.stringify( {
			id,
			op,
			...payload,
		} )

		return new Promise( ( resolve, reject ) => {

			const timer = setTimeout( () => {

				this._pending.delete( id )
				reject( new SmartPlantError( `Python bridge timed out after ${this.timeout}ms on "${op}".`, 'BRIDGE_ERROR' ) )

			}, this.timeout )

			this._pending.set( id, {
				resolve,
				reject,
				timer,
			} )
			this.proc.stdin.write( request + '\n' )

		} )

	}

	/**
	 * Which Python backends are installed.
	 *
	 * @returns {Promise<object>} `{python, backends}`.
	 */
	async ping() {

		return this.call( 'ping' )

	}

	/**
	 * PlantCV phenotyping on a frame.
	 *
	 * @param   {object}          frame  - Frame from the vision layer.
	 * @param   {object}          [opts] - PlantCV options.
	 * @returns {Promise<object>}        Measurements.
	 */
	async plantcv( frame, opts = {} ) {

		return this.call( 'plantcv', {
			frame : encodeFrame( frame ),
			...opts,
		} )

	}

	/**
	 * YOLO detection or segmentation.
	 *
	 * @param   {object}          frame  - Frame.
	 * @param   {object}          [opts] - `{ model, confidence }`.
	 * @returns {Promise<object>}        `{model, detections}`.
	 */
	async yolo( frame, opts = {} ) {

		return this.call( 'yolo', {
			frame : encodeFrame( frame ),
			...opts,
		} )

	}

	/**
	 * mmdetection inference.
	 *
	 * @param   {object}          frame - Frame.
	 * @param   {object}          opts  - `{ config, checkpoint, device, confidence }`.
	 * @returns {Promise<object>}       `{detections}`.
	 */
	async mmdet( frame, opts ) {

		return this.call( 'mmdet', {
			frame : encodeFrame( frame ),
			...opts,
		} )

	}

	/**
	 * Run your own Python against the frame.
	 *
	 * The script receives `frame` as a numpy array and must set `result`. Use it
	 * for detectron2, a custom torch model, or anything else not covered above.
	 *
	 * Only pass scripts you wrote: this executes them in the bridge interpreter.
	 * Never build one from model output, a filename, or any other untrusted text.
	 *
	 * @param   {object}          frame  - Frame.
	 * @param   {string}          script - Python source.
	 * @returns {Promise<*>}             Whatever the script set as `result`.
	 */
	async run( frame, script ) {

		return this.call( 'eval', {
			frame : encodeFrame( frame ),
			script,
		} )

	}

	/** Stop the interpreter. */
	async stop() {

		if ( this.proc ) {

			this.proc.stdin.end()
			this.proc.kill()
			this.proc = null

		}
		return this

	}

}

/**
 * Encode a frame for the wire.
 *
 * @param   {object} frame - Frame.
 * @returns {object}       Wire representation.
 */
export function encodeFrame( frame ) {

	if ( !frame?.data ) throw new SmartPlantError( 'encodeFrame needs a Frame.', 'VISION_ERROR' )
	return {
		width    : frame.width,
		height   : frame.height,
		channels : frame.channels,
		data     : Buffer.from( frame.data.buffer, frame.data.byteOffset, frame.data.length ).toString( 'base64' ),
	}

}
