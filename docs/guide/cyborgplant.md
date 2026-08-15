# Cyborgplant

> SmartPlant is an open-source library that turns a plant and a computer into a functional **symbiont**: a hybrid organism — a **cyborgplant** — with shared perception, memory, reasoning, voice, and the ability to act.

That sentence is the whole design, and it is worth being precise about, because "cyborg plant" is the kind of phrase that usually means nothing. Here it means something narrow and testable: **five faculties that neither half has on its own, each one built from parts of both.**

A plant senses, remembers and responds. It has no way to say any of it, no way to compare this year against last, and no way to act on the room it is in. A computer can say things, keep records and switch a pump. It has no interior state worth reporting. Joined properly, each supplies exactly what the other lacks — and the join is the organism.

## Why a symbiosis is possible at all

Start with the fact that makes the rest of this page more than a metaphor.

**A plant is already a signalling organism, and it is already electrical.** Wounding, cooling, touch and drought all propagate through a plant as measurable voltage changes across the plasma membrane — action potentials, variation potentials, system potentials — carrying information from the leaf where something happened to leaves that have not been touched yet. This is not an analogy with nervous systems and it is not new: it has been recorded with electrodes since the nineteenth century, and it is why an electrode taped to a stem picks up anything at all.

So there is a channel. The interesting part is what is on either end of it.

### The plant computes with its body, which is why it is expensive

A plant has no dedicated tissue for processing. It computes the way it does everything else: chemically and structurally, by building and dismantling molecules. Deciding to defend itself means synthesising defensive compounds. Deciding to conserve water means closing stomata — and a closed stoma stops water loss *and* stops the intake of CO₂, so photosynthesis stops with it. **Every decision a plant makes is paid for in carbon**, and every one of them is slow, because the substrate of the computation is chemistry rather than charge.

The numbers are the argument. Plant action potentials propagate at roughly [0.5–20 cm/s](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2017.00684/full), variation potentials at 0.5–5 mm/s. A myelinated animal axon reaches about 120 m/s. Copper does it at two thirds the speed of light. The decision loop in this library — read, infer, gate, act — runs in **microseconds**.

That gap is not a criticism of plants. It is the entire opportunity: **the two halves are slow and fast at completely different things**, which is the precondition for a division of labour.

### What the join actually removes

Here is the claim to be careful with, because the exciting version of it is false.

A plant does not switch off a metabolic pathway because there is a CPU nearby. Nothing here reaches inside the organism and disables anything. Photosynthesis, respiration, stomatal control and hormone signalling all continue exactly as they would have.

What changes is **how often the expensive ones have to run at all** — and that is measurable, so it is worth stating precisely:

**A stress response the plant never had to mount costs nothing.** The abscisic acid cascade that closes stomata is triggered when the roots detect a water deficit. If the substrate is rewetted before that threshold is crossed, the cascade does not fire — not because it was suppressed, but because the condition that would have triggered it never arrived. The carbon that would have been lost to hours of closed stomata is simply still there. The system did not edit the plant's physiology. It edited the plant's *environment*, early enough that the physiology had nothing to answer.

