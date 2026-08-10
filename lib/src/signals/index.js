/**
 * Plant electrophysiology: acquisition-agnostic signal processing.
 *
 * Pair with the `electrode` sensor driver to stream a waveform, or call these
 * directly on any array of samples you already have.
 */

export {
	bandPass, biquad, detrend, dominantFrequency, fft, hann, highPass, lowPass,
	medianFilter, movingAverage, notch, removeMean, resample, spectrum, zscore,
} from './dsp.js'

export {
	complexity, describeFeatures, extractFeatures, spectralFeatures, timeFeatures,
} from './features.js'

export {
	baselineShift, classifyEvent, detectSpikes, summarizeEvents,
} from './spikes.js'

export {
	autocorrelation, circadianHealth, findRhythm, resampleToGrid,
} from './rhythms.js'

import { extractFeatures } from './features.js'
import {
	bandPass, notch,
} from './dsp.js'
import {
	baselineShift, detectSpikes, summarizeEvents,
} from './spikes.js'

/**
 * The one-call pipeline: clean a raw trace, extract features, find events.
 *
 * @param   {number[]} samples             - Raw samples (mV).
 * @param   {number}   sampleRate          - Samples per second.
 * @param   {object}   [opts]              - Options.
 * @param   {number}   [opts.mainsHz]      - Mains frequency to notch out. 0 disables.
 * @param   {number}   [opts.bandLowHz]    - Band-pass lower cutoff.
 * @param   {number}   [opts.bandHighHz]   - Band-pass upper cutoff.
 * @param   {number}   [opts.threshold]    - Spike threshold in MADs.
 * @returns {object}                       `{features, events, baseline, cleaned}`.
 */
export function analyzeTrace( samples, sampleRate, opts = {} ) {

	const {
		mainsHz = 50, bandLowHz = 0, bandHighHz = 0, threshold = 4,
	} = opts

	let cleaned = [ ...samples ]

	// Mains hum first: it is usually the largest component by far, and removing
	// it before band-passing keeps the later filters out of saturation.
	if ( mainsHz > 0 && mainsHz < sampleRate / 2 ) cleaned = notch( cleaned, sampleRate, mainsHz )
	if ( bandHighHz > 0 ) cleaned = bandPass( cleaned, bandLowHz, bandHighHz, sampleRate )

	const features = extractFeatures( cleaned, sampleRate )
	const events   = detectSpikes( cleaned, sampleRate, { threshold } )
	const durationS = samples.length / sampleRate

	return {
		features,
		events,
		summary  : summarizeEvents( events, durationS ),
		baseline : baselineShift( cleaned, sampleRate ),
		cleaned,
	}

}
