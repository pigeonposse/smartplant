/**
 * @smartplant/simulator — "what if?" without risking the plant.
 *
 * Runs hypothetical conditions through the same comfort model the kernel uses,
 * so a projection is arithmetic first and AI second.
 */

import { definePlugin, happiness } from 'smartplant'

export default definePlugin( {
	name        : 'simulator',
	description : 'Projects how the plant would fare under hypothetical conditions.',
	persona     : 'scientist',
	schema      : {
		advice    : '',
		emoji     : '🔮',
		severity  : 'low',
		outcome   : '',
		survivalDays : 0,
	},

	methods : {
		/**
		 * Ask what happens under different conditions.
		 *
		 * @param   {object}          [input]            - Options.
		 * @param   {object}          [input.conditions] - Hypothetical metric values.
		 * @param   {number}          [input.days]       - Horizon in days.
		 * @returns {Promise<object>}                    `{advice, outcome, survivalDays}`.
		 */
		async simulateConditions( input = {} ) {

			const { conditions = {}, days = 7 } = input
			const hypothetical = {
				...this.context().current,
				...conditions,
			}
			const projected    = happiness( hypothetical, this.plant.ranges )

			return this.ask(
				`Project how this plant would fare over ${days} day(s) under the hypothetical conditions given. `
				+ 'Say what would visibly change and roughly how long it could tolerate them.',
				{
					extra : {
						hypothetical,
						projectedWellbeing : projected,
						currentWellbeing   : this.context().happiness,
						horizonDays        : days,
					},
				},
			)

		},

		/**
		 * Score a hypothetical locally — instant, free, no network.
		 *
		 * @param   {object} conditions - Metric values to test.
		 * @returns {object}            `{wellbeing, delta}`.
		 */
		score( conditions = {} ) {

			const current = this.context()
			const hypothetical = {
				...current.current,
				...conditions,
			}
			const wellbeing = happiness( hypothetical, this.plant.ranges )
			return {
				wellbeing,
				delta : wellbeing - current.happiness,
			}

		},

		/**
		 * Sweep one metric across a range to find where it breaks down.
		 *
		 * @param   {string}   metric - Metric to sweep.
		 * @param   {number[]} values - Values to test.
		 * @returns {object[]}        `{value, wellbeing}` per step.
		 */
		sweep( metric, values ) {

			return values.map( value => ( {
				value,
				wellbeing : this.score( { [ metric ] : value } ).wellbeing,
			} ) )

		},
	},
} )
