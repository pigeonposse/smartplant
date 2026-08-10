/**
 * @smartplant/stress — detects compound stress across metrics.
 *
 * Distinct from `alerts`: alerts fire per-metric breach, stress looks for the
 * combinations that damage a plant even when no single reading looks alarming.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'stress',
	description : 'Detects compound and chronic stress patterns across metrics and time.',
	persona     : 'scientist',
	schema      : {
		advice     : '',
		emoji      : '🥀',
		severity   : 'low',
		stressed   : false,
		stressType : 'none',
		causes     : [],
	},

	on : {
		async 'plant:stressed'( event ) {

			await this.plant.events.emit( 'stress:detected', {
				...event,
				...( await this.detectStress() ),
			} )

		},
	},

	methods : {
		/**
		 * Assess stress.
		 *
		 * @param   {object}          [input] - Extra facts (visible symptoms…).
		 * @returns {Promise<object>}         `{advice, stressed, stressType, causes}`.
		 */
		async detectStress( input = {} ) {

			const ctx = this.context()
			const result = await this.ask(
				'Assess whether this plant is under stress. Consider combinations (e.g. high heat with low soil moisture) '
				+ 'and chronic patterns, not just single readings. stressType should be one of: '
				+ 'drought, overwatering, heat, cold, light-deficit, light-excess, nutrient, none.',
				{
					extra : {
						...input,
						sustainedLowScore : this.chronicScore(),
					},
				},
			)
			return {
				...result,
				stressed : result.stressed ?? ctx.happiness < 50,
			}

		},

		/**
		 * Fraction of the last 48h spent below a comfort threshold — chronic strain
		 * that a single reading cannot show.
		 *
		 * @param   {number}      [threshold] - Wellbeing threshold.
		 * @returns {number|null}             0-1, or null without history.
		 */
		chronicScore( threshold = 60 ) {

			const rows = this.plant.memory.since( 48 )
			if ( rows.length < 3 ) return null
			const bad = rows.filter( r => this.plant.happiness( r ) < threshold ).length
			return Number( ( bad / rows.length ).toFixed( 2 ) )

		},
	},
} )
