import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import {
	BANDS, contraindications, crossBandDiagnosis, describeBands, foldCycles,
	interpret, MockLight, phaseLocking, probePeriodSanity, SPECTRAL_VERDICT,
	SpectralSafety, createLight,
} from '../src/spectral/index.js'

/** A trace with a known period, for verifying the locking maths. */
function carrier( periodSeconds, seconds, rate, amplitude = 1, noise = 0 ) {

	const n = Math.round( seconds * rate )
	return Array.from( { length : n }, ( _, i ) => {

		const t = i / rate
		return amplitude * Math.sin( ( 2 * Math.PI * t ) / periodSeconds )
			+ ( noise ? ( Math.random() - 0.5 ) * noise : 0 )

	} )

}

describe( 'wavelength catalogue', () => {

	it( 'every band declares receptors, a probe stance and a treatment', () => {

		for ( const [ id, b ] of Object.entries( BANDS ) ) {

			assert.ok( b.emoji, `${id} needs an emoji` )
			assert.ok( b.nm > 0 )
			assert.equal( b.range.length, 2 )
			assert.ok( b.photoreceptors.length )
			assert.equal( typeof b.probe.usable, 'boolean' )
			assert.ok( b.treat.effect )
			assert.ok( [ 'low', 'medium', 'high', 'critical' ].includes( b.treat.risk ) )

		}

	} )

	it( 'UV-B and NIR are refused as probes, with a reason', () => {

		assert.equal( BANDS.uvb.probe.usable, false )
		assert.match( BANDS.uvb.probe.why, /DNA/ )
		assert.equal( BANDS.nir.probe.usable, false )

	} )

	it( 'the three headline colours read three different pathways', () => {

		assert.equal( BANDS.blue.probe.reads, 'stomatal_response' )
		assert.equal( BANDS.red.probe.reads, 'photosynthetic_response' )
		assert.equal( BANDS.green.probe.reads, 'mesophyll_response' )

	} )

	it( 'describeBands renders a table for the docs', () => {

		const rows = describeBands()
		assert.equal( rows.length, Object.keys( BANDS ).length )
		assert.ok( rows.every( r => r.emoji && r.label && r.effect ) )

	} )

} )

describe( 'probe period sanity — the guard that stops silent nonsense', () => {

	it( 'refuses a blue probe faster than stomata can respond', () => {

		// The original proposal was 2 Hz. Stomata take 5-30 minutes.
		const twoHz = probePeriodSanity( 'blue', 0.5 / 60 )

		assert.equal( twoHz.ok, false )
		assert.match( twoHz.reason, /needs at least 5min/ )
		assert.equal( twoHz.suggestedMinutes, 16 )

	} )

	it( 'accepts the catalogue period for each probe band', () => {

		for ( const [ id, b ] of Object.entries( BANDS ) ) {

			if ( !b.probe.usable ) continue
			assert.equal( probePeriodSanity( id, b.probe.periodMinutes ).ok, true, `${id} default period should be valid` )

		}

	} )

	it( 'refuses a band that is not a probe at all', () => {

		assert.equal( probePeriodSanity( 'uvb', 60 ).ok, false )

	} )

} )

