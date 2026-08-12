/**
 * Deepening the electrode: the plant's own baseline, its own clock, and a way
 * to tell its voice from a bad contact.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import { vaporPressureDeficit, vpdBand } from '../src/memory/context.js'
import { readBlueInContext } from '../src/spectral/index.js'
import {
	clockCues, coherenceCues, crossCorrelate, electromeFingerprint,
	ElectromeBaseline, estimatePhase, fingerprintDelta, fingerprintDistance,
	internalClock, matchEvents, medianFingerprint, PROPAGATION,
	propagationPlausible, shiftCues, signedHourDifference, siteCoherence,
	timingAdvice,
} from '../src/signals/index.js'
import { SyntheticPlantSignal } from '../src/sensors/drivers/electrode.js'

/** A trace with controllable character, for driving the fingerprint. */
function trace( {
	seconds = 120, rate = 5, noise = 0.5, periodS = 60, amplitude = 2, seed = 1,
} = {} ) {

	let s = seed
	const rnd = () => {

		s = ( s * 1103515245 + 12345 ) & 0x7fffffff
		return s / 0x7fffffff - 0.5

	}

	return Array.from( { length : Math.round( seconds * rate ) }, ( _, i ) => {

		const t = i / rate
		return -60 + amplitude * Math.sin( ( 2 * Math.PI * t ) / periodS ) + rnd() * noise

	} )

}

// ── #5 · VPD-aware blue ─────────────────────────────────────────────────────

describe( 'VPD', () => {

	it( 'computes vapour pressure deficit', () => {

		// 25°C at 50% RH is a well-known ~1.58 kPa.
		assert.ok( Math.abs( vaporPressureDeficit( 25, 50 ) - 1.58 ) < 0.05 )
		// Saturated air has no deficit.
		assert.equal( vaporPressureDeficit( 20, 100 ), 0 )
		assert.equal( vaporPressureDeficit( 20, undefined ), null )

	} )

	it( 'bands the deficit', () => {

		assert.equal( vpdBand( 0.2 ), 'low' )
		assert.equal( vpdBand( 0.9 ), 'comfortable' )
		assert.equal( vpdBand( 1.6 ), 'high' )
		assert.equal( vpdBand( 2.5 ), 'severe' )

	} )

	it( 'appears in the plant context', async () => {

		const plant = await createPlant( {
			name : 'R',
			sensor : {
				driver : 'mock',
				temperature : 25,
				humidity : 50,
				dayNight : false,
			},
			ai : { provider : 'mock' },
		} )
		await plant.read()

		assert.ok( Number.isFinite( plant.context().vpd ) )
		await plant.destroy()

	} )

} )

describe( 'blue read in atmospheric context — the bug that shipped', () => {

	it( 'a strong blue response at high VPD is demand, not comfort', () => {

		const r = readBlueInContext( 'strong', {
			vpd : 2.2,
			current : { soil : 55 },
		} )

		assert.equal( r.state, 'high_demand' )
		assert.match( r.verdict, /demand rather than comfort/ )

	} )

	it( 'strong blue + high VPD + dry soil is the dangerous combination', () => {

		const r = readBlueInContext( 'strong', {
			vpd : 2.2,
			current : { soil : 20 },
		} )

		assert.equal( r.state, 'demand_with_deficit' )
		assert.match( r.verdict, /precedes sudden wilting/ )

	} )

	it( 'a weak response in still humid air is low demand, not stress', () => {

		const r = readBlueInContext( 'weak', {
			vpd : 0.3,
			current : { soil : 55 },
		} )

		assert.equal( r.state, 'no_demand' )
		assert.match( r.verdict, /not necessarily water stress/ )

	} )

	it( 'a weak response under high demand IS stress', () => {

		const r = readBlueInContext( 'weak', {
			vpd : 2.2,
			current : { soil : 30 },
		} )

		assert.equal( r.state, 'closed_under_demand' )
		assert.match( r.verdict, /ABA/ )

	} )

	it( 'stays literal at comfortable VPD, and without VPD at all', () => {

		assert.equal( readBlueInContext( 'strong', {
			vpd : 0.8,
			current : { soil : 55 },
		} ), null )
		assert.equal( readBlueInContext( 'strong', { current : { soil : 55 } } ), null )

	} )

} )

// ── #1 · Electrome fingerprint ──────────────────────────────────────────────

