/**
 * @smartplant/season — the same plant wants different things in February.
 *
 * A plant is not a machine with one correct setpoint. In winter it grows less,
 * drinks less and can rot in soil that would have been merely damp in July, and
 * a system that holds one comfortable band all year is wrong for half of it.
 *
 * Two rules make this safe rather than superstitious.
 *
 * **The hemisphere is not guessed.** Half the guesses would be exactly six
 * months wrong, and that produces advice to cut watering back in somebody's
 * spring — which looks like a plant doing badly rather than like a mistake. No
 * hemisphere, no seasonal adjustment.
 *
 * **The table fades.** It exists so a plant with two months of history is not
 * silent. Once the plant has lived through its own years, its own record
 * describes its own flat, its own window and its own radiator better than any
 * archetype average, and the table gets out of the way.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'season',
	description : 'Bends the comfortable bands toward the time of year, and fades out as the plant learns its own.',
	persona     : 'botanist',
	schema      : {
		advice   : '',
		emoji    : '🍂',
		severity : 'low',
		season   : '',
	},

	methods : {
		/**
		 * Which season it is for this plant.
		 *
		 * @returns {Promise<object>} `{season, known, why}`.
		 */
		async now() {

			const { seasonNow } = await import( 'smartplant/archetypes' )

			return seasonNow( {
				hemisphere : this.plant.config?.hemisphere,
			} )

		},

		/**
		 * The comfortable bands, bent toward the season.
		 *
		 * @returns {Promise<object>} `{ranges, applied, weight, why}`.
		 */
		async ranges() {

			const { seasonalRanges } = await import( 'smartplant/archetypes' )

			const first = this.plant.memory?.data?.readings?.[ 0 ]
			const days = first
				? ( Date.now() - new Date( first.t ).getTime() ) / 86_400_000
				: 0

			return seasonalRanges( this.plant.archetype?.ranges ?? {}, {
				hemisphere : this.plant.config?.hemisphere,
				days,
			} )

		},

		/**
		 * What this plant itself did at this point last year.
		 *
		 * The thing that eventually replaces the table, and it is not an average
		 * of the whole history — it is an average of *this month last year*, the
		 * only part of the record that describes this part of the year.
		 *
		 * @param   {string} [metric] - Default soil.
		 * @returns {Promise<object>} `{known, band, why}`.
		 */
		async lastYear( metric = 'soil' ) {

			const { seasonFromHistory } = await import( 'smartplant/archetypes' )

			return seasonFromHistory( this.plant.memory?.data?.readings ?? [], { metric } )

		},

		/**
		 * How much the table still counts.
		 *
		 * @returns {Promise<object>} `{weight, why}`.
		 */
		async weight() {

			const { seasonalWeight } = await import( 'smartplant/archetypes' )

			const first = this.plant.memory?.data?.readings?.[ 0 ]

			return seasonalWeight( first
				? ( Date.now() - new Date( first.t ).getTime() ) / 86_400_000
				: 0 )

		},
	},
} )
