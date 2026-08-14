/**
 * The system being wrong about itself, and one door for every action.
 *
 * These four are what turn a set of internal states from something the system
 * reports into something that governs it — and, more importantly, into
 * something that can be found to have been governing it badly.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import { Experiment } from '../src/personalization/index.js'
import {
	grade, OUTCOME, StateCalibration,
} from '../src/states/calibration.js'
import { ACTION, CARE, permits, posture } from '../src/states/gate.js'
import { AXIS, Trajectory } from '../src/states/trajectory.js'

const defending = () => ( {
	defense_activation : {
		name : 'defense_activation',
		level : 'high',
		confidence : 'medium',
		acts : true,
		why : 'Wounded.',
	},
	stress_load : {
		name : 'stress_load',
		level : 'low',
		acts : false,
	},
} )

const loaded = () => ( {
	stress_load : {
		name : 'stress_load',
		level : 'medium',
		confidence : 'medium',
		acts : true,
		why : 'Several episodes.',
	},
} )

describe( 'one door, and what may never be shut', () => {

	it( 'never blocks care, whatever the plant is doing', () => {

		for ( const action of CARE ) {

			const r = permits( defending(), action )
			assert.equal( r.allowed, true )
			assert.equal( r.care, true )
			assert.match( r.why, /worst possible reading of this idea/ )

		}

	} )

	it( 'blocks the elective things a defending plant should not be asked for', () => {

		for ( const action of [ ACTION.PROBE.id, ACTION.EXPERIMENT.id, ACTION.AID.id, ACTION.MOVE.id ] ) {

			assert.equal( permits( defending(), action ).allowed, false, `${action} was allowed` )

		}

	} )

	it( 'shrinks rather than refuses where an action has a size', () => {

		const r = permits( loaded(), ACTION.PROBE.id )

		assert.equal( r.allowed, true )
		assert.equal( r.scale, 0.75 )
		assert.match( r.why, /half a treatment on a plant with little room is better than none/ )

	} )

	it( 'does not treat silence as approval', () => {

		const r = permits( defending(), 'something-nobody-thought-about' )

		assert.equal( r.allowed, true )
		// The honest reading of an unlisted action.
		assert.match( r.why, /That is not approval/ )

	} )

	it( 'ignores a state that is not allowed to act', () => {

		const weak = { defense_activation : {
			name : 'defense_activation',
			level : 'high',
			confidence : 'low',
			acts : false,
			why : 'x',
		} }

		assert.equal( permits( weak, ACTION.PROBE.id ).allowed, true )

	} )

	it( 'shows the whole posture at once', () => {

		const rows = posture( defending() )

		assert.equal( rows.length, Object.keys( ACTION ).length )
		assert.ok( rows.every( r => typeof r.allowed === 'boolean' ) )

	} )

} )

describe( 'an override is the only natural experiment there is', () => {

	it( 'grades one that turned out fine as a false positive', () => {

		const r = grade(
			{
				wellbeing : 70,
				states : defending(),
			},
			{
				wellbeing : 72,
				states : defending(),
			},
		)

		assert.equal( r.outcome, OUTCOME.FALSE_POSITIVE )
		assert.match( r.why, /ran the trial the system declined to run/ )

	} )

	it( 'grades one that went badly as the state being right', () => {

		const worse = defending()
		worse.stress_load = {
			level : 'high',
			acts : true,
		}

		const r = grade( {
			wellbeing : 70,
			states : defending(),
		}, {
			wellbeing : 68,
			states : worse,
		} )

		assert.equal( r.outcome, OUTCOME.VINDICATED )
		assert.match( r.why, /the something happened/ )

	} )

	it( 'refuses to grade without a follow-up', () => {

		assert.equal( grade( { wellbeing : 70 }, {} ).outcome, OUTCOME.UNCLEAR )

	} )

	it( 'will not act on an anecdote', () => {

		const cal = new StateCalibration()

		for ( let i = 0; i < 4; i++ ) {

			const id = cal.overridden( {
				state : 'defense_activation',
				level : 'high',
				before : {
					wellbeing : 70,
					states : {},
				},
			} )
			cal.settle( id, {
				wellbeing : 72,
				states : {},
			} )

		}

		const record = cal.record( 'defense_activation' )
		assert.equal( record.known, false )
		assert.match( record.why, /retunes its own safety gates from anecdotes/ )

	} )

	it( 'raises the bar on a state that refuses things that turn out fine', () => {

		const cal = new StateCalibration()

		for ( let i = 0; i < 14; i++ ) {

			const id = cal.overridden( {
				state : 'defense_activation',
				level : 'high',
				before : {
					wellbeing : 70,
					states : {},
				},
			} )
			cal.settle( id, {
				wellbeing : 72,
				states : {},
			} )

		}

		const record = cal.record( 'defense_activation' )
		assert.equal( record.known, true )
		assert.equal( record.tooEager, true )

		// The bar goes up, and only up: a medium-confidence state loses its say.
		const gated = cal.gate( {
			name : 'defense_activation',
			acts : true,
			confidence : 'medium',
		} )
		assert.equal( gated.acts, false )

		// A high-confidence one keeps it.
		assert.equal( cal.gate( {
			name : 'defense_activation',
			acts : true,
			confidence : 'high',
		} ).acts, true )

	} )

	it( 'cannot find a state that is too permissive, and does not pretend to', () => {

		const cal = new StateCalibration()
		const r = cal.report()

		// Nobody overrides a permission, so the evidence structurally cannot
		// exist and no gate is ever loosened on the strength of it.
		assert.match( r.why, /still running on its original judgement/ )

	} )

	it( 'closes the loop through a real plant', async () => {

		const plant = await createPlant( {
			name : 'Overridden',
			species : 'Ficus',
			sensor : {
				driver : 'mock',
				dayNight : false,
			},
			ai : { provider : 'mock' },
		} )

		for ( let i = 0; i < 12; i++ ) {

			await plant.memory.addReading( {
				timestamp : Date.now() - ( 12 - i ) * 3600_000,
				temperature : 22,
				humidity : 55,
				soil : 45,
				light : 900,
			} )

		}
		await plant.read()

		plant.perception.electro = { events : [ { label : 'variation_potential' } ] }
		plant.perception.vision = { findings : { chewing : true } }
		plant._lastRegime = {
			changed : true,
			baselineReady : true,
		}

		assert.equal( plant.mayI( ACTION.PROBE.id ).allowed, false )

		const forced = plant.mayI( ACTION.PROBE.id, { force : true } )
		assert.equal( forced.allowed, true )
		assert.ok( forced.trial, 'an override left no trial to grade' )

		const settled = plant.settleTrial( forced.trial )
		assert.ok( Object.values( OUTCOME ).includes( settled.outcome ) )

		await plant.destroy()

	} )

} )

describe( 'an experiment stops for the subject, not only for the data', () => {

	const baseline = {
		wellbeing : 80,
		states : {
			defense_activation : { level : 'low' },
			stress_load : { level : 'low' },
		},
	}

	it( 'runs while the plant is no worse', () => {

		const e = new Experiment( { baseline } )

		assert.equal( e.checkSubject( {
			defense_activation : { level : 'low' },
			stress_load : { level : 'low' },
		}, { wellbeing : 78 } ).stop, false )

	} )

	it( 'abandons the moment the subject deteriorates', () => {

		const e = new Experiment( { baseline } )
		const r = e.checkSubject( {
			defense_activation : { level : 'medium' },
			stress_load : { level : 'low' },
		}, { wellbeing : 79 } )

		assert.equal( r.stop, true )
		assert.equal( r.abandoned, true )
		assert.equal( e.done, true )
		assert.match( r.why, /no result is worth finishing it for/ )

	} )

	it( 'abandons on wellbeing alone', () => {

		const e = new Experiment( { baseline } )

		assert.equal( e.checkSubject( {
			defense_activation : { level : 'low' },
			stress_load : { level : 'low' },
		}, { wellbeing : 60 } ).stop, true )

	} )

	it( 'says when its kill switch is not armed', () => {

		const e = new Experiment( {} )

		// A plant that was already loaded is not held to a standard it never met
		// — but neither is one whose starting point nobody recorded.
		assert.match( e.checkSubject( {} ).why, /its kill switch does not/ )

	} )

} )

describe( 'the trajectory of the pairing', () => {

	const entry = ( i, over = {} ) => ( {
		at : i * 7 * 86_400_000,
		states : 0.2,
		assessable : 0.8,
		predictionError : 0.1,
		refusalRate : 0.1,
		falsePositives : 0.1,
		electrodeDrift : 0,
		...over,
	} )

	it( 'refuses to read a shape from four points', () => {

		const t = new Trajectory()
		t.entries = [ entry( 0 ), entry( 1 ), entry( 2 ) ]

		assert.equal( t.compare().known, false )
		assert.match( t.compare().why, /four points is not a shape/ )

	} )

	it( 'tells an ageing electrode from a declining plant', () => {

		const t = new Trajectory()
		t.entries = [
			entry( 0 ), entry( 1 ), entry( 2 ),
			entry( 3, {
				electrodeDrift : 1,
				assessable : 0.5,
			} ),
			entry( 4, {
				electrodeDrift : 1,
				assessable : 0.5,
			} ),
			entry( 5, {
				electrodeDrift : 1,
				assessable : 0.5,
			} ),
		]

		const c = t.compare()
		assert.equal( c.verdict, 'instrument' )
		// The two are indistinguishable in a snapshot, which is the reason for
		// keeping a slow record at all.
		assert.match( c.why, /completely different over a season/ )

	} )

	it( 'calls several axes moving together what it is', () => {

		const t = new Trajectory()
		t.entries = Array.from( { length : 6 }, ( _, i ) => entry( i, {
			states : 0.1 + i * 0.15,
			predictionError : 0.1 + i * 0.05,
			refusalRate : 0.1 + i * 0.08,
			falsePositives : 0.05 + i * 0.09,
		} ) )

		assert.equal( t.compare().verdict, 'degrading' )

	} )

	it( 'calls a settled pairing settled', () => {

		const t = new Trajectory()
		t.entries = Array.from( { length : 6 }, ( _, i ) => entry( i, { predictionError : 0.2 - i * 0.02 } ) )

		assert.equal( t.compare().verdict, 'deepening' )

	} )

	it( 'declares which side of the pairing each axis is about', () => {

		for ( const axis of Object.values( AXIS ) ) {

			assert.ok( [ 'plant', 'model', 'instrument' ].includes( axis.side ) )
			assert.ok( [ 'up', 'down' ].includes( axis.better ) )

		}

	} )

	it( 'is slower than anything it describes', async () => {

		const plant = await createPlant( {
			name : 'Slow',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		await plant.read()

		const first = plant.trajectory( { force : true } )
		assert.equal( first.known, false )

		// A second call the same day does not add an entry: weekly by default,
		// because a trajectory sampled daily is just another reading.
		plant.trajectory()
		assert.equal( first.log.entries.length, 1 )

		await plant.destroy()

	} )

} )
