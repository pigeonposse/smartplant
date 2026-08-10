import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
	analyzeFrame, canopyGeometry, compareFrames, createFrame, decodeYolo,
	describePhenotype, excessGreen, frameToTensor, iou, nonMaxSuppression,
	parsePPM, rgbToHsv, segmentPlant, tissueComposition,
} from '../src/vision/index.js'

/**
 * Paint a synthetic scene: a coloured rectangle on a dark background.
 * Enough to exercise segmentation, geometry and tissue classification exactly.
 */
function scene( {
	width = 64, height = 64, color = [ 40, 160, 50 ], box = null, bg = [ 20, 20, 25 ],
} = {} ) {

	const data = new Uint8Array( width * height * 3 )

	for ( let y = 0; y < height; y++ ) {

		for ( let x = 0; x < width; x++ ) {

			const inBox = box && x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height
			const [ r, g, b ] = inBox ? color : bg
			const o = ( y * width + x ) * 3
			data[ o ] = r
			data[ o + 1 ] = g
			data[ o + 2 ] = b

		}

	}

	return createFrame( data, width, height, 3 )

}

describe( 'vegetation index', () => {

	it( 'is positive for green and negative for red', () => {

		assert.ok( excessGreen( 40, 160, 50 ) > 0 )
		assert.ok( excessGreen( 180, 40, 40 ) < 0 )

	} )

	it( 'is invariant to brightness — it must track the plant, not the lights', () => {

		const bright = excessGreen( 80, 255, 100 )
		const dim    = excessGreen( 20, 80, 25 )
		const normal = excessGreen( 40, 160, 50 )

		assert.ok( Math.abs( dim - normal ) < 0.01, 'halving the exposure must not change the index' )
		assert.ok( bright > 0 )

	} )

} )

describe( 'segmentation', () => {

	it( 'finds a green rectangle and measures its coverage', () => {

		const frame = scene( { box : {
			x : 16,
			y : 16,
			width : 32,
			height : 32,
		} } )
		const seg = segmentPlant( frame )

		assert.equal( seg.count, 32 * 32 )
		assert.ok( Math.abs( seg.coverage - 0.25 ) < 0.01 )

	} )

	it( 'finds nothing in an empty scene', () => {

		assert.equal( segmentPlant( scene() ).count, 0 )

	} )

	it( 'ignores near-black pixels whose chromaticity is unreliable', () => {

		// Very dark but nominally "green" pixels must not be counted as plant.
		const frame = scene( {
			bg : [ 2, 8, 3 ],
			box : null,
		} )
		assert.equal( segmentPlant( frame ).count, 0 )

	} )

} )

describe( 'geometry', () => {

	it( 'measures the bounding box, centroid and density', () => {

		const frame = scene( { box : {
			x : 10,
			y : 20,
			width : 20,
			height : 10,
		} } )
		const { mask } = segmentPlant( frame )
		const g = canopyGeometry( mask, frame.width, frame.height )

		assert.equal( g.found, true )
		assert.deepEqual( g.boundingBox, {
			x : 10,
			y : 20,
			width : 20,
			height : 10,
		} )
		// Columns 10..29 inclusive, so the true centre is 19.5.
		assert.equal( g.centroid.x, 20 )
		assert.equal( g.density, 1, 'a solid rectangle fills its box completely' )
		assert.equal( g.aspectRatio, 2 )

	} )

	it( 'reports not-found for an empty mask', () => {

		assert.equal( canopyGeometry( new Uint8Array( 100 ), 10, 10 ).found, false )

	} )

	it( 'verticalCentroid rises as the canopy sits lower in frame', () => {

		const high = scene( { box : {
			x : 10,
			y : 4,
			width : 20,
			height : 10,
		} } )
		const low  = scene( { box : {
			x : 10,
			y : 44,
			width : 20,
			height : 10,
		} } )

		const gh = canopyGeometry( segmentPlant( high ).mask, 64, 64 )
		const gl = canopyGeometry( segmentPlant( low ).mask, 64, 64 )

		assert.ok( gl.verticalCentroid > gh.verticalCentroid )

	} )

} )

describe( 'tissue classification', () => {

	it( 'separates healthy green from yellow and brown', () => {

		const healthy = scene( {
			color : [ 40, 160, 50 ],
			box : {
				x : 0,
				y : 0,
				width : 64,
				height : 64,
			},
		} )
		const yellow  = scene( {
			color : [ 200, 210, 40 ],
			box : {
				x : 0,
				y : 0,
				width : 64,
				height : 64,
			},
		} )

		const h = tissueComposition( healthy, segmentPlant( healthy ).mask )
		const y = tissueComposition( yellow, segmentPlant( yellow ).mask )

		assert.ok( h.healthy > 0.9, `expected healthy tissue, got ${h.healthy}` )
		assert.ok( y.chlorotic > 0.9, `expected chlorotic tissue, got ${y.chlorotic}` )

	} )

} )

