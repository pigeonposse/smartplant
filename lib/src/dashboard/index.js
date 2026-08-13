/**
 * The plant, in a browser.
 *
 * `await plant.serve()` and open the address it prints. No build step, no
 * framework, no network fetch: one file of HTML with the styles and the script
 * inline, served from `node:http`, which the runtime already has.
 *
 * ## Why it listens on loopback and nothing else
 *
 * The colony server in this library binds to `127.0.0.1` unless told otherwise,
 * and this does the same for a stronger reason. A colony port carries plant
 * chatter; this port carries a live feed of somebody's home — when the lights
 * are on, when the temperature drops because a window opened, and in the
 * clearest possible terms whether anyone is in.
 *
 * Binding to `0.0.0.0` puts that on every device on the network, and one
 * forwarded port puts it on the internet. That may be exactly what somebody
 * wants, and it is theirs to choose deliberately rather than to discover. So the
 * host has to be passed, the choice is logged in plain words when it is made,
 * and there is no configuration that makes it the default.
 *
 * ## Why it is read-only
 *
 * The colony channel is closed to people by design: a person can read every
 * exchange and cannot author one. The same instinct applies here, but the
 * argument is more ordinary — a page that can water a plant is a page where a
 * stray request waters a plant. Watering, probing and moving stay in code, where
 * they are already gated by the safety layers, and no HTTP verb reaches them.
 *
 * There is no `allowActions` option. Adding one later would be a deliberate act
 * with its own authentication story, not a flag.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { page } from './page.js'
import { snapshot } from './vitals.js'

/**
 * Serve this plant's vitals over HTTP.
 *
 * @param   {object} plant           - A `SmartPlant`.
 * @param   {object} [opts]          - Options.
 * @param   {number} [opts.port]     - Port. Default 7777.
 * @param   {string} [opts.host]     - Interface. Defaults to loopback, deliberately.
 * @param   {number} [opts.everyMs]  - Live update interval. Default 5000.
 * @returns {Promise<object>}        `{url, close, warnings}`.
 */
export async function serveVitals( plant, opts = {} ) {

	const port = opts.port ?? 7777
	const host = opts.host ?? '127.0.0.1'
	const everyMs = Math.max( 1000, opts.everyMs ?? 5000 )

	const warnings = []
	const here = dirname( fileURLToPath( import.meta.url ) )

	// What to print in the banner. The bound host is the truth about where this
	// is reachable; the LAN address is what somebody would actually type from
	// another device, and it is shown only when the server is listening widely
	// enough for it to be true.
	const net = {
		host,
		port,
		address : `${host}:${port}`,
		lan : host === '127.0.0.1' || host === 'localhost' ? null : lanAddress(),
	}

	if ( net.lan ) net.address = `${net.lan}:${port}`

	if ( host !== '127.0.0.1' && host !== 'localhost' ) {

		warnings.push( `Listening on ${host} rather than loopback. This page is a live feed of a room — when the lights go on, when a window opens, and whether anybody is home. On ${host} every device on this network can read it, and a forwarded port puts it on the internet. There is no authentication here, because adding a password field would suggest this was built to be exposed. If this is deliberate, it is fine; if it was copied from an example, change it back.` )

	}

	const clients = new Set()

	const server = createServer( async ( req, res ) => {

		// Read-only, and stated in the protocol rather than only in the docs.
		if ( req.method !== 'GET' && req.method !== 'HEAD' ) {

			return json( res, 405, {
				error : 'read-only',
				why : 'This server only answers GET. Watering, probing and moving stay in code where the safety layers already gate them, and no HTTP verb reaches them. A page that can water a plant is a page where a stray request waters a plant.',
			} )

		}

		const url = new URL( req.url, `http://${req.headers.host ?? 'localhost'}` )

		if ( url.pathname === '/health' ) {

			return json( res, 200, {
				ok : true,
				name : plant.memory?.plant?.name ?? 'plant',
			} )

		}

		if ( url.pathname === '/vitals.json' ) {

			return json( res, 200, {
				...await snapshot( plant, { deep : url.searchParams.has( 'deep' ) } ),
				net,
			} )

		}

		// Server-sent events: one direction, no dependency, and it reconnects on
		// its own. A socket library would be a dependency for a page that only
		// ever pushes.
		if ( url.pathname === '/live' ) {

			res.writeHead( 200, {
				'content-type' : 'text/event-stream',
				'cache-control' : 'no-cache',
				connection : 'keep-alive',
			} )

			clients.add( res )
			req.on( 'close', () => clients.delete( res ) )

			res.write( `data: ${JSON.stringify( {
				...await snapshot( plant ),
				net,
			} )}\n\n` )
			return

		}

		// Served from disk rather than inlined as a data URI: a hundred kilobytes
		// of base64 in a source file is a hundred kilobytes on every page load and
		// in every diff.
		if ( url.pathname === '/logo.png' ) {

			try {

				const buf = await readFile( join( here, 'logo.png' ) )
				res.writeHead( 200, {
					'content-type' : 'image/png',
					'cache-control' : 'max-age=86400',
				} )
				return res.end( buf )

			}
			catch {

				return json( res, 404, { error : 'no logo' } )

			}

		}

		if ( url.pathname === '/' ) {

			res.writeHead( 200, {
				'content-type' : 'text/html; charset=utf-8',
				// Nothing is loaded from anywhere, and the header says so, so a
				// future edit that reaches for a CDN fails loudly in the browser
				// rather than quietly working until the CDN is down.
				'content-security-policy' : "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'",
				'referrer-policy' : 'no-referrer',
			} )
			return res.end( page( {
				name : plant.memory?.plant?.name ?? 'plant',
				everyMs,
			} ) )

		}

		return json( res, 404, { error : 'not found' } )

	} )

	const timer = setInterval( async () => {

		if ( !clients.size ) return

		const data = `data: ${JSON.stringify( {
			...await snapshot( plant ),
			net,
		} )}\n\n`
		for ( const c of clients ) c.write( data )

	}, everyMs )

	// Never hold the process open for the sake of a dashboard nobody is reading.
	timer.unref?.()

	await new Promise( ( resolve, reject ) => {

		server.once( 'error', err => reject( err.code === 'EADDRINUSE'
			? new Error( `Port ${port} is already in use. Another plant may be serving on it — pass { port } to move this one.` )
			: err ) )
		server.listen( port, host, resolve )

	} )

	return {
		url : `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`,
		host,
		port,
		net,
		warnings,
		readOnly : true,

		async close() {

			clearInterval( timer )
			for ( const c of clients ) c.end()
			clients.clear()
			await new Promise( r => server.close( r ) )

		},
	}

}

/**
 * The first non-internal IPv4 address on this machine.
 *
 * Only used when the server was told to listen beyond loopback, because
 * otherwise it would print an address that looks reachable and is not.
 *
 * @returns {string|null} The address.
 */
function lanAddress() {

	for ( const addrs of Object.values( networkInterfaces() ) ) {

		for ( const a of addrs ?? [] ) {

			if ( a.family === 'IPv4' && !a.internal ) return a.address

		}

	}

	return null

}

function json( res, code, body ) {

	res.writeHead( code, { 'content-type' : 'application/json; charset=utf-8' } )
	res.end( JSON.stringify( body, null, 2 ) )

}

export { BAND, band, snapshot, vitals } from './vitals.js'
