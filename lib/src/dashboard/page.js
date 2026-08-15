/**
 * The page itself.
 *
 * One string. No build step, no framework, nothing fetched from anywhere — the
 * whole thing has to work on a Raspberry Pi with no internet connection, which
 * is where most of these will actually run, and a CDN link would make the page
 * blank exactly when the network is the thing that broke.
 *
 * ## Three pages, not three panels
 *
 * Everything used to be on one screen, which meant the interesting parts —
 * rhythms, components, restarts, what the plant has said to its neighbours —
 * had nowhere to go and were left out. They are now separate pages, and the
 * chat page only exists when there is somebody to have talked to: a colony of
 * one is not a conversation, and an empty tab implying otherwise is worse than
 * no tab.
 *
 * ## Light by default
 *
 * A terminal is dark because a terminal is a tool you stare at for hours. This
 * is something somebody glances at, often on a phone, often in daylight, and
 * light is the right default for that. The dark theme is one small control, and
 * the choice is remembered — asking twice is asking once too many.
 *
 * ## The vitals line is still a console
 *
 * The one thing that did not change. A gauge that overwrites itself shows the
 * present and destroys the past, and "at 5% for an hour" and "dropped there just
 * now" are the same picture on it. Appending keeps the difference.
 */

/**
 * Render the page.
 *
 * @param   {object} opts - `{ name, everyMs }`.
 * @returns {string}      HTML.
 */
export function page( opts = {} ) {

	const name = String( opts.name ?? 'plant' )
	const everyMs = opts.everyMs ?? 5000

	const esc = s => String( s ).replace( /[<>&"]/g, c => ( {
		'<' : '&lt;',
		'>' : '&gt;',
		'&' : '&amp;',
		'"' : '&quot;',
	} )[ c ] )

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc( name )}</title>
<style>
:root {
	--bg:#fcfcfb; --panel:#fff; --line:#e6e5e0; --fg:#1a1c19; --dim:#71756c;
	--ok:#3f7d46; --low:#2b6d94; --high:#a8571f; --none:#b3b5ae; --accent:#3f7d46;
	--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
:root[data-theme="dark"] {
	--bg:#0b0c0a; --panel:#121411; --line:#23261f; --fg:#dcded6; --dim:#82877c;
	--ok:#6ab377; --low:#5fa0c4; --high:#d18f57; --none:#4a4e46; --accent:#6ab377;
}
* { box-sizing:border-box; margin:0; padding:0 }
html, body { height:100%; overflow:hidden }
body {
	background:var(--bg); color:var(--fg); font:14px/1.55 var(--sans);
	display:grid; grid-template-rows:auto auto 1fr; height:100vh;
	-webkit-font-smoothing:antialiased;
}

/* ── banner ─────────────────────────────────────────────────────────────── */
header { display:flex; align-items:center; gap:1.1rem; padding:1rem 1.4rem .9rem;
	background:var(--panel); border-bottom:1px solid var(--line) }
header img { width:56px; height:56px; flex:none; border-radius:.5rem }
header .id { min-width:0 }
header h1 { font-size:1.35rem; font-weight:600; letter-spacing:-.01em; line-height:1.2 }
header .meta { display:flex; flex-wrap:wrap; gap:.15rem .9rem; margin-top:.2rem;
	font:12px/1.5 var(--mono); color:var(--dim) }
header .meta b { font-weight:500; color:var(--fg) }
header .spacer { flex:1 }
.dot { width:8px; height:8px; border-radius:50%; background:var(--ok); flex:none }
.dot.stale { background:var(--high) }
#theme { border:1px solid var(--line); background:transparent; color:var(--dim);
	border-radius:.4rem; width:30px; height:30px; cursor:pointer; font-size:14px; flex:none }
#theme:hover { color:var(--fg); border-color:var(--dim) }

/* ── pages ──────────────────────────────────────────────────────────────── */
nav { display:flex; gap:.15rem; padding:0 1.4rem; background:var(--panel);
	border-bottom:1px solid var(--line) }
nav button { border:0; background:none; color:var(--dim); cursor:pointer;
	font:500 13px/1 var(--sans); padding:.7rem .85rem; border-bottom:2px solid transparent;
	margin-bottom:-1px }
nav button:hover { color:var(--fg) }
nav button[aria-selected="true"] { color:var(--fg); border-bottom-color:var(--accent) }
nav button[hidden] { display:none }

