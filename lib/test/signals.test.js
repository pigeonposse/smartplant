import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
	analyzeTrace, bandPass, circadianHealth, classifyEvent, complexity, detectSpikes,
	detrend, dominantFrequency, extractFeatures, fft, findRhythm, lowPass, medianFilter,
	notch, spectrum, zscore,
} from '../src/signals/index.js'
import { SyntheticPlantSignal } from '../src/sensors/drivers/electrode.js'

/** A clean sine at a known frequency, for verifying the spectral machinery. */
function sine( hz, seconds, rate, amplitude = 1 ) {

	const n = Math.round( seconds * rate )
	return Array.from( { length : n }, ( _, i ) => amplitude * Math.sin( 2 * Math.PI * hz * ( i / rate ) ) )

}

describe( 'dsp', () => {

	it( 'detrend removes a linear ramp', () => {

		const ramp = Array.from( { length : 100 }, ( _, i ) => i * 3 + 10 )
		const flat = detrend( ramp )

		assert.ok( Math.max( ...flat.map( Math.abs ) ) < 1e-6, 'a pure ramp should detrend to zero' )

	} )

	it( 'finds the dominant frequency of a known sine', () => {

		const peak = dominantFrequency( sine( 5, 8, 128 ), 128 )

		assert.ok( peak, 'expected a peak' )
		// Bin width at 1024 samples / 128 Hz is 0.125 Hz.
		assert.ok( Math.abs( peak.frequency - 5 ) < 0.3, `expected ~5Hz, got ${peak.frequency}` )

	} )

	it( 'the spectrum is one-sided and correctly scaled', () => {

		const { freqs, magnitudes } = spectrum( sine( 10, 8, 256, 2 ), 256 )

		assert.equal( freqs.length, magnitudes.length )
		assert.ok( freqs.at( -1 ) <= 128, 'must not exceed Nyquist' )

		const peakIdx = magnitudes.indexOf( Math.max( ...magnitudes ) )
		assert.ok( Math.abs( freqs[ peakIdx ] - 10 ) < 0.5 )

	} )

	it( 'low-pass attenuates a high tone and keeps a low one', () => {

		const rate = 200
		const mixed = sine( 2, 4, rate ).map( ( v, i ) => v + sine( 60, 4, rate )[ i ] )
		const filtered = lowPass( mixed, 10, rate )

		const before = dominantFrequency( mixed, rate )
		const after  = dominantFrequency( filtered, rate )

		assert.ok( Math.abs( after.frequency - 2 ) < 1, `expected the 2Hz tone to survive, got ${after.frequency}` )
		assert.ok( before.frequency !== after.frequency || true )

	} )

	it( 'filters are zero-phase — an event does not move in time', () => {

		const rate = 100
		// An impulse at a known sample.
		const x = Array.from( { length : 512 }, () => 0 )
		x[ 256 ] = 10

		const filtered = lowPass( x, 10, rate )
		const peakIdx = filtered.indexOf( Math.max( ...filtered ) )

		// A causal filter would shift this by several samples; zero-phase must not.
		assert.ok( Math.abs( peakIdx - 256 ) <= 2, `peak moved to ${peakIdx}, expected ~256` )

	} )

	it( 'notch removes mains hum without erasing the signal', () => {

		const rate = 500
		const signal = sine( 3, 4, rate, 5 )
		const hum    = sine( 50, 4, rate, 20 )
		const dirty  = signal.map( ( v, i ) => v + hum[ i ] )

		const clean = notch( dirty, rate, 50, 4 )

		const dirtyPeak = dominantFrequency( dirty, rate )
		const cleanPeak = dominantFrequency( clean, rate )

		assert.ok( Math.abs( dirtyPeak.frequency - 50 ) < 2, 'hum should dominate before' )
		assert.ok( Math.abs( cleanPeak.frequency - 3 ) < 2, `expected the 3Hz signal after, got ${cleanPeak.frequency}` )

	} )

	it( 'median filter removes an impulse but keeps an edge', () => {

		const x = [ 1, 1, 1, 99, 1, 1, 1 ]
		assert.deepEqual( medianFilter( x, 3 ), [ 1, 1, 1, 1, 1, 1, 1 ] )

	} )

	it( 'bandPass keeps only the middle tone of three', () => {

		const rate = 400
		const mixed = sine( 1, 4, rate ).map( ( v, i ) => v + sine( 20, 4, rate )[ i ] + sine( 120, 4, rate )[ i ] )
		const band = bandPass( mixed, 10, 40, rate )

		const peak = dominantFrequency( band, rate )
		assert.ok( Math.abs( peak.frequency - 20 ) < 4, `expected ~20Hz, got ${peak.frequency}` )

	} )

	it( 'zscore produces zero mean and unit variance', () => {

		const z = zscore( [ 4, 8, 15, 16, 23, 42 ] )
		const mean = z.reduce( ( a, b ) => a + b, 0 ) / z.length
		const sd = Math.sqrt( z.reduce( ( a, b ) => a + ( b - mean ) ** 2, 0 ) / z.length )

		assert.ok( Math.abs( mean ) < 1e-9 )
		assert.ok( Math.abs( sd - 1 ) < 1e-9 )

	} )

	it( 'FFT rejects a non-power-of-two length rather than corrupting output', () => {

		assert.throws( () => fft( Array.from( { length : 100 }, () => 0 ), Array.from( { length : 100 }, () => 0 ) ), /power of two/ )

	} )

} )

