/**
 * Analysis of a plant's electrical response to a light probe.
 *
 * The method comes from the LIRB literature: drive the plant with a periodic
 * light/dark cycle and the surface potential locks to that period, forming a
 * carrier. The plant's internal state then shows up as *modulation* of that
 * carrier — amplitude, phase and harmonic content — rather than as a discrete
 * event you have to catch.
 *
 * The single most important engineering fact here: **plant photoresponses are
 * minutes-scale, not seconds-scale.** Stomatal opening takes 5-30 minutes. A
 * probe period faster than the pathway's own latency measures nothing except
 * the noise floor, so `probePeriodSanity()` refuses to let that happen quietly.
 */

import { vpdBand } from '../memory/context.js'
import { detrend, spectrum } from '../signals/index.js'
import { BANDS } from './wavelengths.js'

/**
 * Is this probe period physically capable of reading this pathway?
 *
 * @param   {string} bandId         - Band being used as a probe.
 * @param   {number} periodMinutes  - Proposed probe period.
 * @returns {object}                `{ok, reason, suggestedMinutes}`.
 */
export function probePeriodSanity( bandId, periodMinutes ) {

	const b = BANDS[ bandId ]
	if ( !b?.probe?.usable ) {

		return {
			ok : false,
			reason : b?.probe?.why || `"${bandId}" is not usable as a probe.`,
			suggestedMinutes : null,
		}

	}

	const suggested = b.probe.periodMinutes

	// A full cycle has to be long enough for the pathway to actually move. Half
	// the period is the "on" phase, and that must exceed the response latency.
	const latency = b.probe.latency
	const minOnMinutes = latency?.openingMinutes?.[ 0 ]
		?? ( latency?.onsetSeconds?.[ 0 ] ? latency.onsetSeconds[ 0 ] / 60 : null )
		?? ( latency?.conversionMinutes?.[ 0 ] ?? null )

	if ( minOnMinutes && periodMinutes / 2 < minOnMinutes ) {

		return {
			ok     : false,
			reason : `A ${periodMinutes}min period gives a ${( periodMinutes / 2 ).toFixed( 1 )}min pulse, but the ${b.label.toLowerCase()} pathway needs at least ${minOnMinutes}min to respond. The probe would read noise, not the plant.`,
			suggestedMinutes : suggested,
		}

	}

	return {
		ok     : true,
		reason : `${periodMinutes}min is long enough for the ${b.label.toLowerCase()} pathway.`,
		suggestedMinutes : suggested,
	}

}

/**
 * Strength of frequency-locking between a stimulus and the measured response.
 *
 * Concentration of response power at the stimulus frequency is what separates a
 * real evoked response from drift that happened to coincide.
 *
 * @param   {number[]} samples       - Response samples (mV).
 * @param   {number}   sampleRateHz  - Sampling rate.
 * @param   {number}   periodSeconds - Stimulus period.
 * @returns {object}                 `{locked, power, snr, harmonics}`.
 */
