/**
 * Firmware generation for the sensing hardware.
 *
 * @example
 * import { generateProject } from 'smartplant/firmware'
 * import { writeFile, mkdir } from 'node:fs/promises'
 * import { dirname, join } from 'node:path'
 *
 * const files = generateProject( {
 *   target    : 'platformio',
 *   sensors   : [ 'dht22', { type: 'capacitive_soil', pin: 34 } ],
 *   transport : 'mqtt',
 *   mqttHost  : '192.168.1.10',
 * } )
 *
 * for ( const [ path, content ] of Object.entries( files ) ) {
 *   await mkdir( dirname( join( 'firmware', path ) ), { recursive: true } )
 *   await writeFile( join( 'firmware', path ), content )
 * }
 */

export {
	generateArduinoSketch, generateEspIdf, generatePlatformIO, generateProject,
	SUPPORTED_SENSORS,
} from './generate.js'
