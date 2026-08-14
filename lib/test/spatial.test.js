/**
 * Reading the space around the plant.
 *
 * Two sensors that answer the same question from opposite ends: is anything
 * there. Neither claims more than it can support — the WiFi one refuses to
 * estimate a pose, and the lidar one refuses to build a map.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import { coupled } from '../src/colony/index.js'
import { relevance, uvbGate } from '../src/colony/security.js'
import {
	CAPABILITY, motionExplains, PresenceSensor, SENSING, variance,
} from '../src/sensors/drivers/presence.js'
import { defenseActivation } from '../src/signals/defense.js'
import { LidarSensor } from '../src/sensors/drivers/lidar.js'
import {
	clearance, points, rangeTo, readSpace, whatChanged,
} from '../src/spatial/index.js'
import { LoopbackBus } from '../src/colony/index.js'
import { planMove, REFUSAL } from '../src/navigation/index.js'

const steady = n => Array.from( { length : n }, () => ( {
	temperature : 22,
	light : 900,
	soil : 45,
} ) )

const ring = ( fn, n = 360 ) => ( {
	ranges : Array.from( { length : n }, ( _, i ) => fn( i ) ),
	angleMin : 0,
	angleMax : 2 * Math.PI,
} )

describe( 'presence, and what a radio can honestly say', () => {

	const feed = async ( sensor, times ) => {

		for ( let i = 0; i < times; i++ ) await sensor.read()

	}

	it( 'insists on being told which kind of radio it has', () => {

		assert.throws( () => new PresenceSensor( { sample : async () => 1 } ), /csi.*rssi/s )
		assert.throws( () => new PresenceSensor( {
			sensing : 'radar',
			sample : async () => 1,
		} ), /Unknown sensing kind/ )

	} )

	it( 'needs something to sample, and says why there is no default', () => {

		assert.throws( () => new PresenceSensor( { sensing : SENSING.RSSI } ),
			/no portable way to read a radio from here/ )

	} )

	it( 'claims presence and motion, and refuses pose for either kind', () => {

		// The claim that runs furthest ahead of single-radio hardware, so it is
		// declared false rather than left unmentioned.
		for ( const cap of Object.values( CAPABILITY ) ) {

			assert.equal( cap.occupancy, true )
			assert.equal( cap.pose, false )

		}

	} )

	it( 'will not answer before it has a quiet to compare against', async () => {

		const s = new PresenceSensor( {
			sensing : SENSING.RSSI,
			sample : async () => -50 + Math.random(),
		} )
		await s.connect()
		await feed( s, 5 )

		const state = s.state()
		assert.equal( state.settled, false )
		assert.equal( state.occupancy, null )
		assert.match( state.why, /a number from somebody else's room/ )

	} )

	it( 'reads an empty room as empty and a moving one as moving', async () => {

		let spread = 0.2

		const s = new PresenceSensor( {
			sensing : SENSING.CSI,
			sample : async () => Array.from( { length : 52 }, () => Math.random() * spread ),
			settleSamples : 40,
		} )
		await s.connect()
		await feed( s, 60 )

		assert.equal( s.state().occupancy, false )

		spread = 4
		await feed( s, 20 )

		const busy = s.state()
		assert.equal( busy.occupancy, true )
		assert.equal( busy.motion, true )

	} )

	it( 'catches a radio returning a constant rather than calling it a calm house', async () => {

		const s = new PresenceSensor( {
			sensing : SENSING.RSSI,
			sample : async () => -50,
			settleSamples : 10,
		} )
		await s.connect()
		await feed( s, 15 )

		const state = s.state()
		// Not "nobody is here". Dividing by a floor of zero would have turned any
		// change into a ratio in the thousands, which reads as certainty.
		assert.equal( state.stuck, true )
		assert.equal( state.occupancy, null )
		assert.match( state.why, /rather than a very still house/ )

	} )

	it( 'says plainly what it cannot see', async () => {

		const s = new PresenceSensor( {
			sensing : SENSING.RSSI,
			sample : async () => -50 + Math.random() * 0.4,
			settleSamples : 20,
		} )
		await s.connect()
		await feed( s, 30 )

		assert.match( s.state().why, /a person sitting perfectly still is the case this cannot see/ )

	} )

	it( 'computes variance and survives a series that is not one', () => {

		assert.equal( variance( [ 1, 1, 1 ] ), 0 )
		assert.ok( variance( [ 1, 5, 9 ] ) > 0 )
		assert.equal( variance( null ), 0 )
		assert.equal( variance( [ 1 ] ), 0 )

	} )

} )

describe( 'motion as a negative control', () => {

	const at = Date.now()

	it( 'has no opinion without a history', () => {

		assert.equal( motionExplains( [], at ).explains, null )
		assert.match( motionExplains( [], at ).why, /commonest cause of an action potential that is not a wound/ )

	} )

	it( 'finds somebody walking past at the moment of an event', () => {

		const r = motionExplains( [ {
			at : at - 5000,
			motion : true,
		} ], at )

		assert.equal( r.explains, true )
		assert.match( r.why, /Brushing a leaf produces an action potential/ )

	} )

	it( 'clears a still room', () => {

		assert.equal( motionExplains( [ {
			at,
			motion : false,
		} ], at ).explains, false )

	} )

	it( 'lowers a defence estimate the way the weather does', () => {

		const evidence = {
			events : [ { label : 'variation_potential' } ],
			shift : { shifted : true },
			readings : steady( 8 ),
		}

		assert.equal( defenseActivation( evidence ).level, 'medium' )

		const withMotion = defenseActivation( {
			...evidence,
			motion : {
				explains : true,
				why : 'Somebody was moving nearby.',
			},
		} )

		assert.equal( withMotion.level, 'low' )
		assert.equal( withMotion.downgradedFrom, 'medium' )

	} )

	it( 'does not explain away a wound it can see', () => {

		const r = defenseActivation( {
			events : [ { label : 'variation_potential' } ],
			shift : { shifted : true },
			vision : { chewing : true },
			readings : steady( 8 ),
			motion : { explains : true },
		} )

		// Somebody walking past does not chew holes in a leaf.
		assert.equal( r.level, 'high' )
		assert.equal( r.downgradedFrom, null )

	} )

} )

describe( 'the UV-B interlock stops depending on being told', () => {

	const plant = extra => ( {
		memory : { plant : { species : 'Ficus lyrata' } },
		archetype : { id : 'tropical-understorey' },
		spectral : {
			light : { channels : [ 'uvb' ] },
			safety : { usedToday : () => 0 },
		},
		states : () => ( {
			stress_load : { level : 'low' },
			defense_activation : { level : 'low' },
		} ),
		...extra,
	} )

	const strong = relevance( {
		species : 'Ficus lyrata',
		archetype : 'tropical-understorey',
		metres : 0.3,
	}, plant() )

	it( 'refuses on a measured occupancy nobody mentioned', () => {

		const r = uvbGate( plant( { perception : { presence : { occupancy : true } } } ), strong, { allowUvb : true } )

		assert.equal( r.reason, 'occupied' )
		assert.equal( r.measured, true )
		assert.match( r.why, /according to the presence sensor/ )

	} )

	it( 'still allows it in an empty room', () => {

		const r = uvbGate( plant( { perception : { presence : { occupancy : false } } } ), strong, { allowUvb : true } )

		assert.equal( r.allowed, true )

	} )

	it( 'lets an explicit statement win over the sensor', () => {

		const r = uvbGate( plant( { perception : { presence : { occupancy : false } } } ), strong, {
			allowUvb : true,
			occupied : true,
		} )

		assert.equal( r.reason, 'occupied' )

	} )

} )

describe( 'one lidar scan, and no map', () => {

	it( 'normalises both shapes a rangefinder produces', () => {

		assert.equal( points( ring( () => 2, 36 ) ).length, 36 )
		assert.equal( points( [ {
			angle : 0,
			range : 1,
		}, {
			angle : 1,
			range : 0,
		} ] ).length, 1 )
		assert.deepEqual( points( null ), [] )

	} )

	it( 'measures the distance to a neighbour somebody pointed at', () => {

		const scan = ring( i => ( i > 85 && i < 95 ? 0.26 : 3 ) )
		const r = rangeTo( scan, {
			id : 'willow',
			bearing : Math.PI / 2,
		} )

		assert.equal( r.measured, true )
		assert.equal( r.metres, 0.26 )
		// Range measured, bearing declared, and it says which is which.
		assert.equal( r.bearingDeclared, true )

	} )

	it( 'refuses to pick a plant out of a room by itself', () => {

		const r = rangeTo( ring( () => 2 ), { id : 'willow' } )

		assert.equal( r.measured, false )
		assert.match( r.why, /cannot pick a plant out of a room/ )

	} )

	it( 'distinguishes a moved neighbour from a missing one', () => {

		const r = rangeTo( ring( () => 0.05 ), {
			id : 'willow',
			bearing : 0,
		} )

		// Everything inside 0.15m is this plant's own foliage.
		assert.equal( r.measured, false )
		assert.match( r.why, /those are different problems/ )

	} )

	it( 'replaces the typed distance the coupling layer rests on', () => {

		const typed = coupled( { metres : 0.25 } )
		const measured = coupled( {
			metres : 0.25,
			measuredMetres : 0.31,
		} )

		assert.equal( typed.measured, false )
		assert.match( typed.why, /Declared, not measured/ )

		assert.equal( measured.measured, true )
		assert.equal( measured.metres, 0.31 )
		assert.match( measured.why, /stays true when a pot is moved/ )

	} )

	it( 'reports clearance, and refuses when nothing comes back at all', () => {

		const open = clearance( ring( () => 3 ) )
		assert.equal( open.clear, true )
		assert.ok( open.openings.length > 0 )

		const boxed = clearance( ring( () => 0.25 ), { radius : 0.2 } )
		assert.equal( boxed.clear, false )
		assert.match( boxed.why, /planning through a wall/ )

		const nothing = clearance( { ranges : [] } )
		assert.equal( nothing.clear, null )
		assert.match( nothing.why, /a sensor that is not working/ )

	} )

	it( 'notices something appearing between the plant and the window', () => {

		const before = ring( () => 3 )
		const after = ring( i => ( i > 10 && i < 40 ? 0.5 : 3 ) )

		const r = whatChanged( before, after )

		assert.equal( r.changed, true )
		// The reason it matters: a box on the sill and a cloudy week look
		// identical in the light record.
		assert.match( r.why, /a cloudy week look identical/ )

	} )

	it( 'will not compare two scans that are too sparse to be rings', () => {

		assert.equal( whatChanged( { ranges : [ 1, 2 ] }, { ranges : [ 1, 2 ] } ).changed, null )

	} )

	it( 'puts it together without pretending to have a map', () => {

		const scan = ring( i => ( i > 85 && i < 95 ? 0.3 : 2.5 ) )
		const space = readSpace( scan, { neighbours : [ {
			id : 'willow',
			bearing : Math.PI / 2,
		} ] } )

		assert.equal( space.returns, 360 )
		assert.equal( space.neighbours[ 0 ].measured, true )
		assert.match( space.why, /measured rather than declared/ )

	} )

} )

describe( 'attached to a plant', () => {

	it( 'registers as a driver like any other', async () => {

		const plant = await createPlant( {
			name : 'Watched',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		const presence = await plant.attachSensor( {
			driver : 'presence',
			sensing : SENSING.RSSI,
			sample : async () => -50 + Math.random(),
		} )

		assert.equal( presence.id, 'presence' )
		assert.equal( presence.connected, true )

		await plant.destroy()

	} )

} )

describe( 'the rangefinder as a driver', () => {

	it( 'needs something to scan with, and says why there is no default', () => {

		assert.throws( () => new LidarSensor( {} ),
			/every one has its own serial protocol/ )

	} )

	it( 'refuses a handful of returns as a scan', async () => {

		const l = new LidarSensor( { scan : async () => ( { ranges : [ 1, 2, 3 ] } ) } )
		await l.connect()

		// Either the motor is not spinning or everything in range is absorbing,
		// and those are different faults.
		await assert.rejects( () => l.read(), /a ring needs at least/ )

	} )

	it( 'keeps the previous scan so two can be compared', async () => {

		let n = 3
		const l = new LidarSensor( { scan : async () => ring( () => n ) } )
		await l.connect()

		await l.read()
		n = 1
		await l.read()

		assert.ok( l.previous )
		assert.equal( points( l.latest )[ 0 ].range, 1 )
		assert.equal( points( l.previous )[ 0 ].range, 3 )

	} )

	it( 'answers nothing rather than something old', async () => {

		const l = new LidarSensor( {
			scan : async () => ring( () => 2 ),
			staleAfter : 10,
		} )
		await l.connect()
		await l.read()

		assert.ok( l.latest )
		await new Promise( r => setTimeout( r, 40 ) )

		// A stale moisture reading is roughly still true. A stale scan describes
		// a room somebody may have moved a chair through.
		assert.equal( l.latest, null )
		assert.equal( l.freshness().fresh, false )
		assert.match( l.freshness().why, /routing through furniture that is no longer there/ )

	} )

} )

describe( 'what now consumes a scan', () => {

	const plant = async () => {

		const p = await createPlant( {
			name : 'Ranged',
			species : 'Ficus lyrata',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		await p.read()
		return p

	}

	it( 'measures a neighbour the coupling layer was being told about', async () => {

		const p = await plant()
		const lidar = await p.attachSensor( { scan : async () => ring( i => ( i > 85 && i < 95 ? 0.31 : 3 ) ),
			driver : 'lidar' } )
		await lidar.read()
		await p.joinColony( { transport : new LoopbackBus().endpoint( 'ranged' ) } )

		const c = await p.colony.coupling( {
			reading : { humidity : 57 },
			metres : 0.25,
			bearing : Math.PI / 2,
		} )

		// The typed 0.25 is replaced by the measured 0.31.
		assert.equal( c.metres, 0.31 )
		assert.equal( c.measured, true )

		await p.destroy()

	} )

	it( 'leaves the typed distance alone when nobody said which way', async () => {

		const p = await plant()
		const lidar = await p.attachSensor( {
			driver : 'lidar',
			scan : async () => ring( () => 3 ),
		} )
		await lidar.read()
		await p.joinColony( { transport : new LoopbackBus().endpoint( 'ranged2' ) } )

		const c = await p.colony.coupling( { metres : 0.25 } )

		assert.equal( c.metres, 0.25 )
		assert.equal( c.measured, false )

		await p.destroy()

	} )

	it( 'refuses a move when the scan says the pot is boxed in', async () => {

		const p = await plant()
		p.chassis = {
			heightM : 1.2,
			baseM : 0.3,
			wheelbaseM : 0.35,
		}
		const lidar = await p.attachSensor( {
			driver : 'lidar',
			scan : async () => ring( () => 0.18 ),
		} )
		await lidar.read()

		const r = await planMove( p, {
			to : {},
			there : { light : 2000 },
			want : { metric : 'light' },
			obstacle : { stepM : 0.005 },
		} )

		assert.equal( r.go, false )
		assert.ok( r.refusals.some( x => x.reason === REFUSAL.BLOCKED ) )
		assert.match( r.why, /planning through a wall/ )

		await p.destroy()

	} )

	it( 'does not block a move when there is room', async () => {

		const p = await plant()
		p.chassis = {
			heightM : 1.2,
			baseM : 0.3,
			wheelbaseM : 0.35,
		}
		const lidar = await p.attachSensor( {
			driver : 'lidar',
			scan : async () => ring( () => 3 ),
		} )
		await lidar.read()

		const r = await planMove( p, {
			to : {},
			there : { light : 2000 },
			want : { metric : 'light' },
			obstacle : { stepM : 0.005 },
		} )

		// Still refused, but for the honest reason: there is no map.
		assert.ok( !r.refusals.some( x => x.reason === REFUSAL.BLOCKED ) )
		assert.equal( r.refusals[ 0 ].reason, REFUSAL.NO_MAP )

		await p.destroy()

	} )

	it( 'is reported by the diagnosis, and asks for one when there are neighbours', async () => {

		const bare = await plant()
		await bare.joinColony( { transport : new LoopbackBus().endpoint( 'bare' ) } )
		bare.colony.neighbours.set( 'willow', {} )

		const absent = ( await bare.systemDiagnosis( { probeAI : false } ) ).checks
			.find( c => c.area === 'spatial' )

		assert.equal( absent.result, 'absent' )
		assert.match( absent.fix, /a number nobody measured/ )
		await bare.destroy()

		const ranged = await plant()
		const lidar = await ranged.attachSensor( {
			driver : 'lidar',
			scan : async () => ring( () => 3 ),
		} )
		await lidar.read()

		const ok = ( await ranged.systemDiagnosis( { probeAI : false } ) ).checks
			.find( c => c.area === 'spatial' )

		assert.equal( ok.result, 'ok' )
		await ranged.destroy()

	} )

} )

describe( 'reachable through the ordinary path, not only when called by hand', () => {

	const ring2 = ( fn, n = 360 ) => ( {
		ranges : Array.from( { length : n }, ( _, i ) => fn( i ) ),
		angleMin : 0,
		angleMax : 2 * Math.PI,
	} )

	it( 'keeps a presence log without being asked, and reaches defence through it', async () => {

		const p = await createPlant( {
			name : 'Watched',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		let busy = 0.2
		await p.attachSensor( {
			driver : 'presence',
			sensing : SENSING.CSI,
			settleSamples : 20,
			sample : async () => Array.from( { length : 52 }, () => Math.random() * busy ),
		} )

		for ( let i = 0; i < 25; i++ ) await p.read()
		assert.ok( p._presenceLog.length > 0, 'reading a plant does not record what the radio said' )

		busy = 6
		for ( let i = 0; i < 10; i++ ) await p.read()

		p.perception.electro = { events : [ {
			label : 'variation_potential',
			at : Date.now(),
		} ] }
		p._lastRegime = {
			changed : true,
			baselineReady : true,
		}

		// The failure this replaced: the control worked when defenseActivation
		// was called directly and never fired through states(), which is the only
		// path anything in this library actually uses.
		const def = p.defense()
		assert.equal( def.level, 'low' )
		assert.equal( def.downgradedFrom, 'medium' )
		assert.match( def.why, /moving nearby/ )

		assert.equal( p.states().defense_activation.level, 'low' )

		await p.destroy()

	} )

	it( 'advertises a rangefinder and a radio to the colony', async () => {

		const p = await createPlant( {
			name : 'Equipped',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		await p.read()

		await p.attachSensor( {
			driver : 'lidar',
			scan : async () => ring2( () => 3 ),
		} )
		await p.attachSensor( {
			driver : 'presence',
			sensing : SENSING.RSSI,
			sample : async () => -50 + Math.random(),
		} )
		await p.joinColony( { transport : new LoopbackBus().endpoint( 'equipped' ) } )

		// FACULTY.RANGE existed and checked a field nothing ever set, so an
		// attached lidar advertised nothing at all.
		const faculties = p.colony.manifest.faculties
		assert.ok( faculties.includes( 'range' ) )
		assert.ok( faculties.includes( 'presence' ) )

		await p.destroy()

	} )

	it( 'does not invent a presence log for a plant with no radio', async () => {

		const p = await createPlant( {
			name : 'Blind',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		await p.read()

		// No radio, so no opinion — rather than an empty log read as "nobody
		// was there", which would silently downgrade nothing forever.
		assert.equal( p.defense().motion, undefined )
		assert.ok( !p.colony?.manifest?.faculties?.includes?.( 'presence' ) )

		await p.destroy()

	} )

} )