export function phaseLocking( samples, sampleRateHz, periodSeconds, opts = {} ) {

	// Under the null hypothesis "there is no response, only noise", the power in
	// any one FFT bin is exponentially distributed about the noise floor. So the
	// probability of a bin reaching an SNR of x by chance is exactly e^-x, and a
	// bare `snr > 3` test is a 5% false-positive rate wearing a technical face.
	//
	// 5% per test would be defensible for one test. A sweep runs one per band, so
	// the chance of *some* band appearing to respond compounds: five bands at 5%
	// is a 23% chance of inventing a response somewhere. The caller therefore
	// says how many tests belong to the same decision, and the threshold is
	// corrected (Šidák) to hold the error rate across the whole sweep.
	const alpha = opts.alpha ?? 0.05
	const tests = Math.max( 1, opts.tests ?? 1 )
	const perTest = 1 - Math.pow( 1 - alpha, 1 / tests )
	const snrThreshold = -Math.log( perTest )

	const target = 1 / periodSeconds
	const { freqs, magnitudes } = spectrum( detrend( samples ), sampleRateHz )

	if ( !freqs.length ) return {
		locked : false,
		reason : 'not enough samples',
	}

	if ( target > freqs.at( -1 ) ) {

		return {
			locked : false,
			reason : `stimulus at ${target.toExponential( 2 )}Hz is above Nyquist for this sample rate`,
		}

	}

	const binWidth = freqs[ 1 ] - freqs[ 0 ] || 1
	if ( target < binWidth ) {

		return {
			locked : false,
			reason : `the recording is too short to resolve a ${periodSeconds}s period — need at least two full cycles`,
		}

	}

	const power = magnitudes.map( m => m * m )
	const at = f => {

		const i = Math.round( f / binWidth )
		return i > 0 && i < power.length ? power[ i ] : 0

	}

	const fundamental = at( target )
	const harmonics = [ 2, 3, 4 ].map( n => ( {
		n,
		power : Number( at( target * n ).toFixed( 8 ) ),
	} ) )

	// Noise floor: everything that is neither the fundamental nor a harmonic.
	const targetBins = new Set( [ 1, 2, 3, 4 ].map( n => Math.round( ( target * n ) / binWidth ) ) )
	const noise = power.filter( ( _, i ) => i > 0 && !targetBins.has( i ) )
	const noiseFloor = noise.length ? noise.reduce( ( a, b ) => a + b, 0 ) / noise.length : 1e-12

	const snr = fundamental / ( noiseFloor || 1e-12 )
	// Harmonic distortion rises when the response saturates or the pathway is
	// stressed, so it carries information beyond the fundamental alone.
	const harmonicPower = harmonics.reduce( ( a, h ) => a + h.power, 0 )

	// Exact, because the null distribution is known rather than assumed.
	const pValue = Math.exp( -snr )

	return {
		locked      : snr > snrThreshold,
		pValue      : Number( pValue.toExponential( 3 ) ),
		snrThreshold : Number( snrThreshold.toFixed( 2 ) ),
		tests,
		frequency   : Number( target.toExponential( 3 ) ),
		power       : Number( fundamental.toFixed( 8 ) ),
		snr         : Number( snr.toFixed( 2 ) ),
		noiseFloor  : Number( noiseFloor.toFixed( 10 ) ),
		harmonics,
		harmonicRatio : fundamental > 0 ? Number( ( harmonicPower / fundamental ).toFixed( 4 ) ) : 0,
	}

}

/**
 * Response amplitude and latency, measured by folding the trace over the
 * stimulus period.
 *
 * Averaging every cycle onto one is the same signal-averaging trick ERP uses:
 * uncorrelated noise falls as 1/√N while the locked response survives.
 *
 * @param   {number[]} samples       - Response samples.
 * @param   {number}   sampleRateHz  - Sampling rate.
 * @param   {number}   periodSeconds - Stimulus period.
 * @param   {number}   [phaseOffset] - Seconds between recording start and first pulse.
 * @returns {object}                 `{cycles, averaged, amplitude, latencySeconds, polarity}`.
 */
export function foldCycles( samples, sampleRateHz, periodSeconds, phaseOffset = 0 ) {

	const periodSamples = Math.round( periodSeconds * sampleRateHz )
	const offset = Math.round( phaseOffset * sampleRateHz )

	if ( periodSamples < 4 || samples.length < periodSamples * 2 ) {

		return {
			cycles : 0,
			reason : `need at least two full cycles (${periodSamples * 2} samples), have ${samples.length}`,
		}

	}

	const clean = detrend( samples )
	const cycles = Math.floor( ( clean.length - offset ) / periodSamples )
	const averaged = Array.from( { length : periodSamples }, () => 0 )

	for ( let c = 0; c < cycles; c++ ) {

		for ( let i = 0; i < periodSamples; i++ ) {

			averaged[ i ] += clean[ offset + c * periodSamples + i ]

		}

	}
	for ( let i = 0; i < periodSamples; i++ ) averaged[ i ] /= cycles

	// Baseline is the mean over the whole averaged cycle, not the tail. Using
	// "the last fifth is the dark phase" assumes the recording happens to be
	// phase-aligned with the stimulus, which it generally is not — and a
	// misaligned baseline inflates the amplitude by whatever the waveform
	// happened to be doing there.
	const baseline = averaged.reduce( ( a, b ) => a + b, 0 ) / periodSamples

	let peakIdx = 0, peak = 0
	for ( let i = 0; i < periodSamples; i++ ) {

		const d = averaged[ i ] - baseline
		if ( Math.abs( d ) > Math.abs( peak ) ) {

			peak = d
			peakIdx = i

		}

	}

	return {
		cycles,
		averaged       : averaged.map( v => Number( ( v - baseline ).toFixed( 5 ) ) ),
		amplitude      : Number( Math.abs( peak ).toFixed( 4 ) ),
		signedAmplitude: Number( peak.toFixed( 4 ) ),
		latencySeconds : Number( ( peakIdx / sampleRateHz ).toFixed( 2 ) ),
		polarity       : peak >= 0 ? 'depolarizing' : 'hyperpolarizing',
	}

}

