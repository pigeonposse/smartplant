/**
 * Spectral probing and therapy.
 *
 * Turns an RGB / multi-channel LED from a lamp into an **instrument**: instead
 * of waiting for the plant to emit an ambiguous signal, it interrogates a
 * specific photoreceptor pathway and reads what comes back.
 *
 * That is what makes it worth building. The central problem in plant
 * electrophysiology is equifinality — different causes producing the same
 * waveform. Passive sensing can only add modalities; controlled excitation lets
 * you *ask a question whose answer is diagnostic*. Blue reads the stomata, red
 * reads photosynthesis, and the pair separates thirst from malnutrition, which
 * a single electrode never can.
 *
 * Two halves, deliberately unequal in privilege:
 *
 *   `probe()`  — brief, low-intensity interrogation. Free to run.
 *   `treat()`  — sustained dose that changes the plant. Gated by `SpectralSafety`.
 */

export {
	BANDS, BAND_IDS, PROBE_ORDER, band, contraindications, describeBands,
} from './wavelengths.js'

export {
	CallbackLight, createLight, LightDriver, MockLight, MqttLight, SerialLight,
} from './light.js'

export {
	crossBandDiagnosis, foldCycles, interpret, phaseLocking, probePeriodSanity,
} from './analysis.js'

export {
	SPECTRAL_VERDICT, SpectralSafety,
} from './safety.js'

import { SmartPlantError } from '../core/errors.js'
import {
	crossBandDiagnosis, foldCycles, interpret, phaseLocking, probePeriodSanity,
} from './analysis.js'
import { createLight } from './light.js'
import { SpectralSafety } from './safety.js'
import { BANDS, PROBE_ORDER } from './wavelengths.js'

export class SpectralSystem {

	/**
	 * @param {object} [config]            - Options.
	 * @param {object} [config.light]      - Light driver spec or instance.
	 * @param {object} [config.electrode]  - An `ElectrodeSensor`, for reading responses.
	 * @param {object} [config.safety]     - `SpectralSafety` options.
	 * @param {number} [config.level]      - Default probe intensity 0-1.
	 */
	constructor( config = {} ) {

		this.light  = createLight( config.light || { driver : 'mock' } )
		this.safety = config.safety instanceof SpectralSafety
			? config.safety
			: new SpectralSafety( config.safety || {} )

		this.electrode = config.electrode || null
		this.level     = config.level ?? 0.6

		/** @type {object[]} */
		this.history = []
		this._busy = false

	}

	attachElectrode( electrode ) {

		this.electrode = electrode
		return this

	}

	/**
	 * Run one band as a probe and measure the response.
	 *
	 * The sequence is a LIRB carrier: alternate the band on and off at its
	 * pathway-appropriate period, then look for a response locked to that period.
	 *
	 * @param   {string}          bandId              - Band to probe.
	 * @param   {object}          [opts]              - Options.
	 * @param   {number}          [opts.periodMinutes]- Cycle period. Defaults to the band's own.
	 * @param   {number}          [opts.cycles]       - How many cycles. Default 3.
	 * @param   {number}          [opts.level]        - Intensity 0-1.
	 * @param   {boolean}         [opts.simulate]     - Compress time for demos and tests.
	 * @returns {Promise<object>}                     `{band, locking, fold, interpretation}`.
	 */
	async probe( bandId, opts = {} ) {

		const b = BANDS[ bandId ]
		if ( !b ) throw new SmartPlantError( `Unknown band "${bandId}".`, 'CONFIG_ERROR' )

		const periodMinutes = opts.periodMinutes ?? b.probe.periodMinutes
		const sanity = probePeriodSanity( bandId, periodMinutes )

		// The guard that stops the whole idea failing silently: a probe faster
		// than the pathway measures nothing, and must say so rather than return
		// a confident-looking zero.
		if ( !sanity.ok ) {

			throw new SmartPlantError( sanity.reason, 'SPECTRAL_ERROR', { suggestedMinutes : sanity.suggestedMinutes } )

		}

		const verdict = this.safety.validate( {
			band    : bandId,
			mode    : 'probe',
			seconds : periodMinutes * 60 * ( opts.cycles ?? 3 ),
			level   : opts.level ?? this.level,
		} )

		if ( !verdict.allowed ) {

			throw new SmartPlantError( verdict.explanation, 'SPECTRAL_ERROR' )

		}

		if ( !this.light.supports( bandId ) ) {

			throw new SmartPlantError(
				`The fixture has no ${b.label} channel. It emits: ${this.light.channels.join( ', ' )}.`,
				'SPECTRAL_ERROR',
			)

		}

		if ( this._busy ) throw new SmartPlantError( 'A spectral sequence is already running.', 'SPECTRAL_ERROR' )
		this._busy = true

		try {

			const cycles = opts.cycles ?? 3
			const level  = verdict.request.level ?? this.level
			const periodSeconds = periodMinutes * 60

			const startedAt = Date.now()
			await this._runCarrier( bandId, {
				cycles,
				level,
				periodSeconds,
				simulate : opts.simulate,
			} )

			this.safety.record( bandId, periodSeconds * cycles * 0.5, level )

			const result = this._measure( bandId, {
				periodSeconds,
				cycles,
				startedAt,
				simulate : opts.simulate,
			} )

			this.history.push( result )
			if ( this.history.length > 200 ) this.history.shift()

			return result

		}
		finally {

			this._busy = false
			await this.light.off().catch( () => {} )

		}

	}