describe( 'response analysis', () => {

	it( 'detects locking to a known period', () => {

		const rate = 1
		const trace = carrier( 120, 1200, rate, 5, 0.5 )
		const r = phaseLocking( trace, rate, 120 )

		assert.equal( r.locked, true )
		assert.ok( r.snr > 3, `expected SNR>3, got ${r.snr}` )

	} )

	it( 'does not claim locking on pure noise', () => {

		// Seeded: an unseeded fixture here was genuinely flaky, and it was right to
		// be. Noise reaches any fixed SNR threshold some fraction of the time, so
		// a single random draw tests luck rather than the library.
		let seed = 42
		const rnd = () => {

			seed = ( seed * 1103515245 + 12345 ) & 0x7fffffff
			return seed / 0x7fffffff - 0.5

		}

		const noise = Array.from( { length : 1200 }, () => rnd() )

		assert.equal( phaseLocking( noise, 1, 120 ).locked, false )

	} )

	it( 'reports an exact p-value, because the null distribution is known', () => {

		const r = phaseLocking( carrier( 120, 1200, 1, 1, 6 ), 1, 120 )

		// Bin power under "noise only" is exponential about the noise floor, so
		// the chance of reaching SNR x by luck is exactly e^-x.
		// `snr` is reported rounded, so compare proportionally rather than absolutely.
		const expected = Math.exp( -r.snr )
		assert.ok( Math.abs( r.pValue - expected ) / expected < 0.01,
			`p=${r.pValue} should track e^-snr=${expected}` )
		assert.ok( r.pValue < 0.05 )

	} )

	it( 'tightens the threshold when one probe is part of a sweep', () => {

		// Five bands each tested at 5% is a 23% chance of finding a response
		// somewhere on a plant that did nothing. The threshold has to know.
		const alone   = phaseLocking( carrier( 120, 1200, 1 ), 1, 120, { tests : 1 } )
		const inSweep = phaseLocking( carrier( 120, 1200, 1 ), 1, 120, { tests : 5 } )

		assert.ok( inSweep.snrThreshold > alone.snrThreshold )
		assert.equal( alone.tests, 1 )
		assert.equal( inSweep.tests, 5 )

	} )

	it( 'holds the sweep-wide false-positive rate near the nominal 5%', () => {

		let seed = 7
		const rnd = () => {

			seed = ( seed * 1103515245 + 12345 ) & 0x7fffffff
			return seed / 0x7fffffff - 0.5

		}

		let locked = 0
		const trials = 600

		for ( let i = 0; i < trials; i++ ) {

			const noise = Array.from( { length : 1200 }, () => rnd() )
			if ( phaseLocking( noise, 1, 120, { tests : 5 } ).locked ) locked++

		}

		// ~1% per band, so that five bands together land near 5%.
		const rate = locked / trials
		assert.ok( rate < 0.035, `per-band false positives should be ~1%, got ${( rate * 100 ).toFixed( 1 )}%` )

	} )

	it( 'refuses to analyse a recording shorter than two cycles', () => {

		const r = phaseLocking( carrier( 600, 300, 1 ), 1, 600 )
		assert.equal( r.locked, false )
		assert.match( r.reason, /two full cycles/ )

	} )

	it( 'cycle folding recovers amplitude and latency', () => {

		const rate = 2
		const period = 100
		const trace = carrier( period, period * 6, rate, 4 )

		const f = foldCycles( trace, rate, period )

		assert.equal( f.cycles, 6 )
		assert.ok( Math.abs( f.amplitude - 4 ) < 1.5, `expected ~4, got ${f.amplitude}` )
		assert.ok( f.latencySeconds >= 0 && f.latencySeconds < period )

	} )

	it( 'folding averages noise down', () => {

		const rate = 2, period = 100
		const clean = carrier( period, period * 12, rate, 3 )
		const noisy = clean.map( v => v + ( Math.random() - 0.5 ) * 6 )

		const f = foldCycles( noisy, rate, period )
		// Twelve cycles of averaging should recover the signal despite noise
		// twice its amplitude.
		assert.ok( Math.abs( f.amplitude - 3 ) < 2, `expected ~3, got ${f.amplitude}` )

	} )

} )