/**
 * Interpret one band's response against its own baseline (the amber control).
 *
 * Everything is expressed relative to control, because absolute millivolts
 * depend on electrode placement and contact impedance and are not comparable
 * across sessions, let alone across plants.
 *
 * The blue channel additionally needs the atmospheric context. A strong blue
 * response is *not* automatically good news: under high VPD it can mean the
 * stomata are wide open into dry air, which is high transpirational demand
 * rather than comfort. Reading amplitude without VPD is how a monitor concludes
 * "hydration adequate" about a plant that is losing water fast.
 *
 * @param   {string} bandId     - Band probed.
 * @param   {object} response   - `{locking, fold}` for the band.
 * @param   {object} [control]  - The same for the amber control channel.
 * @param   {object} [ctx]      - Plant context, for VPD-aware reading.
 * @returns {object}            `{reads, strength, verdict, confidence}`.
 */
export function interpret( bandId, response, control, ctx ) {

	const b = BANDS[ bandId ]
	if ( !b?.probe?.usable ) {

		return {
			reads : null,
			strength : 0,
			verdict : `"${bandId}" is not a probe band.`,
			confidence : 0,
		}

	}

	const amplitude = response?.fold?.amplitude ?? 0
	const locked    = response?.locking?.locked ?? false
	const snr       = response?.locking?.snr ?? 0

	// The control channel is amber: weakly photoactive, so whatever it produces
	// is the floor that any real response has to beat.
	const floor = control?.fold?.amplitude ?? 0
	const ratio = floor > 0 ? amplitude / floor : ( amplitude > 0 ? Infinity : 0 )

	let strength, key
	if ( !locked || amplitude === 0 ) {

		strength = 0
		key = 'absent'

	}
	else if ( ratio >= 3 || ( floor === 0 && snr > 10 ) ) {

		strength = Math.min( 1, snr / 20 )
		key = 'strong'

	}
	else if ( ratio >= 1.5 ) {

		strength = Math.min( 0.6, snr / 30 )
		key = 'weak'

	}
	else {

		strength = 0
		key = 'absent'

	}

	let verdict = b.probe.interprets?.[ key ]
		|| ( key === 'absent'
			? `No ${b.label.toLowerCase()} response above the control channel.`
			: `${b.label} response present (${key}).` )

	// A strong blue response means different things at 0.5 kPa and at 2.4 kPa.
	const atmosphere = bandId === 'blue' ? readBlueInContext( key, ctx ) : null
	if ( atmosphere ) verdict = atmosphere.verdict

	return {
		reads      : b.probe.reads,
		key,
		strength   : Number( strength.toFixed( 3 ) ),
		amplitude,
		controlAmplitude : floor,
		ratio      : Number.isFinite( ratio ) ? Number( ratio.toFixed( 2 ) ) : null,
		snr,
		latencySeconds : response?.fold?.latencySeconds ?? null,
		vpd        : ctx?.vpd ?? null,
		atmosphere : atmosphere?.state ?? null,
		verdict,
		// Confidence in the *measurement*, distinct from the strength of the
		// biological response it reports.
		confidence : Number( Math.min( 1, snr / 15 ).toFixed( 3 ) ),
	}

}

/**
 * Cross-band diagnosis — the payoff of probing more than one pathway.
 *
 * Separating "the stomata will not open" from "photosynthesis is impaired" is
 * exactly the equifinality problem that a single passive electrode cannot solve.
 *
 * @param   {object} interpreted - Band id → `interpret()` result.
 * @returns {object[]}           Candidate conditions with reasoning.
 */
