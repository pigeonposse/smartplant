---
"smartplant": minor
---

**`plant.systemDiagnosis()` and `smartplant diagnose`** — one command that checks everything actually wired up and says what to change.

Somebody has just connected a plant: a probe in the soil, maybe an electrode, a key in a file, a lamp on a relay. Everything looks connected. This answers whether it is, and if not, which wire — on a plant with no history, no baseline and nothing recorded, which is exactly the moment the other two reviews cannot help. `checkup()` needs weeks of readings; `maintenance()` is for a rig that has been running a while.

Two rules decide whether a check like this is useful or noise:

- **Not configured is not broken.** A setup with no camera is not failing, it simply has no camera. Telling somebody their vision system is down when they never wanted one is how people learn to ignore warnings. Absent subsystems report as absent and only what was configured can fail.
- **Every red line ends in something to do.** "Electrode: degraded" is a fact with no next step. "The trace is flat — the lead is not touching living tissue; reseat it against damp stem and run this again" is the same fact with the walk to the windowsill included. A test enforces that every 🔴 and 🟡 carries one.

It catches a probe reading outside physical possibility (a wiring fault, not a plant in distress), a latched sensor, a lead not touching the plant, a sample rate too low to filter mains hum, memory that vanishes when the process ends, a configured but unreachable provider, a lamp with no electrode to record what it provokes, and a single electrode — which works, but can never separate a changing plant from a tiring contact.

The CLI command exits non-zero when something is broken, so it can run in a startup script or a cron job and mean something.