describe( 'interpretation', () => {

	const mk = ( amplitude, snr = 20 ) => ( {
		fold : { amplitude },
		locking : {
			locked : snr > 3,
			snr,
			harmonicRatio : 0,
		},
	} )

	it( 'reads a strong response against a quiet control', () => {

		const r = interpret( 'blue', mk( 12 ), mk( 1 ) )

		assert.equal( r.key, 'strong' )
		assert.equal( r.reads, 'stomatal_response' )
		assert.match( r.verdict, /turgor and water status/ )

	} )

	it( 'reads a blunted response as water stress language', () => {

		const r = interpret( 'blue', mk( 1.6 ), mk( 1 ) )

		assert.equal( r.key, 'weak' )
		assert.match( r.verdict, /ABA|water stress/ )

	} )

	it( 'reports absent when nothing beats the control', () => {

		const r = interpret( 'blue', mk( 1 ), mk( 1 ) )
		assert.equal( r.key, 'absent' )

	} )

	it( 'refuses to interpret a non-probe band', () => {

		assert.equal( interpret( 'uvb', mk( 10 ), mk( 1 ) ).reads, null )

	} )

} )

describe( 'cross-band diagnosis — separating thirst from malnutrition', () => {

	const strong = { key : 'strong', amplitude : 10, ratio : 5, snr : 20 }
	const weak   = { key : 'weak', amplitude : 2, ratio : 1.6, snr : 6 }

	it( 'blue weak + red strong means water stress', () => {

		const d = crossBandDiagnosis( {
			blue : weak,
			red : strong,
		} )

		assert.equal( d[ 0 ].condition, 'water_stress' )
		assert.ok( d[ 0 ].confidence > 0.7 )
		assert.match( d[ 0 ].reasoning, /ABA/ )

	} )

	it( 'blue strong + red weak means nutrient deficiency', () => {

		const d = crossBandDiagnosis( {
			blue : strong,
			red : weak,
		} )

		assert.equal( d[ 0 ].condition, 'nutrient_deficiency' )
		assert.match( d[ 0 ].reasoning, /not drought/ )

	} )

	it( 'both weak flags severe stress and warns about the electrode', () => {

		const d = crossBandDiagnosis( {
			blue : weak,
			red : weak,
		} )

		assert.equal( d[ 0 ].condition, 'severe_stress' )
		assert.match( d[ 0 ].reasoning, /electrode contact/ )

	} )

	it( 'both strong means no cross-band pattern', () => {

		assert.equal( crossBandDiagnosis( {
			blue : strong,
			red : strong,
		} ).length, 0 )

	} )

	it( 'harmonic distortion with preserved amplitude flags ionic imbalance', () => {

		const d = crossBandDiagnosis( {
			blue : {
				...strong,
				harmonicRatio : 0.8,
			},
			red : strong,
		} )

		assert.ok( d.some( x => x.condition === 'ionic_imbalance' ) )

	} )

} )

