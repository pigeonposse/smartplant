# Federated learning

```js
import { computeLocalUpdate, FederatedRegistry, applyProfile } from 'smartplant/federated'

registry.submit( computeLocalUpdate( plant ) )   // statistics only, never readings
registry.profile( 'Monstera deliciosa' )         // published once 3+ contributors exist
```

The useful thing to learn across many plants is what a species actually wants — the ranges that produced *healthy* plants, not what a model guessed once. But sensor histories reveal when a home is occupied, and nobody should have to upload them.

So only **percentile summaries and a sample count** leave the device, aggregated by weighted averaging (FedAvg). Raw histories never move. The registry **rejects any update carrying them**, and a test asserts it.

Community profiles are **blended** into local ranges, not substituted for them: an average is evidence, not authority, and a plant in an unusual spot should not be dragged to the mean.

---
