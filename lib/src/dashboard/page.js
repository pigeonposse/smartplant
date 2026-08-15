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
 * ## The dashboard is a glance, the activity page is the record
 *
 * The dashboard shows the plant's own line, the last thing that happened, and
 * the vitals. Nothing else and no scrolling: if it does not fit, that is a
 * reason to move something rather than to let the page grow.
 *
 * Everything that accumulates lives on the activity page — the events and the
 * per-minute vitals line, merged into one column. They are kept apart in the
 * data and together in the view, because a reading is not an activity and the
 * feed on the server does not store one, but a person reading down the page
 * wants to see what the plant was reading while something happened.
 *
 * The per-minute line still appends rather than overwriting. A gauge that
 * overwrites itself shows the present and destroys the past, and "at 5% for an
 * hour" and "dropped there just now" are the same picture on it.
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
/* The mark is white on transparent, which is invisible on a white page. It is
   inverted in the light theme and left alone in the dark one. */
header img { width:56px; height:56px; flex:none; border-radius:.5rem; filter:invert(1) }
:root[data-theme="dark"] header img { filter:none }
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
/* The dashboard is a glance. If it does not fit, that is a reason to move
   something to another page rather than to let it scroll. */
#page-dashboard { overflow:hidden; display:none; grid-template-rows:auto auto auto 1fr;
	gap:0; padding-bottom:1.2rem }
#page-dashboard[data-active] { display:grid }
.page::-webkit-scrollbar { width:8px }
.page::-webkit-scrollbar-thumb { background:var(--line); border-radius:4px }
.page[data-active] { display:block }

/* ── shared ─────────────────────────────────────────────────────────────── */
h2 { font-size:.68rem; text-transform:uppercase; letter-spacing:.1em; color:var(--dim);
	font-weight:600; margin:1.6rem 0 .6rem }
h2:first-child { margin-top:0 }
/* Four across, so the cards line up in columns rather than reflowing into a
   ragged block that changes shape every time a sensor is added. */
.grid { display:grid; grid-template-columns:repeat(4,1fr); gap:.6rem;
	max-width:74rem; margin:0 auto; width:100%;
	/* Cards size to their content. Without this they stretch to fill the row
	   and a two-line card becomes half a screen tall. */
	align-content:start; align-items:start }
@media (max-width:60rem) { .grid { grid-template-columns:repeat(2,1fr) } }
@media (max-width:34rem) { .grid { grid-template-columns:1fr } }
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
/* The plant's own line. It was the smallest thing on a page about it. */
/* One line, and it stays one line. It wrapped to two on a narrow window and
   read like a paragraph rather than a status. */
#says { text-align:center; font-size:1.05rem; font-weight:600; color:var(--fg);
	padding:.5rem 0 1.5rem; white-space:nowrap; overflow-x:auto;
	scrollbar-width:none }
#says::-webkit-scrollbar { display:none }
.empty { color:var(--dim); font-size:.85rem; padding:1.5rem 0 }

/* ── chat ───────────────────────────────────────────────────────────────── */
.latest { display:flex; align-items:baseline; gap:.7rem; text-align:left;
	background:var(--panel); border:1px solid var(--line); border-radius:.55rem;
	padding:.55rem .9rem; font:inherit; font-size:.88rem; color:var(--fg); cursor:pointer;
	max-width:52rem; width:100%; margin:0 auto 1.6rem }
.latest:hover { border-color:var(--dim) }
.latest .more { color:var(--dim); font-size:.78rem; margin-left:auto; flex:none }
.act { display:flex; align-items:baseline; gap:.7rem; padding:.45rem .9rem; font-size:.85rem }
.act + .act { border-top:1px solid var(--line) }
.act .t { font:12px var(--mono); color:var(--none); flex:none; width:3.2rem }
.act .l { flex:1; min-width:0 }
.act .d { color:var(--dim); font-size:.8rem }
.act .tag { font:600 .62rem var(--mono); text-transform:uppercase; letter-spacing:.06em;
	padding:.1rem .35rem; border-radius:.25rem; flex:none }
.tag.care{color:var(--ok)} .tag.electrical{color:var(--low)} .tag.state{color:var(--fg)}
.tag.environment{color:var(--dim)} .tag.vision{color:var(--low)} .tag.colony{color:var(--accent)}
.tag.system{color:var(--none)} .tag.refusal{color:var(--high)} .tag.reading{color:var(--none)}
/* A reading is the background against which the events happened, so it reads
   as background. */
.act.pulse .l { font:12.5px var(--mono); color:var(--dim) }
.act.degraded { opacity:.55 }
.act.degraded .l::after { content:' · from a degraded instrument'; color:var(--high); font-size:.75rem }
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
	<button data-page="activity">Activity</button>
	<button data-page="chat" hidden>Colony</button>
	<button data-page="detail">Detail</button>
</nav>

