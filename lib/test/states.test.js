/**
 * Internal states.
 *
 * The contract matters more than any individual state, so it is tested first
 * and generically: every state declares what decision it changes, low
 * confidence removes its authority, and insufficient evidence produces
 * `unknown` rather than a weak guess.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import { defenseActivation } from '../src/signals/defense.js'
import {
	CONFIDENCE, circadianIntegrity, internalStates, LEVEL, state, stateCues,
	stressLoad, stressMemory, unknown, waterStressInternal,
} from '../src/states/index.js'

const steady = n => Array.from( { length : n }, () => ( {
	temperature : 22,
	light : 900,
	soil : 45,
} ) )

describe( 'the contract every state keeps', () => {

	const all = () => ( {
		...internalStates( {} ),
		defense_activation : defenseActivation( {} ),
	} )

	it( 'names the decision it changes, or it should not exist', () => {

		for ( const [ name, s ] of Object.entries( all() ) ) {

			assert.ok( s.decides, `${name} ships without saying what it decides` )

		}

	} )

	it( 'carries its own name and the fields every consumer reads', () => {

		for ( const [ name, s ] of Object.entries( all() ) ) {

			assert.equal( s.name, name )
			assert.ok( Object.values( LEVEL ).includes( s.level ) )
			assert.ok( Object.values( CONFIDENCE ).includes( s.confidence ) )
			assert.ok( Array.isArray( s.evidence ) )
			assert.equal( typeof s.acts, 'boolean' )
			assert.ok( s.why?.length > 20, `${name} does not explain itself` )

		}

	} )

	it( 'refuses to act on low confidence, however high the level', () => {

		const s = state( {
			name : 'x',
			level : LEVEL.HIGH,
			confidence : CONFIDENCE.LOW,
			decides : 'something',
			why : 'A strong-looking signal that nothing corroborates.',
		} )

		// This is the whole rule: weak evidence informs a person and does not
		// change what the system does.
		assert.equal( s.acts, false )

	} )

	it( 'refuses to act when it does not know', () => {

		assert.equal( unknown( 'x', [ 'electrode' ], 'Nothing to go on here at all.' ).acts, false )

	} )

	it( 'does not act on low, which is the plant being fine', () => {

		assert.equal( state( {
			name : 'x',
			level : LEVEL.LOW,
			confidence : CONFIDENCE.HIGH,
			decides : 'y',
			why : 'Confidently nothing.',
		} ).acts, false )

	} )

	it( 'says nothing about a plant that is fine, and speaks up about one it cannot read', () => {

		assert.deepEqual( stateCues( state( {
			name : 'x',
			level : LEVEL.LOW,
			confidence : CONFIDENCE.HIGH,
			decides : 'y',
			why : 'Fine.',
		} ) ), [] )

		// A missing instrument is a fact worth surfacing, not silence.
		assert.equal( stateCues( unknown( 'x', [ 'electrode' ], 'No electrode here.' ) ).length, 1 )

	} )

	it( 'flags when a state was too weak to be allowed to act', () => {

		const cues = stateCues( state( {
			name : 'x',
			level : LEVEL.HIGH,
			confidence : CONFIDENCE.LOW,
			decides : 'watering',
			why : 'Something, weakly.',
		} ) )

		assert.ok( cues.some( c => /not being allowed to/.test( c ) ) )

	} )

} )

describe( 'water stress the soil probe cannot see', () => {

	const stressed = {
		stomata : {
			known : true,
			closing : true,
		},
	}

	it( 'needs both sides, and says which one is missing', () => {

		assert.deepEqual( waterStressInternal( stressed ).missing, [ 'soil' ] )

		const noPlant = waterStressInternal( { soil : 70 } )
		assert.equal( noPlant.level, LEVEL.UNKNOWN )
		assert.match( noPlant.why, /cannot tell a plant that is drinking from one that cannot/ )

	} )

	it( 'catches the case where watering is the wrong answer', () => {

		const s = waterStressInternal( {
			soil : 75,
			...stressed,
			shift : { shifted : true },
		} )

		assert.equal( s.level, LEVEL.HIGH )
		assert.equal( s.withhold, 'water' )
		assert.equal( s.acts, true )
		assert.match( s.why, /watering is the one response that would make every cause of it worse/ )

	} )

	it( 'will not withhold water on a single plant-side signal', () => {

		const s = waterStressInternal( {
			soil : 75,
			...stressed,
		} )

		assert.equal( s.level, LEVEL.MEDIUM )
		// The state exists, and it is not allowed to stop anyone watering.
		assert.equal( s.acts, false )

	} )

	it( 'stays quiet when the pot and the plant agree', () => {

		const s = waterStressInternal( {
			soil : 15,
			...stressed,
		} )

		assert.equal( s.level, LEVEL.LOW )
		assert.equal( s.pattern, 'agreed-thirst' )
		assert.match( s.why, /This state exists to catch disagreement, and there is none/ )

	} )

	it( 'uses this plant\'s own range when it has one', () => {

		const ranges = { soil : {
			min : 30,
			max : 90,
		} }

		// 75 is below the flat 55 threshold's idea of wet but well above 80% of
		// this plant's own maximum.
		assert.equal( waterStressInternal( {
			soil : 75,
			ranges,
			...stressed,
		} ).pattern, 'wet-soil-stressed-plant' )

	} )

} )

describe( 'accumulated load', () => {

	it( 'cannot be estimated from a current reading', () => {

		const s = stressLoad( {} )

		assert.equal( s.level, LEVEL.UNKNOWN )
		assert.match( s.why, /should not be guessed from one/ )

	} )

	it( 'counts a busy electrode and a history of episodes', () => {

		const s = stressLoad( {
			events : {
				ratePerHour : 8,
				damageSignal : true,
			},
			episodes : 4,
		} )

		assert.equal( s.level, LEVEL.HIGH )
		assert.equal( s.scale, 0.6 )
		assert.equal( s.acts, true )

	} )

	it( 'refuses to count drift that belongs to the electrode', () => {

		const withElectrode = stressLoad( {
			events : { ratePerHour : 8 },
			drift : {
				cause : 'electrode',
				why : 'One site only.',
			},
			episodes : 2,
		} )

		const withPlant = stressLoad( {
			events : { ratePerHour : 8 },
			drift : {
				cause : 'physiology',
				why : 'All sites agree.',
			},
			episodes : 2,
		} )

		// The same numbers, and the electrode version scores lower — an ageing
		// probe produces this pattern and it is not a fact about the plant.
		assert.ok( [ LEVEL.LOW, LEVEL.MEDIUM ].includes( withElectrode.level ) )
		assert.notEqual( withElectrode.level, LEVEL.HIGH )
		assert.equal( withPlant.level, LEVEL.HIGH )

		// And it says so rather than silently dropping it.
		assert.ok( withElectrode.evidence.some( e => e.signal === 'drift-discounted' ) )

	} )

	it( 'will not act on one instrument alone', () => {

		const s = stressLoad( { events : { ratePerHour : 9 } } )

		assert.equal( s.confidence, CONFIDENCE.LOW )
		assert.equal( s.acts, false )

	} )

	it( 'leaves a rested plant at full size', () => {

		assert.equal( stressLoad( {
			events : { ratePerHour : 0.5 },
			episodes : 0,
		} ).scale, 1 )

	} )

} )

describe( 'stress memory', () => {

	it( 'stays unknown until the same thing has happened enough times', () => {

		const s = stressMemory( { hysteresis : {
			known : false,
			reason : 'Need 3 comparable occurrences either side.',
		} } )

		assert.equal( s.level, LEVEL.UNKNOWN )
		assert.match( s.why, /most likely to stay unknown for a long time/ )

	} )

	it( 'treats a negative result as a real finding', () => {

		const s = stressMemory( { hysteresis : {
			known : true,
			changed : false,
			verdict : 'The response is the same as before.',
		} } )

		assert.equal( s.level, LEVEL.LOW )
		assert.match( s.why, /a real finding rather than an absence of one/ )

	} )

	it( 'never goes above medium, and carries the caveat that keeps it there', () => {

		const caveat = 'A plant is older and larger at the second measurement than the first.'
		const s = stressMemory( {
			hysteresis : {
				known : true,
				changed : true,
				verdict : 'It now peaks in 6h rather than 14h.',
				caveat,
			},
			stimulus : 'watering',
		} )

		assert.equal( s.level, LEVEL.MEDIUM )
		assert.equal( s.caveat, caveat )
		assert.equal( s.useProfile, 'after' )
		// The limitation travels with the state rather than being left behind.
		assert.ok( s.evidence.some( e => e.detail === caveat ) )

	} )

} )

describe( 'the internal clock, and trusting it less', () => {

	it( 'is unknown without days of recording, and says timing advice is groundless', () => {

		const s = circadianIntegrity( {} )

		assert.equal( s.level, LEVEL.UNKNOWN )
		assert.match( s.why, /there is no clock behind it/ )

	} )

	it( 'trusts timing when the clock keeps time', () => {

		const s = circadianIntegrity( { health : {
			healthy : true,
			detected : true,
			periodHours : 24.1,
			strength : 0.7,
			offByHours : 0.1,
			verdict : 'Healthy.',
		} } )

		assert.equal( s.level, LEVEL.LOW )
		assert.equal( s.trustTiming, true )

	} )

	it( 'blames the room when the rhythm is strong but off-period', () => {

		const s = circadianIntegrity( { health : {
			healthy : false,
			detected : true,
			periodHours : 31,
			strength : 0.6,
			offByHours : 7,
			verdict : 'Off-period.',
		} } )

		assert.equal( s.external, true )
		assert.match( s.why, /A timer fixes this; nothing done to the plant will/ )

	} )

	it( 'blames the plant when the rhythm has simply weakened', () => {

		const s = circadianIntegrity( { health : {
			healthy : false,
			detected : true,
			periodHours : 24,
			strength : 0.18,
			offByHours : 0,
			verdict : 'Weak.',
		} } )

		assert.equal( s.level, LEVEL.HIGH )
		assert.equal( s.external, false )
		assert.equal( s.trustTiming, false )
		assert.match( s.why, /noise presented as insight/ )

	} )

} )

describe( 'what they actually change', () => {

	const plant = async () => {

		const p = await createPlant( {
			name : 'Subject',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		await p.read()
		return p

	}

	it( 'exposes all five', async () => {

		const p = await plant()
		const s = p.states()

		assert.deepEqual( Object.keys( s ).sort(), [
			'circadian_integrity', 'defense_activation', 'stress_load',
			'stress_memory', 'water_stress_internal',
		] )

		await p.destroy()

	} )

	it( 'refuses to water a stressed plant standing in wet soil', async () => {

		const p = await plant()

		// Both plant-side signals, so the state has the confidence to act.
		p.memory.lastReading.soil = 85
		p._lastInference = { stomata : {
			known : true,
			closing : true,
			why : 'Closing well ahead of what VPD accounts for.',
		} }
		p._lastRegime = {
			changed : true,
			baselineReady : true,
			why : 'Electrome away from baseline.',
		}

		const refused = await p.water()

		assert.equal( refused.refused, true )
		assert.equal( refused.state, 'water_stress_internal' )
		assert.ok( refused.evidence.length >= 2 )

		// The override exists and works, because the person may know something
		// the sensors do not.
		const forced = await p.water( { force : true } )
		assert.notEqual( forced.refused, true )

		await p.destroy()

	} )

	it( 'waters normally when only one signal is present', async () => {

		const p = await plant()

		p.memory.lastReading.soil = 85
		p._lastInference = { stomata : {
			known : true,
			closing : true,
		} }

		const watered = await p.water()

		assert.notEqual( watered.refused, true )

		await p.destroy()

	} )

	it( 'stops offering timing opinions when the clock is not keeping time', async () => {

		const p = await plant()

		p.perception.electro = { clock : {
			healthy : false,
			detected : true,
			periodHours : 24,
			strength : 0.15,
			offByHours : 0,
			verdict : 'Weak.',
		} }

		const moment = await p.goodMoment( 'probe' )

		assert.equal( moment.trusted, false )
		assert.equal( moment.good, true )
		assert.match( moment.reason, /No timing opinion offered/ )

		await p.destroy()

	} )

} )

describe( 'the language', () => {

	it( 'never names a hormone concentration anywhere', () => {

		const all = [
			...Object.values( internalStates( {} ) ),
			defenseActivation( {
				events : [ { label : 'variation_potential' } ],
				vision : { chewing : true },
				readings : steady( 8 ),
			} ),
		]

		for ( const s of all ) {

			const text = JSON.stringify( s )
			assert.doesNotMatch( text, /level of (methyl )?jasmonate/i )
			assert.doesNotMatch( text, /ABA level|ethylene level|concentration of/i )

		}

	} )

} )
