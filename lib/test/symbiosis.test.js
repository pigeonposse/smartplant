/**
 * The last three: cross-evidence, identity across a body change, and adapting.
 *
 * What they have in common is that each is a place where the obvious version is
 * wrong in a way that only shows up months later — a colony that counts
 * correlated observers as independent, an identity that carries a fingerprint
 * belonging to a wire, and an adaptation that tunes toward its own beliefs.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import {
	corroborate, CORROBORATION, oddOneOut, SATURATES_AT, worthTeaching,
} from '../src/colony/index.js'
import { describeIdentity, PARTS, TIED_TO } from '../src/migration/identity.js'
import { Adaptation, bias, REFUSED } from '../src/states/adaptation.js'
import { StateCalibration } from '../src/states/calibration.js'

const witnesses = n => Array.from( { length : n }, ( _, i ) => ( {
	id : `p${i}`,
	agrees : true,
	hasOwnElectrode : true,
} ) )

/** A calibration record that has been told it was wrong about something. */
const grounded = () => {

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

	return cal

}

describe( 'when agreement is evidence and when it is one thing counted twice', () => {

	it( 'lets independent instruments corroborate a claim about the room', () => {

		const r = corroborate( 'too_cold', witnesses( 4 ) )

		assert.equal( r.kind, CORROBORATION.ENVIRONMENTAL )
		assert.ok( r.strength > 0.8 )
		// Their sharing a room is exactly what is being claimed.
		assert.match( r.why, /not a flaw in the evidence — it is the evidence/ )

	} )

	it( 'refuses the same agreement about a plant', () => {

		const r = corroborate( 'water_stress', witnesses( 4 ) )

		assert.equal( r.kind, CORROBORATION.NONE )
		assert.equal( r.strength, 0.35 )
		assert.match( r.why, /still one witness/ )

	} )

	it( 'needs two separate instruments before agreement means anything', () => {

		assert.equal( corroborate( 'too_cold', witnesses( 1 ) ).kind, CORROBORATION.NONE )

	} )

	it( 'does not count a plant with no instrument of its own', () => {

		const mixed = [
			...witnesses( 2 ),
			{
				id : 'blind',
				agrees : true,
				hasOwnElectrode : false,
			},
		]

		assert.equal( corroborate( 'too_cold', mixed ).agreeing, 2 )

	} )

	it( 'saturates, because past a point they are still one room', () => {

		const four = corroborate( 'too_cold', witnesses( SATURATES_AT ) )
		const forty = corroborate( 'too_cold', witnesses( 40 ) )

		assert.equal( four.strength, forty.strength )
		assert.equal( forty.saturated, true )

	} )

	it( 'reads one plant moving alone as a question about its instrument', () => {

		const r = oddOneOut( {
			known : true,
			members : 5,
			outliers : [ 'ivy' ],
		} )

		assert.equal( r.singular, true )
		assert.equal( r.priority, 'instrument' )
		assert.match( r.why, /five minutes with a torch/ )

	} )

	it( 'does not call everybody an outlier', () => {

		const r = oddOneOut( {
			known : true,
			members : 3,
			outliers : [ 'a', 'b' ],
		} )

		// No group to be an outlier from is different from everybody having a
		// problem.
		assert.equal( r.singular, false )

	} )

} )

describe( 'whether a lesson is worth giving', () => {

	it( 'refuses when the teacher is unsure', () => {

		const r = worthTeaching( { confidence : 0.4 }, { experience : 0.1 } )

		assert.equal( r.offer, false )
		assert.match( r.why, /it makes it harder to correct, because it now has a source/ )

	} )

	it( 'refuses when the learner already knows', () => {

		const r = worthTeaching( { confidence : 0.9 }, { experience : 0.7 } )

		assert.equal( r.offer, false )
		assert.match( r.why, /displaces something better with something merely older/ )

	} )

	it( 'offers when there is something to give and room to receive it', () => {

		const r = worthTeaching( { confidence : 0.9 }, { experience : 0.05 } )

		assert.equal( r.offer, true )
		assert.ok( r.strength > 0.8 )

	} )

	it( 'will not guess at either side', () => {

		assert.equal( worthTeaching( { confidence : 0.9 }, {} ).offer, false )

	} )

} )

