/**
 * @smartplant/history — reads the past to explain the present.
 *
 * Works directly off `PlantMemory`, so it improves as the plant accumulates
 * history rather than re-asking the model to imagine one.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'history',
	description : 'Analyzes stored readings for trends, cycles and slow decline.',
	persona     : 'scientist',
	schema      : {
		advice    : '',
		emoji     : '📈',
		severity  : 'low',
		direction : 'stable',
		findings  : [],
	},

	methods : {
		/**
		 * Analyze trends over a window.
		 *
		 * @param   {object}          [input]         - Options.
		 * @param   {number}          [input.hours]   - Window size. Default 72.
		 * @returns {Promise<object>}                 `{advice, direction, findings}`.
		 */
		async analyzeTrends( input = {} ) {

			const hours = input.hours ?? 72
			const stats = this.plant.memory.stats( hours )
			const n     = this.plant.memory.since( hours ).length

			if ( n < 3 ) {

				return {
					advice    : `Only ${n} reading(s) in the last ${hours}h — not enough to call a trend yet.`,
					emoji     : '⏳',
					severity  : 'low',
					direction : 'unknown',
					findings  : [],
					offline   : true,
				}

			}

			return this.ask(
				`Analyze this plant's ${hours}-hour history. Identify real trends, ignore noise, and say whether `
				+ 'the direction is improving, stable or declining.',
				{
					extra : {
						windowHours : hours,
						readings    : n,
						stats,
					},
				},
			)

		},

		/** Raw numbers, no AI. */
		stats( hours = 72 ) {

			return this.plant.memory.stats( hours )

		},

		/** Full stored series, for charting or export. */
		series( hours = 168 ) {

			return this.plant.memory.since( hours )

		},
	},
} )
