/**
 * ONNX Runtime inference.
 *
 * ONNX is the interchange format the whole list converges on: a model trained in
 * PyTorch (YOLO, detectron2, segmentation_models.pytorch) or TensorFlow exports
 * to ONNX, and then runs here — in Node, on the edge device, with no Python at
 * inference time. That is the difference between "you need a workstation" and
 * "it runs on the Pi next to the plant".
 *
 * `onnxruntime-node` is an optional dependency, loaded on demand.
 */

import { SmartPlantError } from '../core/errors.js'

export class OnnxModel {

	/**
	 * @param {object} [config]              - Options.
	 * @param {string} [config.path]         - Path to the .onnx file.
	 * @param {number} [config.inputSize]    - Square input size. Default 640.
	 * @param {string[]} [config.labels]     - Class names by index.
	 * @param {string} [config.layout]       - `'nchw'` (default) or `'nhwc'`.
	 */
	constructor( config = {} ) {

		if ( !config.path ) throw new SmartPlantError( 'OnnxModel needs a { path } to a .onnx file.', 'VISION_ERROR' )

		this.path      = config.path
		this.inputSize = config.inputSize ?? 640
		this.labels    = config.labels || null
		this.layout    = config.layout || 'nchw'
		this.session   = null
		this._ort      = null

	}

	/**
	 * Load the model.
	 *
	 * @returns {Promise<OnnxModel>} this
	 */
	async load() {

		if ( this.session ) return this

		try {

			this._ort = await import( 'onnxruntime-node' )

		}
		catch ( err ) {

			throw new SmartPlantError(
				'ONNX inference needs the "onnxruntime-node" package. Install it with: npm install onnxruntime-node',
				'VISION_ERROR',
				{ cause : err.message },
			)

		}

		const ort = this._ort.default || this._ort
		this.session = await ort.InferenceSession.create( this.path )
		return this

	}

	/**
	 * Run the model on a frame.
	 *
	 * @param   {object}          frame  - Frame from the vision layer.
	 * @param   {object}          [opts] - Options.
	 * @returns {Promise<object>}        Raw output tensors, keyed by name.
	 */
	async infer( frame, opts = {} ) {

		await this.load()

		const ort    = this._ort.default || this._ort
		const size   = opts.inputSize ?? this.inputSize
		const tensor = frameToTensor( frame, size, this.layout )

		const dims = this.layout === 'nchw'
			? [ 1, 3, size, size ]
			: [ 1, size, size, 3 ]

		const inputName = this.session.inputNames[ 0 ]
		const feeds = { [ inputName ] : new ort.Tensor( 'float32', tensor, dims ) }

		const output = await this.session.run( feeds )

		return Object.fromEntries( Object.entries( output ).map( ( [ name, t ] ) => [ name, {
			dims : t.dims,
			data : t.data,
		} ] ) )

	}

	/**
	 * Run a YOLO-family model and decode its output into detections.
	 *
	 * Handles the two common export layouts: `[1, 84, N]` (YOLOv8) and
	 * `[1, N, 85]` (YOLOv5), detected from the tensor dimensions.
	 *
	 * @param   {object}            frame  - Frame.
	 * @param   {object}            [opts] - `{ confidence, iou }`.
	 * @returns {Promise<object[]>}        Detections.
	 */
	async detect( frame, opts = {} ) {

		const confidence = opts.confidence ?? 0.25
		const iou        = opts.iou ?? 0.45
		const size       = opts.inputSize ?? this.inputSize

		const outputs = await this.infer( frame, opts )
		const first   = Object.values( outputs )[ 0 ]
		if ( !first ) return []

		const boxes = decodeYolo( first, confidence, this.labels )
		const kept  = nonMaxSuppression( boxes, iou )

		// Map back from the square letterbox to the original frame.
		const sx = frame.width / size
		const sy = frame.height / size

		return kept.map( d => ( {
			...d,
			box : [
				Number( ( d.box[ 0 ] * sx ).toFixed( 1 ) ),
				Number( ( d.box[ 1 ] * sy ).toFixed( 1 ) ),
				Number( ( d.box[ 2 ] * sx ).toFixed( 1 ) ),
				Number( ( d.box[ 3 ] * sy ).toFixed( 1 ) ),
			],
		} ) )

	}

	async dispose() {

		await this.session?.release?.()
		this.session = null
		return this

	}

}

/**
 * Resize a frame to a square and convert it to a normalized float tensor.
 *
 * Nearest-neighbour resize keeps this dependency-free; for detection at these
 * input sizes the accuracy cost is negligible compared to needing a native
 * image library on every edge device.
 *
 * @param   {object}       frame  - Frame.
 * @param   {number}       size   - Target square size.
 * @param   {string}       layout - `'nchw'` or `'nhwc'`.
 * @returns {Float32Array}        Tensor data.
 */
