import * as THREE from 'three';
import { Arena } from './Arena';

/**
 * "The Atrium" — a UT2003-Citadel-inspired sky arena.
 *
 * The map is a chain of platforms suspended over the void. There is NO outer
 * floor: anything off the geometry is a fall to your death (Actor.ts kills any
 * actor whose feet drop below y = -25).
 *
 * Layout:
 *   - CENTRAL CITADEL  a tall stone spire at the origin with a top platform.
 *   - CENTRAL ISLAND   a square deck wrapping the spire base, the contested
 *                      mid where the bridges meet.
 *   - TWO TEAM BASES   mirrored north / south. Each base is a wide deck with
 *                      TWO tall team-coloured towers at its back corners
 *                      (blue south, orange north) glowing as landmarks.
 *   - MAIN BRIDGE      central walkway base → island → other base.
 *   - FLANK BRIDGES    two narrower side walkways with a small platform at the
 *                      midpoint — riskier, more exposed to falls.
 *   - SKY PLATFORMS    four small floating decks at y ~ 22 ringed around the
 *                      citadel. Reachable only by jump pad, falling = death.
 *   - SPIRE TOP        the highest reward platform (amp). Reached by a
 *                      central jump pad off the island.
 *
 * Even though deathmatch isn't team-based, the two bases are painted blue
 * and orange (matching TEAM_COLORS) so the spires read as opposing citadels
 * from across the map.
 */
