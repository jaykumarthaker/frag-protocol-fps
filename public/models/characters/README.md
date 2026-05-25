# Character models

This folder ships a four-character roster — **George**, **Leela**, **Mike** and
**Stan** — alongside the bundled `RobotExpressive` fallback. Each is a rigged
humanoid `.gltf` with the standard `Idle` / `Running` / `Jump` / `Death`
animation clips, so they plug into the character-select screen with no
per-model code.

The registry in [`src/core/Models.ts`](../../../src/core/Models.ts) curates
the in-game roster. To add or remove characters
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