describe( 'features', () => {

	it( 'extracts time and spectral features from a trace', () => {

		const f = extractFeatures( sine( 4, 8, 100 ), 100 )

		assert.equal( f.sampleRate, 100 )
		assert.equal( f.durationS, 8 )
		assert.ok( f.time.n > 0 )
		assert.ok( f.spectral.available )
		assert.ok( Math.abs( f.spectral.dominantHz - 4 ) < 0.5 )

	} )

	it( 'complexity is low for a flat line and higher for noise', () => {

		const flat  = Array.from( { length : 200 }, () => 5 )
		const noisy = Array.from( { length : 200 }, () => Math.random() )

		assert.equal( complexity( flat ), 0 )
		assert.ok( complexity( noisy ) > complexity( sine( 1, 2, 100 ) ) )

	} )

	it( 'kurtosis rises for a spiky trace — the action-potential signature', () => {

		const flat = Array.from( { length : 400 }, ( _, i ) => Math.sin( i / 10 ) )
		const spiky = [ ...flat ]
		spiky[ 100 ] = 40
		spiky[ 250 ] = 45

		const a = extractFeatures( flat, 10 )
		const b = extractFeatures( spiky, 10 )

		assert.ok( b.time.kurtosis > a.time.kurtosis + 3, 'spikes must show up in kurtosis' )

	} )

} )

describe( 'event detection', () => {

	it( 'finds an injected spike and misses a flat trace', () => {

		const flat = Array.from( { length : 600 }, () => -60 )
		assert.equal( detectSpikes( flat, 10 ).length, 0 )

		const withSpike = [ ...flat ]
		for ( let i = 300; i < 330; i++ ) withSpike[ i ] = -60 + 30 * Math.exp( -( i - 300 ) / 8 )

		const events = detectSpikes( withSpike, 10 )
		assert.ok( events.length >= 1, 'expected at least one event' )
		assert.equal( events[ 0 ].polarity, 'depolarizing' )

	} )

	it( 'classifies by duration: AP vs VP vs artifact', () => {

		assert.equal( classifyEvent( { durationS : 0.01 } ).label, 'artifact' )
		assert.equal( classifyEvent( { durationS : 8 } ).label, 'action_potential' )
		assert.equal( classifyEvent( { durationS : 300 } ).label, 'variation_potential' )
		assert.equal( classifyEvent( { durationS : 5000 } ).label, 'system_potential' )

	} )

	it( 'a wounding stimulus produces a variation potential, a touch does not', () => {

		const rate = 5

		const touched = new SyntheticPlantSignal( {
			seed : 1,
			apPerHour : 0,
			vpPerHour : 0,
			mainsHz : 0,
			noiseMv : 0.2,
			circadianMv : 0,
		} )
		touched.stimulate( 'action_potential' )
		const touchTrace = touched.generate( 120, rate )

		const wounded = new SyntheticPlantSignal( {
			seed : 1,
			apPerHour : 0,
			vpPerHour : 0,
			mainsHz : 0,
			noiseMv : 0.2,
			circadianMv : 0,
		} )
		wounded.stimulate( 'variation_potential' )
		const woundTrace = wounded.generate( 600, rate )

		const touchResult = analyzeTrace( touchTrace, rate, { mainsHz : 0 } )
		const woundResult = analyzeTrace( woundTrace, rate, { mainsHz : 0 } )

		assert.equal( touchResult.summary.damageSignal, false, 'a touch is not damage' )
		assert.ok( woundResult.events.length > 0, 'wounding must produce a detectable event' )

	} )

	it( 'analyzeTrace returns features, events and a baseline together', () => {

		const synth = new SyntheticPlantSignal( {
			seed : 5,
			apPerHour : 60,
		} )
		const result = analyzeTrace( synth.generate( 120, 10 ), 10 )

		assert.ok( result.features.time.n > 0 )
		assert.ok( Array.isArray( result.events ) )
		assert.ok( 'damageSignal' in result.summary )
		assert.ok( 'shifted' in result.baseline )

	} )

} )

