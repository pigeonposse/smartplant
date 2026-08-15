# Dashboard

```js
const server = await plant.serve()
// open http://127.0.0.1:7777
```

No build step, no framework, and nothing fetched from anywhere — one file of HTML with the styles and script inline, served from `node:http`. Most of these run on a Raspberry Pi with no internet connection, and a CDN link would make the page blank exactly when the network is the thing that broke.

It is a **terminal**, not a dashboard: three regions pinned to the viewport, nothing scrolls the page. A short banner with the logo, plant name and address; a console down the left; the instrument inventory down the right.

### Why the vitals are a console

A panel of gauges that overwrites itself shows you the present and destroys the past. You cannot tell a plant that has been at 5% humidity for an hour from one that dropped there a minute ago — and that difference is most of what matters. So the vitals line is **appended once a minute** and the previous lines stay:

```
19:51:53  smartplant · read-only monitor
19:52:00  😐 53% | Temperature: 🌡️ 19.9°C | Humidity: 🏜️ 5.3% | Soil: 🏜️ 0% | Light: 🌑 9lux
19:53:00  😐 51% | Temperature: 🌡️ 20.1°C | Humidity: 🏜️ 5.1% | Soil: 🏜️ 0% | Light: 🌑 11lux
```

The right column is the inventory and it deliberately never moves — a list that flickers invites you to watch it, and there is nothing there to watch.

| Route | |
| --- | --- |
| `/` | The page |
| `/vitals.json` | The same thing as JSON — add `?deep` for the full system diagnosis |
| `/live` | Server-sent events, pushed every few seconds |
| `/health` | Is it up |

### The gaps are the content

A dashboard with four handsome gauges and no mention of the electrode that is not connected is lying by omission, and it is the exact opposite of how the rest of this library behaves. So `unknown` is a first-class value, `missing` is a top-level section, and a metric with no sensor is drawn greyed with its reason rather than left out:

```
  conductivity          —   no sensor
  humidity           44.1   ok
  light                 0   low
  ph                    —   no sensor
  soil               32.9   ok
  temperature        20.1   ok

2 metrics have no sensor. They are listed rather than hidden because a screen
showing only what is measured cannot be told apart from a plant with nothing wrong.
```

A person should be able to tell at a glance the difference between *"this plant is fine"* and *"nothing here can see whether this plant is fine"*. On most dashboards those look identical, and they are not remotely the same situation.

Internal states carry their `acts` flag through to the screen, so a state that is **not allowed to change anything** — because its evidence is too weak — does not look like one that is.

### Recent activity

What the symbiont just did, or just noticed — the one thing that existed nowhere a person could read in order:

```
16:34  CARE       Watered · 180 ml
16:34  STATE      defense activation → high · now gating decisions
16:34  REFUSAL    probe refused · defense activation
16:33  SYSTEM     Instrument inspected ×6
16:31  ENVIRONMENT soil fell · 64.2 → 12.0
```

It **listens rather than being told**. A `log()` call at every interesting place produces a feed that is complete the day it is written and quietly incomplete forever after, because the next thing anybody adds will not have the call. So it subscribes to the event bus and diffs the states between cycles.

Readings are not activity — only a change large enough to have meant something earns a line, and an identical line inside half an hour is counted rather than repeated. **Refusals are the most useful entries in it**: somebody looking at a plant that has not been watered wants to know it was declined and why, far more than another line saying the soil was read again. And a line from a failing instrument is dimmed and tagged rather than dropped, because hiding it is how a dying electrode's readings get believed.

### Three pages, light by default

Dashboard, colony and detail. The colony page is hidden when there is nobody to have talked to — an empty tab implying a conversation is worse than no tab. Light by default because this is glanced at, often on a phone, often in daylight; dark is one control away and the choice is remembered.

### Loopback, and read-only

The colony server binds to `127.0.0.1` unless told otherwise, and this does the same for a stronger reason. A colony port carries plant chatter; **this port carries a live feed of somebody's home** — when the lights go on, when the temperature drops because a window opened, and in the clearest possible terms whether anyone is in.

```js
await plant.serve( { host: '0.0.0.0' } )
// warnings: [ 'Listening on 0.0.0.0 rather than loopback. […] There is no
//   authentication here, because adding a password field would suggest this was
//   built to be exposed. If this is deliberate, it is fine; if it was copied
//   from an example, change it back.' ]
```

And it answers nothing but `GET`:

```json
{ "error": "read-only",
  "why": "This server only answers GET. Watering, probing and moving stay in code
          where the safety layers already gate them, and no HTTP verb reaches
          them. A page that can water a plant is a page where a stray request
          waters a plant." }
```

There is no `allowActions` option. Adding one later would be a deliberate act with its own authentication story, not a flag.

Two smaller things that matter more than they look: a **staleness banner** appears the moment the event stream drops, because a dashboard that keeps showing the last numbers after the connection dies is the most misleading thing it can do — the plant may have been dark for hours. And `destroy()` closes the server, so a dashboard is never left holding a port after the plant it describes has gone.
