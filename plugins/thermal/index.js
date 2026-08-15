/**
 * @smartplant/thermal — where the canopy is transpiring, and where it stopped.
 *
 * A leaf cools itself by evaporating, so a working leaf sits below air
 * temperature and one that has shut its stomata drifts up toward it. A thermal
 * camera reads that for the whole canopy at once, which is the one thing a
 * contact probe fundamentally cannot do: a clip reports whichever leaf it was
 * clipped to, and half a plant in trouble looks identical to all of it.
 *
 * The camera does not know the temperature. An uncalibrated sensor is accurate
 * to a few degrees absolutely and to hundredths within one frame, so everything
 * here is a difference and nothing is published as an absolute.
 */

import { definePlugin } from 'smartplant'

export default definePlugin( {
	name        : 'thermal',
	description : 'Reads the canopy with a thermal camera: where it is transpiring and where it has stopped.',
	persona     : 'botanist',
	schema      : {
		advice   : '',
		emoji    : '🌡',
		severity : 'low',
		index    : 0,
		even     : true,
	},

	methods : {
		/**
		 * How hard this plant is working to cool itself.
		 *
		 * Needs an air temperature from an ordinary thermometer. Taking it from
		 * the background of the same frame would cancel the camera's error out of
		 * both numbers and make their difference look perfect while meaning
		 * nothing.
		 *
		 * @returns {Promise<object>} `{known, index, why}`.
		 */
		async stress() {

			const cam = this.plant.sensors?.peek?.( 'thermal' )

			if ( !cam?.latest ) return {
				known : false,
				why : cam
					? 'No current thermal frame. The last one is too old to describe where this plant is now.'
					: 'No thermal camera attached.',
			}

			const { stressIndex } = await import( 'smartplant/vision/thermal' )

			return stressIndex( cam.latest, this.plant.memory.lastReading?.temperature )

		},

		/**
		 * Is the whole canopy doing the same thing?
		 *
		 * The finding worth having a camera for. A branch in a draught, a blocked
		 * vessel or a root problem on one side all show here long before they are
		 * visible, and a contact probe would report whichever half it was on.
		 *
		 * @returns {Promise<object>} `{even, why}`.
		 */
		async evenness() {

			const cam = this.plant.sensors?.peek?.( 'thermal' )

			if ( !cam?.latest ) return {
				even : null,
				why : 'No current thermal frame.',
			}

			const { evenness } = await import( 'smartplant/vision/thermal' )

			return evenness( cam.latest )

		},

		/**
		 * A false-colour map for a screen.
		 *
		 * Scaled between the coolest and warmest pixel in the frame, which is
		 * what an uncalibrated sensor can honestly support.
		 *
		 * @returns {Promise<object>} `{rows, relative, why}`.
		 */
		async map() {

			const cam = this.plant.sensors?.peek?.( 'thermal' )

			if ( !cam?.latest ) return {
				rows : [],
				why : 'No current thermal frame.',
			}

			const { heatmap } = await import( 'smartplant/vision/thermal' )

			return heatmap( cam.latest )

		},
	},
} )
