/**
 * @smartplant/lighting — light placement and supplementation advice.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'lighting',
	description : 'Advises on placement, exposure hours and grow-light use.',
	persona     : 'botanist',
	schema      : {
		advice        : '',
		emoji         : '🌞',
		severity      : 'low',
		hoursNeeded   : 0,
		needsGrowLight: false,
	},

	on : {
		async 'plant:too-dark'( event ) {

			await this.plant.events.emit( 'lighting:insufficient', {
				...event,
				...( await this.optimizeLight() ),
			} )

		},
	},

	methods : {
		/**
		 * Recommend a lighting change.
		 *
		 * @param   {object}          [input] - Extra facts (window direction, floor…).
		 * @returns {Promise<object>}         `{advice, hoursNeeded, needsGrowLight}`.
		 */
		async optimizeLight( input = {} ) {

			const result = await this.ask(
				'Assess this plant\'s light exposure. Recommend a concrete placement change or grow-light schedule. '
				+ 'hoursNeeded is the daily hours of suitable light it should receive.',
				{ extra : input },
			)
			return {
				...result,
				emoji : result.emoji || lightEmoji( this.context().current?.light ),
			}

		},

		/** Daily light integral estimate from stored readings, no AI. */
		dailyLightHours( threshold = 200 ) {

			const rows = this.plant.memory.since( 24 ).filter( r => Number.isFinite( r.light ) )
			if ( !rows.length ) return null
			const lit = rows.filter( r => r.light >= threshold ).length
			return Number( ( ( lit / rows.length ) * 24 ).toFixed( 1 ) )

		},
	},
} )

function lightEmoji( lux ) {

	if ( !Number.isFinite( lux ) ) return '🌞'
	if ( lux < 100 ) return '🌑'
	if ( lux < 300 ) return '🌥️'
	if ( lux > 900 ) return '🔆'
	return '🌞'

}