describe( 'phenotype', () => {

	it( 'scores a healthy plant above a yellowing one', () => {

		const box = {
			x : 8,
			y : 8,
			width : 40,
			height : 40,
		}
		const healthy = analyzeFrame( scene( {
			box,
			color : [ 40, 160, 50 ],
		} ) )
		const sick    = analyzeFrame( scene( {
			box,
			color : [ 200, 210, 40 ],
		} ) )

		assert.ok( healthy.healthIndex > sick.healthIndex )
		assert.ok( healthy.healthIndex > 50 )

	} )

	it( 'describes the phenotype in words', () => {

		const p = analyzeFrame( scene( { box : {
			x : 8,
			y : 8,
			width : 40,
			height : 40,
		} } ) )

		assert.match( describePhenotype( p ), /canopy covers/ )
		assert.match( describePhenotype( p ), /visual health/ )

	} )

	it( 'says so when there is no plant', () => {

		assert.match( describePhenotype( analyzeFrame( scene() ) ), /No plant detected/ )

	} )

	it( 'detects canopy shrinkage and drooping between frames', () => {

		const before = analyzeFrame( scene( { box : {
			x : 10,
			y : 10,
			width : 40,
			height : 40,
		} } ) )
		const after  = analyzeFrame( scene( { box : {
			x : 15,
			y : 30,
			width : 30,
			height : 30,
		} } ) )

		const change = compareFrames( before, after )

		assert.ok( change.coveragePercent < -5, 'canopy shrank' )
		assert.ok( change.droopDelta > 0, 'canopy dropped' )
		assert.ok( change.findings.some( f => /shrank/.test( f ) ) )
		assert.ok( change.findings.some( f => /wilting/.test( f ) ) )

	} )

} )

describe( 'frame handling', () => {

	it( 'rejects a buffer that is too small', () => {

		assert.throws( () => createFrame( new Uint8Array( 10 ), 64, 64, 3 ), /too small/ )

	} )

	it( 'parses a binary PPM, comments and all', () => {

		const header = Buffer.from( 'P6\n# made by a test\n2 2\n255\n', 'ascii' )
		const pixels = Buffer.from( [ 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255 ] )
		const frame  = parsePPM( Buffer.concat( [ header, pixels ] ) )

		assert.equal( frame.width, 2 )
		assert.equal( frame.height, 2 )
		assert.equal( frame.data[ 0 ], 255 )
		assert.equal( frame.data[ 4 ], 255 )

	} )

	it( 'converts RGB to HSV', () => {

		assert.equal( Math.round( rgbToHsv( 255, 0, 0 ).h ), 0 )
		assert.equal( Math.round( rgbToHsv( 0, 255, 0 ).h ), 120 )
		assert.equal( rgbToHsv( 0, 0, 0 ).s, 0 )

	} )

} )

describe( 'onnx helpers', () => {

	it( 'builds an NCHW tensor of the right size and range', () => {

		const t = frameToTensor( scene( { box : {
			x : 0,
			y : 0,
			width : 64,
			height : 64,
		} } ), 32, 'nchw' )

		assert.equal( t.length, 32 * 32 * 3 )
		assert.ok( t.every( v => v >= 0 && v <= 1 ), 'values must be normalized' )

	} )

	it( 'computes IoU correctly', () => {

		assert.equal( iou( [ 0, 0, 10, 10 ], [ 0, 0, 10, 10 ] ), 1 )
		assert.equal( iou( [ 0, 0, 10, 10 ], [ 20, 20, 30, 30 ] ), 0 )
		assert.ok( Math.abs( iou( [ 0, 0, 10, 10 ], [ 5, 0, 15, 10 ] ) - 1 / 3 ) < 1e-6 )

	} )

	it( 'suppresses overlapping boxes of the same class', () => {

		const boxes = [
			{
				classId : 0,
				confidence : 0.9,
				box : [ 0, 0, 10, 10 ],
			},
			{
				classId : 0,
				confidence : 0.8,
				box : [ 1, 1, 11, 11 ],
			},
			{
				classId : 1,
				confidence : 0.7,
				box : [ 0, 0, 10, 10 ],
			},
		]

		const kept = nonMaxSuppression( boxes, 0.5 )

		assert.equal( kept.length, 2, 'the duplicate box goes, the other class stays' )
		assert.equal( kept[ 0 ].confidence, 0.9 )

	} )

	it( 'decodes a YOLOv8-shaped output tensor', () => {

		// [1, 4 + 2 classes, 20 boxes] — the YOLOv8 layout, where the box count
		// exceeds the attribute count. That relationship is how the decoder tells
		// the v8 and v5 layouts apart, so the fixture has to respect it.
		const numBoxes = 20, attrs = 6
		const data = new Float32Array( attrs * numBoxes )
		const set = ( attr, box, v ) => {

			data[ attr * numBoxes + box ] = v

		}

		set( 0, 0, 50 )
		set( 1, 0, 50 )
		set( 2, 0, 20 )
		set( 3, 0, 20 )
		set( 4, 0, 0.9 )
		set( 5, 0, 0.1 )

		set( 0, 1, 10 )
		set( 1, 1, 10 )
		set( 2, 1, 4 )
		set( 3, 1, 4 )
		set( 4, 1, 0.05 )
		set( 5, 1, 0.02 )

		const decoded = decodeYolo( {
			dims : [ 1, attrs, numBoxes ],
			data,
		}, 0.25, [ 'leaf', 'pest' ] )

		assert.equal( decoded.length, 1, 'the low-confidence box is dropped' )
		assert.equal( decoded[ 0 ].label, 'leaf' )
		assert.deepEqual( decoded[ 0 ].box, [ 40, 40, 60, 60 ] )

	} )

} )