export function crossBandDiagnosis( interpreted ) {

	const blue  = interpreted.blue
	const red   = interpreted.red
	const green = interpreted.green

	const out = []

	const weak = r => r && ( r.key === 'weak' || r.key === 'absent' )
	const strong = r => r && r.key === 'strong'

	// Blue reads stomatal competence; red reads photosynthetic capacity. The
	// four combinations separate water stress from nutrition cleanly.
	if ( weak( blue ) && strong( red ) ) {

		out.push( {
			condition  : 'water_stress',
			confidence : 0.8,
			because    : [
				`blue probe blunted (amplitude ${blue.amplitude}, ${blue.ratio}× control) — stomata are not opening`,
				`red probe normal (${red.amplitude}) — the photosynthetic apparatus is intact`,
			],
			reasoning  : 'Stomata shut while photosynthesis is healthy is the signature of ABA-mediated closure, which means water stress rather than damage.',
		} )

	}

	if ( strong( blue ) && weak( red ) ) {

		out.push( {
			condition  : 'nutrient_deficiency',
			confidence : 0.7,
			because    : [
				`blue probe normal (${blue.amplitude}) — hydration and turgor are adequate`,
				`red probe reduced (${red.amplitude}, ${red.ratio}× control) — electron transport is impaired`,
			],
			reasoning  : 'Adequate water with impaired photosynthesis points at nutrition (N, Mg, Fe) or photosystem damage, not drought.',
		} )

	}

	if ( weak( blue ) && weak( red ) ) {

		out.push( {
			condition  : 'severe_stress',
			confidence : 0.6,
			because    : [ 'both the stomatal and photosynthetic probes are blunted' ],
			reasoning  : 'Loss of response on both pathways means either advanced stress or a measurement problem — check electrode contact before acting.',
		} )

	}

	if ( strong( green ) === false && green && strong( red ) ) {

		out.push( {
			condition  : 'lower_canopy_decline',
			confidence : 0.55,
			because    : [
				`green probe weak (${green.amplitude}) — deep mesophyll under-responding`,
				'red probe normal — the upper canopy is fine',
			],
			reasoning  : 'Green penetrates to lower leaves that red and blue never reach. A healthy top with a quiet interior means self-shading or senescing lower foliage.',
		} )

	}

	// Harmonic distortion without amplitude loss is the early marker the LIRB
	// literature reports for osmotic and salt stress.
	for ( const [ bandId, r ] of Object.entries( interpreted ) ) {

		const hr = r?.harmonicRatio
		if ( hr > 0.5 && r.key === 'strong' ) {

			out.push( {
				condition  : 'ionic_imbalance',
				confidence : 0.45,
				because    : [ `${bandId} response is distorted (harmonic ratio ${hr}) while amplitude is preserved` ],
				reasoning  : 'Waveform distortion ahead of amplitude loss is an early marker of altered K+/Na+ balance — often salinity — before any visible symptom.',
			} )
			break

		}

	}

	return out.sort( ( a, b ) => b.confidence - a.confidence )

}


/**
 * Read a blue-probe result against the atmospheric demand it happened under.
 *
 * The stomatal response is a control action, not a comfort score. Wide-open
 * stomata into 2.4 kPa air is the plant spending water hard; wide-open into
 * 0.6 kPa is the plant relaxed. The amplitude alone cannot tell you which.
 *
 * @param   {string} key - `'strong'` | `'weak'` | `'absent'`.
 * @param   {object} ctx - Plant context, carrying `vpd` and `current`.
 * @returns {object|null} `{state, verdict}`, or null without VPD.
 */
export function readBlueInContext( key, ctx ) {

	const vpd = ctx?.vpd
	if ( !Number.isFinite( vpd ) ) return null

	// A CAM plant keeps its stomata shut through the day on purpose. Reading that
	// closure as water stress is not an imprecise conclusion, it is an inverted
	// one — and no amount of further data corrects it, because the model of the
	// plant is upside down. The archetype is the only thing that can say so.
	if ( ctx?.archetype?.nocturnal ) {

		const hour = new Date().getHours()
		const daytime = hour >= 8 && hour <= 18

		if ( daytime ) {

			return {
				state   : 'cam_daytime_closure',
				verdict : `Stomata are shut, and for a CAM plant in daylight that is correct behaviour rather than stress — these open at night to take in CO₂ without losing water. A blue probe cannot read hydration on this plant during the day; probe after dark or use soil and turgor instead.`,
			}

		}

	}

	const band = vpdBand( vpd )
	const soil = ctx?.current?.soil
	const dry  = Number.isFinite( soil ) && soil < 35

	if ( key === 'strong' && ( band === 'high' || band === 'severe' ) ) {

		return dry
			? {
				state   : 'demand_with_deficit',
				verdict : `Stomata are open at ${vpd} kPa with soil at ${soil}% — the plant is transpiring hard against a supply it does not have. This is the combination that precedes sudden wilting, not a sign of comfort.`,
			}
			: {
				state   : 'high_demand',
				verdict : `Stomata open readily, but at ${vpd} kPa (${band} VPD) that means high transpirational demand rather than comfort. Water use is elevated; check the soil more often than usual.`,
			}

	}

	if ( key === 'weak' && band === 'low' ) {

		return {
			state   : 'no_demand',
			verdict : `Muted stomatal response at only ${vpd} kPa. In still, humid air a plant has little reason to open — this reads as low demand, not necessarily water stress. Re-probe when the air dries.`,
		}

	}

	if ( key === 'weak' && ( band === 'high' || band === 'severe' ) ) {

		return {
			state   : 'closed_under_demand',
			verdict : `Stomata stayed shut at ${vpd} kPa, when the atmospheric pull was strong. Refusing to open under that demand is a clear ABA signal: water stress.`,
		}

	}

	return null

}