describe( 'electrome fingerprint', () => {

	it( 'produces a comparable signature', () => {

		const fp = electromeFingerprint( trace(), 5, { mainsHz : 0 } )

		assert.ok( Number.isFinite( fp.complexity ) )
		assert.ok( Number.isFinite( fp.entropy ) )
		assert.ok( Number.isFinite( fp.variability ) )
		assert.ok( fp.bands )
		assert.equal( fp.sampleRate, 5 )

	} )

	it( 'is invariant to DC offset — electrode drift must not read as a new plant', () => {

		const base = trace()
		const drifted = base.map( v => v - 40 )

		const a = electromeFingerprint( base, 5, { mainsHz : 0 } )
		const b = electromeFingerprint( drifted, 5, { mainsHz : 0 } )

		assert.ok( fingerprintDistance( a, b ) < 0.15, `offset should barely move the signature, got ${fingerprintDistance( a, b )}` )

	} )

	it( 'distance is zero against itself and rises with real change', () => {

		const calm  = electromeFingerprint( trace( { noise : 0.2 } ), 5, { mainsHz : 0 } )
		const noisy = electromeFingerprint( trace( {
			noise : 8,
			seed : 99,
		} ), 5, { mainsHz : 0 } )

		assert.equal( fingerprintDistance( calm, calm ), 0 )
		assert.ok( fingerprintDistance( calm, noisy ) > 0.05 )

	} )

	it( 'delta names which axes moved, worst first', () => {

		const calm  = electromeFingerprint( trace( { noise : 0.2 } ), 5, { mainsHz : 0 } )
		const noisy = electromeFingerprint( trace( {
			noise : 8,
			seed : 7,
		} ), 5, { mainsHz : 0 } )

		const delta = fingerprintDelta( calm, noisy )

		assert.ok( delta.length > 0 )
		assert.ok( delta[ 0 ].axis )
		assert.ok( [ 'up', 'down' ].includes( delta[ 0 ].direction ) )
		// Sorted by weighted magnitude.
		assert.ok( delta[ 0 ].weighted >= delta.at( -1 ).weighted )

	} )

	it( 'the median signature ignores one outlier window', () => {

		const normal = Array.from( { length : 5 }, ( _, i ) =>
			electromeFingerprint( trace( { seed : i + 1 } ), 5, { mainsHz : 0 } ) )
		const spike = electromeFingerprint( trace( {
			noise : 30,
			seed : 50,
		} ), 5, { mainsHz : 0 } )

		const withoutSpike = medianFingerprint( normal )
		const withSpike    = medianFingerprint( [ ...normal, spike ] )

		assert.ok( fingerprintDistance( withoutSpike, withSpike ) < 0.1,
			'one wild window must not redefine normal' )

	} )

} )