main { overflow:hidden; min-height:0 }
.page { display:none; height:100%; overflow-y:auto; padding:1.2rem 1.4rem 2.5rem;
	scrollbar-width:thin; scrollbar-color:var(--line) transparent }
.page::-webkit-scrollbar { width:8px }
.page::-webkit-scrollbar-thumb { background:var(--line); border-radius:4px }
.page[data-active] { display:block }

/* ── shared ─────────────────────────────────────────────────────────────── */
h2 { font-size:.68rem; text-transform:uppercase; letter-spacing:.1em; color:var(--dim);
	font-weight:600; margin:1.6rem 0 .6rem }
h2:first-child { margin-top:0 }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(15rem,1fr)); gap:.5rem }
.card { background:var(--panel); border:1px solid var(--line); border-radius:.55rem; padding:.75rem .9rem }
.card .k { font-size:.78rem; color:var(--dim) }
.card .v { font:600 1.35rem/1.2 var(--mono); font-variant-numeric:tabular-nums; margin-top:.1rem }
.card .u { font-size:.75rem; color:var(--dim); font-weight:400 }
.card.off .v { color:var(--none) }
.card .note { font-size:.72rem; color:var(--dim); margin-top:.35rem; line-height:1.45 }
.bar { height:4px; background:var(--line); border-radius:2px; margin-top:.5rem; position:relative }
.bar i { position:absolute; top:0; bottom:0; width:3px; border-radius:2px; background:var(--fg) }
.bar.ok i{background:var(--ok)} .bar.low i{background:var(--low)} .bar.high i{background:var(--high)}
.rows { background:var(--panel); border:1px solid var(--line); border-radius:.55rem; overflow:hidden }
.row { display:flex; align-items:baseline; gap:.6rem; padding:.45rem .9rem; font-size:.85rem }
.row + .row { border-top:1px solid var(--line) }
.row .k { flex:1; min-width:0 }
.row .v { font-family:var(--mono); font-variant-numeric:tabular-nums; color:var(--dim) }
.row.off .k, .row.off .v { color:var(--none) }
.row .s { width:.7rem; text-align:center; font-size:.7rem }
.s.ok{color:var(--ok)} .s.low{color:var(--low)} .s.high{color:var(--high)} .s.none{color:var(--none)}
.why { font-size:.78rem; color:var(--dim); line-height:1.55; margin-top:.5rem }
.empty { color:var(--dim); font-size:.85rem; padding:1.5rem 0 }

/* ── console ────────────────────────────────────────────────────────────── */
#console { font:12.5px/1.65 var(--mono); background:var(--panel);
	border:1px solid var(--line); border-radius:.55rem; padding:.7rem .9rem;
	max-height:22rem; overflow-y:auto }
#console p { white-space:pre-wrap; word-break:break-word }
#console .ts { color:var(--none) }

/* ── chat ───────────────────────────────────────────────────────────────── */
.msg { background:var(--panel); border:1px solid var(--line); border-radius:.55rem;
	padding:.6rem .85rem; margin-bottom:.45rem }
.msg .who { font:600 .75rem var(--mono); color:var(--accent) }
.msg .when { font:.7rem var(--mono); color:var(--none); float:right }
.msg .text { font-size:.85rem; margin-top:.2rem }
#stale { display:none; background:var(--high); color:#fff; padding:.5rem 1.4rem; font-size:.8rem }
#stale.show { display:block }
</style>
</head>
<body>
<div id="stale">The live connection dropped. What follows is the last thing this plant said, not what it is saying now.</div>

<header>
	<img src="/logo.png" alt="">
	<span class="id">
		<h1 id="pname">${esc( name )}</h1>
		<div class="meta">
			<span><b id="paddr">—</b></span>
			<span id="pspecies"></span>
			<span id="parch"></span>
			<span id="pcount"></span>
		</div>
	</span>
	<span class="spacer"></span>
	<span class="dot" id="dot" title="live"></span>
	<button id="theme" title="Light or dark">◐</button>
</header>

<nav>
	<button data-page="dashboard" aria-selected="true">Dashboard</button>
	<button data-page="chat" hidden>Colony</button>
	<button data-page="detail">Detail</button>
</nav>

