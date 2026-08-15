# CLI

```bash
smartplant                      # interactive setup + live monitoring
smartplant status               # one status line
smartplant ask "how are you?"   # talk to your plant
smartplant diary                # today's journal entry
smartplant water --amount 200   # record a watering
smartplant history --hours 72   # stored trends
smartplant providers            # which AI backends are ready
smartplant sensors              # which drivers are available
smartplant hardware             # scan this machine for boards and sensors
smartplant openclaw [dir]       # generate an OpenClaw plugin for your plant
smartplant brain "<goal>"       # let an OpenClaw brain operate the plant
```

Flags: `--memory` `--sensor` `--provider` `--model` `--language` `--persona` `--interval`.

In the live view: `[t]` talk · `[w]` water · `[h]` history · `[q]` quit.