describe( 'spectral safety — the interlocks', () => {

	it( 'REFUSES blue on a plant with dry soil', () => {

		// The single most important rule in the module. The plant closed its
		// stomata to survive; forcing them open with blue accelerates death.
		const s = new SpectralSafety()
		const v = s.validate( {
			band : 'blue',
			mode : 'treat',
			seconds : 600,
		}, { current : { soil : 15 } } )

		assert.equal( v.allowed, false )
		assert.match( v.explanation, /conserve water|accelerates dehydration/ )

	} )

	it( 'allows blue on a well-watered plant', () => {

		const s = new SpectralSafety( { darkHours : [ 25, 26 ] } )
		const v = s.validate( {
			band : 'blue',
			mode : 'treat',
			seconds : 600,
		}, { current : {
			soil : 55,
			humidity : 50,
			temperature : 21,
		} } )

		assert.equal( v.allowed, true )

	} )

	it( 'refuses blue on a hot plant even with wet soil', () => {

		const s = new SpectralSafety( { darkHours : [ 25, 26 ] } )
		const v = s.validate( {
			band : 'blue',
			mode : 'treat',
			seconds : 600,
		}, { current : {
			soil : 60,
			humidity : 50,
			temperature : 35,
		} } )

		assert.equal( v.allowed, false )
		assert.match( v.explanation, /32°C|losing water/ )

	} )

	it( 'a probe is not blocked by treatment contraindications', () => {

		// A 4-minute pulse reads the stomata; it does not force them.
		const s = new SpectralSafety( { darkHours : [ 25, 26 ] } )
		const v = s.validate( {
			band : 'blue',
			mode : 'probe',
			seconds : 240,
		}, { current : { soil : 10 } } )

		assert.equal( v.allowed, true )

	} )

	it( 'UV-B needs explicit human authorization', () => {

		const s = new SpectralSafety( { darkHours : [ 25, 26 ] } )
		const ctx = { current : { soil : 55 }, happiness : 80 }

		assert.equal( s.validate( {
			band : 'uvb',
			mode : 'treat',
			seconds : 60,
		}, ctx ).allowed, false )

		s.authorize( 'uvb' )
		assert.equal( s.validate( {
			band : 'uvb',
			mode : 'treat',
			seconds : 60,
		}, ctx ).allowed, true )

	} )

	it( 'far-red is blocked by default and needs a deliberate override', () => {

		const s = new SpectralSafety( { darkHours : [ 25, 26 ] } )
		const ctx = { current : { soil : 55 } }

		const blocked = s.validate( {
			band : 'farRed',
			mode : 'treat',
			seconds : 60,
		}, ctx )
		assert.equal( blocked.allowed, false )
		assert.match( blocked.explanation, /shade-avoidance|weakens/ )

		s.authorize( 'farRed' )
		assert.equal( s.validate( {
			band : 'farRed',
			mode : 'treat',
			seconds : 60,
		}, ctx ).allowed, true )

	} )

	it( 'protects the dark period', () => {

		// A window that covers every hour, so the test is clock-independent.
		const s = new SpectralSafety( { darkHours : [ 0, 24 ] } )
		const v = s.validate( {
			band : 'green',
			mode : 'treat',
			seconds : 60,
		}, { current : { soil : 55 } } )

		assert.equal( v.allowed, false )
		assert.match( v.explanation, /dark period|circadian/ )

	} )

	it( 'tracks a daily dose and trims when the budget runs out', () => {

		const s = new SpectralSafety( { darkHours : [ 25, 26 ] } )
		const ctx = { current : { soil : 55 } }

		s.record( 'green', 28_000 )
		const trimmed = s.validate( {
			band : 'green',
			mode : 'treat',
			seconds : 5000,
		}, ctx )

		assert.equal( trimmed.verdict, SPECTRAL_VERDICT.MODIFY )
		assert.ok( trimmed.request.seconds < 5000 )

		s.record( 'green', 5000 )
		assert.equal( s.validate( {
			band : 'green',
			mode : 'treat',
			seconds : 60,
		}, ctx ).allowed, false )

	} )

	it( 'a contraindication predicate that throws blocks rather than passes', () => {

		// Unknown state is not a licence to irradiate a plant.
		assert.ok( contraindications( 'blue', null ).length > 0 )

	} )

} )

