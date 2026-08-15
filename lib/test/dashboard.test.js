/**
 * The plant in a browser.
 *
 * Three things are worth testing more than the rendering: that it binds to
 * loopback unless told otherwise, that no verb other than GET reaches anything,
 * and that unmeasured metrics appear as unmeasured rather than quietly
 * disappearing.
 */

import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { createPlant } from '../src/index.js'
import { band, BAND, snapshot, vitals } from '../src/dashboard/index.js'

const plants = []

const plant = async ( opts = {} ) => {

	const p = await createPlant( {
		name : 'Ivy',
		species : 'Ficus lyrata',
		sensor : { driver : 'mock' },
		ai : { provider : 'mock' },
		...opts,
	} )
	await p.read()
	plants.push( p )
	return p

}

after( async () => {

	await Promise.all( plants.map( p => p.destroy().catch( () => {} ) ) )

} )

describe( 'banding a reading against this plant\'s own range', () => {

	const range = {
		min : 18,
		max : 26,
	}

	it( 'places a value', () => {

		assert.equal( band( 22, range ).band, BAND.OK )
		assert.equal( band( 12, range ).band, BAND.LOW )
		assert.equal( band( 30, range ).band, BAND.HIGH )

	} )

	it( 'is unknown without a range, rather than assumed fine', () => {

		assert.equal( band( 22, null ).band, BAND.UNKNOWN )
		assert.equal( band( undefined, range ).band, BAND.UNKNOWN )

	} )

	it( 'clamps the bar without clamping the number', () => {

		const wild = band( 500, range )

		assert.ok( wild.fraction <= 1.2 )
		// The value itself is never touched — only how far the bar is drawn.
		assert.equal( band( 500, range ).band, BAND.HIGH )

	} )

} )

describe( 'the gaps are the content', () => {

	it( 'lists metrics with no sensor instead of omitting them', async () => {

		const rows = vitals( await plant() )
		const unmeasured = rows.filter( r => !r.measured )

		assert.ok( unmeasured.length > 0 )
		assert.match( unmeasured[ 0 ].why, /Not a reading of zero and not a plant that is fine/ )

	} )

	it( 'keeps provenance out of the vitals', async () => {

		const names = vitals( await plant() ).map( r => r.metric )

		// A reading carries which driver produced it and when. Those are not
		// vitals, and a row called "src" on a dashboard is noise.
		for ( const k of [ 'src', 't', 'timestamp', 'at' ] ) assert.ok( !names.includes( k ), `${k} leaked into the vitals` )

	} )

	it( 'makes missing a top-level fact, not a footnote', async () => {

		const s = await snapshot( await plant() )

		assert.ok( Array.isArray( s.missing.metrics ) )
		assert.match( s.missing.why, /cannot be told apart from a plant with nothing wrong/ )

	} )

	it( 'carries whether a state is allowed to act', async () => {

		const s = await snapshot( await plant() )

		for ( const state of Object.values( s.states ) ) {

			assert.equal( typeof state.acts, 'boolean' )
			assert.ok( state.level )

		}

	} )

	it( 'never carries a credential', async () => {

		const p = await plant( { ai : {
			provider : 'openai',
			apiKey : 'sk-do-not-leak-this',
		} } )

		const text = JSON.stringify( await snapshot( p ) )

		assert.ok( !text.includes( 'sk-do-not-leak-this' ) )
		assert.doesNotMatch( text, /apiKey|api_key|authorization/i )

	} )

	it( 'survives a layer that throws rather than showing nothing', async () => {

		const p = await plant()
		p.states = () => {

			throw new Error( 'misconfigured' )

		}

		// This is the page somebody opens *because* something is wrong.
		const s = await snapshot( p )
		assert.deepEqual( s.states, {} )
		assert.ok( s.vitals.length > 0 )

	} )

} )

