/**
 * @smartplant/fertilizer — feeding schedule and nutrient guidance.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'fertilizer',
	description : 'Recommends what to feed, how much and when, from conductivity and care history.',
	persona     : 'botanist',
	schema      : {
		advice        : '',
		emoji         : '🧪',
		severity      : 'low',
		npk           : '',
		dilution      : '',
		daysUntilFeed : 0,
	},

	methods : {
		/**
		 * Recommend a feeding.
		 *
		 * @param   {object}          [input] - Extra facts (current product, season…).
		 * @returns {Promise<object>}         `{advice, npk, dilution, daysUntilFeed}`.
		 */
		async guideFertilization( input = {} ) {

			const ctx = this.context()
			return this.ask(
				'Recommend a fertilization plan for this plant. Give an NPK ratio, a dilution, and how many days '
				+ 'until the next feed. Consider the season, growth stage and how long since the last feeding. '
				+ 'Err on the side of underfeeding — burn is harder to undo than deficiency.',
				{
					extra : {
						...input,
						daysSinceFertilizer : ctx.care?.daysSinceFertilizer,
						conductivity        : ctx.current?.conductivity ?? null,
					},
				},
			)

		},

		/** Record a feeding. */
		async recordFeeding( detail = {} ) {

			return this.plant.fertilize( detail )

		},
	},
} )
