/**
 * @smartplant/watering — predicts when the plant next needs water.
 *
 * Reacts to `plant:thirsty` so it can warn before the owner asks.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'watering',
	description : 'Predicts watering needs from soil moisture, trends and care history.',
	persona     : 'botanist',
	schema      : {
		advice         : '',
		emoji          : '💧',
		severity       : 'low',
		daysUntilWater : 0,
		amountMl       : 0,
	},

	on : {
		async 'plant:thirsty'( event ) {

			const result = await this.predictWatering()
			await this.plant.events.emit( 'watering:needed', {
				...result,
				trigger : event,
			} )

		},
	},

	methods : {
		/**
		 * Predict the next watering.
		 *
		 * @param   {object}          [input] - Extra facts (pot size, substrate…).
		 * @returns {Promise<object>}         `{advice, emoji, daysUntilWater, amountMl}`.
		 */
		async predictWatering( input = {} ) {

			const result = await this.ask(
				'When should this plant next be watered, and how much? '
				+ 'Account for the soil trend and how long it has been since the last watering.',
				{ extra : input },
			)
			return {
				...result,
				emoji : result.emoji || emojiFor( this.context() ),
			}

		},

		/** Record a watering and clear the prediction. */
		async recordWatering( detail = {} ) {

			return this.plant.water( detail )

		},
	},
} )

function emojiFor( ctx ) {

	const soil = ctx.current?.soil ?? ctx.current?.humidity
	if ( !Number.isFinite( soil ) ) return '💧'
	if ( soil < 25 ) return '🏜️'
	if ( soil < 40 ) return '🥀'
	if ( soil > 85 ) return '🌊'
	return '🌿'

}