describe( 'the same plant in a new body', () => {

	const symbiont = async () => {

		const p = await createPlant( {
			name : 'Elder',
			species : 'Ficus lyrata',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		for ( let i = 0; i < 20; i++ ) await p.read()
		p.perception.electro = { fingerprint : [ 1, 2, 3 ] }
		p.trajectory( { force : true } )

		return p

	}

	it( 'knows what belongs to the plant and what belongs to the wire', () => {

		const plant = Object.values( PARTS ).filter( p => p.tiedTo === TIED_TO.PLANT )
		const electrode = Object.values( PARTS ).filter( p => p.tiedTo === TIED_TO.ELECTRODE )

		assert.ok( plant.length >= 5 )
		assert.ok( electrode.length >= 2 )
		assert.match( PARTS.fingerprint.why, /through this electrode at this contact point/ )

	} )

	it( 'restores whole, because it is the same plant', async () => {

		const old = await symbiont()
		const bundle = await old.exportIdentity()

		const fresh = await createPlant( {
			name : 'Elder',
			species : 'Ficus lyrata',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		const r = await fresh.restoreIdentity( bundle )

		assert.ok( r.restored.length > 0 )
		// Nothing fades. That is the whole difference from inheritance.
		assert.match( r.why, /discard a year of its life over a swapped cable/ )

		await Promise.all( [ old, fresh ].map( p => p.destroy() ) )

	} )

	it( 'holds back the fingerprint unless the electrode is the same one', async () => {

		const old = await symbiont()
		const bundle = await old.exportIdentity()

		const fresh = await createPlant( {
			name : 'Elder',
			species : 'Ficus lyrata',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		const held = await fresh.restoreIdentity( bundle )
		assert.ok( held.held.some( h => h.part === 'fingerprint' ) )
		assert.match( held.held[ 0 ].why, /report a plant changing when what changed was the wire/ )

		const same = await fresh.restoreIdentity( bundle, { sameElectrode : true } )
		assert.ok( same.restored.includes( 'fingerprint' ) )

		await Promise.all( [ old, fresh ].map( p => p.destroy() ) )

	} )

	it( 'refuses to restore one plant onto another', async () => {

		const old = await symbiont()
		const bundle = await old.exportIdentity()

		const other = await createPlant( {
			name : 'Different',
			species : 'Monstera deliciosa',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		const r = await other.restoreIdentity( bundle )

		assert.deepEqual( r.restored, [] )
		assert.match( r.why, /is not a hardware change, it is a mistake/ )

		await Promise.all( [ old, other ].map( p => p.destroy() ) )

	} )

	it( 'says what a restore would cost before doing it', async () => {

		const old = await symbiont()
		const d = describeIdentity( await old.exportIdentity() )

		assert.ok( d.reEstablish.includes( 'fingerprint' ) )
		assert.match( d.why, /worth knowing that up front rather than discovering that drift readings look wrong for a fortnight/ )

		await old.destroy()

	} )

} )

describe( 'moving a threshold, and being able to take it back', () => {

	it( 'tells a noisy plant from a badly-placed threshold', () => {

		const noisy = bias( Array.from( { length : 25 }, ( _, i ) => ( i % 2 ? 9 : -8 ) ) )
		const biased = bias( Array.from( { length : 25 }, ( _, i ) => 2 + ( i % 3 ) * 0.2 ) )

		assert.equal( noisy.systematic, false )
		assert.match( noisy.why, /wrong by a little in the same direction is a threshold in the wrong place. This is the first/ )
		assert.equal( biased.systematic, true )

	} )

	it( 'refuses to act on a handful', () => {

		assert.equal( bias( [ 2, 2, 2 ] ).reason, REFUSED.TOO_LITTLE )

	} )

	it( 'will not adapt for a plant nothing has ever contradicted', () => {

		const a = new Adaptation()
		a.register( 'soil.dry', 30 )

		const r = a.adapt( 'soil.dry', bias( Array.from( { length : 25 }, () => 2 ) ), { calibration : new StateCalibration() } )

		assert.equal( r.changed, false )
		assert.equal( r.reason, REFUSED.NO_CALIBRATION )
		// The gate that stops the circle.
		assert.match( r.why, /adapts toward what it already believed|moving toward its own conclusions/ )

	} )

	it( 'moves a fifth of the way, not all of it', () => {

		const a = new Adaptation()
		a.register( 'soil.dry', 30 )

		const r = a.adapt( 'soil.dry', bias( Array.from( { length : 25 }, () => 2 ) ), { calibration : grounded() } )

		assert.equal( r.changed, true )
		assert.equal( r.to, 29.6 )
		assert.match( r.why, /has overfitted the last month/ )

	} )

	it( 'stops before a threshold has wandered off', () => {

		const a = new Adaptation( { maxDrift : 0.05 } )
		a.register( 'soil.dry', 30 )

		const big = bias( Array.from( { length : 25 }, () => 20 ) )
		const r = a.adapt( 'soil.dry', big, { calibration : grounded() } )

		assert.equal( r.changed, false )
		assert.equal( r.reason, REFUSED.CAPPED )
		assert.match( r.why, /either the original was badly wrong/ )

	} )

	it( 'puts it back', () => {

		const a = new Adaptation()
		a.register( 'soil.dry', 30 )
		const cal = grounded()

		a.adapt( 'soil.dry', bias( Array.from( { length : 25 }, () => 2 ) ), { calibration : cal } )
		a.adapt( 'soil.dry', bias( Array.from( { length : 25 }, () => 2 ) ), { calibration : cal } )

		assert.notEqual( a.get( 'soil.dry' ), 30 )

		const back = a.revert( 'soil.dry' )
		assert.equal( a.get( 'soil.dry' ), 30 )
		assert.match( back.why, /by the time it is visible nobody remembers what the number used to be/ )

	} )

	it( 'walks back one step at a time when asked', () => {

		const a = new Adaptation()
		a.register( 'soil.dry', 30 )
		const cal = grounded()

		a.adapt( 'soil.dry', bias( Array.from( { length : 25 }, () => 2 ) ), { calibration : cal } )
		const afterFirst = a.get( 'soil.dry' )
		a.adapt( 'soil.dry', bias( Array.from( { length : 25 }, () => 2 ) ), { calibration : cal } )

		a.revert( 'soil.dry', { steps : 1 } )
		assert.equal( a.get( 'soil.dry' ), afterFirst )

	} )

	it( 'refuses to adapt something it cannot put back', () => {

		const a = new Adaptation()
		const r = a.adapt( 'never.registered', bias( Array.from( { length : 25 }, () => 2 ) ), { calibration : grounded() } )

		assert.equal( r.changed, false )
		assert.match( r.why, /the way back is the point/ )

	} )

} )