describe( 'electrome baseline', () => {

	const fp = ( opts, rate = 5 ) => electromeFingerprint( trace( opts ), rate, { mainsHz : 0 } )

	it( 'refuses to judge before it has learned the plant', () => {

		const b = new ElectromeBaseline( { settleSamples : 5 } )

		const first = b.push( fp( { seed : 1 } ) )
		assert.equal( first.settled, false )
		assert.match( first.verdict, /Learning this plant's normal/ )
		assert.equal( b.settled, false )

	} )

	it( 'settles, then reports stability', () => {

		const b = new ElectromeBaseline( { settleSamples : 4 } )
		for ( let i = 0; i < 4; i++ ) b.push( fp( { seed : i + 1 } ) )

		assert.equal( b.settled, true )

		const next = b.push( fp( { seed : 9 } ) )
		assert.equal( next.shifted, false )
		assert.match( next.verdict, /within this plant's normal range/ )

	} )

	it( 'detects a genuine shift and names it', () => {

		const b = new ElectromeBaseline( {
			settleSamples : 4,
			shiftThreshold : 0.08,
		} )
		for ( let i = 0; i < 4; i++ ) b.push( fp( { seed : i + 1 } ) )

		const shifted = b.push( fp( {
			noise : 12,
			amplitude : 0.1,
			seed : 77,
		} ) )

		assert.equal( shifted.shifted, true )
		assert.ok( shifted.delta.length > 0 )
		assert.match( shifted.verdict, /shifted/ )
		assert.equal( b.shifts.length, 1 )

	} )

	it( 'rebase re-learns after a legitimate change', () => {

		const b = new ElectromeBaseline( {
			settleSamples : 4,
			shiftThreshold : 0.08,
		} )
		for ( let i = 0; i < 4; i++ ) b.push( fp( { seed : i + 1 } ) )

		// A new normal — repotted, electrode moved, season turned.
		for ( let i = 0; i < 4; i++ ) b.push( fp( {
			noise : 12,
			seed : 40 + i,
		} ) )

		const r = b.rebase( 'moved the electrode' )
		assert.equal( r.rebased, true )

		const after = b.push( fp( {
			noise : 12,
			seed : 60,
		} ) )
		assert.equal( after.shifted, false, 'the new normal should now read as normal' )

	} )

	it( 'a shift produces weak corroborating cues, never a diagnosis', () => {

		const cues = shiftCues( {
			shifted : true,
			distance : 0.2,
			verdict : 'x',
			delta : [ {
				axis : 'complexity',
				direction : 'down',
				delta : -0.3,
				from : 0.5,
				to : 0.2,
			} ],
		} )

		assert.ok( cues.some( c => c.claim === 'electrome_shift' ) )
		assert.ok( cues.some( c => c.claim === 'reduced_activity' ) )
		// Deliberately weak: drift says "something reorganized", not what.
		assert.ok( cues.every( c => c.strength <= 0.8 ) )

	} )

	it( 'rising entropy with rising fast-band power blames the electrode', () => {

		const cues = shiftCues( {
			shifted : true,
			distance : 0.3,
			verdict : 'x',
			delta : [
				{
					axis : 'entropy',
					direction : 'up',
					delta : 0.3,
					from : 0.4,
					to : 0.7,
				},
				{
					axis : 'bands.fast',
					direction : 'up',
					delta : 0.2,
					from : 0.1,
					to : 0.3,
				},
			],
		} )

		assert.ok( cues.some( c => c.claim === 'electrode_degrading' ) )

	} )

	it( 'round-trips through JSON', () => {

		const b = new ElectromeBaseline( { settleSamples : 3 } )
		for ( let i = 0; i < 3; i++ ) b.push( fp( { seed : i + 1 } ) )

		const restored = ElectromeBaseline.fromJSON( b.toJSON(), { settleSamples : 3 } )
		assert.ok( restored.settled )

	} )

} )

// ── #7 · Internal clock ─────────────────────────────────────────────────────

describe( 'internal clock', () => {

	/** A rhythm peaking at a chosen wall hour. */
	function rhythmSeries( {
		days = 5, periodH = 24, acrophaseHour = 13, amplitude = 1,
	} = {} ) {

		const out = []
		const now = new Date()
		const start = new Date( now.getTime() - days * 86_400_000 )
		start.setMinutes( 0, 0, 0 )

		const startHour = start.getHours()

		for ( let h = 0; h < days * 24; h++ ) {

			const t = new Date( start.getTime() + h * 3600_000 )
			// Phase advances with *elapsed* hours, not wall hours — otherwise a
			// 30h period silently becomes a 24h one and free-running never shows.
			const elapsed = h + startHour - acrophaseHour
			const phase = ( elapsed / periodH ) * 2 * Math.PI
			out.push( {
				t : t.toISOString(),
				value : amplitude * Math.cos( phase ),
			} )

		}
		return out

	}

	it( 'refuses without enough data', () => {

		const c = internalClock( [ {
			t : new Date().toISOString(),
			value : 1,
		} ] )
		assert.equal( c.known, false )
		assert.match( c.reason, /at least 12 readings/ )

	} )

	it( 'recovers the acrophase of a known rhythm', () => {

		const c = internalClock( rhythmSeries( { acrophaseHour : 13 } ) )

		assert.equal( c.known, true )
		// Within a couple of hours is plenty for this purpose.
		const err = Math.abs( ( ( c.acrophaseHour - 13 + 12 ) % 24 ) - 12 )
		assert.ok( err < 3, `expected peak near 13h, got ${c.acrophaseHour}` )

	} )

	it( 'calls an aligned plant aligned', () => {

		// Light 7-19 puts the expected acrophase at 13h.
		const c = internalClock( rhythmSeries( { acrophaseHour : 13 } ), {
			expectedDawn : 7,
			expectedDusk : 19,
		} )

		assert.equal( c.aligned, true )
		assert.match( c.verdict, /aligned/ )

	} )

	it( 'detects a shifted clock and says which way', () => {

		const c = internalClock( rhythmSeries( { acrophaseHour : 20 } ), {
			expectedDawn : 7,
			expectedDusk : 19,
		} )

		assert.equal( c.aligned, false )
		assert.ok( Math.abs( c.offsetHours ) > 3 )
		assert.match( c.verdict, /later|earlier/ )

	} )

	it( 'detects free-running', () => {

		const c = internalClock( rhythmSeries( { periodH : 30 } ) )

		assert.equal( c.freeRunning, true )
		assert.match( c.verdict, /Free-running/ )

	} )

	it( 'signed hour difference wraps the dial correctly', () => {

		assert.equal( signedHourDifference( 13, 12 ), 1 )
		assert.equal( signedHourDifference( 1, 23 ), 2 )
		assert.equal( signedHourDifference( 23, 1 ), -2 )

	} )

	it( 'quadrature phase estimation finds a known peak', () => {

		// A cosine sampled from hour 0 peaks at hour 0.
		const grid = Array.from( { length : 96 }, ( _, i ) => Math.cos( ( 2 * Math.PI * i * 0.25 ) / 24 ) )
		const p = estimatePhase( grid, 0.25, 24, 0 )

		assert.ok( p.acrophaseHour < 2 || p.acrophaseHour > 22, `expected ~0h, got ${p.acrophaseHour}` )
		assert.ok( p.strength > 0.5 )

	} )

	it( 'advises against probing at subjective night', () => {

		const night = timingAdvice( {
			known : true,
			subjectiveHour : 2,
		}, 'probe' )

		assert.equal( night.good, false )
		assert.match( night.reason, /closed down/ )
		assert.ok( Number.isFinite( night.betterInHours ) )

		const day = timingAdvice( {
			known : true,
			subjectiveHour : 11,
		}, 'probe' )
		assert.equal( day.good, true )

	} )

	it( 'has no opinion before the clock is known', () => {

		assert.equal( timingAdvice( { known : false }, 'probe' ).good, true )

	} )

	it( 'misalignment becomes an independent cue', () => {

		const cues = clockCues( {
			known : true,
			freeRunning : true,
			periodHours : 30,
			offsetHours : 5,
			strength : 0.4,
		} )

		assert.ok( cues.some( c => c.claim === 'circadian_mismatch' ) )

	} )

} )

// ── #9 · Multi-electrode coherence ──────────────────────────────────────────

describe( 'propagation plausibility', () => {

	it( 'rejects simultaneity as interference, not biology', () => {

		const r = propagationPlausible( 0.01, 50 )

		assert.equal( r.plausible, false )
		assert.equal( r.kind, 'simultaneous' )
		assert.match( r.why, /shared electrical interference/ )

	} )

	it( 'accepts an action-potential speed', () => {

		// 50mm in 5s = 10mm/s, right in the AP band.
		const r = propagationPlausible( 5, 50 )

		assert.equal( r.plausible, true )
		assert.equal( r.kind, 'action_potential' )

	} )

	it( 'refuses to name a kind when the speed ranges overlap', () => {

		// 50mm in 25s = 2mm/s, which fits all three published ranges.
		const r = propagationPlausible( 25, 50 )

		assert.equal( r.plausible, true )
		assert.equal( r.kind, null, 'naming one kind here would be false precision' )
		assert.ok( r.kinds.length > 1 )
		assert.match( r.why, /overlap/ )

	} )

	it( 'names the kind when the speed is actually diagnostic', () => {

		// 50mm in 1.5s = 33mm/s — only an action potential travels that fast.
		const r = propagationPlausible( 1.5, 50 )

		assert.equal( r.plausible, true )
		assert.equal( r.kind, 'action_potential' )
		assert.deepEqual( r.kinds, [ 'action_potential' ] )

	} )

	it( 'rejects speeds beyond plant physiology', () => {

		// 50mm in 0.1s = 500mm/s, far beyond any plant signal.
		const fast = propagationPlausible( 0.1, 50 )
		assert.equal( fast.plausible, false )
		assert.match( fast.why, /exceeds the fastest/ )

		// 50mm in 5000s = 0.01mm/s, slower than anything known.
		const slow = propagationPlausible( 5000, 50 )
		assert.equal( slow.plausible, false )
		assert.match( slow.why, /slower than any known/ )

	} )

	it( 'needs the distance to judge anything', () => {

		assert.equal( propagationPlausible( 5, undefined ).plausible, false )

	} )

	it( 'the speed table covers the three event kinds', () => {

		for ( const kind of [ 'action_potential', 'variation_potential', 'system_potential' ] ) {

			assert.ok( PROPAGATION[ kind ].min < PROPAGATION[ kind ].max )

		}

	} )

} )

describe( 'site coherence', () => {

	const rate = 5

	/**
	 * The same signal at two sites, separated by a delay.
	 *
	 * Deliberately transient rather than periodic: a periodic carrier correlates
	 * equally well at lag and lag+period, so the delay would be ambiguous — which
	 * is exactly what the library now refuses to pretend otherwise about.
	 */
	function twoSites( delayS, {
		correlated = true, seconds = 300,
	} = {} ) {

		const n = Math.round( seconds * rate )
		const bump = ( i, at, width ) => Math.exp( -( ( i / rate - at ) ** 2 ) / ( 2 * width ** 2 ) )

		let seed = 3
		const rnd = () => {

			seed = ( seed * 1103515245 + 12345 ) & 0x7fffffff
			return seed / 0x7fffffff - 0.5

		}

		const a = Array.from( { length : n }, ( _, i ) =>
			-60 + 8 * bump( i, 100, 6 ) + rnd() * 0.3 )

		const shift = Math.round( delayS * rate )

		const b = correlated
			? Array.from( { length : shift }, () => a[ 0 ] ).concat( a.slice( 0, a.length - shift ) )
			// Genuinely unrelated: noise with no shared event. The same bump merely
			// displaced would correlate perfectly at *some* lag, which is not what
			// "uncorrelated" means.
			: Array.from( { length : n }, () => -60 + rnd() * 8 )

		return [
			{
				samples : a,
				sampleRate : rate,
				id : 'leaf',
			},
			{
				samples : b,
				sampleRate : rate,
				id : 'stem',
			},
		]

	}

	it( 'cross-correlation recovers a known delay', () => {

		const [ a, b ] = twoSites( 5 )
		const xc = crossCorrelate( a.samples, b.samples, rate, 60 )

		assert.ok( Math.abs( xc.lagSeconds - 5 ) < 1, `expected ~5s, got ${xc.lagSeconds}` )
		assert.ok( xc.correlation > 0.7 )

	} )

	it( 'confirms a coherent signal across two sites', () => {

		// 50mm apart, 5s delay → 10mm/s, a plausible action potential.
		const [ a, b ] = twoSites( 5 )
		const r = siteCoherence( a, b, { distanceMm : 50 } )

		assert.equal( r.coherent, true )
		assert.match( r.verdict, /corroborated at two sites/ )

	} )

	it( 'flags zero delay as interference, not corroboration', () => {

		// The identical trace at both sites with no delay is mains pickup.
		const [ a ] = twoSites( 5 )
		const r = siteCoherence( a, {
			...a,
			id : 'stem',
		}, { distanceMm : 50 } )

		assert.equal( r.coherent, false )
		assert.match( r.verdict, /interference/ )

	} )

	it( 'reports when the two sites are not tracking each other at all', () => {

		const [ a, b ] = twoSites( 5, { correlated : false } )
		const r = siteCoherence( a, b, { distanceMm : 50 } )

		assert.equal( r.coherent, false )
		assert.match( r.verdict, /not tracking each other|interference|exceeds|slower/ )

	} )

	it( 'refuses to judge without the distance', () => {

		const [ a, b ] = twoSites( 5 )
		const r = siteCoherence( a, b, {} )

		assert.equal( r.coherent, false )
		assert.match( r.verdict, /how far apart/ )

	} )

	it( 'a verified signal is strong evidence; an unreliable one is a warning', () => {

		const verified = coherenceCues( {
			coherent : true,
			verdict : 'ok',
		} )
		assert.equal( verified[ 0 ].claim, 'verified_plant_signal' )
		assert.ok( verified[ 0 ].strength > 0.8 )

		const interference = coherenceCues( {
			coherent : false,
			propagation : { kind : 'simultaneous' },
			verdict : 'x',
		} )
		assert.equal( interference[ 0 ].claim, 'electrical_interference' )

		const unreliable = coherenceCues( {
			coherent : false,
			correlation : 0.05,
			verdict : 'x',
		} )
		assert.equal( unreliable[ 0 ].claim, 'electrode_unreliable' )

	} )

	it( 'matches discrete events and checks each pair', () => {

		const synth = new SyntheticPlantSignal( {
			seed : 5,
			apPerHour : 0,
			vpPerHour : 0,
			mainsHz : 0,
			noiseMv : 0.2,
			circadianMv : 0,
		} )
		synth.stimulate( 'action_potential' )
		const a = synth.generate( 120, rate )

		// The same event 3s later, 30mm away → 10mm/s.
		const shift = 3 * rate
		const b = Array.from( { length : shift }, () => a[ 0 ] ).concat( a.slice( 0, a.length - shift ) )

		const m = matchEvents(
			{
				samples : a,
				sampleRate : rate,
			},
			{
				samples : b,
				sampleRate : rate,
			},
			{ distanceMm : 30 },
		)

		assert.ok( m.pairs.length > 0 )
		assert.ok( m.verdict.length > 0 )

	} )

} )

// ── integration ─────────────────────────────────────────────────────────────

describe( 'kernel integration', () => {

	const makePlant = ( sensor = {} ) => createPlant( {
		name   : 'Rosa',
		sensor : {
			driver : 'electrode',
			transport : 'synthetic',
			sampleRate : 2,
			bufferSeconds : 3600,
			mainsHz : 0,
			circadianMv : 0,
			apPerHour : 0,
			...sensor,
		},
		ai : { provider : 'mock' },
	} )

	it( 'listen() builds the baseline and reports it', async () => {

		const plant = await makePlant()
		const r = await plant.listen( { seconds : 60 } )

		assert.ok( r.fingerprint )
		assert.ok( r.shift )
		assert.equal( r.shift.settled, false, 'the first window cannot be a baseline' )
		assert.ok( plant.electrome )

		await plant.destroy()

	} )

	it( 'the baseline settles over repeated listens', async () => {

		const plant = await createPlant( {
			name : 'Rosa',
			sensor : {
				driver : 'electrode',
				transport : 'synthetic',
				sampleRate : 2,
				bufferSeconds : 3600,
				mainsHz : 0,
				circadianMv : 0,
				apPerHour : 0,
			},
			ai : { provider : 'mock' },
			electrome : { settleSamples : 3 },
		} )

		let last
		for ( let i = 0; i < 4; i++ ) {

			plant.getSensor( 'electrode' ).advance( 60 )
			last = await plant.listen( { seconds : 60 } )

		}

		assert.equal( plant.electrome.settled, true )
		assert.equal( last.shift.settled, true )

		await plant.destroy()

	} )

	it( 'a two-site electrode reports coherence', async () => {

		const plant = await createPlant( {
			name : 'Rosa',
			sensor : {
				driver : 'electrode',
				transport : 'synthetic',
				sampleRate : 5,
				bufferSeconds : 3600,
				mainsHz : 0,
				circadianMv : 0,
				apPerHour : 0,
				noiseMv : 0.2,
				sites : [ {
					id : 'stem',
					distanceMm : 50,
				} ],
			},
			ai : { provider : 'mock' },
		} )

		const electrode = plant.getSensor( 'electrode' )
		electrode.stimulate( 'action_potential' )
		electrode.advance( 300 )

		const r = await plant.listen( { seconds : 300 } )

		assert.ok( r.coherence, 'a second site should produce a coherence report' )
		assert.ok( r.coherence.stem )
		assert.ok( 'coherent' in r.coherence.stem )

		await plant.destroy()

	} )

	it( 'electrome and clock findings reach the evidence ledger as distinct sources', async () => {

		const plant = await createPlant( {
			name : 'Rosa',
			sensor : {
				driver : 'electrode',
				transport : 'synthetic',
				sampleRate : 2,
				bufferSeconds : 3600,
				mainsHz : 0,
				circadianMv : 0,
			},
			ai : { provider : 'mock' },
			electrome : {
				settleSamples : 2,
				shiftThreshold : 0.01,
			},
		} )
		await plant.embody()

		for ( let i = 0; i < 4; i++ ) {

			plant.getSensor( 'electrode' ).advance( 60 )
			await plant.listen( { seconds : 60 } )

		}

		const sources = new Set( plant.body.evidence.cues.map( c => c.source ) )
		assert.ok( sources.has( 'electrome' ), `expected an electrome cue, got ${[ ...sources ]}` )

		await plant.destroy()

	} )

	it( 'emits plant:electrome-shift when the baseline moves', async () => {

		const plant = await createPlant( {
			name : 'Rosa',
			sensor : {
				driver : 'electrode',
				transport : 'synthetic',
				sampleRate : 2,
				bufferSeconds : 3600,
				mainsHz : 0,
				circadianMv : 0,
			},
			ai : { provider : 'mock' },
			electrome : {
				settleSamples : 2,
				shiftThreshold : 0.001,
			},
		} )

		let fired = false
		plant.on( 'plant:electrome-shift', () => {

			fired = true

		} )

		for ( let i = 0; i < 5; i++ ) {

			plant.getSensor( 'electrode' ).advance( 60 )
			await plant.listen( { seconds : 60 } )

		}

		assert.equal( fired, true )
		await plant.destroy()

	} )

} )
