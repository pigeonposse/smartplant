import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from 'smartplant'

import plugin from './index.js'

/** A plant with a believable history in a given spot. */
async function grow( { name, temperature = 22, soil = 45, episodes = [] } ) {

	const plant = await createPlant( {
		name,
		species : 'Ficus lyrata',
		sensor  : {
			driver : 'mock',
			dayNight : false,
		},
		ai      : { provider : 'mock' },
	} )

	let seed = 5
	const jitter = span => {

		seed = ( seed * 1103515245 + 12345 ) & 0x7fffffff
		return ( seed / 0x7fffffff - 0.5 ) * span

	}

	for ( let i = 0; i < 240; i++ ) {

		await plant.memory.addReading( {
			timestamp   : Date.now() - ( 240 - i ) * 6 * 3600_000,
			temperature : temperature + jitter( 4 ),
			humidity    : 55 + jitter( 10 ),
			soil        : soil + jitter( 12 ),
			light       : 900 + jitter( 200 ),
		} )

	}

	if ( episodes.length ) plant.body = { personalization : { memory : { episodes } } }

	return plant

}

const spots = [
	{ temperature : 14, soil : 25, humidity : 35 },
	{ temperature : 22, soil : 45, humidity : 55 },
	{ temperature : 27, soil : 62, humidity : 70 },
	{ temperature : 18, soil : 55, humidity : 48 },
]

const episodes = ( action, contexts, n, reward ) =>
	Array.from( { length : n }, ( _, i ) => ( {
		at      : new Date().toISOString(),
		action,
		reward,
		context : contexts[ i % contexts.length ],
	} ) )

describe( '@smartplant/migration', () => {

	it( 'installs and reports that nothing has been inherited yet', async () => {

		const plant = await grow( { name : 'Alone' } )
		await plant.use( plugin )

		const status = plant.plugin( 'migration' ).status()
		assert.equal( status.inherited, false )
		assert.match( status.summary, /measured itself/ )

		await plant.destroy()

	} )

	it( 'bequeaths what travels and names what does not', async () => {

		const plant = await grow( {
			name : 'Elder',
			episodes : [
				...episodes( 'move_to_light', spots, 32, 0.7 ),
				// 400 outcomes, all in one unchanging spot.
				...episodes( 'water_early', [ spots[ 1 ] ], 400, 0.9 ),
			],
		} )
		await plant.use( plugin )

		const { shipped, withheld, summary } = await plant.plugin( 'migration' ).bequeath()

		assert.deepEqual( shipped, [ 'move_to_light' ] )
		assert.equal( withheld.length, 1 )
		assert.equal( withheld[ 0 ].action, 'water_early' )
		assert.ok( withheld[ 0 ].trials > shipped.length,
			'the withheld policy had far more evidence than the one that shipped' )
		assert.match( summary, /held back/ )

		await plant.destroy()

	} )

	it( 'says so plainly when nothing is transferable', async () => {

		const plant = await grow( {
			name : 'Fixed',
			episodes : episodes( 'water_early', [ spots[ 1 ] ], 300, 0.9 ),
		} )
		await plant.use( plugin )

		const { shipped, summary } = await plant.plugin( 'migration' ).bequeath()

		assert.equal( shipped.length, 0 )
		assert.match( summary, /describes this spot rather than this plant/ )

		await plant.destroy()

	} )

	it( 'checks whether a bundle would suit before changing anything', async () => {

		const source = await grow( { name : 'Sol', soil : 20 } )
		const target = await grow( { name : 'Sombra', soil : 70 } )

		await source.use( plugin )
		await target.use( plugin )

		const { bundle } = await source.plugin( 'migration' ).bequeath()
		const before = { ...target.ranges.soil }

		const fit = await target.plugin( 'migration' ).wouldSuit( bundle )

		assert.equal( fit.compatible, false )
		assert.ok( fit.mismatches.some( m => m.metric === 'soil' ) )
		assert.deepEqual( target.ranges.soil, before, 'asking must not change anything' )

		await source.destroy()
		await target.destroy()

	} )

	it( 'receives an inheritance and holds back what does not fit', async () => {

		const source = await grow( {
			name : 'Dry',
			soil : 20,
			episodes : episodes( 'soil_early_water', spots, 30, 0.8 ),
		} )
		const target = await grow( { name : 'Wet', soil : 70 } )

		await source.use( plugin )
		await target.use( plugin )

		const { bundle } = await source.plugin( 'migration' ).bequeath()
		const received = await target.plugin( 'migration' ).receive( bundle )

		assert.equal( received.compatibility.compatible, false )
		assert.equal( received.held.length, 1 )
		assert.match( received.held[ 0 ].reason, /problem this plant may not have/ )

		await source.destroy()
		await target.destroy()

	} )

	it( 'inherits at install time and emits the event', async () => {

		const source = await grow( {
			name : 'A',
			episodes : episodes( 'move_to_light', spots, 30, 0.8 ),
		} )
		await source.use( plugin )
		const { bundle } = await source.plugin( 'migration' ).bequeath()

		const heir = await grow( { name : 'B' } )

		let announced = null
		heir.on( 'migration:inherited', payload => {

			announced = payload

		} )

		await heir.use( plugin, { inherit : bundle } )

		assert.ok( announced, 'installing with a bundle should announce it' )
		assert.equal( heir.plugin( 'migration' ).status().inherited, true )

		await source.destroy()
		await heir.destroy()

	} )

	it( 'dilutes the inheritance as this plant measures for itself', async () => {

		const source = await grow( {
			name : 'A',
			episodes : episodes( 'move_to_light', spots, 30, 0.9 ),
		} )
		await source.use( plugin )
		const { bundle } = await source.plugin( 'migration' ).bequeath()

		const heir = await grow( { name : 'B' } )
		await heir.use( plugin, { inherit : bundle } )

		const mig = heir.plugin( 'migration' )
		const first = mig.outcome( 'move_to_light', 0 )

		for ( let i = 0; i < 50; i++ ) mig.outcome( 'move_to_light', 0 )
		const later = mig.outcome( 'move_to_light', 0 )

		assert.ok( later.weight < first.weight, 'the inheritance must fade' )
		assert.ok( later.expected < first.expected,
			'this plant\'s own measurements have to win in the end' )

		await source.destroy()
		await heir.destroy()

	} )

	it( 'refuses to record an outcome with nothing inherited', async () => {

		const plant = await grow( { name : 'Alone' } )
		await plant.use( plugin )

		assert.throws( () => plant.plugin( 'migration' ).outcome( 'x', 1 ), /Nothing has been inherited/ )

		await plant.destroy()

	} )

} )