<main>
	<section class="page" id="page-dashboard" data-active>
		<p class="why" id="says"></p>
		<h2>Vitals</h2>
		<div class="grid" id="vitals"></div>
		<h2>One line a minute</h2>
		<div id="console"></div>
	</section>

	<section class="page" id="page-chat">
		<h2>What the plants have said to each other</h2>
		<div id="chat"></div>
	</section>

	<section class="page" id="page-detail">
		<h2>What it is doing</h2><div class="rows" id="states"></div>
		<h2>Rhythms</h2><div class="rows" id="rhythms"></div>
		<h2>Components</h2><div class="rows" id="components"></div>
		<h2>Space</h2><div class="rows" id="space"></div>
		<h2>Record</h2><div class="rows" id="record"></div>
		<p class="why">Read-only. Nothing on this page can act on the plant.</p>
	</section>
</main>

<script>
const $ = id => document.getElementById( id )
const esc = s => String( s ).replace( /[<>&]/g, c => ( { '<':'&lt;', '>':'&gt;', '&':'&amp;' } )[ c ] )
const pad = n => String( n ).padStart( 2, '0' )
const clock = d => pad( d.getHours() ) + ':' + pad( d.getMinutes() ) + ':' + pad( d.getSeconds() )
const UNITS = { temperature:'°C', humidity:'%', soil:'%', light:'lux', co2:'ppm', airflow:'m/s',
	ph:'', conductivity:'µS/cm', voltage:'mV', leafTemperature:'°C', par:'µmol/m²/s',
	redFarRed:'', canopySpread:'°C' }

/* Remembered, because asking twice is asking once too many. */
const saved = ( () => { try { return localStorage.getItem( 'sp-theme' ) } catch { return null } } )()
if ( saved ) document.documentElement.dataset.theme = saved
$( 'theme' ).onclick = () => {
	const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
	document.documentElement.dataset.theme = next
	try { localStorage.setItem( 'sp-theme', next ) } catch {}
}

for ( const b of document.querySelectorAll( 'nav button' ) ) {
	b.onclick = () => {
		for ( const o of document.querySelectorAll( 'nav button' ) ) o.setAttribute( 'aria-selected', o === b )
		for ( const p of document.querySelectorAll( '.page' ) ) p.toggleAttribute( 'data-active', p.id === 'page-' + b.dataset.page )
	}
}

let lastMinute = null
function log( text, cls ) {
	const el = document.createElement( 'p' )
	el.innerHTML = '<span class="ts">' + clock( new Date() ) + '</span>  ' + esc( text )
	const box = $( 'console' )
	box.appendChild( el )
	while ( box.childElementCount > 400 ) box.removeChild( box.firstChild )
	box.scrollTop = box.scrollHeight
}

const rows = ( id, list, empty ) => {
	$( id ).innerHTML = list.length ? list.join( '' )
		: '<div class="row off"><span class="k">' + esc( empty ) + '</span></div>'
}
const row = ( k, v, mark, off ) =>
	'<div class="row' + ( off ? ' off' : '' ) + '"><span class="s ' + ( mark || 'none' ) + '">' +
	( mark === 'ok' ? '●' : mark === 'low' ? '▼' : mark === 'high' ? '▲' : '·' ) +
	'</span><span class="k">' + esc( k ) + '</span><span class="v">' + esc( v ) + '</span></div>'

