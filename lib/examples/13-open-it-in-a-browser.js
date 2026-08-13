/**
 * 13 · Open it in a browser
 *
 * Everything this library works out about a plant has, until now, only been
 * reachable from code. This puts it on a screen.
 *
 * Two things about the page are worth more attention than the numbers:
 *
 *   · It lists the metrics that have **no sensor**, greyed out with the reason,
 *     rather than showing only what it can measure. A tidy dashboard with four
 *     healthy gauges and a plant nobody can see look identical, and one of them
 *     is a plant nobody can see.
 *   · It binds to loopback and answers nothing but GET. A page that can water a
 *     plant is a page where a stray request waters a plant.
 *
 * Run with:  node examples/13-open-it-in-a-browser.js
 */

import { createPlant } from '../src/index.js'

const line = t => console.log( `\n[1m${t}[0m\n${'─'.repeat( t.length )}` )

const plant = await createPlant( {
	name : 'Ivy',
	species : 'Ficus lyrata',
	sensor : { driver : 'mock' },
	ai : { provider : 'mock' },
} )

// A little history, so the ranges are learned rather than empty.
for ( let i = 0; i < 40; i++ ) await plant.read()

line( '1 · What the page is built from' )

const { snapshot } = await import( '../src/dashboard/index.js' )
const data = await snapshot( plant )

console.log( data.says )
console.log()

for ( const v of data.vitals ) {

	console.log( v.measured
		? `  ${v.metric.padEnd( 14 )} ${String( v.value ).padStart( 8 )}   ${v.band}`
		: `  ${v.metric.padEnd( 14 )} ${'—'.padStart( 8 )}   no sensor` )

}

console.log( `\n${data.missing.why}` )

line( '2 · What it is doing' )

for ( const [ name, s ] of Object.entries( data.states ) ) {

	console.log( `  ${name.padEnd( 22 )} ${s.level.padEnd( 8 )} ${s.acts ? 'acting' : 'not changing anything'}` )

}

line( '3 · Serving it' )

const server = await plant.serve( { port : 7777 } )

console.log( `open ${server.url}` )
console.log( `read-only: ${server.readOnly}` )
console.log( `bound to : ${server.host}  (loopback, deliberately — pass { host } to change it and read the warning)` )
console.log( `
  /            the page
  /vitals.json the same thing as JSON
  /live        server-sent events, pushed every few seconds
  /health      is it up
` )

// Demonstrate the two endpoints rather than leaving a server running in an
// example that is meant to finish.
const json = await ( await fetch( `${server.url}/vitals.json` ) ).json()
console.log( `GET /vitals.json → ${json.vitals.length} metrics, ${Object.keys( json.states ).length} internal states` )

const refused = await fetch( `${server.url}/vitals.json`, { method : 'POST' } )
console.log( `POST /vitals.json → ${refused.status} ${( await refused.json() ).error}` )

await plant.destroy()
console.log( '\nThe plant was destroyed, which closed the server with it.' )
