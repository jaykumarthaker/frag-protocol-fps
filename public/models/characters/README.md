# Character models

This folder ships with the **Quaternius Modular Characters** pack (CC0 / public
domain) — https://quaternius.com/packs/modularcharacters.html. ~50 stylized
humanoids share one rig and one animation set, so they all plug into the
character-select screen with no per-model code.

The registry in [`src/core/Models.ts`](../../../src/core/Models.ts) curates a
subset (~28 characters) for the in-game roster. To add or remove characters
from the **Choose Your Fighter** screen:

1. Add a `CharacterDef` entry to `CHARACTERS` in `src/core/Models.ts` pointing
   at the `.gltf` filename.
2. Add the matching id to `CHARACTER_IDS` in
   [`server/room.mjs`](../../../server/room.mjs) (otherwise the server will
   reject the pick for online play).

## Other sources

Any rigged humanoid `.gltf`/`.glb` will work as long as it ships clips named
(or aliased to) `Idle`, `Running`/`Run`/`Walk`, `Jump`, and `Death`/`Die`.
The right-hand bone finder also accepts `Fist.R` (Quaternius), `Hand_R`
(Mixamo), `RightHand`, etc.
