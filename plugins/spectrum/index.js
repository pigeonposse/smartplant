/**
 * @smartplant/spectrum — the plant's spectral instrument.
 *
 * Uses an RGB / multi-channel LED as a *probe* rather than as illumination:
 * each wavelength interrogates a different photoreceptor pathway, and the
 * electrical response to each is diagnostic in a way no passive reading is.
 *
 * 🔵 Blue reads the stomata → hydration and turgor.
 * 🔴 Red reads Photosystem II → photosynthetic capacity and nutrition.
 * 🟢 Green penetrates to the deep mesophyll → the lower canopy nothing else sees.
 *
 * Blue weak while red is strong means thirst. Red weak while blue is strong
 * means malnutrition. One electrode can never tell those apart; two colours can.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'spectrum',
	description : 'Probes the plant with specific wavelengths and reads the electrical response of each photoreceptor pathway.',
	persona     : 'scientist',
	schema      : {
		advice    : '',
		emoji     : '🔬',
		severity  : 'low',
		condition : '',
		confidence: 0,
	},

	async setup( plant, options ) {

		// Attach a light only if the caller has not already done so, so a plant
		// that shares one fixture across plugins is not given a second driver.
		if ( !plant.spectral ) {

			await plant.useSpectral( options.spectral || { light : { driver : 'mock' } } )

		}

		this.lastSweep = null

	},

	async teardown() {

		// Never leave a lamp on because a process ended.
		await this.plant?.spectral?.allOff().catch( () => {} )

	},

	on : {
		// A stressed plant is exactly when a spectral sweep earns its cost: it
		// separates causes that the passive channels leave ambiguous.
		async 'plant:stressed'() {

			if ( !this.options.autoProbe ) return
			await this.diagnose().catch( () => {} )

		},
	},

	methods : {

		/**
		 * Run a full spectral sweep and interpret it.
		 *
		 * @param   {object}          [input]          - Options.
		 * @param   {string[]}        [input.bands]    - Which bands to probe.
		 * @param   {boolean}         [input.simulate] - Compress time, for demos and tests.
		 * @returns {Promise<object>} `{condition, confidence, advice, findings, sweep}`.
		 */
		async diagnose( input = {} ) {

			const sweep = await this.plant.interrogate( input )
			this.lastSweep = sweep

			const top = sweep.diagnosis[ 0 ]

			// With no cross-band pattern there is nothing to ask the model about:
			// answer from the measurement and spend nothing.
			if ( !top ) {

				return {
					advice     : Object.keys( sweep.interpreted ).length
						? 'Every probed pathway responded consistently. No spectral evidence of stress.'
						: 'No pathway produced a measurable response — check electrode contact before reading anything into this.',
					emoji      : '🔬',
					severity   : 'low',
					condition  : 'none',
					confidence : 0,
					findings   : sweep.summary,
					sweep,
					offline    : true,
				}

			}

			const result = await this.ask(
				'Interpret this spectral interrogation for the plant\'s owner. The measurements are already made — '
				+ 'explain what they mean and what to do, without inventing readings that are not listed.',
				{
					extra : {
						summary   : sweep.summary,
						diagnosis : sweep.diagnosis,
					},
				},
			)

			return {
				...result,
				condition  : top.condition,
				confidence : top.confidence,
				findings   : sweep.summary,
				sweep,
			}

		},

		/**
		 * Probe a single band.
		 *
		 * @param   {string}          band    - Band id: `blue`, `red`, `green`, `amber`, `farRed`.
		 * @param   {object}          [opts]  - Probe options.
		 * @returns {Promise<object>}         The measurement.
		 */
		async probe( band, opts = {} ) {

			return this.plant.spectral.probe( band, opts )

		},

		/**
		 * Apply a wavelength therapeutically. Gated by the spectral safety layer.
		 *
		 * @param   {string}          band          - Band id.
		 * @param   {object}          opts          - `{ seconds, level }`.
		 * @returns {Promise<object>}               `{applied, explanation, ...}`.
		 */
		async treat( band, opts = {} ) {

			return this.plant.spectral.treat( band, {
				...opts,
				context : this.context(),
			} )

		},

		/**
		 * Authorize a wavelength that requires a human — UV-B and far-red.
		 * Valid until midnight.
		 *
		 * @param   {string} band - Band id.
		 * @returns {object}      The plugin, for chaining.
		 */
		authorize( band ) {

			this.plant.spectral.safety.authorize( band )
			return this

		},

		/** Today's exposure per band, against its budget. */
		doses() {

			return this.plant.spectral.safety.report()

		},

		/** Which bands this fixture can actually emit. */
		channels() {

			return this.plant.spectral.light.channels

		},

		/** Everything off, now. */
		async allOff() {

			return this.plant.spectral.allOff()

		},

	},
} )
