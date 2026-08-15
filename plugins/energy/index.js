/**
 * @smartplant/energy — a plant that runs off a panel and a battery.
 *
 * On mains, none of this exists: everything measures as often as it likes. Off
 * grid the question is different and permanent — this charge has to last until
 * the sun comes back, and something has to decide what stops.
 *
 * The decisions worth knowing about are the ones that are *not* about power.
 *
 * The lamp goes off at night whatever the charge, because irradiating through
 * the dark period destroys the circadian signal the rest of the library reads,
 * and spare charge does not make that a good trade. On a CAM plant the same
 * night is when its stomata open and everything worth measuring happens, so the
 * electrode stays on at low charge while the lamp stays off — the one plant it
 * would be most tempting to light up is the one where lighting it does the most
 * harm.
 *
 * And travel is costed there *and back*. A plant that spends its last charge
 * arriving somewhere is stranded there.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'energy',
	description : 'Solar and battery budgeting: what runs, what sleeps, and how long the charge lasts.',
	persona     : 'engineer',
	schema      : {
		advice   : '',
		emoji    : '🔋',
		severity : 'low',
		mode     : 'full',
		charge   : 1,
	},

	async setup( plant ) {

		const { PowerBudget } = await import( 'smartplant/power' )

		this.budget = new PowerBudget( {
			...plant.config?.power,
			archetype : plant.archetype,
		} )

	},

	methods : {
		/**
		 * Tell it what the battery gauge says.
		 *
		 * @param   {number} charge - 0 to 1.
		 * @returns {object}        `{charge, mode}`.
		 */
		charge( charge ) {

			if ( !Number.isFinite( charge ) || charge < 0 || charge > 1 ) return {
				accepted : false,
				why : 'State of charge is a fraction between 0 and 1. A percentage passed as 85 would read as a battery eighty-five times full and unlock everything forever.',
			}

			this.budget.charge = charge

			return {
				accepted : true,
				charge,
				mode : this.budget.mode().id,
			}

		},

		/**
		 * Record what the panel actually made.
		 *
		 * The only thing that turns the estimate into a fact, so it is worth
		 * wiring a current sensor to.
		 *
		 * @param   {number} watts - Measured output.
		 * @returns {object}       The record.
		 */
		produced( watts ) {

			return this.budget.solar.record( watts )

		},

		/**
		 * What should be running right now.
		 *
		 * @param   {object} [opts] - `{ night, moving }`.
		 * @returns {object}        `{mode, running, asleep, why}`.
		 */
		plan( opts = {} ) {

			return this.budget.plan( opts )

		},

		/**
		 * How long this lasts, and whether the panel covers it.
		 *
		 * @param   {object} [opts] - `{ night, moving }`.
		 * @returns {object}        `{hours, sustainable, harvest, why}`.
		 */
		forecast( opts = {} ) {

			return this.budget.forecast( opts )

		},

		/**
		 * Can it afford to go somewhere?
		 *
		 * @param   {number} metres - One way. The return leg is added here.
		 * @returns {object}        `{afford, costWh, why}`.
		 */
		canTravel( metres ) {

			return this.budget.canTravel( metres )

		},

		/** A line for a panel. */
		report( opts = {} ) {

			return this.budget.report( opts )

		},
	},
} )
