/**
 * Fusion, control, safety, confidence and personalization — the layers that let
 * a plant occupy and act on physical space.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	after, describe, it,
} from 'node:test'

import { createPlant } from '../src/index.js'
import { EvidenceLedger, RISK, ShadowMode } from '../src/confidence/index.js'
import {
	Arbitrator, collisionReflex, lostLocalizationReflex, PRIORITY,
} from '../src/control/index.js'
import {
	ChangePointDetector, EMA, Kalman1D, MultirateState, RATE, slopePerSecond,
} from '../src/fusion/index.js'
import {
	ContextualBandit, EpisodicMemory, Experiment, PlantPersonalization, wellbeingReward,
} from '../src/personalization/index.js'
import {
	EnergyManager, Geofence, pointInPolygon, SafetySupervisor, VERDICT, Watchdog,
} from '../src/safety/index.js'

const tmp = await mkdtemp( join( tmpdir(), 'smartplant-body-' ) )
after( () => rm( tmp, {
	recursive : true,
	force     : true,
} ) )

const makePlant = extra => createPlant( {
	name    : 'Ivy',
	species : 'Monstera deliciosa',
	sensor  : 'mock',
	ai      : { provider : 'mock' },
	memory  : { path : join( tmp, `${Math.random().toString( 36 ).slice( 2 )}.json` ) },
	...extra,
} )

describe( 'fusion filters', () => {

	it( 'EMA weights by elapsed time, not sample count', () => {

		const fast = new EMA( { tauMs : 1000 } )
		fast.push( 0, 0 )
		fast.push( 10, 100 )      // 0.1 tau → small step

		const slow = new EMA( { tauMs : 1000 } )
		slow.push( 0, 0 )
		slow.push( 10, 5000 )     // 5 tau → nearly all the way

		assert.ok( slow.value > fast.value, 'a longer gap must move the average further' )
		assert.ok( fast.value < 2 )
		assert.ok( slow.value > 9 )

	} )

	it( 'Kalman smooths noise and reports its own uncertainty', () => {

		const k = new Kalman1D( {
			processVariance : 1e-5,
			measurementVariance : 1,
		} )
		for ( let i = 0; i < 50; i++ ) k.push( 10 + ( Math.random() - 0.5 ) * 4 )

		assert.ok( Math.abs( k.value - 10 ) < 1.5, `expected ~10, got ${k.value}` )
		assert.ok( k.sd < 1, 'uncertainty should shrink with evidence' )

	} )

	it( 'change-point detection fires on a real shift, not on noise', () => {

		const d = new ChangePointDetector( {
			threshold : 5,
			drift : 0.5,
		} )

		let fired = false
		for ( let i = 0; i < 100; i++ ) if ( d.push( 50 + ( Math.random() - 0.5 ) ) .changed ) fired = true
		assert.equal( fired, false, 'noise must not trip the detector' )

		let changed = null
		for ( let i = 0; i < 40; i++ ) {

			const r = d.push( 65 )
			if ( r.changed ) changed = r

		}
		assert.ok( changed, 'a genuine step must trip it' )
		assert.equal( changed.direction, 'up' )

	} )

	it( 'slope is per second, so sample rate does not change the answer', () => {

		const fast = [ 0, 1000, 2000 ].map( ( t, i ) => ( {
			t,
			v : i,
		} ) )
		const slow = [ 0, 10_000, 20_000 ].map( ( t, i ) => ( {
			t,
			v : i * 10,
		} ) )

		assert.ok( Math.abs( slopePerSecond( fast ) - 1 ) < 1e-6 )
		assert.ok( Math.abs( slopePerSecond( slow ) - 1 ) < 1e-6 )

	} )

} )

describe( 'multirate state', () => {

	it( 'keeps fast raw and slow summarized, and never mixes them', () => {

		const s = new MultirateState()
		s.register( 'sonar', { rate : RATE.FAST } )
		s.register( 'soil', { rate : RATE.SLOW } )

		for ( let i = 0; i < 20; i++ ) s.push( 'sonar', 1 - i * 0.04 )
		for ( let i = 0; i < 20; i++ ) s.push( 'soil', 60 - i )

		const snap = s.snapshot()

		assert.ok( 'sonar' in snap.fast )
		assert.ok( !( 'sonar' in snap.slow ) )
		assert.ok( 'soil' in snap.slow )
		assert.ok( !( 'soil' in snap.fast ) )

		assert.ok( snap.fast.sonar.n > 0, 'fast keeps raw samples' )
		assert.ok( snap.slow.soil.average !== null, 'slow keeps a summary' )

	} )

	it( 'reports coherence and refuses to call a stale snapshot usable', async () => {

		const s = new MultirateState( { staleFastMs : 20 } )
		s.register( 'sonar', { rate : RATE.FAST } )
		s.push( 'sonar', 0.5 )

		assert.equal( s.snapshot().coherence.usableForControl, true )

		await new Promise( r => setTimeout( r, 60 ) )

		const stale = s.snapshot()
		assert.equal( stale.coherence.usableForControl, false )
		assert.deepEqual( stale.coherence.staleFast, [ 'sonar' ] )

	} )

	it( 'fast slope uses the monotonic clock, not wall time', () => {

		// Regression: samples arriving inside the same millisecond of wall time
		// share a `t`, which made the slope explode. Intervals must come from the
		// monotonic clock.
		const s = new MultirateState()
		s.register( 'sonar', { rate : RATE.FAST } )

		const t = Date.now()
		let mono = 0
		for ( const v of [ 1.0, 0.8, 0.6, 0.4 ] ) {

			s.push( 'sonar', v, {
				t,
				mono : ( mono += 1000 ),
			} )

		}

		// 0.2m lost per second.
		const { slope } = s.fast().sonar
		assert.ok( Math.abs( slope + 0.2 ) < 0.01, `expected ~-0.2 m/s, got ${slope}` )

	} )

	it( 'ingests a plant reading into slow channels automatically', () => {

		const s = new MultirateState()
		s.ingestReading( {
			soil : 44,
			temperature : 21,
			timestamp : new Date(),
			source : 'mock',
		} )

		const slow = s.slow()
		assert.ok( 'soil' in slow )
		assert.equal( slow.soil.value, 44 )

	} )

	it( 'auto-registers an unknown channel rather than dropping the data', () => {

		const s = new MultirateState()
		s.push( 'surprise', 42 )
		assert.equal( s.value( 'surprise' ), 42 )

	} )

} )

describe( 'energy management', () => {

	it( 'refuses a mission it could not return from', () => {

		const e = new EnergyManager( {
			capacityWh : 10,
			stateOfCharge : 0.3,
			moveDrawW : 20,
			speedMs : 0.1,
		} )

		const near = e.afford( { distanceM : 1 } )
		const far  = e.afford( { distanceM : 50 } )

		assert.equal( near.ok, true )
		assert.equal( far.ok, false )
		assert.match( far.reason, /return leg/ )

	} )

	it( 'always costs the return leg, even for a one-way request', () => {

		const e = new EnergyManager( {
			capacityWh : 100,
			moveDrawW : 10,
			speedMs : 1,
		} )
		const est = e.estimate( { distanceM : 10 } )

		assert.ok( est.returnWh > 0, 'the way home is not free' )
		assert.ok( est.totalWh > est.travelWh )

	} )

	it( 'blocks everything but survival below the critical threshold', () => {

		const e = new EnergyManager( {
			stateOfCharge : 0.05,
			criticalFraction : 0.1,
		} )

		assert.equal( e.critical, true )
		assert.equal( e.afford( { distanceM : 0.1 } ).ok, false )

	} )

	it( 'charging lifts the critical flag', () => {

		const e = new EnergyManager( { stateOfCharge : 0.05 } )
		assert.equal( e.critical, true )
		e.update( { charging : true } )
		assert.equal( e.critical, false )

	} )

} )

describe( 'geofence', () => {

	const square = [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ]

	it( 'point-in-polygon works for inside and outside', () => {

		assert.equal( pointInPolygon( [ 2, 2 ], square ), true )
		assert.equal( pointInPolygon( [ 5, 2 ], square ), false )

	} )

	it( 'rejects a target outside the bounds', () => {

		const g = new Geofence( { bounds : square } )
		assert.equal( g.contains( [ 2, 2 ] ).ok, true )
		assert.equal( g.contains( [ 9, 9 ] ).ok, false )

	} )

	it( 'rejects a target inside a keep-out zone', () => {

		const g = new Geofence( {
			bounds : square,
			keepOut : [ {
				name : 'stairs',
				polygon : [ [ 3, 3 ], [ 4, 3 ], [ 4, 4 ], [ 3, 4 ] ],
			} ],
		} )

		const verdict = g.contains( [ 3.5, 3.5 ] )
		assert.equal( verdict.ok, false )
		assert.match( verdict.reason, /stairs/ )

	} )

	it( 'refuses to move when the position is unknown', () => {

		const g = new Geofence( { bounds : square } )
		const verdict = g.contains( [ NaN, 2 ] )

		assert.equal( verdict.ok, false )
		assert.match( verdict.reason, /without localization/ )

	} )

} )

describe( 'safety supervisor', () => {

	const makeSupervisor = extra => new SafetySupervisor( {
		energy : {
			capacityWh : 100,
			stateOfCharge : 1,
		},
		geofence : {
			bounds : [ [ 0, 0 ], [ 5, 0 ], [ 5, 5 ], [ 0, 5 ] ],
			home : [ 1, 1 ],
		},
		limits : { minMoveIntervalMs : 0 },
		...extra,
	} )

	it( 'allows a reasonable move', () => {

		const s = makeSupervisor()
		const v = s.validate( {
			type : 'move',
			from : [ 1, 1 ],
			target : [ 3, 3 ],
		} )

		assert.equal( v.allowed, true )
		assert.equal( v.verdict, VERDICT.ALLOW )

	} )

	it( 'denies a move outside the fence', () => {

		const s = makeSupervisor()
		const v = s.validate( {
			type : 'move',
			from : [ 1, 1 ],
			target : [ 20, 20 ],
		} )

		assert.equal( v.allowed, false )
		assert.match( v.explanation, /DENY/ )

	} )

	it( 'caps an excessive watering instead of refusing it', () => {

		const s = makeSupervisor()
		const v = s.validate( {
			type : 'water',
			amountMl : 5000,
		} )

		assert.equal( v.verdict, VERDICT.MODIFY )
		assert.equal( v.mission.amountMl, 500 )
		assert.equal( v.allowed, true )

	} )

	it( 'rate-limits relocations', () => {

		const s = makeSupervisor( { limits : { minMoveIntervalMs : 60_000 } } )
		s.notifyMoved()

		const v = s.validate( {
			type : 'move',
			from : [ 1, 1 ],
			target : [ 2, 2 ],
		} )
		assert.equal( v.allowed, false )
		assert.match( v.reasons.join( ' ' ), /Moved too recently/ )

	} )

	it( 'an emergency stop denies everything until explicitly cleared', () => {

		const s = makeSupervisor()
		s.emergencyStop( 'test' )

		assert.equal( s.validate( {
			type : 'move',
			target : [ 2, 2 ],
		} ).allowed, false )
		assert.equal( s.validate( { type : 'water', amountMl : 10 } ).allowed, false )

		s.clearStop()
		assert.equal( s.validate( { type : 'water', amountMl : 10 } ).allowed, true )

	} )

	it( 'safeMode is always available', () => {

		const s = makeSupervisor( { energy : {
			capacityWh : 10,
			stateOfCharge : 0.02,
		} } )
		const mode = s.safeMode()

		assert.equal( mode.type, 'idle' )
		assert.ok( mode.reason.length > 0 )

	} )

	it( 'the watchdog trips and triggers an emergency stop', async () => {

		const s = makeSupervisor( { watchdog : { timeoutMs : 40 } } )
		s.watchdog.start()

		await new Promise( r => setTimeout( r, 150 ) )

		assert.equal( s.watchdog.tripped, true )
		assert.equal( s.stopped, true )
		assert.match( s.stopReason, /watchdog/ )

		s.watchdog.stop()

	} )

	it( 'a fed watchdog does not trip', async () => {

		const w = new Watchdog( { timeoutMs : 60 } ).start()
		const beat = setInterval( () => w.beat(), 15 )

		await new Promise( r => setTimeout( r, 150 ) )
		clearInterval( beat )

		assert.equal( w.tripped, false )
		w.stop()

	} )

} )

describe( 'evidence and confidence', () => {

	it( 'one cue is not enough for a medium-risk action', () => {

		const e = new EvidenceLedger()
		e.add( {
			source : 'soil',
			claim : 'drought',
			strength : 0.9,
		} )

		const verdict = e.isEnough( 'drought', RISK.MEDIUM )
		assert.equal( verdict.allowed, false )
		assert.ok( verdict.missing.some( m => /independent source/.test( m ) ) )

	} )

	it( 'two independent cues corroborate', () => {

		const long = Date.now() - 2 * 3600_000
		const e = new EvidenceLedger()
		e.add( {
			source : 'soil',
			claim : 'drought',
			strength : 0.8,
			since : long,
		} )
		e.add( {
			source : 'vision',
			claim : 'drought',
			strength : 0.7,
			since : long,
		} )

		const verdict = e.isEnough( 'drought', RISK.MEDIUM )
		assert.equal( verdict.allowed, true )
		assert.ok( verdict.score > 0.8 )

	} )

	it( 'a persistent condition is required for high-risk actions', () => {

		const e = new EvidenceLedger()
		e.add( {
			source : 'soil',
			claim : 'drought',
			strength : 0.95,
		} )
		e.add( {
			source : 'vision',
			claim : 'drought',
			strength : 0.95,
		} )

		const verdict = e.isEnough( 'drought', RISK.HIGH )
		assert.equal( verdict.allowed, false )
		assert.ok( verdict.missing.some( m => /has held/.test( m ) ) )

	} )

	it( 'critical actions always require a human', () => {

		const long = Date.now() - 24 * 3600_000
		const e = new EvidenceLedger()
		for ( const source of [ 'soil', 'vision', 'electro' ] ) {

			e.add( {
				source,
				claim : 'dying',
				strength : 1,
				since : long,
			} )

		}

		assert.equal( e.isEnough( 'dying', RISK.CRITICAL ).allowed, false )

	} )

	it( 'a chatty source cannot manufacture its own consensus', () => {

		const e = new EvidenceLedger()
		for ( let i = 0; i < 10; i++ ) {

			e.add( {
				source : 'soil',
				claim : 'drought',
				strength : 0.9,
			} )

		}

		assert.equal( e.score( 'drought' ).sources.length, 1 )
		assert.equal( e.isEnough( 'drought', RISK.MEDIUM ).allowed, false )

	} )

	it( 'human feedback lowers the weight of a source that was wrong', () => {

		const e = new EvidenceLedger()
		e.add( {
			source : 'ai',
			claim : 'pests',
			strength : 0.8,
		} )

		const before = e.weights.ai
		e.recordFeedback( 'pests', false )

		assert.ok( e.weights.ai < before )
		assert.ok( e.weights.ai >= 0.1, 'a source is discounted, never silenced' )

	} )

	it( 'explanations name the sources and the evidence', () => {

		const e = new EvidenceLedger()
		e.add( {
			source : 'soil',
			claim : 'drought',
			strength : 0.8,
			detail : 'soil at 12%',
		} )

		const text = e.explain( 'drought' )
		assert.match( text, /soil at 12%/ )
		assert.match( text, /confidence/ )

	} )

	it( 'builds cues from a real plant context', async () => {

		const plant = await makePlant( { sensor : {
			driver : 'mock',
			soil : 3,
			humidity : 6,
		} } )
		await plant.read()

		const e = new EvidenceLedger()
		e.ingest( plant.context(), plant.diagnose() )

		assert.ok( e.cues.length >= 2 )
		assert.ok( e.cues.some( c => c.source === 'reasoner' ) )

		await plant.destroy()

	} )

	it( 'shadow mode reports disagreement without acting', () => {

		const s = new ShadowMode( { name : 'v2' } )
		s.compare( { move : 1 }, { move : 1 } )
		s.compare( { move : 1 }, { move : 2 } )

		const r = s.report()
		assert.equal( r.total, 2 )
		assert.equal( r.agreementRate, 0.5 )
		assert.equal( r.disagreements.length, 1 )

	} )

} )

describe( 'hierarchical control', () => {

	const makeArb = extra => new Arbitrator( {
		safety : new SafetySupervisor( {
			geofence : {
				bounds : [ [ 0, 0 ], [ 5, 0 ], [ 5, 5 ], [ 0, 5 ] ],
				home : [ 1, 1 ],
			},
			limits : { minMoveIntervalMs : 0 },
		} ),
		...extra,
	} )

	it( 'a reflex preempts a plan', () => {

		const a = makeArb()

		a.propose( {
			id : 'relocate',
			priority : PRIORITY.PLAN,
			mission : {
				type : 'move',
				from : [ 1, 1 ],
				target : [ 3, 3 ],
			},
		} )
		a.propose( {
			id : 'collision',
			priority : PRIORITY.REFLEX,
			mission : { type : 'stop' },
		} )

		const { decision } = a.decide()
		assert.equal( decision.id, 'collision' )

	} )

	it( 'the collision reflex fires only when something is close', () => {

		const reflex = collisionReflex( { stopM : 0.2 } )

		assert.equal( reflex.check( { distance : {
			value : 1.5,
			stale : false,
		} } ), null )

		const fired = reflex.check( { distance : {
			value : 0.1,
			stale : false,
		} } )
		assert.ok( fired )
		assert.equal( fired.mission.type, 'stop' )

	} )

	it( 'a stale distance reading does not fire the reflex', () => {

		const reflex = collisionReflex()
		assert.equal( reflex.check( { distance : {
			value : 0.01,
			stale : true,
		} } ), null )

	} )

	it( 'lost localization stops the robot', () => {

		const reflex = lostLocalizationReflex()

		assert.equal( reflex.check( { pose : {
			value : 1,
			stale : false,
		} } ), null )
		assert.ok( reflex.check( {} ), 'no pose channel at all must stop it' )
		assert.ok( reflex.check( { pose : {
			value : 1,
			stale : true,
		} } ) )

	} )

	it( 'safety can veto the highest-priority proposal', () => {

		const a = makeArb()
		a.propose( {
			id : 'bad-move',
			priority : PRIORITY.CARE,
			mission : {
				type : 'move',
				from : [ 1, 1 ],
				target : [ 50, 50 ],
			},
		} )

		const result = a.decide()
		assert.equal( result.decision, null )
		assert.equal( result.rejected[ 0 ].by, 'safety' )
		assert.ok( result.fallback )

	} )

	it( 'evidence gates a deliberate action but never a reflex', () => {

		const evidence = new EvidenceLedger()
		evidence.add( {
			source : 'soil',
			claim : 'drought',
			strength : 0.5,
		} )

		const a = makeArb( { evidence } )

		a.propose( {
			id : 'water-it',
			priority : PRIORITY.CARE,
			claim : 'drought',
			risk : RISK.HIGH,
			mission : {
				type : 'water',
				amountMl : 100,
			},
		} )

		let result = a.decide()
		assert.equal( result.decision, null )
		assert.equal( result.rejected[ 0 ].by, 'evidence' )

		// The same weak evidence must not block a reflex.
		a.propose( {
			id : 'collision',
			priority : PRIORITY.REFLEX,
			claim : 'drought',
			risk : RISK.HIGH,
			mission : { type : 'stop' },
		} )
		result = a.decide()
		assert.equal( result.decision.id, 'collision' )

	} )

	it( 'a broken reflex does not stop the others', () => {

		const a = makeArb()
		a.registerReflex( 'broken', { check : () => {

			throw new Error( 'boom' )

		} } )
		a.registerReflex( 'good', { check : () => ( {
			mission : { type : 'stop' },
			reason : 'ok',
		} ) } )

		const raised = a.runReflexes( { fast : {} } )
		assert.equal( raised.length, 1 )
		assert.equal( raised[ 0 ].id, 'good' )

	} )

	it( 'expired proposals are dropped', async () => {

		const a = makeArb()
		a.propose( {
			id : 'stale',
			priority : PRIORITY.PLAN,
			ttlMs : 10,
			mission : { type : 'idle' },
		} )

		await new Promise( r => setTimeout( r, 40 ) )

		assert.equal( a.decide().decision, null )

	} )

	it( 'reports override statistics', () => {

		const a = makeArb()
		a.propose( {
			id : 'r',
			priority : PRIORITY.REFLEX,
			mission : { type : 'stop' },
		} )
		a.decide()

		const stats = a.stats()
		assert.equal( stats.decisions, 1 )
		assert.equal( stats.reflexOverrides, 1 )
		assert.equal( stats.overrideRate, 1 )

	} )

} )

describe( 'personalization', () => {

	it( 'reward penalizes harm more than it rewards improvement', () => {

		assert.ok( Math.abs( wellbeingReward( 50, 30 ) ) > wellbeingReward( 50, 70 ) )
		assert.equal( wellbeingReward( 50, 50 ), 0 )

	} )

	it( 'episodic memory retrieves the situation that resembles now', async () => {

		const m = new EpisodicMemory()
		await m.record( {
			action : 'move_window',
			reward : 0.5,
			context : {
				hour : 9,
				light : 200,
				soil : 40,
			},
		} )
		await m.record( {
			action : 'move_window',
			reward : -0.3,
			context : {
				hour : 22,
				light : 0,
				soil : 40,
			},
		} )

		const near = await m.similar( {
			hour : 9,
			light : 200,
			soil : 40,
		}, { k : 1 } )
		assert.equal( near[ 0 ].reward, 0.5 )

	} )

	it( 'expected reward reflects past outcomes in similar situations', async () => {

		const m = new EpisodicMemory()
		const ctx = {
			hour : 9,
			light : 100,
			soil : 30,
		}
		for ( let i = 0; i < 5; i++ ) await m.record( {
			action : 'move_window',
			reward : 0.6,
			context : ctx,
		} )

		const est = await m.expectedReward( ctx, 'move_window' )
		assert.ok( est.expected > 0.4 )
		assert.equal( est.n, 5 )

	} )

	it( 'the bandit converges on the action that actually worked', async () => {

		const b = new ContextualBandit( {
			actions : [ 'window', 'shelf', 'bathroom' ],
			exploration : 0.05,
		} )
		const ctx = {
			hour : 10,
			light : 150,
		}

		for ( let i = 0; i < 15; i++ ) {

			await b.update( 'window', 0.7, ctx )
			await b.update( 'shelf', -0.2, ctx )
			await b.update( 'bathroom', -0.5, ctx )

		}

		const choice = await b.choose( ctx, { explore : false } )
		assert.equal( choice.action, 'window' )
		assert.equal( b.report()[ 0 ].action, 'window' )

	} )

	it( 'the bandit explores an untried action', async () => {

		const b = new ContextualBandit( {
			actions : [ 'known', 'never-tried' ],
			exploration : 1,
		} )
		for ( let i = 0; i < 5; i++ ) await b.update( 'known', 0.1, {} )

		const choice = await b.choose( {} )
		assert.equal( choice.action, 'never-tried' )
		assert.equal( choice.exploring, true )

	} )

	it( 'an experiment needs a control phase and a stopping rule', () => {

		const e = new Experiment( {
			treatment : 'move_window',
			periodMs : 0,
			minSamples : 5,
			minEffect : 5,
		} )

		for ( let i = 0; i < 5; i++ ) e.observe( 50 )
		assert.equal( e.status().phase, 'treatment' )

		for ( let i = 0; i < 5; i++ ) e.observe( 75 )

		const { result } = e.status()
		assert.ok( result )
		assert.equal( result.significant, true )
		assert.equal( result.better, true )
		assert.match( result.verdict, /helped/ )

	} )

	it( 'an experiment reports no effect rather than inventing one', () => {

		const e = new Experiment( {
			treatment : 'x',
			periodMs : 0,
			minSamples : 5,
			minEffect : 5,
		} )

		for ( let i = 0; i < 5; i++ ) e.observe( 50 + ( i % 2 ) )
		for ( let i = 0; i < 5; i++ ) e.observe( 51 - ( i % 2 ) )

		assert.equal( e.status().result.significant, false )
		assert.match( e.status().result.verdict, /no clear difference/ )

	} )

	it( 'the façade suggests, scores and remembers', async () => {

		const p = new PlantPersonalization( {
			plantId : 'ivy',
			actions : [ 'window', 'shelf' ],
		} )

		const choice = await p.suggest( {
			happiness : 50,
			current : { light : 100 },
			deviations : [],
		} )
		assert.ok( choice.action )

		const { reward } = await p.outcome( { happiness : 80 } )
		assert.ok( reward > 0 )
		assert.equal( p.profile().episodes, 1 )

	} )

	it( 'scoring without a suggestion is an error, not a silent no-op', async () => {

		const p = new PlantPersonalization( { actions : [ 'a' ] } )
		await assert.rejects( () => p.outcome( { happiness : 50 } ), /No pending suggestion/ )

	} )

} )

describe( 'kernel embodiment', () => {

	it( 'embody() wires all five layers', async () => {

		const plant = await makePlant()
		const body = await plant.embody()

		assert.ok( body.state )
		assert.ok( body.safety )
		assert.ok( body.control )
		assert.ok( body.evidence )
		assert.ok( body.personalization )
		assert.equal( plant.body, body )

		await plant.destroy()

	} )

	it( 'readings flow into fusion automatically', async () => {

		const plant = await makePlant()
		await plant.embody()
		await plant.read()

		const slow = plant.body.state.slow()
		assert.ok( 'soil' in slow, 'the plant reading should reach the slow channels' )

		await plant.destroy()

	} )

	it( 'justifies() gathers multimodal evidence before allowing an action', async () => {

		const plant = await makePlant( { sensor : {
			driver : 'mock',
			soil : 2,
			humidity : 5,
		} } )
		await plant.embody()
		await plant.read()

		const verdict = plant.justifies( 'soil_low', RISK.LOW )

		assert.ok( verdict.score > 0 )
		assert.ok( verdict.explanation.includes( 'soil' ) )

		await plant.destroy()

	} )

	it( 'justifies() before embody() is a clear error', async () => {

		const plant = await makePlant()
		assert.throws( () => plant.justifies( 'x' ), /embody\(\)/ )
		await plant.destroy()

	} )

} )