function onData( d ) {
	$( 'dot' ).classList.remove( 'stale' )
	$( 'pname' ).textContent = d.plant.name
	$( 'paddr' ).textContent = ( d.net && d.net.address ) || '—'
	$( 'pspecies' ).textContent = d.plant.species || ''
	$( 'parch' ).textContent = d.plant.archetype || ''
	$( 'pcount' ).textContent = d.plant.readings + ' readings'
	$( 'says' ).textContent = d.says || 'This plant has nothing to say yet — it has not been read.'

	const now = new Date()
	const minute = now.toDateString() + now.getHours() + '-' + now.getMinutes()
	if ( minute !== lastMinute ) { lastMinute = minute; log( d.says || 'no reading yet' ) }

	$( 'vitals' ).innerHTML = d.vitals.map( v => {
		if ( !v.measured ) return '<div class="card off"><div class="k">' + esc( v.metric ) +
			'</div><div class="v">—</div><p class="note">no sensor</p></div>'
		const pct = v.fraction === null ? null : Math.round( v.fraction * 100 )
		return '<div class="card"><div class="k">' + esc( v.metric ) + '</div>' +
			'<div class="v">' + v.value + ' <span class="u">' + ( UNITS[ v.metric ] ?? '' ) + '</span></div>' +
			( pct === null ? '' : '<div class="bar ' + v.band + '"><i style="left:' +
				Math.min( 97, Math.max( 0, pct ) ) + '%"></i></div>' ) +
			( v.range ? '<p class="note">comfortable ' + v.range.min + '–' + v.range.max + '</p>' : '' ) + '</div>'
	} ).join( '' )

	// Colony is a page only when there is somebody to have talked to. An empty
	// tab implying a conversation is worse than no tab.
	const peers = ( d.colony && d.colony.neighbours ) || []
	document.querySelector( 'nav button[data-page="chat"]' ).hidden = peers.length === 0

	$( 'chat' ).innerHTML = ( d.colony && d.colony.transcript || [] ).length
		? d.colony.transcript.map( t => '<div class="msg"><span class="who">' + esc( t.from ) +
			' → ' + esc( t.to ) + '</span><span class="when">' + esc( t.kind ) + '</span>' +
			'<div class="text">' + esc( t.text ) + '</div></div>' ).join( '' )
		: '<p class="empty">' + ( peers.length
			? 'Connected to ' + peers.join( ', ' ) + ', and nothing said yet.'
			: 'No neighbours.' ) + '</p>'

	rows( 'states', Object.entries( d.states || {} ).map( ( [ k, s ] ) =>
		row( k.replace( /_/g, ' ' ), s.level + ( s.acts ? '' : ' · not acting' ),
			s.level === 'high' ? 'high' : s.level === 'medium' ? 'low' : s.level === 'unknown' ? 'none' : 'ok',
			!s.acts ) ), 'No internal states.' )

	rows( 'rhythms', [
		d.season && row( 'season', d.season.season || 'not known', d.season.applied ? 'ok' : 'none', !d.season.applied ),
		d.rhythms && row( 'circadian', d.rhythms.circadian || 'not assessable', 'none', !d.rhythms.circadian ),
		row( 'last read', d.lastReadingAt ? new Date( d.lastReadingAt ).toLocaleString() : 'never', 'none' ),
	].filter( Boolean ), 'Nothing rhythmic known yet.' )

	rows( 'components', Object.entries( d.layers ).map( ( [ k, v ] ) =>
		row( k, v ? ( v === true ? 'attached' : v ) : 'none', v ? 'ok' : 'none', !v ) )
		.concat( d.missing.metrics.map( m => row( m, 'no sensor', 'none', true ) ) ), '' )

	rows( 'space', d.space ? ( d.space.stale
		? [ row( 'last scan', 'too old', 'high' ) ]
		: [ row( 'nearest', d.space.tightest + ' m', d.space.clear ? 'ok' : 'high' ),
			row( 'ways out', String( d.space.openings ), 'ok' ) ]
			.concat( d.space.neighbours.map( n => row( n.id, n.metres + ' m', 'ok' ) ) ) )
		: [], 'No rangefinder.' )

	rows( 'record', [
		row( 'readings', String( d.plant.readings ), 'ok' ),
		d.plant.since && row( 'since', new Date( d.plant.since ).toLocaleDateString(), 'ok' ),
		d.symbiont && row( 'resumed', d.symbiont.restored || 'nothing', d.symbiont.restored ? 'ok' : 'none' ),
		d.symbiont && row( 'last saved', d.symbiont.at ? new Date( d.symbiont.at ).toLocaleString() : 'never',
			d.symbiont.at ? 'ok' : 'none', !d.symbiont.at ),
	].filter( Boolean ), '' )
}

let src
function connect() {
	src = new EventSource( '/live' )
	src.onmessage = e => { $( 'stale' ).classList.remove( 'show' ); onData( JSON.parse( e.data ) ) }
	src.onerror = () => {
		$( 'stale' ).classList.add( 'show' )
		$( 'dot' ).classList.add( 'stale' )
		log( 'connection lost — nothing below this line is current' )
		src.close(); setTimeout( connect, ${everyMs} )
	}
}
fetch( '/vitals.json' ).then( r => r.json() ).then( onData ).catch( () => {} )
connect()
</script>
</body>
</html>`

}
