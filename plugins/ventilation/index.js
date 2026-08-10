/**
 * @smartplant/ventilation — airflow, humidity and heat management.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'ventilation',
	description : 'Recommends airflow and humidity adjustments from temperature and humidity.',
	persona     : 'botanist',
	schema      : {
		advice     : '',
		emoji      : '🌬️',
		severity   : 'low',
		action     : 'none',
		targetHumidity : 0,
	},

	on : {
		async 'plant:too-hot'( event ) {

			await this.plant.events.emit( 'ventilation:needed', {
				...event,
				...( await this.adjustVentilation() ),
			} )

		},
	},

	methods : {
		/**
		 * Recommend a ventilation change.
		 *
		 * @param   {object}          [input] - Extra facts (room, season, HVAC…).
		 * @returns {Promise<object>}         `{advice, action, targetHumidity}`.
		 */
		async adjustVentilation( input = {} ) {

			return this.ask(
				'Assess airflow, humidity and heat for this plant. Recommend one action: '
				+ 'increase-airflow, reduce-airflow, humidify, dehumidify, or none. Explain briefly why.',
				{ extra : input },
			)

		},

		/**
		 * Vapour-pressure-deficit estimate (kPa) — the number that actually drives
		 * transpiration. Computed locally, no AI needed.
		 *
		 * @returns {number|null} VPD in kPa, or null without both inputs.
		 */
		vpd() {

			const { temperature, humidity } = this.context().current || {}
			if ( !Number.isFinite( temperature ) || !Number.isFinite( humidity ) ) return null
			// Tetens equation for saturation vapour pressure.
			const svp = 0.61078 * Math.exp( ( 17.27 * temperature ) / ( temperature + 237.3 ) )
			return Number( ( svp * ( 1 - humidity / 100 ) ).toFixed( 3 ) )

		},
	},
} )
