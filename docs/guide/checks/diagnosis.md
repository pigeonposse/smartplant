# System diagnosis

You have just wired a plant: a probe in the soil, maybe an electrode, a key in a file, a lamp on a relay. Everything *looks* connected. Before walking away for a month, one command tells you whether it is — and if not, which wire.

```bash
smartplant diagnose
```

```
System diagnosis

  🟢  sensor:serial    Connected, providing temperature, humidity, soil, light.
  🟢  reading          Read temperature 21.4, humidity 55.2, soil 38.1, light 820.
  🔴  electrode        The trace is flat (spread 0.00000mV). Living tissue is never
                       electrically silent — this electrode is not in contact with a plant.
  🟢  memory           Persisting to ./ivy.json (412 readings stored).
  🟡  ai               The mock provider returns canned text rather than reasoning.
  ⚪  vision           No camera. Visible symptoms will not be seen.

  3 working · 1 to look at · 1 broken · 1 not set up

  1 thing(s) are not working: electrode. Nothing downstream of them can be
  trusted until they are fixed.

What to change

  1. [electrode] A flat trace means the lead is not making contact with living
     tissue. Reseat the electrode against damp stem or leaf tissue and run this again.
  2. [ai] Fine for trying things out. For real answers, set a provider and key.
```

Also available as `plant.systemDiagnosis()`. It exits non-zero when something is broken, so it works in a startup script or a cron job.

**Forty areas**, covering every layer that can be misconfigured: sensors and the reading itself, electrode, memory, AI, spectral, vision, the thermal camera, colony and whether anything it says can leave, archetype, power, inference, internal states, coupling, optical, security, navigation, presence, space, dashboard, learning, knowledge, safety limits, voice, plugins, co-adaptation, running experiments, a restored identity, integrations, the season, the pot and how much water it implies, root space, a transplant still settling, the activity feed, night consolidation, the provenance index and the profiler.

Nothing new is allowed to stay outside it. Every layer added in 3.0.5 has its own line, and the plugin check knows what each official plugin needs — a plugin waiting for a wire answers every call with a refusal, which is honest and also a very quiet way for somebody to conclude the library does not work, so it is named here rather than discovered one empty result at a time.

Two rules decide whether a check like this is useful or just noise:

**Not configured is not broken.** ⚪ means you never asked for it. Telling somebody their vision system is down when they never wanted a camera is how people learn to ignore warnings. Only what you configured can fail.

**Every red line ends in something to do.** "Electrode: degraded" is a fact with no next step. The same fact with the walk to the windowsill included is a fix. Every 🔴 and 🟡 carries one, and a test enforces it.

It catches, among others: a probe reading values outside physical possibility (a wiring fault, not a plant in distress), a sensor that has latched onto one number, a lead not touching the plant, a sample rate too low to filter mains hum, memory that will vanish when the process ends, a provider that is configured but unreachable, a lamp with no electrode to record what it provokes, and a single electrode — which works, but can never tell a changing plant from a tiring contact.

### How it differs from the other two

| | Asks |
| --- | --- |
| 🩻 **`systemDiagnosis()`** | *Does any of this work yet?* — answerable on a plant with no history at all |
| 🩺 [`checkup()`](/guide/checks/checkup) | *How has the plant been changing?* — needs weeks of readings |
| 🔧 [`maintenance()`](/guide/checks/maintenance) | *Can the instrument still be believed?* — for a rig that has been running a while |
