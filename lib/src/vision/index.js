/**
 * Vision layer.
 *
 * Three tiers, chosen by what you have available:
 *
 *   1. Classical, pure JS      — always works, no install, interpretable numbers.
 *   2. ONNX Runtime            — a trained model, on the edge, no Python.
 *   3. Python bridge           — the full PlantCV / YOLO / detectron2 ecosystem.
 *
 * `PlantVision` composes them: it always produces the tier-1 phenotype, and
 * layers 2 and 3 on top when configured.
 */

export {
	analyzeFrame, canopyGeometry, compareFrames, createFrame, describePhenotype,
	excessGreen, rgbToHsv, segmentPlant, tissueComposition,
} from './analysis.js'

export {
	CallbackSource, createSource, FFmpegSource, parsePPM, RawFileSource, VisionSource,
} from './sources.js'

export {
	decodeYolo, frameToTensor, iou, nonMaxSuppression, OnnxModel,
} from './onnx.js'

export {
	encodeFrame, PythonBridge,
} from './bridge.js'

import { analyzeFrame, compareFrames, describePhenotype } from './analysis.js'
import { PythonBridge } from './bridge.js'
import { OnnxModel } from './onnx.js'
import { createSource } from './sources.js'

/**
 * The vision façade: one object that grabs a frame and returns everything the
 * configured tiers can say about it.
 */
export class PlantVision {

	/**
	 * @param {object} [config]           - Options.
	 * @param {object} [config.source]    - Source spec, e.g. `{ source: 'ffmpeg', input: '/dev/video0' }`.
	 * @param {object} [config.onnx]      - `OnnxModel` config, to enable tier 2.
	 * @param {object} [config.python]    - `PythonBridge` config, to enable tier 3.
	 * @param {number} [config.threshold] - Segmentation threshold.
	 */
	constructor( config = {} ) {

		this.config    = config
		this.source    = config.source ? createSource( config.source ) : null
		this.model     = config.onnx ? new OnnxModel( config.onnx ) : null
		this.bridge    = config.python ? new PythonBridge( config.python ) : null
		this.threshold = config.threshold

		/** Last phenotype, kept so `analyze()` can report change over time. */
		this.previous  = null

	}

	/**
	 * Grab one frame from the configured source.
	 *
	 * @returns {Promise<object>} Frame.
	 */
	async grab() {

		if ( !this.source ) throw new Error( 'No vision source configured. Pass { source: { source: "ffmpeg", input: "/dev/video0" } }.' )
		await this.source.open()
		return this.source.grab()

	}

	/**
	 * Analyze a frame across every configured tier.
	 *
	 * @param   {object}          [frame] - Frame. Grabbed from the source if omitted.
	 * @param   {object}          [opts]  - Options.
	 * @returns {Promise<object>}         Combined analysis.
	 */
	async analyze( frame, opts = {} ) {

		const f = frame || await this.grab()

		const phenotype = analyzeFrame( f, { threshold : opts.threshold ?? this.threshold } )
		const result = {
			phenotype,
			description : describePhenotype( phenotype ),
			change      : this.previous ? compareFrames( this.previous, phenotype ) : null,
		}

		// Tiers 2 and 3 are enhancements, never preconditions: a missing model or
		// a broken Python install must not cost you the measurements you already have.
		if ( this.model ) {

			try {

				result.detections = await this.model.detect( f, opts )

			}
			catch ( err ) {

				result.onnxError = err.message

			}

		}

		if ( this.bridge && opts.plantcv !== false ) {

			try {

				result.plantcv = await this.bridge.plantcv( f, opts.plantcvOptions || {} )

			}
			catch ( err ) {

				result.plantcvError = err.message

			}

		}

		this.previous = phenotype
		return result

	}

	/**
	 * Which tiers are actually usable right now.
	 *
	 * @returns {Promise<object>} Capability report.
	 */
	async capabilities() {

		const out = {
			classical : true,
			source    : !!this.source,
			onnx      : false,
			python    : false,
		}

		if ( this.model ) {

			out.onnx = await this.model.load().then( () => true ).catch( () => false )

		}
		if ( this.bridge ) {

			out.python = await this.bridge.ping().catch( () => null )

		}

		return out

	}

	async close() {

		await this.source?.close()
		await this.model?.dispose()
		await this.bridge?.stop()
		return this

	}

}