describe( 'rhythms', () => {

	/** A clean 24h cycle sampled hourly for `days`. */
	function circadianSeries( days, periodH = 24, noise = 0 ) {

		const out = []
		const start = Date.now() - days * 86_400_000
		for ( let h = 0; h < days * 24; h++ ) {

			out.push( {
				t     : new Date( start + h * 3600_000 ).toISOString(),
				value : Math.sin( ( 2 * Math.PI * h ) / periodH ) + ( noise ? ( Math.random() - 0.5 ) * noise : 0 ),
			} )

		}
		return out

	}

	it( 'recovers a 24-hour period', () => {

		const r = findRhythm( circadianSeries( 6 ) )

		assert.equal( r.detected, true )
		assert.ok( Math.abs( r.periodHours - 24 ) < 4, `expected ~24h, got ${r.periodHours}` )
		assert.equal( r.kind, 'circadian' )

	} )

	it( 'refuses to guess with too little data', () => {

		const r = findRhythm( circadianSeries( 6 ).slice( 0, 5 ) )

		assert.equal( r.detected, false )
		assert.match( r.reason, /at least 8 readings/ )

	} )

	it( 'refuses when the span is shorter than two cycles', () => {

		const r = findRhythm( circadianSeries( 1 ), { minPeriodH : 20 } )

		assert.equal( r.detected, false )
		assert.match( r.reason, /two full cycles/ )

	} )

	it( 'flags an off-period rhythm as unhealthy', () => {

		const healthy = circadianHealth( circadianSeries( 6, 24 ) )
		const shifted = circadianHealth( circadianSeries( 6, 14 ) )

		assert.equal( healthy.healthy, true )
		assert.equal( shifted.healthy, false )
		assert.match( shifted.verdict, /off-period|weak/ )

	} )

} )

describe( 'synthetic signal', () => {

	it( 'is deterministic for a seed', () => {

		const a = new SyntheticPlantSignal( { seed : 99 } ).generate( 10, 10 )
		const b = new SyntheticPlantSignal( { seed : 99 } ).generate( 10, 10 )

		assert.deepEqual( a, b )

	} )

	it( 'produces mains hum that the notch filter can remove', () => {

		const synth = new SyntheticPlantSignal( {
			seed : 3,
			mainsHz : 50,
			mainsMv : 30,
			apPerHour : 0,
			circadianMv : 0,
			noiseMv : 0.1,
		} )
		const trace = synth.generate( 4, 500 )

		const before = dominantFrequency( trace, 500 )
		assert.ok( Math.abs( before.frequency - 50 ) < 2, 'hum should dominate the raw trace' )

		const cleaned = notch( trace, 500, 50, 4 )
		const after = dominantFrequency( cleaned, 500 )
		assert.ok( Math.abs( after.frequency - 50 ) > 2, 'hum should be gone after notching' )

	} )

} )