**A cheaper response can be substituted for an expensive one.** Plants that are *primed* — warned that an attack is likely — mount a faster, stronger defence when it comes, and carry far less of the cost in the meantime. Measured in Arabidopsis, activating defence directly cost [39–44% of relative growth rate; priming cost at most 27%](https://pubmed.ncbi.nlm.nih.gov/16565218/). In nature that warning arrives as volatile compounds drifting a few dozen centimetres downwind, if the wind happens to be going the right way. In a [colony](/guide/colony/), it arrives as a message, at the speed of the link, to every plant in the room. Same biology, better postman.

**And uncertainty is itself a cost.** An organism that cannot predict its environment must hedge: hold defences up, close early, grow conservatively. Hedging is expensive and it is paid whether or not the threat appears. Information is what removes the need to hedge — which is the honest, thermodynamic version of what a computer contributes here. It does not give the plant energy. It gives it *reasons not to spend some*.

### The channel runs both ways, and that is what makes it symbiosis

A relationship where one side only listens is instrumentation. Two things here make it bidirectional, and both are physical rather than rhetorical.

**Reading.** The electrode does not interpret behaviour from the outside; it records the plant's own long-distance signalling, the same voltages the plant is using to talk to itself. The system is listening on the organism's existing bus.

**Writing.** [Spectral interrogation](/guide/plant/spectral) puts a controlled pulse of blue, red or green light on a leaf and reads the electrical and stomatal answer. Blue light drives stomatal opening through a known photoreceptor pathway; a well-hydrated leaf answers it differently from a water-stressed one. **That is a question, asked in a language the plant already responds to, with an answer that comes back down the same wire.** No monitor can do that, because a monitor has nothing to say.

The join, then, is not a computer watching a plant. It is two systems with complementary failure modes wired into one loop: the plant supplies interior state that no model can invent, and the machine supplies memory, prediction and reach that no plant can grow.

### Why this is a new organism rather than a well-tended one

Three faculties in the pairing belong to neither half, which is the usual test for whether a symbiosis has produced something new:

- **Perception beyond the body.** A plant cannot know what the far side of the room is doing, that a cold front arrives tonight, or what its neighbour is experiencing. The pairing can. That is not better care; it is a larger sensory field than the organism has.
- **Memory that can be compared.** Plants do retain stress experience, but they cannot hold *this March* next to *last March* and notice a difference. The record can, and [what worked before](/guide/care/what-worked) is reused because it worked *here*, on this plant.
- **A history of the pairing itself.** [Co-adaptation](/guide/care/learning) tracks when the system's own refusals turned out to be unnecessary. That record describes neither the plant nor the software: it describes the relationship, and it is the thing that makes the pair get better at being a pair.

Biology has a name for the shape of this. An organism that reliably alters its own environment, and is in turn shaped by the environment it altered, is engaged in niche construction — and when the constructed part becomes reliable enough to be depended on, it stops being scenery and becomes part of the organism's functional anatomy. A beaver's dam. A termite mound's air conditioning. **A plant's silicon.**

### The part that keeps it from being science fiction

Every claim above is an ordinary mechanism stated plainly, and the honest boundary belongs in the same paragraph as the exciting part:

- The plant is not thinking, wanting or deciding. It is signalling and responding, and those words are already remarkable enough without borrowing others.
- Nothing here modifies the plant. No genes, no implants, no interventions in its metabolism. The electrode is taped on and comes off.
- The savings described are savings the *pair* achieves. Measured properly, they show up as growth not lost — not as a plant that has learned to need less.
- And every one of these mechanisms is either measured or refused. If the electrode is not in contact, the system says so and stops concluding things. That refusal is why the rest of this page can be believed.

## The five faculties

| | The plant brings | The machine brings | Together |
| --- | --- | --- | --- |
| 👁 **Perception** | Electrical signals, canopy temperature, visible symptoms | Probes, an electrode, a camera, an LED that asks questions | [Sensors](/guide/core/sensors) · [Electrophysiology](/guide/plant/electrophysiology) · [Spectral](/guide/plant/spectral) |
| 💾 **Memory** | The episodes themselves — a drought, a move, a pest | A record that survives a restart and can be compared | [Memory](/guide/core/memory) · [What worked last time](/guide/care/what-worked) |
| 🧠 **Reasoning** | Physiology no model can invent | Symbolic inference, an ontology, a language model | [Knowledge & reasoning](/guide/extra/knowledge) · [Internal states](/guide/plant/states) |
| 🗣 **Voice** | Something worth saying | The words, in eleven languages | [Voice](/guide/core/voice) · [Dashboard](/guide/ecosystem/dashboard) |
| 🦿 **Action** | The need | A pump, a lamp, a fan, sometimes wheels | [Symbiosis](/guide/body/) · [Safety](/guide/body/safety) |

## What makes it a symbiont rather than a monitor

A monitor observes something and reports on it. The relationship is one-way, the instrument is outside the thing it watches, and nothing about the observer changes.

Four properties in this library are only meaningful if the join is real:

**The plant is interrogated, not just watched.** [Spectral](/guide/plant/spectral) puts a blue pulse on a leaf and reads the electrical answer — a question and a reply, which is a conversation and not a measurement. A monitor cannot ask anything.

**The pairing has a history of its own.** [Co-adaptation](/guide/care/learning) records when the system's own refusals turned out to be unnecessary, so it can be wrong *about itself* and find out. That record belongs to neither half: it is about how these two have got on.

**The machine's authority is derived, not assumed.** Every conclusion carries the readings that produced it, a low-confidence estimate loses the right to change anything, and the [gate](/guide/care/learning) sits between wanting to act and acting. The plant is not a device being operated.

**And the plant can be moved without being handled.** With a [body](/guide/body/), the organism relocates itself toward better light — the plant supplying the reason and the machine the legs, under limits no model can talk past.

## The refusal that holds it together

A hybrid organism is an easy thing to claim and a hard thing to mean. What keeps this one honest is a single rule applied everywhere:

> **Nothing is inferred from data that is not there.**

A missing sensor blocks a conclusion instead of being replaced by a default. An absent signal is reported as absent rather than as low. Every refusal names both the reason and the instrument that would lift it.

Without that rule, the "shared perception" of a cyborgplant is a machine narrating a plant it cannot actually see — which is the failure mode this whole library is arranged against, and the reason [System diagnosis](/guide/checks/diagnosis) ends every red line in something a person can go and do.

## What it is not

- **Not a plant monitor.** Those exist, they are cheaper, and they do a different thing.
- **Not a chatbot speaking *for* a plant.** The [voice](/guide/core/voice) says what the readings support and refuses the rest; with no AI configured at all it still speaks, offline, from the numbers.
- **Not a claim about plant consciousness.** Nothing here asserts that a plant feels, wants or intends. The [internal states](/guide/plant/states) are qualitative estimates of *physiological* state, each one built from a measured signal and carrying the evidence that raised it.
- **Not finished by adding hardware.** A plant with every sensor attached and no record of what happened is still just a monitor. The memory and the history are what make the join an organism rather than a wiring diagram.

## The evidence

None of the mechanisms on this page were invented here. Every one of them is established plant physiology, published in the ordinary way and reproduced by other groups. What this library does is wire them together — so it is fair to ask which paper stands behind which claim.

**Plants signal electrically over long distances.**
Fromm J & Lautner S (2007). *Electrical signals and their physiological significance in plants.* **Plant, Cell & Environment** 30(3), 249–257. → [doi:10.1111/j.1365-3040.2006.01614.x](https://doi.org/10.1111/j.1365-3040.2006.01614.x) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/17263772/)
The review the propagation speeds on this page come from: action potentials at roughly 0.5–20 cm/s, variation potentials at 0.5–5 mm/s. It is the basis for [reading the electrome](/guide/plant/electrome) with an electrode at all.

**A wound in one leaf is announced to leaves that have not been touched.**
Mousavi SAR, Chauvin A, Pascaud F, Kellenberger S & Farmer EE (2013). *GLUTAMATE RECEPTOR-LIKE genes mediate leaf-to-leaf wound signalling.* **Nature** 500, 422–426. → [doi:10.1038/nature12478](https://doi.org/10.1038/nature12478) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/23969459/)
Genes related to those behind synaptic activity in animals carry a wound signal from organ to organ, and mutants lacking them lose the surface potential change *and* the distal defence response. The electrical event and the physiological consequence are the same phenomenon — which is the premise of [defence activation](/guide/plant/states).

**And the systemic alarm travels in minutes, visibly.**
Toyota M, Spencer D, Sawai-Toyota S, Jiaqi W, Zhang T, Koo AJ, Howe GA & Gilroy S (2018). *Glutamate triggers long-distance, calcium-based plant defense signaling.* **Science** 361(6407), 1112–1115. → [doi:10.1126/science.aat7744](https://doi.org/10.1126/science.aat7744)
Filmed with a calcium biosensor: glutamate released at the wound sets off a calcium wave through the vasculature, and a distant leaf begins anticipatory defence within minutes. This is what "the plant tells itself" looks like when you can watch it.

**Being warned is much cheaper than being defended.**
van Hulten M, Pelser M, van Loon LC, Pieterse CMJ & Ton J (2006). *Costs and benefits of priming for defense in Arabidopsis.* **PNAS** 103(14), 5602–5607. → [doi:10.1073/pnas.0510213103](https://doi.org/10.1073/pnas.0510213103) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/16565218/)
The numbers behind the central economic claim on this page: directly activating defence cost 39–44% of relative growth rate, priming at most 27%. This is why [security priming](/guide/colony/priming) is worth carrying between plants and full defence is not something to trigger casually.

**Plants already warn each other — slowly, and only downwind.**
Heil M & Karban R (2010). *Explaining evolution of plant communication by airborne signals.* **Trends in Ecology & Evolution** 25(3), 137–144. → [doi:10.1016/j.tree.2009.09.010](https://doi.org/10.1016/j.tree.2009.09.010) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/19837476/)
Volatile signalling between plants is real and documented. Its limits — distance, wind direction, dilution — are exactly what a [colony](/guide/colony/) replaces, without inventing a channel that does not already exist biologically.

**Blue light is a question a leaf answers through a known receptor.**
Kinoshita T, Doi M, Suetsugu N, Kagawa T, Wada M & Shimazaki K (2001). *phot1 and phot2 mediate blue light regulation of stomatal opening.* **Nature** 414, 656–660. → [doi:10.1038/414656a](https://doi.org/10.1038/414656a)
Phototropins drive stomatal opening via H⁺-ATPase activation, and a double mutant stops responding to blue entirely. [Spectral interrogation](/guide/plant/spectral) is built on this pathway: the probe is not shining a light and hoping — it is addressing a receptor whose response is characterised.

**Canopy temperature is a usable proxy for what stomata are doing.**
Leinonen I, Grant OM, Tagliavia CPP, Chaves MM & Jones HG (2006). *Estimating stomatal conductance with thermal imagery.* **Plant, Cell & Environment** 29(8), 1508–1518. → [doi:10.1111/j.1365-3040.2006.01528.x](https://doi.org/10.1111/j.1365-3040.2006.01528.x)
The basis of the [thermal camera](/guide/plant/thermal), including the reason this library refuses to publish an absolute leaf temperature: the method rests on *differences* against reference surfaces, not on the sensor knowing how warm anything is.

::: tip Where the papers end and this library begins
These establish the mechanisms. They do not evaluate SmartPlant, which is a young open-source project and has never been through peer review. The honest split: **the physiology is well supported, the engineering on top of it is ours and is only as good as its tests** — which is why [What has and has not touched hardware](/guide/checks/hardware-truth) exists and says plainly which parts have only ever met a mock.
:::

## Where to go next

- [What is SmartPlant?](/guide/) — the twenty-three layers, and how to install it
- [Internal states](/guide/plant/states) — the clearest case of the join: what the plant is *doing*, not what surrounds it
- [Symbiosis](/guide/body/) — what happens when the organism gets a body
- [Colony](/guide/colony/) — more than one cyborgplant, and a channel a person can watch but never enter
