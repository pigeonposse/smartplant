/**
 * Lamps, panels and what the battery is for.
 *
 * Two things decide whether this is useful: a recipe must never let a probe
 * become a treatment, and an energy policy must not save power by discarding
 * the only readings worth having.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import { fixtureCapability, FIXTURE_IDS, FIXTURES, recipe, RECIPES } from '../src/spectral/index.js'
import { PowerBudget, SolarSupply, SUBSYSTEMS } from '../src/power/index.js'

describe( 'lamps and recipes', () => {

	it( 'gives every fixture channels and an honest note', () => {

		for ( const id of FIXTURE_IDS ) {

			const f = FIXTURES[ id ]
			assert.ok( f.channels.length, `${id} has no channels` )
			assert.ok( f.notes, `${id} says nothing about itself` )

		}

	} )

	it( 'never states a delivered dose, only a drive level', () => {

		// A level is a duty cycle. Two rigs running 0.35 can differ tenfold at the
		// leaf, and a figure in µmol would carry an error nobody could see.
		const r = recipe( 'blue', 'probe', 'horticultural-6ch' )

		assert.equal( r.delivered, null )
		assert.ok( Number.isFinite( r.level ) )
		assert.match( r.why, /drive setting, not a dose/ )

	} )

	it( 'keeps probe levels below treatment levels', () => {

		for ( const [ band, spec ] of Object.entries( RECIPES ) ) {

			if ( !spec.treat ) continue
			assert.ok( spec.probe.level < spec.treat.level,
				`${band}: a probe must not be as strong as a treatment` )

		}

	} )

	it( 'substitutes a nearby wavelength and says the response will be weaker', () => {

		const exact = recipe( 'blue', 'probe', 'horticultural-6ch' )
		const near = recipe( 'blue', 'probe', 'rgb-strip' )

		assert.equal( exact.nm, 450 )
		assert.equal( exact.substituted, false )
		assert.equal( near.nm, 470 )
		assert.equal( near.substituted, true )
		assert.match( near.why, /weaker/ )

	} )

	it( 'refuses a probe the fixture cannot run', () => {

		const r = recipe( 'farRed', 'probe', 'rgb-strip' )

		assert.equal( r.usable, false )
		assert.match( r.why, /no farRed channel/ )

	} )

	it( 'falls back to a sham control where there is no amber', () => {

		// Horticultural fixtures almost never carry amber, and the control is
		// what every other band is interpreted against.
		const r = recipe( 'amber', 'probe', 'horticultural-6ch' )

		assert.equal( r.usable, true )
		assert.equal( r.sham, true )
		assert.deepEqual( r.emit, {} )
		assert.match( r.why, /the lamp stays dark/ )

	} )

	it( 'says plainly that a white-only fixture cannot probe at all', () => {

		const c = fixtureCapability( 'single-white' )

		assert.equal( c.probes.length, 0 )
		assert.match( c.verdict, /No probing is possible/ )

	} )

	it( 'offers no treatment for the diagnostic-only bands', () => {

		// Green, amber and UV-A ask questions. Nothing here turns them into doses.
		for ( const band of [ 'green', 'amber', 'uvA' ] ) {

			assert.equal( RECIPES[ band ].treat, null )
			assert.equal( recipe( band, 'treat', 'horticultural-6ch' ).usable, false )

		}

	} )

} )

describe( 'solar', () => {

	it( 'labels an estimate as an estimate every time', () => {

		const s = new SolarSupply( { wattsPeak : 20 } )
		const d = s.daily()

		assert.equal( d.measured, false )
		assert.match( d.why, /arithmetic, not a measurement/ )

	} )

	it( 'says what it means to have no panel', () => {

		assert.equal( new SolarSupply().daily().wh, 0 )
		assert.match( new SolarSupply().daily().why, /nothing replaces/ )

	} )

	it( 'prefers measurements once there are enough of them', () => {

		const s = new SolarSupply( { wattsPeak : 20 } )
		for ( let i = 0; i < 15; i++ ) s.record( 3.2 )

		const d = s.daily()
		assert.equal( d.measured, true )
		assert.match( d.why, /from the panel itself/ )

	} )

} )

describe( 'what the battery is for', () => {

	const budget = ( charge, archetype ) => new PowerBudget( {
		capacityWh : 100,
		charge,
		archetype,
	} )

	it( 'runs everything on mains', () => {

		const p = new PowerBudget()
		assert.equal( p.forecast().unlimited, true )

	} )

	it( 'drops modes as the charge falls', () => {

		assert.equal( budget( 0.9 ).mode().id, 'full' )
		assert.equal( budget( 0.4 ).mode().id, 'measuring' )
		assert.equal( budget( 0.2 ).mode().id, 'frugal' )
		assert.equal( budget( 0.05 ).mode().id, 'survival' )

	} )

	it( 'never sheds the essentials', () => {

		const plan = budget( 0.01 ).plan()

		for ( const [ id, s ] of Object.entries( SUBSYSTEMS ) ) {

			if ( s.essential ) assert.ok( plan.running.includes( id ), `${id} was shed` )

		}

	} )

	it( 'pauses measurement while the motors turn', () => {

		const plan = budget( 0.9 ).plan( { moving : true } )

		assert.ok( plan.running.includes( 'motion' ) )
		// A reading taken while the pot is rolling is measuring the journey.
		assert.ok( !plan.running.includes( 'electrode' ) )
		assert.ok( !plan.running.includes( 'spectral' ) )

	} )

	it( 'sleeps the camera at night for an ordinary plant', () => {

		const plan = budget( 0.9, { nocturnal : false } ).plan( { night : true } )

		assert.ok( !plan.running.includes( 'camera' ) )
		assert.ok( !plan.running.includes( 'spectral' ) )

	} )

	it( 'keeps the electrode awake at night for a CAM plant', () => {

		// The inversion. Sleeping through the dark on a CAM plant saves power by
		// discarding the only measurements worth having.
		const plan = budget( 0.2, { nocturnal : true } ).plan( { night : true } )

		assert.ok( plan.running.includes( 'electrode' ) )
		assert.match( plan.why, /everything worth measuring happens in the dark/ )

	} )

	it( 'still refuses to light a CAM plant at night', () => {

		// The one it is most tempting to illuminate is the one where doing so
		// would do the most harm: these are its active hours.
		const plan = budget( 0.95, { nocturnal : true } ).plan( { night : true } )

		assert.ok( !plan.running.includes( 'spectral' ) )
		assert.match( plan.why, /must not be irradiated through its active hours/ )

	} )

	it( 'includes the return leg when deciding whether to travel', () => {

		const p = new PowerBudget( {
			capacityWh : 10,
			charge : 0.3,
		} )
		const far = p.canTravel( 200 )

		assert.equal( far.afford, false )
		assert.match( far.why, /stranded there/ )

	} )

	it( 'says whether the panel covers the draw', () => {

		const lean = new PowerBudget( {
			capacityWh : 100,
			charge : 0.5,
			solar : { wattsPeak : 40 },
		} )
		const f = lean.forecast( { night : true } )

		assert.ok( Number.isFinite( f.dailyNeedWh ) )
		assert.equal( typeof f.sustainable, 'boolean' )

	} )

	it( 'takes the night policy from the plant it is powering', async () => {

		const plant = await createPlant( {
			name : 'Cactus',
			species : 'Echeveria elegans',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )

		await plant.usePower( {
			capacityWh : 100,
			charge : 0.3,
		} )
		const r = await plant.powerPlan( { night : true } )

		assert.ok( r.plan.running.includes( 'electrode' ) )

		await plant.destroy()

	} )

} )
