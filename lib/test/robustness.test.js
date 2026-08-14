/**
 * Nothing pure should ever throw.
 *
 * This library's whole posture is that it refuses with a reason rather than
 * failing. A `TypeError: Cannot read properties of null` is not a refusal — it
 * is the library breaking in the caller's hands and telling them nothing useful
 * about why, and it is exactly the kind of silly error somebody finds five
 * minutes after installing.
 *
 * So instead of picking cases by hand, this walks every exported function in the
 * analytical modules and calls it with the values that actually turn up in real
 * code: an explicit `null` from an optional field, an `undefined` from a `?.`
 * that found nothing, a string where an object was expected, a `NaN` from
 * arithmetic on a missing reading.
 *
 * The trap this exists to catch is specific and easy to miss. A default
 * parameter (`input = {}`) covers an omitted argument and does **nothing** for
 * an explicit `null` — and an explicit null is what JSON, an optional field and
 * a failed lookup all hand over. The rest of the codebase learned this in
 * `ContinuityTracker.attribute()`; this makes sure the newer modules keep it.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import * as colony from '../src/colony/index.js'
import * as dashboard from '../src/dashboard/vitals.js'
import * as navigation from '../src/navigation/index.js'
import * as defense from '../src/signals/defense.js'
import * as adaptation from '../src/states/adaptation.js'
import * as calibration from '../src/states/calibration.js'
import * as gate from '../src/states/gate.js'
import * as identity from '../src/migration/identity.js'
import * as states from '../src/states/index.js'
import * as trajectory from '../src/states/trajectory.js'

/** What actually arrives when a caller gets it wrong. */
const JUNK = [
	undefined,
	null,
	{},
	[],
	0,
	-1,
	'',
	'nonsense',
	Number.NaN,
	Number.POSITIVE_INFINITY,
	true,
	false,
	() => {},
]

/**
 * Functions allowed to throw, and why each one earns it.
 *
 * Kept as an explicit list rather than a pattern, so adding a function that
 * throws is a decision somebody writes down instead of a test that quietly
 * stops covering it.
 */
const MAY_THROW = new Set( [
	// Builders, all three. A state with no name, or a skill with no id, is not a
	// degraded value — it is a mistake that would otherwise travel silently into
	// a decision or a vocabulary. A clear message at the point of construction is
	// worth more than a nameless object gating a watering later.
	'states.state',
	'states.unknown',
	'colony.registerSkill',
] )

const MODULES = {
	states,
	defense,
	navigation,
	colony,
	dashboard,
	gate,
	calibration,
	trajectory,
	adaptation,
	identity,
}

describe( 'nothing pure throws, whatever it is handed', () => {

	for ( const [ modName, mod ] of Object.entries( MODULES ) ) {

		it( `${modName}: every exported function survives junk`, async () => {

			const broken = []

			for ( const [ fnName, fn ] of Object.entries( mod ) ) {

				// Constants and classes are not the subject here.
				if ( typeof fn !== 'function' || /^[A-Z]/.test( fnName ) ) continue
				if ( MAY_THROW.has( `${modName}.${fnName}` ) ) continue

				for ( const junk of JUNK ) {

					try {

						await fn( junk, junk, junk )

					}
					catch ( err ) {

						broken.push( `${modName}.${fnName}(${String( junk )}) → ${err.constructor.name}: ${err.message}` )

					}

				}

			}

			assert.deepEqual( broken, [], `\n${broken.join( '\n' )}\n` )

		} )

	}

} )

describe( 'the null-versus-undefined trap specifically', () => {

	it( 'treats an explicit null the same as an omitted argument', () => {

		// This is the case a default parameter does not cover, and it is what an
		// optional field or an unsuccessful `?.` actually produces.
		assert.deepEqual(
			states.waterStressInternal( null ).level,
			states.waterStressInternal().level,
		)
		assert.deepEqual( states.stressLoad( null ).level, states.stressLoad().level )
		assert.deepEqual( states.stressMemory( null ).level, states.stressMemory().level )
		assert.deepEqual( states.circadianIntegrity( null ).level, states.circadianIntegrity().level )
		assert.deepEqual( defense.defenseActivation( null ).level, defense.defenseActivation().level )
		assert.deepEqual( navigation.canCross( null ).safe, navigation.canCross().safe )

	} )

	it( 'still returns a well-formed state, not an empty object', () => {

		for ( const s of Object.values( states.internalStates( null ) ) ) {

			assert.ok( s.name )
			assert.ok( s.level )
			assert.equal( typeof s.acts, 'boolean' )
			assert.ok( s.why.length > 20 )

		}

	} )

} )

describe( 'cue builders degrade rather than break', () => {

	it( 'produces no lines for anything that is not a state', () => {

		for ( const junk of JUNK ) {

			assert.deepEqual( states.stateCues( junk ), [] )
			assert.deepEqual( defense.defenseCues( junk ), [] )

		}

	} )

	it( 'survives a state read back from JSON with fields missing', () => {

		// The realistic case: a state that went through storage and lost the
		// arrays, or arrived from an older version.
		const partial = {
			name : 'x',
			level : 'high',
			confidence : 'low',
			why : 'Something happened.',
		}

		assert.doesNotThrow( () => states.stateCues( partial ) )
		assert.ok( states.stateCues( partial ).length > 0 )

		assert.doesNotThrow( () => defense.defenseCues( {
			level : 'high',
			statement : 'x',
			evidence : undefined,
			posture : undefined,
		} ) )

	} )

} )

describe( 'the builder that is allowed to throw', () => {

	it( 'says what it needed instead of failing cryptically', () => {

		assert.throws( () => states.state( null ), /needs at least \{ name, level/ )
		assert.throws( () => states.state( { name : 'x' } ), /cannot be reported, gated on, or explained/ )

	} )

} )

describe( 'numbers that are not numbers', () => {

	it( 'does not band a NaN as anything but unknown', () => {

		assert.equal( dashboard.band( Number.NaN, {
			min : 0,
			max : 1,
		} ).band, 'unknown' )

	} )

	it( 'clamps an absurd value rather than drawing off the screen', () => {

		assert.ok( dashboard.band( 1e9, {
			min : 0,
			max : 1,
		} ).fraction <= 1.2 )

	} )

	it( 'refuses an environmental window that is not a window', () => {

		for ( const junk of JUNK ) {

			assert.equal( defense.environmentExplains( junk ).explains, null )

		}

	} )

} )