export function frameToTensor( frame, size, layout = 'nchw' ) {

	const out = new Float32Array( size * size * 3 )
	const xRatio = frame.width / size
	const yRatio = frame.height / size

	for ( let y = 0; y < size; y++ ) {

		const srcY = Math.min( frame.height - 1, Math.floor( y * yRatio ) )

		for ( let x = 0; x < size; x++ ) {

			const srcX = Math.min( frame.width - 1, Math.floor( x * xRatio ) )
			const o = ( srcY * frame.width + srcX ) * frame.channels

			const r = frame.data[ o ] / 255
			const g = frame.data[ o + 1 ] / 255
			const b = frame.data[ o + 2 ] / 255

			if ( layout === 'nchw' ) {

				const p = y * size + x
				out[ p ] = r
				out[ size * size + p ] = g
				out[ 2 * size * size + p ] = b

			}
			else {

				const p = ( y * size + x ) * 3
				out[ p ] = r
				out[ p + 1 ] = g
				out[ p + 2 ] = b

			}

		}

	}

	return out

}

/**
 * Decode a YOLO output tensor into candidate boxes.
 *
 * @param   {object}   tensor     - `{dims, data}`.
 * @param   {number}   confidence - Score threshold.
 * @param   {string[]} [labels]   - Class names.
 * @returns {object[]}            Candidates in xyxy.
 */
export function decodeYolo( tensor, confidence, labels ) {

	const { dims, data } = tensor
	if ( dims.length !== 3 ) return []

	const [ , d1, d2 ] = dims
	// YOLOv8 exports [1, 4+classes, boxes]; v5 exports [1, boxes, 5+classes].
	const transposed = d1 < d2
	const numBoxes   = transposed ? d2 : d1
	const stride     = transposed ? d1 : d2

	const at = ( box, attr ) => ( transposed ? data[ attr * numBoxes + box ] : data[ box * stride + attr ] )

	// v5 carries an objectness column at index 4; v8 does not.
	const hasObjectness = !transposed && stride > 5
	const classOffset   = hasObjectness ? 5 : 4
	const numClasses    = stride - classOffset

	const out = []

	for ( let i = 0; i < numBoxes; i++ ) {

		let bestScore = 0, bestClass = -1
		for ( let c = 0; c < numClasses; c++ ) {

			const s = at( i, classOffset + c )
			if ( s > bestScore ) {

				bestScore = s
				bestClass = c

			}

		}

		const score = hasObjectness ? bestScore * at( i, 4 ) : bestScore
		if ( score < confidence || bestClass < 0 ) continue

		const cx = at( i, 0 ), cy = at( i, 1 ), w = at( i, 2 ), h = at( i, 3 )

		out.push( {
			label      : labels?.[ bestClass ] ?? String( bestClass ),
			classId    : bestClass,
			confidence : Number( score.toFixed( 4 ) ),
			box        : [ cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2 ],
		} )

	}

	return out

}

/**
 * Greedy non-maximum suppression.
 *
 * @param   {object[]} boxes     - Candidates.
 * @param   {number}   threshold - IoU threshold.
 * @returns {object[]}           Kept boxes.
 */
export function nonMaxSuppression( boxes, threshold = 0.45 ) {

	const sorted = [ ...boxes ].sort( ( a, b ) => b.confidence - a.confidence )
	const kept = []

	for ( const candidate of sorted ) {

		let overlaps = false
		for ( const k of kept ) {

			if ( k.classId === candidate.classId && iou( k.box, candidate.box ) > threshold ) {

				overlaps = true
				break

			}

		}
		if ( !overlaps ) kept.push( candidate )

	}

	return kept

}

/** Intersection over union of two xyxy boxes. */
export function iou( a, b ) {

	const x1 = Math.max( a[ 0 ], b[ 0 ] )
	const y1 = Math.max( a[ 1 ], b[ 1 ] )
	const x2 = Math.min( a[ 2 ], b[ 2 ] )
	const y2 = Math.min( a[ 3 ], b[ 3 ] )

	const inter = Math.max( 0, x2 - x1 ) * Math.max( 0, y2 - y1 )
	if ( inter === 0 ) return 0

	const areaA = ( a[ 2 ] - a[ 0 ] ) * ( a[ 3 ] - a[ 1 ] )
	const areaB = ( b[ 2 ] - b[ 0 ] ) * ( b[ 3 ] - b[ 1 ] )

	return inter / ( areaA + areaB - inter )

}