<main>
	<section class="page" id="page-dashboard" data-active>
		<p id="says"></p>
		<button class="latest" id="latest" type="button"></button>
		<h2>Vitals</h2>
		<div class="grid" id="vitals"></div>
	</section>

	<section class="page" id="page-activity">
		<h2>Activity</h2>
		<div class="rows" id="activity"></div>
	</section>

	<section class="page" id="page-chat">
		<h2>What the plants have said to each other</h2>
		<div id="chat"></div>
	</section>

	<section class="page" id="page-detail">
		<h2>What it is doing</h2><div class="rows" id="states"></div>
		<h2>Rhythms</h2><div class="rows" id="rhythms"></div>
		<h2>Components</h2><div class="rows" id="components"></div>
		<h2>Root space</h2><div class="rows" id="rootspace"></div>
		<h2>Watering</h2><div class="rows" id="watering"></div>
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

const goTo = page => {
	for ( const o of document.querySelectorAll( 'nav button' ) ) o.setAttribute( 'aria-selected', o.dataset.page === page )
	for ( const p of document.querySelectorAll( '.page' ) ) p.toggleAttribute( 'data-active', p.id === 'page-' + page )
}
$( 'latest' ).onclick = () => goTo( 'activity' )

for ( const b of document.querySelectorAll( 'nav button' ) ) {
	b.onclick = () => goTo( b.dataset.page )
}

/* The per-minute vitals line. Kept here rather than in the feed on the server,
   because a reading is not an activity and the feed does not store one — but a
   person reading down the page wants both in one column, so they are merged in
   the view and tagged apart. */
const pulse = []
let lastMinute = null

function log( text ) {
	pulse.unshift( {
		at : Date.now(),
		text,
	} )
	while ( pulse.length > 400 ) pulse.pop()
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

	// Timestamp, short label, optional detail. Lines from a failing instrument
	// are dimmed and tagged rather than dropped: they are still information, and
	// hiding them is how a dying electrode's readings get believed.
	const acts = d.activity || []

	const top = acts[ 0 ]
	$( 'latest' ).innerHTML = top
		? '<span class="tag ' + top.kind + '">' + esc( top.kind ) + '</span>' +
			'<span class="l">' + esc( top.label ) +
			( top.detail ? ' <span class="d">· ' + esc( top.detail ) + '</span>' : '' ) + '</span>' +
			'<span class="more">' + clock( new Date( top.at ) ).slice( 0, 5 ) +
			'  ·  ' + acts.length + ' more →</span>'
		: '<span class="l">Nothing worth mentioning yet.</span>'

	// Everything in one column, newest first: what happened and what the plant
	// was reading while it happened.
	const merged = [
		...acts.map( a => ( { ...a, isEvent : true } ) ),
		...pulse.map( p => ( { at : p.at, kind : 'reading', label : p.text } ) ),
	].sort( ( a, b ) => b.at - a.at ).slice( 0, 120 )

	$( 'activity' ).innerHTML = merged.length
		? merged.map( a => '<div class="act' + ( a.degraded ? ' degraded' : '' ) +
			( a.isEvent ? '' : ' pulse' ) + '">' +
			'<span class="t">' + clock( new Date( a.at ) ).slice( 0, 5 ) + '</span>' +
			'<span class="tag ' + a.kind + '">' + esc( a.kind ) + '</span>' +
			'<span class="l">' + esc( a.label ) +
			( a.detail ? ' <span class="d">· ' + esc( a.detail ) + '</span>' : '' ) +
			( a.repeated > 1 ? ' <span class="d">×' + a.repeated + '</span>' : '' ) + '</span></div>' ).join( '' )
		: '<div class="row off"><span class="k">Nothing yet.</span></div>'

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

	rows( 'rootspace', d.transplant
		? [ row( 'transplant', d.transplant.phase + ( d.transplant.day !== undefined ? ' · day ' + d.transplant.day : '' ),
			d.transplant.phase === 'settled' ? 'ok' : 'low' ),
		row( 'new volume', d.transplant.volumeL + ' L', 'ok' ),
		row( 'baselines', d.transplant.baselines || '—', 'low' ) ]
		: d.rootSpace
			? [ row( 'index', d.rootSpace.index,
				d.rootSpace.index === 'low' ? 'high' : d.rootSpace.index === 'medium' ? 'low' : 'ok',
				d.rootSpace.index === 'unknown' ),
			row( 'outlook', d.rootSpace.outlook, 'none' ),
			row( 'in this pot', ( d.rootSpace.daysInPot ?? '—' ) + ' days', 'none' ) ]
				.concat( d.rootSpace.evidence.map( e => row( '·', e, 'none' ) ) )
			: [], 'No pot size, so nothing here can say.' )

	rows( 'watering', d.watering
		? ( d.watering.known === false
			? [ row( 'not known', 'needs a pot size', 'none', true ) ]
			: [ row( 'pot', d.watering.litres + ' L', 'ok' ),
				row( 'a watering', d.watering.ml + ' ml', 'ok' ),
				row( 'pump', d.watering.seconds ? d.watering.seconds + ' s' : 'not calibrated',
					d.watering.seconds ? 'ok' : 'none', !d.watering.seconds ) ] )
		: [], 'No watering plan.' )

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