describe( 'the server', () => {

	it( 'binds to loopback with no warning, and warns when told otherwise', async () => {

		const p = await plant()

		const local = await p.serve( { port : 7811 } )
		assert.equal( local.host, '127.0.0.1' )
		assert.deepEqual( local.warnings, [] )
		assert.equal( local.readOnly, true )
		await local.close()

		const open = await p.serve( {
			port : 7812,
			host : '0.0.0.0',
		} )
		assert.equal( open.warnings.length, 1 )
		assert.match( open.warnings[ 0 ], /whether anybody is home/ )
		await open.close()

	} )

	it( 'answers GET and refuses everything else', async () => {

		const p = await plant()
		const s = await p.serve( { port : 7813 } )

		const ok = await fetch( `${s.url}/vitals.json` )
		assert.equal( ok.status, 200 )

		for ( const method of [ 'POST', 'PUT', 'DELETE', 'PATCH' ] ) {

			const res = await fetch( `${s.url}/vitals.json`, { method } )
			assert.equal( res.status, 405, `${method} was not refused` )
			assert.match( ( await res.json() ).why, /stray request waters a plant/ )

		}

		await s.close()

	} )

	it( 'serves a page that fetches nothing from anywhere', async () => {

		const p = await plant()
		const s = await p.serve( { port : 7814 } )

		const res = await fetch( s.url )
		const html = await res.text()

		// It has to work on a Pi with no internet — which is where most of these
		// run, and where a CDN link makes the page blank exactly when the network
		// is the thing that broke.
		const external = html.replace( /https?:\/\/www\.w3\.org[^"']*/g, '' )
		assert.doesNotMatch( external, /https?:\/\// )
		assert.match( res.headers.get( 'content-security-policy' ), /default-src 'none'/ )

		await s.close()

	} )

	it( 'serves the logo from disk rather than inlining a hundred kilobytes', async () => {

		const p = await plant()
		const s = await p.serve( { port : 7819 } )

		const res = await fetch( `${s.url}/logo.png` )
		assert.equal( res.status, 200 )
		assert.equal( res.headers.get( 'content-type' ), 'image/png' )

		const html = await ( await fetch( s.url ) ).text()
		// A data URI would be that many kilobytes on every load and in every diff.
		assert.doesNotMatch( html, /data:image/ )
		assert.match( html, /src="\/logo\.png"/ )
		assert.match( res.headers.get( 'content-type' ), /image/ )

		await s.close()

	} )

	it( 'pins the page to the viewport, with the pages scrolling inside it', async () => {

		const p = await plant()
		const s = await p.serve( { port : 7820 } )

		const html = await ( await fetch( s.url ) ).text()

		assert.match( html, /html, body \{ height:100%; overflow:hidden \}/ )
		// Banner, tabs, and one page filling the rest.
		assert.match( html, /grid-template-rows:auto auto 1fr/ )

		await s.close()

	} )

	it( 'is light by default with dark one control away', async () => {

		const p = await plant()
		const s = await p.serve( { port : 7823 } )

		const html = await ( await fetch( s.url ) ).text()

		// Something glanced at on a phone in daylight, not stared at for hours.
		assert.match( html, /--bg:#fcfcfb/ )
		assert.match( html, /\[data-theme="dark"\]/ )
		// Remembered, because asking twice is asking once too many.
		assert.match( html, /localStorage.setItem\( 'sp-theme'/ )

		await s.close()

	} )

	it( 'hides the colony page when there is nobody to have talked to', async () => {

		const p = await plant()
		const s = await p.serve( { port : 7824 } )

		const html = await ( await fetch( s.url ) ).text()

		// An empty tab implying a conversation is worse than no tab.
		assert.match( html, /data-page="chat" hidden/ )
		assert.match( html, /data-page="detail"/ )

		await s.close()

	} )

	it( 'shows the loopback address, and a LAN one only when that is true', async () => {

		const p = await plant()

		const local = await p.serve( { port : 7821 } )
		assert.equal( local.net.address, '127.0.0.1:7821' )
		// Printing a LAN address for a loopback server would name somewhere the
		// page is not actually reachable.
		assert.equal( local.net.lan, null )
		await local.close()

		const open = await p.serve( {
			port : 7822,
			host : '0.0.0.0',
		} )
		assert.notEqual( open.net.address, '0.0.0.0:7822' )
		await open.close()

	} )

	it( 'reports the port the OS actually gave it', async () => {

		const p = await plant()
		const s = await p.serve( { port : 0 } )

		// Port 0 means "whatever is free". Reporting the requested port would
		// print an address nothing is listening on.
		assert.notEqual( s.port, 0 )
		assert.equal( s.url, `http://127.0.0.1:${s.port}` )
		assert.equal( ( await fetch( `${s.url}/health` ) ).status, 200 )

		await s.close()

	} )

	it( 'reports health without disclosing anything', async () => {

		const p = await plant()
		const s = await p.serve( { port : 7815 } )

		const body = await ( await fetch( `${s.url}/health` ) ).json()
		assert.equal( body.ok, true )
		assert.equal( Object.keys( body ).length, 2 )

		await s.close()

	} )

	it( 'pushes updates over an event stream', async () => {

		const p = await plant()
		const s = await p.serve( {
			port : 7816,
			everyMs : 1000,
		} )

		const res = await fetch( `${s.url}/live` )
		assert.equal( res.headers.get( 'content-type' ), 'text/event-stream' )

		const reader = res.body.getReader()
		const first = new TextDecoder().decode( ( await reader.read() ).value )

		assert.match( first, /^data: \{/ )
		assert.ok( JSON.parse( first.slice( 6 ) ).vitals.length > 0 )

		await reader.cancel()
		await s.close()

	} )

	it( 'says which port is taken rather than failing obscurely', async () => {

		const p = await plant()
		const first = await p.serve( { port : 7817 } )

		await assert.rejects(
			() => p.serve( { port : 7817 } ),
			/already in use/,
		)

		await first.close()

	} )

	it( 'stops listening when the plant is destroyed', async () => {

		const p = await createPlant( {
			name : 'Temp',
			species : 'Ficus',
			sensor : { driver : 'mock' },
			ai : { provider : 'mock' },
		} )
		await p.read()
		const s = await p.serve( { port : 7818 } )

		assert.equal( ( await fetch( `${s.url}/health` ) ).status, 200 )

		await p.destroy()

		// A dashboard left listening keeps a port bound long after the plant it
		// describes has gone.
		await assert.rejects( () => fetch( `${s.url}/health` ) )

	} )

} )