describe( 'light drivers', () => {

	it( 'clamps, drops unsupported channels and reports both', async () => {

		const l = new MockLight( { channels : [ 'blue', 'red' ] } )
		const r = await l.emit( {
			blue : 2,
			red : -1,
			green : 1,
		} )

		assert.equal( r.emission.blue, 1 )
		assert.equal( r.emission.red, 0 )
		assert.deepEqual( r.unsupported, [ 'green' ] )

	} )

	it( 'scales down when the total exceeds the fixture limit', async () => {

		const l = new MockLight( {
			channels : [ 'blue', 'red', 'green' ],
			maxTotal : 1,
		} )
		const r = await l.emit( {
			blue : 1,
			red : 1,
			green : 1,
		} )

		assert.equal( r.scaled, true )
		const total = Object.values( r.emission ).reduce( ( a, b ) => a + b, 0 )
		assert.ok( Math.abs( total - 1 ) < 0.01 )

	} )

	it( 'off() clears every channel', async () => {

		const l = new MockLight()
		await l.emit( { blue : 1 } )
		await l.off()

		assert.deepEqual( l.current, {} )

	} )

	it( 'computes photon flux only when calibrated', async () => {

		const plain = new MockLight()
		await plain.emit( { blue : 1 } )
		assert.equal( plain.flux(), null )

		const cal = new MockLight( { irradiance : { blue : 100 } } )
		await cal.emit( { blue : 0.5 } )
		assert.equal( cal.flux(), 50 )

	} )

	it( 'rejects an unknown channel at construction', () => {

		assert.throws( () => new MockLight( { channels : [ 'ultraviolet' ] } ), /Unknown light channel/ )

	} )

	it( 'createLight builds from a spec and passes instances through', () => {

		assert.ok( createLight( { driver : 'mock' } ) instanceof MockLight )
		const l = new MockLight()
		assert.equal( createLight( l ), l )
		assert.throws( () => createLight( { driver : 'laser' } ), /Unknown light driver/ )

	} )

} )

describe( 'SpectralSystem', () => {

	const makeSystem = async () => {

		const plant = await createPlant( {
			name    : 'Rosa',
			sensor  : {
				driver : 'electrode',
				transport : 'synthetic',
				sampleRate : 2,
				bufferSeconds : 7200,
				mainsHz : 0,
				apPerHour : 0,
				circadianMv : 0,
				noiseMv : 0.3,
			},
			ai : { provider : 'mock' },
		} )

		const spectral = await plant.useSpectral( {
			light  : { driver : 'mock' },
			safety : { darkHours : [ 25, 26 ] },
		} )

		return {
			plant,
			spectral,
		}

	}

	it( 'probing drives the lamp and records a measurement', async () => {

		const { plant, spectral } = await makeSystem()

		const r = await spectral.probe( 'blue', {
			cycles : 3,
			simulate : true,
		} )

		assert.equal( r.band, 'blue' )
		assert.equal( r.measured, true )
		assert.ok( r.samples > 0 )
		assert.ok( spectral.light.log.length > 0, 'the lamp should have been driven' )

		await plant.destroy()

	} )

	it( 'refuses a probe period too fast for the pathway', async () => {

		const { plant, spectral } = await makeSystem()

		await assert.rejects(
			() => spectral.probe( 'blue', {
				periodMinutes : 0.01,
				simulate : true,
			} ),
			/needs at least/,
		)

		await plant.destroy()

	} )

	it( 'refuses a band the fixture cannot emit', async () => {

		const plant = await createPlant( {
			name : 'Rosa',
			sensor : 'mock',
			ai : { provider : 'mock' },
		} )
		const spectral = await plant.useSpectral( {
			light : {
				driver : 'mock',
				channels : [ 'red' ],
			},
			safety : { darkHours : [ 25, 26 ] },
		} )

		await assert.rejects( () => spectral.probe( 'blue', { simulate : true } ), /no Blue channel/ )
		await plant.destroy()

	} )

	it( 'a sweep runs the control first and interprets against it', async () => {

		const { plant, spectral } = await makeSystem()

		const sweep = await spectral.sweep( {
			bands : [ 'amber', 'blue', 'red' ],
			cycles : 3,
			simulate : true,
		} )

		assert.deepEqual( sweep.bands, [ 'amber', 'blue', 'red' ] )
		assert.ok( sweep.responses.amber, 'the control channel must run' )
		// Amber is the control, so it is not itself interpreted.
		assert.ok( !( 'amber' in sweep.interpreted ) )
		assert.ok( 'blue' in sweep.interpreted )
		assert.equal( typeof sweep.summary, 'string' )

		await plant.destroy()

	} )

	it( 'one failing band does not abandon the sweep', async () => {

		const { plant, spectral } = await makeSystem()

		const sweep = await spectral.sweep( {
			// uvb is not probeable, so it is filtered out rather than crashing.
			bands : [ 'amber', 'blue', 'uvb' ],
			cycles : 2,
			simulate : true,
		} )

		assert.ok( sweep.responses.blue )
		assert.ok( !sweep.bands.includes( 'uvb' ) )

		await plant.destroy()

	} )

	it( 'treat() is refused on dry soil and says why', async () => {

		const { plant, spectral } = await makeSystem()

		const r = await spectral.treat( 'blue', {
			seconds : 60,
			simulate : true,
			context : { current : { soil : 10 } },
		} )

		assert.equal( r.applied, false )
		assert.match( r.explanation, /conserve water/ )

		await plant.destroy()

	} )

	it( 'treat() applies and books the dose when conditions are safe', async () => {

		const { plant, spectral } = await makeSystem()

		const r = await spectral.treat( 'green', {
			seconds : 120,
			simulate : true,
			context : { current : { soil : 55 } },
		} )

		assert.equal( r.applied, true )
		assert.equal( r.emoji, '🟢' )
		assert.ok( r.remainingToday < BANDS.green.treat.maxDailySeconds )

		await plant.destroy()

	} )

	it( 'the lamp is off after a probe, whatever happened', async () => {

		const { plant, spectral } = await makeSystem()
		await spectral.probe( 'red', {
			cycles : 2,
			simulate : true,
		} )

		assert.deepEqual( spectral.light.current, {} )
		await plant.destroy()

	} )

} )