export class AtriumArena extends Arena {
  override build() {
    this.makeMaterials();
    this.scene.add(this.root);

    // ---- colour constants for the team-flavoured base landmarks ----------
    const BLUE = 0x36e0ff;
    const ORANGE = 0xff7a18;

    // Skybox is the deep-space starfield set up by Game.ts — we don't touch
    // it, so the void below the platforms reads as bottomless space.

    // =====================================================================
    //  CENTRAL CITADEL  (origin)
    // =====================================================================
    // A solid square spire from y=-6 up to y=22, topped by a wider deck at
    // y=22..23.5 with a parapet, and a small crown finial at y=23.5..27.
    const SPIRE_HALF = 8;        // 16x16 footprint
    const SPIRE_TOP_Y = 22;
    // Trunk (slightly buried so its base hides into the island deck).
    this.box(0, (SPIRE_TOP_Y - 6) / 2, 0,
      SPIRE_HALF * 2, SPIRE_TOP_Y + 6, SPIRE_HALF * 2, this.matWall);
    // Top deck — wider than the trunk so its underside reads as a crown.
    const CROWN_HALF = 11;
    this.box(0, SPIRE_TOP_Y + 0.6, 0,
      CROWN_HALF * 2, 1.2, CROWN_HALF * 2, this.matStruct);
    // Parapet around the top deck
    const cp = (cx: number, cz: number, sx: number, sz: number) =>
      this.box(cx, SPIRE_TOP_Y + 1.9, cz, sx, 1.4, sz, this.matStruct);
    cp(0,  CROWN_HALF, CROWN_HALF * 2, 0.6);
    cp(0, -CROWN_HALF, CROWN_HALF * 2, 0.6);
    cp( CROWN_HALF, 0, 0.6, CROWN_HALF * 2);
    cp(-CROWN_HALF, 0, 0.6, CROWN_HALF * 2);
    // Glowing crown finial — a thin pillar above the deck, neutral colour.
    const finialMat = new THREE.MeshStandardMaterial({
      color: 0xffd23f, emissive: 0xffd23f, emissiveIntensity: 2.0, roughness: 0.4,
    });
    const finial = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 3.5, 12), finialMat);
    finial.position.set(0, SPIRE_TOP_Y + 4.0, 0);
    this.root.add(finial);
    const finialLight = new THREE.PointLight(0xffd23f, 18, 60);
    finialLight.position.set(0, SPIRE_TOP_Y + 4.0, 0);
    this.root.add(finialLight);

    // =====================================================================
    //  CENTRAL ISLAND  (square deck around the spire base)
    // =====================================================================
    const ISLAND_HALF = 22;     // 44x44 deck
    // Build the deck as four strips around the spire so the spire trunk pokes
    // through (no hidden geometry inside the trunk).
    const T = 1.6;              // deck thickness
    const ISLAND_Y = -T / 2;
    // North / South strips
    const stripZ = (ISLAND_HALF + SPIRE_HALF) / 2;
    const stripD = ISLAND_HALF - SPIRE_HALF;
    this.box(0, ISLAND_Y,  stripZ, ISLAND_HALF * 2, T, stripD, this.matFloor);
    this.box(0, ISLAND_Y, -stripZ, ISLAND_HALF * 2, T, stripD, this.matFloor);
    // East / West strips
    this.box( stripZ, ISLAND_Y, 0, stripD, T, SPIRE_HALF * 2, this.matFloor);
    this.box(-stripZ, ISLAND_Y, 0, stripD, T, SPIRE_HALF * 2, this.matFloor);
    // Edge trim so the island reads as a defined platform over the void.
    this.trimRing(0, 0.06, 0, ISLAND_HALF, 0xffd23f);

    // =====================================================================
    //  TEAM BASES  (south = BLUE, north = ORANGE)
    // =====================================================================
    const BASE_Z = 90;          // base centre |z|
    const BASE_HX = 26;         // half-width (x)
    const BASE_HZ = 18;         // half-depth (z)

    const buildBase = (sign: 1 | -1, color: number) => {
      const cz = sign * BASE_Z;

      // Main base deck
      this.box(0, ISLAND_Y, cz, BASE_HX * 2, T, BASE_HZ * 2, this.matFloor);
      this.trimRing(0, 0.06, cz, Math.min(BASE_HX, BASE_HZ) - 0.5, color);

      // Back wall (the wall behind the spawn line) — gives respawning players
      // a backstop and reads as the team's keep.
      this.box(0, 4.5, cz + sign * (BASE_HZ - 0.6), BASE_HX * 2, 9, 1.2, this.matWall);

      // ---- TWO team-coloured towers at the back corners ---------------
      const towerMat = new THREE.MeshStandardMaterial({
        color: 0x1a1f2a, emissive: color, emissiveIntensity: 0.35, roughness: 0.55, metalness: 0.6,
      });
      const stripeMat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 1.8, roughness: 0.4,
      });
      const TOWER_H = 30;
      const TOWER_HALF = 2.4;          // 4.8 footprint
      const towerXs: number[] = [-BASE_HX + 3.6, BASE_HX - 3.6];
      for (const tx of towerXs) {
        const tz = cz + sign * (BASE_HZ - 3.2);
        // Trunk
        const trunk = new THREE.Mesh(
          new THREE.BoxGeometry(TOWER_HALF * 2, TOWER_H, TOWER_HALF * 2), towerMat,
        );
        trunk.position.set(tx, TOWER_H / 2, tz);
        trunk.castShadow = true; trunk.receiveShadow = true;
        this.root.add(trunk);
        this.colliders.push(this.physics.addStaticBox(
          tx, TOWER_H / 2, tz, TOWER_HALF, TOWER_H / 2, TOWER_HALF,
        ));
        // Glowing vertical stripe on the inward face — visible from mid.
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(1.4, TOWER_H - 4, 0.15), stripeMat,
        );
        stripe.position.set(tx, TOWER_H / 2, tz - sign * (TOWER_HALF + 0.08));
        this.root.add(stripe);
        // Cap a glowing crystal/brazier at the top.
        const cap = new THREE.Mesh(
          new THREE.OctahedronGeometry(1.4, 0), stripeMat,
        );
        cap.position.set(tx, TOWER_H + 1.4, tz);
        this.root.add(cap);
        const capLight = new THREE.PointLight(color, 14, 48);
        capLight.position.set(tx, TOWER_H + 2.0, tz);
        this.root.add(capLight);
      }

      // Two short side walls on the back-corners so the base feels enclosed
      // toward the rear, leaving the front open onto the bridges.
      this.box(-BASE_HX + 0.6, 3.0, cz + sign * (BASE_HZ - 6),
        1.2, 6, 8, this.matWall);
      this.box( BASE_HX - 0.6, 3.0, cz + sign * (BASE_HZ - 6),
        1.2, 6, 8, this.matWall);

      // A bit of cover on the front of the base (low crates)
      this.box(-10, 1.2, cz - sign * (BASE_HZ - 6), 3.6, 2.4, 3.6, this.matStruct);
      this.box( 10, 1.2, cz - sign * (BASE_HZ - 6), 3.6, 2.4, 3.6, this.matStruct);

      // Spawn line along the back of the base (under the towers)
      const spawnZ = cz + sign * (BASE_HZ - 8);
      for (const sx of [-16, -6, 6, 16]) {
        this.spawnPoints.push(new THREE.Vector3(sx, 0.05, spawnZ));
      }
    };
    buildBase(-1, BLUE);
    buildBase( 1, ORANGE);

    // =====================================================================
    //  MAIN BRIDGES  (central walkway, each side, base → island)
    // =====================================================================
    const MAIN_W = 10;
    const mainSpan = BASE_Z - BASE_HZ - ISLAND_HALF; // gap between base front and island edge
    const mainCZ = (BASE_Z - BASE_HZ + ISLAND_HALF) / 2; // already accounts for sign
    // South (blue) bridge
    this.box(0, ISLAND_Y, -mainCZ, MAIN_W, T, mainSpan, this.matStruct);
    // North (orange) bridge
    this.box(0, ISLAND_Y,  mainCZ, MAIN_W, T, mainSpan, this.matStruct);
    // Bridge parapets so the walkway reads as a defined path over the void.
    const parH = 0.9;
    const bp = (cx: number, cz: number, sx: number, sz: number) =>
      this.box(cx, parH / 2 + 0.05, cz, sx, parH, sz, this.matStruct);
    bp( MAIN_W / 2 + 0.2, -mainCZ, 0.4, mainSpan);
    bp(-(MAIN_W / 2 + 0.2), -mainCZ, 0.4, mainSpan);
    bp( MAIN_W / 2 + 0.2,  mainCZ, 0.4, mainSpan);
    bp(-(MAIN_W / 2 + 0.2),  mainCZ, 0.4, mainSpan);

    // =====================================================================
    //  FLANK ROUTES  (two side bridges with a small mid platform)
    // =====================================================================
    const FLANK_X = 40;          // |x| of the flank platforms
    const FLANK_W = 6;
    const FLANK_LEN = 18;        // each segment length
    // Mid flank platforms on east + west (over the void, between bases)
    this.box( FLANK_X, ISLAND_Y, 0, 14, T, 14, this.matStruct);
    this.box(-FLANK_X, ISLAND_Y, 0, 14, T, 14, this.matStruct);
    this.trimRing( FLANK_X, 0.06, 0, 6.5, 0xffd23f);
    this.trimRing(-FLANK_X, 0.06, 0, 6.5, 0xffd23f);

    // Connecting strips from each flank platform to each base + the island.
    // South leg → BLUE base front corner
    const flankSeg = (sx: number, cz: number) => {
      // segment from flank platform (sx, 0) toward base (sx_clamped, cz)
      // We use a straight diagonal strip approximated by an axis-aligned box
      // chain: one along Z heading toward the base, then a short cross strip
      // to meet the base front corner.
      const half = 7; // flank platform half
      // Z-strip from flank platform edge to base front Z
      const zStart = Math.sign(cz) * half;
      const zEnd = cz - Math.sign(cz) * BASE_HZ;
      const zMid = (zStart + zEnd) / 2;
      const zLen = Math.abs(zEnd - zStart);
      this.box(sx, ISLAND_Y, zMid, FLANK_W, T, zLen, this.matStruct);
      bp(sx + FLANK_W / 2 + 0.2, zMid, 0.4, zLen);
      bp(sx - FLANK_W / 2 - 0.2, zMid, 0.4, zLen);
      // Cross strip from flank x to base edge x at the base front
      const xEnd = Math.sign(-sx) * (BASE_HX - 3); // bring flank into base
      const xMid = (sx + xEnd) / 2;
      const xLen = Math.abs(xEnd - sx);
      // Sit the cross strip just outside the base front so it joins the
      // flank Z-strip to the base front corner without z-fighting the deck.
      const crossZ = cz - Math.sign(cz) * (BASE_HZ + FLANK_W / 2 - 1);
      this.box(xMid, ISLAND_Y, crossZ, xLen, T, FLANK_W, this.matStruct);
    };
    flankSeg( FLANK_X, -BASE_Z); flankSeg(-FLANK_X, -BASE_Z);
    flankSeg( FLANK_X,  BASE_Z); flankSeg(-FLANK_X,  BASE_Z);

    // Short cross strip connecting each flank platform inward to the central
    // island so the flank route is also a path to mid.
    const flankToIsland = (sx: number) => {
      // Flank platform's inner edge sits at sx - sign(sx)*7; island outer
      // edge sits at sign(sx)*ISLAND_HALF. Strip bridges the gap between.
      const start = sx - Math.sign(sx) * 7;
      const end = Math.sign(sx) * (ISLAND_HALF - 0.5);
      const mid = (start + end) / 2; const len = Math.abs(end - start);
      this.box(mid, ISLAND_Y, 0, len, T, FLANK_W, this.matStruct);
    };
    flankToIsland( FLANK_X);
    flankToIsland(-FLANK_X);

    // =====================================================================
    //  SKY PLATFORMS  (four floating decks at y=22, jump-pad only)
    // =====================================================================
    const SKY_Y = 22;
    const SKY_R = 28;          // distance from spire centre
    const skyPlats: [number, number][] = [
      [ SKY_R, 0], [-SKY_R, 0], [0,  SKY_R], [0, -SKY_R],
    ];
    for (const [sx, sz] of skyPlats) {
      this.box(sx, SKY_Y, sz, 9, 0.8, 9, this.matStruct);
      this.trimRing(sx, SKY_Y + 0.5, sz, 4.2, 0x36e0ff);
      // Thin railing on the outer edges so the sky platform reads as a deck.
      const railH = 0.7;
      const railY = SKY_Y + 0.45 + railH / 2;
      this.box(sx, railY, sz + 4.4, 9, railH, 0.25, this.matStruct);
      this.box(sx, railY, sz - 4.4, 9, railH, 0.25, this.matStruct);
      this.box(sx + 4.4, railY, sz, 0.25, railH, 9, this.matStruct);
      this.box(sx - 4.4, railY, sz, 0.25, railH, 9, this.matStruct);
    }

    // =====================================================================
    //  JUMP PADS
    // =====================================================================
    // With GRAVITY=60: apex height above launch = vy^2 / 120.
    //   vy=55 → ~25m  (reach sky platforms at y=22)
    //   vy=62 → ~32m  (reach spire top at y=28 with margin)
    // Pads launch from floor (y≈0).

    // Two pads per base, near the front, launching onto the side sky platforms
    const SKY_VY = 55;
    // BLUE base → east/west sky platforms (we bias the lateral travel toward
    // the nearer sky deck so the landing is comfortable, not pixel-perfect).
    this.addJumpPad(new THREE.Vector3( 18, 0, -BASE_Z + 4),
      new THREE.Vector3(  6, SKY_VY,  16));   // toward (SKY_R, 0) bias
    this.addJumpPad(new THREE.Vector3(-18, 0, -BASE_Z + 4),
      new THREE.Vector3( -6, SKY_VY,  16));
    // ORANGE base
    this.addJumpPad(new THREE.Vector3( 18, 0,  BASE_Z - 4),
      new THREE.Vector3(  6, SKY_VY, -16));
    this.addJumpPad(new THREE.Vector3(-18, 0,  BASE_Z - 4),
      new THREE.Vector3( -6, SKY_VY, -16));

    // Central spire-top pad on the island, just south of the spire.
    this.addJumpPad(new THREE.Vector3(0, 0, ISLAND_HALF - 4),
      new THREE.Vector3(0, 62, -10));        // long arc up and forward to crown

    // Flank-platform pads — short hops to the nearest sky deck (boost vert).
    this.addJumpPad(new THREE.Vector3( FLANK_X - 4, 0, 0),
      new THREE.Vector3(-10, SKY_VY, 0));
    this.addJumpPad(new THREE.Vector3(-FLANK_X + 4, 0, 0),
      new THREE.Vector3( 10, SKY_VY, 0));

    // =====================================================================
    //  PICKUPS
    // =====================================================================
    // Top-of-spire = highest reward: amp + mega health (both at the crown).
    this.pickupSpawns.push({ type: 'amp', pos: new THREE.Vector3(0, SPIRE_TOP_Y + 2.0, 0) });
    // A mega-health on one sky platform — the high-risk pickup.
    this.pickupSpawns.push({ type: 'health_mega', pos: new THREE.Vector3(0, SKY_Y + 1.2, -SKY_R) });
    // Armour on the flank platforms (one each side)
    this.pickupSpawns.push({ type: 'armor', pos: new THREE.Vector3( FLANK_X, 1.2, 0) });
    this.pickupSpawns.push({ type: 'armor', pos: new THREE.Vector3(-FLANK_X, 1.2, 0) });
    // Health near each base front + on the flank platforms
    for (const [x, z] of [
      [10, -BASE_Z + 6], [-10, -BASE_Z + 6],
      [10,  BASE_Z - 6], [-10,  BASE_Z - 6],
      [ FLANK_X, 5], [-FLANK_X, -5],
    ] as [number, number][]) {
      this.pickupSpawns.push({ type: 'health', pos: new THREE.Vector3(x, 1.2, z) });
    }
    // Ammo: bridge ends + sky platforms + island corners
    for (const [x, z] of [
      [0, -ISLAND_HALF - 4], [0,  ISLAND_HALF + 4],
      [ ISLAND_HALF + 4, 0], [-ISLAND_HALF - 4, 0],
      [ SKY_R, 0], [-SKY_R, 0],
    ] as [number, number][]) {
      const y = (Math.abs(x) === SKY_R) ? SKY_Y + 1.2 : 1.2;
      this.pickupSpawns.push({ type: 'ammo', pos: new THREE.Vector3(x, y, z) });
    }

    // A few extra spawn points up on the sky platforms so respawns can
    // sometimes drop in from high ground.
    this.spawnPoints.push(new THREE.Vector3( SKY_R, SKY_Y + 0.6, 0));
    this.spawnPoints.push(new THREE.Vector3(-SKY_R, SKY_Y + 0.6, 0));

    this.physics.step();
    this.buildAtriumWaypoints(SPIRE_TOP_Y, SKY_Y, ISLAND_HALF, BASE_Z, BASE_HX, BASE_HZ, FLANK_X, SKY_R);
  }

  /**
   * Nav graph for the sky-arena layout. Bots travel:
   *   spawn → base front → main bridge → island → spire ramps (via jump pad)
   * and along the flank bridges. Jump-pad apex nodes give the pathing a hint
   * of where to land so they don't try to walk into the void.
   */
  private buildAtriumWaypoints(
    spireTopY: number, skyY: number, islandHalf: number,
    baseZ: number, baseHX: number, baseHZ: number, flankX: number, skyR: number,
  ) {
    const W = (x: number, y: number, z: number) =>
      this.waypoints.push(new THREE.Vector3(x, y, z));

    // Per-base ring (back spawn line + front of base + base side walls)
    for (const sign of [-1, 1] as const) {
      const cz = sign * baseZ;
      W(0, 0, cz + sign * (baseHZ - 8));      // spawn centre
      W(-16, 0, cz + sign * (baseHZ - 8));
      W( 16, 0, cz + sign * (baseHZ - 8));
      W(0, 0, cz - sign * (baseHZ - 2));      // base front (onto bridge)
      W(-baseHX + 4, 0, cz - sign * (baseHZ - 2)); // base front corner W
      W( baseHX - 4, 0, cz - sign * (baseHZ - 2)); // base front corner E
    }

    // Main bridge midpoints
    W(0, 0, -(baseZ - baseHZ + islandHalf) / 2);
    W(0, 0,  (baseZ - baseHZ + islandHalf) / 2);
    // Island ring
    const RI = islandHalf - 3;
    for (const [x, z] of [
      [0, -RI], [0, RI], [RI, 0], [-RI, 0],
      [RI - 3, RI - 3], [-(RI - 3), RI - 3], [RI - 3, -(RI - 3)], [-(RI - 3), -(RI - 3)],
    ] as [number, number][]) W(x, 0, z);

    // Flank platforms + flank-to-base mids
    W( flankX, 0, 0); W(-flankX, 0, 0);
    for (const sign of [-1, 1] as const) {
      W( flankX, 0, sign * (baseZ - baseHZ - 6));
      W(-flankX, 0, sign * (baseZ - baseHZ - 6));
    }
    // Flank to island connectors
    W( flankX / 2, 0, 0); W(-flankX / 2, 0, 0);

    // Sky platforms (jump-pad apex hints)
    W( skyR, skyY + 0.6, 0); W(-skyR, skyY + 0.6, 0);
    W(0, skyY + 0.6,  skyR); W(0, skyY + 0.6, -skyR);

    // Spire top — the crown deck
    W(0, spireTopY + 1.0, 0);
    W(6, spireTopY + 1.0, 0); W(-6, spireTopY + 1.0, 0);

    this.linkWaypoints(26);
  }
}
