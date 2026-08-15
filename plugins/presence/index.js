/**
 * @smartplant/presence — the room, as far as a WiFi radio can tell.
 *
 * This is not here to watch people, and it cannot: the radio reports one number
 * about how disturbed the channel is, with no identity, no count and no position
 * in it. Two things about a plant depend on it.
 *
 * The **UV-B interlock**. UV-B burns skin and eyes, a plant on a shelf sits at
 * eye height, and until now the library could only know the room was empty if
 * somebody told it. Here it can refuse on its own.
 *
 * And **motion as a negative control**. Brushing past a plant produces an action
 * potential; so does the draught from a door. Both look like the opening of a
 * wound response for the first few minutes. The defence estimate already
 * discounts an event the weather explains, and "somebody walked past at that
 * exact moment" belongs in the same column.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'presence',
	description : 'Occupancy from a WiFi radio: the UV-B interlock, and motion as a control on electrical events.',
	persona     : 'engineer',
	schema      : {
		advice   : '',
		emoji    : '📡',
		severity : 'low',
		occupied : false,
	},

	methods : {
		/**
		 * What the radio says about the room right now.
		 *
		 * @returns {object} `{occupancy, motion, settled, why}`.
		 */
		room() {

			const s = this.plant.sensors?.peek?.( 'presence' )

			if ( !s ) return {
				occupancy : null,
				motion : null,
				settled : false,
				why : 'No presence radio attached.',
			}

			return s.state()

		},

		/**
		 * May UV-B run?
		 *
		 * Unknown is a refusal. An interlock that opens when it cannot see is not
		 * an interlock, and the failure here is somebody getting a face full of
		 * UV-B rather than a plant missing an optional dose.
		 *
		 * @returns {object} `{allowed, why}`.
		 */
		uvbAllowed() {

			const r = this.room()

			if ( !r.settled || r.occupancy === null ) return {
				allowed : false,
				why : `${r.why} An interlock that opens when it cannot see is not an interlock, so UV-B stays off. The plant misses an optional dose; the alternative is somebody at eye height getting one.`,
			}

			return {
				allowed : r.occupancy === false,
				why : r.occupancy
					? 'Somebody is in the room. UV-B burns skin and eyes and this plant is at eye height.'
					: 'The room reads empty. Note what that means on this hardware: nobody *moving*. A person sitting perfectly still is the case a WiFi radio cannot see, so this belongs with a physical guard rather than instead of one.',
			}

		},

		/**
		 * Did somebody move when that electrical event happened?
		 *
		 * @param   {number} at - Milliseconds.
		 * @returns {Promise<object>} `{explains, why}`.
		 */
		async explains( at ) {

			const s = this.plant.sensors?.peek?.( 'presence' )
			const { motionExplains } = await import( 'smartplant/sensors/presence' )

			return motionExplains( s?._history?.map( h => ( {
				at : h.at,
				motion : h.motion,
			} ) ) ?? [], at )

		},

		/**
		 * What this radio can and cannot support.
		 *
		 * Worth having as a method because the honest answer differs between CSI
		 * and RSSI, and neither does direction or pose whatever a datasheet says.
		 *
		 * @returns {object} From `CAPABILITY`.
		 */
		capability() {

			const s = this.plant.sensors?.peek?.( 'presence' )

			return s?.capability ?? {
				why : 'No presence radio attached.',
			}

		},
	},
} )