describe( 'kernel integration', () => {

	it( 'interrogate() stores the sweep in the context', async () => {

		const plant = await createPlant( {
			name : 'Rosa',
			sensor : {
				driver : 'electrode',
				transport : 'synthetic',
				sampleRate : 2,
				bufferSeconds : 7200,
				mainsHz : 0,
				circadianMv : 0,
			},
			ai : { provider : 'mock' },
		} )
		await plant.useSpectral( {
			light : { driver : 'mock' },
			safety : { darkHours : [ 25, 26 ] },
		} )

		const sweep = await plant.interrogate( {
			bands : [ 'amber', 'blue', 'red' ],
			cycles : 2,
			simulate : true,
		} )

		assert.ok( sweep.summary )
		assert.ok( plant.context().spectral, 'the context must carry the sweep' )

		await plant.destroy()

	} )

	it( 'spectral findings become independent evidence', async () => {

		const plant = await createPlant( {
			name : 'Rosa',
			sensor : {
				driver : 'electrode',
				transport : 'synthetic',
				sampleRate : 2,
				bufferSeconds : 7200,
				mainsHz : 0,
				circadianMv : 0,
			},
			ai : { provider : 'mock' },
		} )
		await plant.embody()
		await plant.useSpectral( {
			light : { driver : 'mock' },
			safety : { darkHours : [ 25, 26 ] },
		} )

		// Inject a diagnosis directly: what matters here is that the kernel
		// forwards findings to the ledger as a distinct source.
		plant.spectral.sweep = async () => ( {
			at : new Date().toISOString(),
			bands : [],
			responses : {},
			interpreted : {},
			diagnosis : [ {
				condition : 'water_stress',
				confidence : 0.8,
				because : [ 'blue blunted, red normal' ],
			} ],
			summary : 'x',
		} )

		await plant.interrogate()

		const cues = plant.body.evidence.forClaim( 'water_stress' )
		assert.equal( cues.length, 1 )
		assert.equal( cues[ 0 ].source, 'spectral' )

		await plant.destroy()

	} )

	it( 'interrogate() before useSpectral() is a clear error', async () => {

		const plant = await createPlant( {
			name : 'Rosa',
			sensor : 'mock',
			ai : { provider : 'mock' },
		} )

		await assert.rejects( () => plant.interrogate(), /useSpectral/ )
		await plant.destroy()

	} )

} )