	/** Drive the on/off carrier. */
	async _runCarrier( bandId, {
		cycles, level, periodSeconds, simulate,
	} ) {

		const halfMs = ( periodSeconds / 2 ) * 1000
		// Tests and demos cannot wait 48 real minutes; the simulate flag runs the
		// same sequence on a compressed clock.
		const wait = simulate ? () => Promise.resolve() : ms => new Promise( r => setTimeout( r, ms ) )

		for ( let c = 0; c < cycles; c++ ) {

			await this.light.emit( { [ bandId ] : level } )
			if ( this.electrode?.advance ) this.electrode.advance( periodSeconds / 2 )
			await wait( halfMs )

			await this.light.emit( {} )
			if ( this.electrode?.advance ) this.electrode.advance( periodSeconds / 2 )
			await wait( halfMs )

		}

	}

	/** Analyze whatever the electrode recorded during the carrier. */
	_measure( bandId, {
		periodSeconds, cycles, startedAt,
	} ) {

		if ( !this.electrode ) {

			return {
				band : bandId,
				at   : new Date( startedAt ).toISOString(),
				measured : false,
				reason : 'No electrode attached — the light ran but nothing was recorded.',
			}

		}

		const windowSeconds = periodSeconds * cycles
		const samples = this.electrode.window( windowSeconds )
		const rate = this.electrode.sampleRate

		if ( samples.length < 8 ) {

			return {
				band : bandId,
				at : new Date( startedAt ).toISOString(),
				measured : false,
				reason : `Only ${samples.length} electrode samples for a ${windowSeconds}s window.`,
			}

		}

		const locking = phaseLocking( samples, rate, periodSeconds )
		const fold    = foldCycles( samples, rate, periodSeconds )

		return {
			band     : bandId,
			label    : BANDS[ bandId ].label,
			emoji    : BANDS[ bandId ].emoji,
			at       : new Date( startedAt ).toISOString(),
			measured : true,
			periodMinutes : periodSeconds / 60,
			cycles,
			samples  : samples.length,
			locking,
			fold,
			harmonicRatio : locking.harmonicRatio,
		}

	}

	/**
	 * Run a full multiplexed sweep: the amber control first, then each pathway.
	 *
	 * The control channel is what makes the rest interpretable — it establishes
	 * what "no stimulus" looks like on this electrode, on this plant, today.
	 *
	 * @param   {object}          [opts]        - Options.
	 * @param   {string[]}        [opts.bands]  - Which bands. Defaults to `PROBE_ORDER`.
	 * @param   {boolean}         [opts.simulate] - Compress time.
	 * @returns {Promise<object>}               `{responses, interpreted, diagnosis, summary}`.
	 */
	async sweep( opts = {} ) {

		const requested = opts.bands || PROBE_ORDER
		const bands = requested.filter( id => this.light.supports( id ) && BANDS[ id ]?.probe?.usable )

		if ( !bands.length ) {

			throw new SmartPlantError(
				`None of the requested bands can be probed with this fixture (it emits: ${this.light.channels.join( ', ' )}).`,
				'SPECTRAL_ERROR',
			)

		}

		const responses = {}
		const failed = {}

		for ( const id of bands ) {

			try {

				responses[ id ] = await this.probe( id, opts )

			}
			catch ( err ) {

				// One band failing must not abandon the sweep — the others still
				// carry diagnostic information.
				failed[ id ] = err.message

			}

		}

		const control = responses.amber
		const interpreted = {}

		for ( const [ id, r ] of Object.entries( responses ) ) {

			if ( id === 'amber' || !r.measured ) continue
			interpreted[ id ] = {
				...interpret( id, r, control ),
				harmonicRatio : r.harmonicRatio,
			}

		}

		const diagnosis = crossBandDiagnosis( interpreted )

		return {
			at          : new Date().toISOString(),
			bands,
			responses,
			failed,
			control     : control ? {
				amplitude : control.fold?.amplitude,
				measured : control.measured,
			} : null,
			interpreted,
			diagnosis,
			summary     : this.summarize( interpreted, diagnosis ),
		}

	}

