/**
 * Whether the plant is mounting a defence.
 *
 * Two things are being tested more than anything else here: that a missing
 * electrode reads as unknown rather than as calm, and that the weather can pull
 * a conclusion back down. Everything else in this file is detail; those two are
 * the difference between a useful signal and an alarm generator.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import { AID, canOffer } from '../src/colony/index.js'
import {
	CONFIDENCE, DEFENSE, defenseActivation, defenseCues, environmentExplains,
	EVIDENCE, posture,
} from '../src/signals/defense.js'

const steady = n => Array.from( { length : n }, () => ( {
	temperature : 22,
	light : 900,
	soil : 45,
} ) )

const draughty = [ 22, 22, 22, 17, 16, 16, 17, 18 ].map( temperature => ( {
	temperature,
	light : 900,
	soil : 45,
} ) )

const VP = [ { label : 'variation_potential' } ]
const AP = [ { label : 'action_potential' } ]
const SHIFTED = { shifted : true }

describe( 'absent is not low', () => {

	it( 'returns unknown when nothing was watching', () => {

		const r = defenseActivation( {} )

		assert.equal( r.level, DEFENSE.UNKNOWN )
		assert.match( r.why, /A plant being eaten right now would look exactly like this/ )

	} )

	it( 'returns low only when the electrode was there and saw nothing', () => {

		const r = defenseActivation( {
			electrode : true,
			readings : steady( 8 ),
		} )

		assert.equal( r.level, DEFENSE.LOW )

	} )

	it( 'still answers from a camera alone', () => {

		const r = defenseActivation( { vision : { chewing : true } } )

		assert.notEqual( r.level, DEFENSE.UNKNOWN )

	} )

	it( 'holds nothing back when it knows nothing, and says that is the problem', () => {

		const p = posture( DEFENSE.UNKNOWN )

		assert.deepEqual( p.hold, [] )
		assert.equal( p.allowElective, true )
		assert.match( p.why, /an electrode would change that more than any other addition/ )

	} )

} )

describe( 'what counts as evidence', () => {

	it( 'ignores an action potential, which is a touch or a light change', () => {

		const r = defenseActivation( {
			events : AP,
			readings : steady( 8 ),
		} )

		assert.equal( r.level, DEFENSE.LOW )

	} )

	it( 'raises to medium on a variation potential alone', () => {

		const r = defenseActivation( {
			events : VP,
			readings : steady( 8 ),
		} )

		assert.equal( r.level, DEFENSE.MEDIUM )
		assert.match( r.why, /not enough to conclude it has been attacked/ )

	} )

	it( 'will not reach high on electrical evidence alone', () => {

		const r = defenseActivation( {
			events : VP,
			shift : SHIFTED,
			readings : steady( 8 ),
		} )

		// Two signals from one electrode is one instrument agreeing with itself.
		assert.equal( r.level, DEFENSE.MEDIUM )
		assert.match( r.why, /its cause is not established/ )

	} )

	it( 'reaches high when something that would cause it is also visible', () => {

		const r = defenseActivation( {
			events : VP,
			shift : SHIFTED,
			vision : { chewing : true },
			readings : steady( 8 ),
		} )

		assert.equal( r.level, DEFENSE.HIGH )
		assert.equal( r.confidence, CONFIDENCE.HIGH )

	} )

	it( 'treats pruning as the wounding it is', () => {

		const r = defenseActivation( {
			events : VP,
			shift : SHIFTED,
			wound : { what : 'prune' },
			readings : steady( 8 ),
		} )

		assert.equal( r.level, DEFENSE.HIGH )
		assert.equal( EVIDENCE.WOUND_EVENT.rank, 'primary' )

	} )

	it( 'never lets supporting evidence lead', () => {

		const r = defenseActivation( {
			electrode : true,
			stomata : {
				known : true,
				unexplained : true,
			},
			sustainedActivity : true,
			readings : steady( 8 ),
		} )

		// Two supporting signals and no primary one. Still low.
		assert.equal( r.level, DEFENSE.LOW )
		assert.equal( r.evidence.length, 2 )
		assert.ok( r.evidence.every( e => e.rank === 'supporting' ) )

	} )

} )

describe( 'the negative control', () => {

	it( 'finds a swing that would produce the same electrical event', () => {

		const c = environmentExplains( draughty )

		assert.equal( c.explains, true )
		assert.equal( c.by[ 0 ].metric, 'temperature' )

	} )

	it( 'finds nothing in a steady room', () => {

		assert.equal( environmentExplains( steady( 8 ) ).explains, false )

	} )

	it( 'refuses to answer from two readings', () => {

		assert.equal( environmentExplains( steady( 2 ) ).explains, null )

	} )

	it( 'leaves the window to the caller, because only the caller knows when', () => {

		// The same readings, trimmed past the event, no longer contain it.
		assert.equal( environmentExplains( draughty ).explains, true )
		assert.equal( environmentExplains( draughty, { window : 4 } ).explains, false )

	} )

	it( 'pulls a conclusion back down when the room explains it', () => {

		const r = defenseActivation( {
			events : VP,
			shift : SHIFTED,
			readings : draughty,
		} )

		assert.equal( r.level, DEFENSE.LOW )
		assert.equal( r.downgradedFrom, DEFENSE.MEDIUM )
		assert.match( r.why, /The electrical evidence is real/ )

	} )

	it( 'does not explain away a wound it can see', () => {

		const r = defenseActivation( {
			events : VP,
			shift : SHIFTED,
			vision : { chewing : true },
			readings : draughty,
		} )

		// A cold draught does not chew holes in a leaf. An observed cause
		// outranks a coincidental swing.
		assert.equal( r.level, DEFENSE.HIGH )
		assert.equal( r.downgradedFrom, null )

	} )

	it( 'drops confidence when the room was never checked', () => {

		const r = defenseActivation( {
			events : VP,
			shift : SHIFTED,
			vision : { chewing : true },
		} )

		assert.equal( r.confidence, CONFIDENCE.LOW )

	} )

	it( 'drops confidence when the baseline is not established', () => {

		const r = defenseActivation( {
			events : VP,
			shift : {
				shifted : true,
				baselineReady : false,
			},
			vision : { chewing : true },
			readings : steady( 8 ),
		} )

		// "Away from its own baseline" means nothing without a baseline.
		assert.equal( r.confidence, CONFIDENCE.LOW )

	} )

} )

describe( 'saying what it is', () => {

	it( 'never states a hormone concentration', () => {

		const r = defenseActivation( {
			events : VP,
			shift : SHIFTED,
			vision : { chewing : true },
			readings : steady( 8 ),
		} )

		assert.match( r.statement, /not a measurement of methyl jasmonate/ )
		assert.doesNotMatch( r.statement, /MeJA level|concentration of/ )

	} )

	it( 'says nothing at all when there is nothing to say', () => {

		assert.deepEqual( defenseCues( defenseActivation( {
			electrode : true,
			readings : steady( 8 ),
		} ) ), [] )

	} )

	it( 'reports the downgrade rather than hiding it', () => {

		const cues = defenseCues( defenseActivation( {
			events : VP,
			shift : SHIFTED,
			readings : draughty,
		} ) )

		assert.ok( cues.some( c => /lowered from medium/i.test( c ) ) )

	} )

	it( 'tells a low-confidence reader to look rather than to conclude', () => {

		const cues = defenseCues( defenseActivation( {
			events : VP,
			shift : SHIFTED,
			vision : { chewing : true },
		} ) )

		assert.ok( cues.some( c => /a reason to look rather than a reason to conclude/.test( c ) ) )

	} )

} )

describe( 'what it changes', () => {

	it( 'holds back experiments at medium and everything elective at high', () => {

		assert.ok( posture( DEFENSE.MEDIUM ).hold.includes( 'spectral-probe' ) )
		assert.equal( posture( DEFENSE.MEDIUM ).warnColony, false )

		assert.ok( posture( DEFENSE.HIGH ).hold.includes( 'aid-session' ) )
		assert.ok( posture( DEFENSE.HIGH ).hold.includes( 'relocation' ) )
		assert.equal( posture( DEFENSE.HIGH ).warnColony, true )

	} )

	it( 'is about restraint, and continues ordinary care', () => {

		assert.match( posture( DEFENSE.HIGH ).why, /Care that keeps it stable continues/ )

	} )

	it( 'refuses a spectral probe on a plant that is defending itself', async () => {

		const plant = await createPlant( {
			name : 'Wounded',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		await plant.useSpectral( { light : { driver : 'mock' } } )
		await plant.read()

		// A real sweep drives the lamp for minutes. Nothing here is about the
		// sweep itself — only about whether it is allowed to start.
		plant.spectral.sweep = async () => ( {
			at : new Date().toISOString(),
			bands : [],
			responses : {},
			interpreted : {},
			diagnosis : [],
			summary : 'stubbed',
		} )

		plant.perception.electro = { events : VP }
		plant.perception.vision = { findings : { chewing : true } }
		plant._lastRegime = {
			changed : true,
			baselineReady : true,
		}

		const refused = await plant.interrogate()

		assert.equal( refused.refused, true )
		assert.equal( refused.defense, DEFENSE.HIGH )
		assert.match( refused.why, /force: true/ )

		// The override exists, and taking it works.
		const forced = await plant.interrogate( { force : true } )
		assert.notEqual( forced.refused, true )

		await plant.destroy()

	} )

	it( 'will not volunteer a defending plant to help a neighbour', () => {

		const busy = {
			body : {},
			memory : { lastReading : {} },
			_lastDefense : defenseActivation( {
				events : VP,
				shift : SHIFTED,
				vision : { chewing : true },
				readings : steady( 8 ),
			} ),
		}

		const r = canOffer( busy, AID.SHELTER )

		assert.equal( r.able, false )
		assert.equal( r.reason, 'defending' )
		assert.match( r.why, /it lifts when the response does/ )

	} )

	it( 'lets a calm plant help as usual', () => {

		const calm = {
			body : {},
			memory : { lastReading : {} },
			_lastDefense : defenseActivation( {
				electrode : true,
				readings : steady( 8 ),
			} ),
		}

		assert.equal( canOffer( calm, AID.SHELTER ).able, true )

	} )

} )