	/**
	 * Render a sweep as text, for a prompt, a log or a chat reply.
	 *
	 * @param   {object}   interpreted - Per-band interpretation.
	 * @param   {object[]} diagnosis   - Cross-band conclusions.
	 * @returns {string}               Brief.
	 */
	summarize( interpreted, diagnosis ) {

		const lines = []

		for ( const [ id, r ] of Object.entries( interpreted ) ) {

			const b = BANDS[ id ]
			lines.push( `${b.emoji} ${b.label} (${b.nm}nm) → ${r.reads}: ${r.key} (${r.ratio ?? '—'}× control, SNR ${r.snr}). ${r.verdict}` )

		}

		if ( diagnosis.length ) {

			lines.push( '', 'Cross-band diagnosis:' )
			for ( const d of diagnosis ) {

				lines.push( `  ${d.condition.replace( /_/g, ' ' )} (${Math.round( d.confidence * 100 )}%)` )
				for ( const w of d.because ) lines.push( `    · ${w}` )

			}

		}
		else if ( Object.keys( interpreted ).length ) {

			lines.push( '', 'No cross-band pattern: the pathways are responding consistently.' )

		}

		return lines.join( '\n' ) || 'Nothing measured.'

	}

	/**
	 * Apply a wavelength therapeutically. Gated hard.
	 *
	 * @param   {string}          bandId          - Band.
	 * @param   {object}          opts            - Options.
	 * @param   {number}          opts.seconds    - Duration.
	 * @param   {number}          [opts.level]    - Intensity 0-1.
	 * @param   {object}          [opts.context]  - Plant context, for contraindications.
	 * @param   {boolean}         [opts.simulate] - Do not actually wait.
	 * @returns {Promise<object>}                 `{applied, verdict, ...}`.
	 */
	async treat( bandId, opts = {} ) {

		const verdict = this.safety.validate( {
			band    : bandId,
			mode    : 'treat',
			seconds : opts.seconds ?? 0,
			level   : opts.level ?? this.level,
		}, opts.context )

		if ( !verdict.allowed ) {

			return {
				applied : false,
				band    : bandId,
				verdict : verdict.verdict,
				reasons : verdict.reasons,
				explanation : verdict.explanation,
			}

		}

		if ( !this.light.supports( bandId ) ) {

			return {
				applied : false,
				band : bandId,
				explanation : `The fixture has no ${BANDS[ bandId ].label} channel.`,
			}

		}

		const seconds = verdict.request.seconds
		const level   = verdict.request.level ?? this.level

		await this.light.emit( { [ bandId ] : level } )
		if ( !opts.simulate ) await new Promise( r => setTimeout( r, seconds * 1000 ) )
		if ( this.electrode?.advance ) this.electrode.advance( seconds )
		await this.light.off()

		this.safety.record( bandId, seconds, level )

		return {
			applied : true,
			band    : bandId,
			label   : BANDS[ bandId ].label,
			emoji   : BANDS[ bandId ].emoji,
			seconds,
			level,
			modified : verdict.verdict === 'modify',
			explanation : verdict.explanation,
			effect  : BANDS[ bandId ].treat.effect,
			remainingToday : Math.round( this.safety.remaining( bandId ) ),
		}

	}

	/** Everything off, immediately. The state the system fails into. */
	async allOff() {

		return this.light.off()

	}

	async destroy() {

		await this.light.disconnect().catch( () => {} )
		return this

	}

}
