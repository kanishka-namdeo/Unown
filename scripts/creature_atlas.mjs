/**
 * creature_atlas.mjs — the ten feature creatures, composed.
 *
 * One drawing per agent feature, in the order the capability dex numbers
 * them (001-010). Every composition uses the shared kit (creature_kit.mjs):
 * the standing chibi for silhouette+plate+face+feet, then the feature's ONE
 * prop — a magnifier, three sockets, an orb, a monocle, a drawer, a
 * stopwatch, a clock, a cloud, a shield, a badge. One idea per sprite: at
 * 64px a second prop is noise (the v1 sprites died of it).
 *
 * Every prop is part of the feature's story, not decoration:
 *   websearch — the magnifier (and dish ears: everything is a receiver)
 *   mcp       — three sockets: tools plug into the creature
 *   task      — one glowing orb carried overhead
 *   lsp       — the monocle: it reads your code closely
 *   memory    — the filing drawer, one card slipping out
 *   harness   — the stopwatch: it times everything
 *   router    — the clock belly + courier cap: on dispatch
 *   dream     — asleep on a cloud, one star, three z's
 *   hooks     — the shield it stands behind
 *   sdlc      — the badger's vest, one badge earned
 *
 * IP note: original silhouettes throughout — generic creature-collector
 * vocabulary only; no species names, no capture iconography, no named
 * artists. Warm-gold round bodies with pointed ears remain banned (the
 * generator attractor, v1; here it cannot recur — nothing is generated).
 */
import {
  chibi, face, feet, arms, glint, paint, px, shade, stamp, rim, union, minus,
  inEllipse, inRoundRect, inTri,
  STAR, Z_BIG, Z_MID, Z_SML, MAGNIFIER, STOPWATCH,
} from "./creature_kit.mjs";

export const SPRITES = [

/* 001 — websearch: the aqua receiver-bird, magnifier up ************** */
{
  id: "websearch",
  meta: { standing: true, symmetric: false },
  draw(c) {
    const dishes = union(inEllipse(23, 10, 4, 3.5), inEllipse(40, 10, 4, 3.5));
    chibi(c, {
      hy: 20, hrx: 15, hry: 11,          // head rows 9..31
      by: 39, bw: 28, bh: 18,            // body rows 30..48
      extra: dishes,                     // dish ears join the silhouette
      ramp: { base: "A2", light: "A3", shadow: "A1" },
      face: {},                          // beak replaces mouth; no cheeks
    });
    // dish concavity + the feed dot (2px, so it is a mark, not noise)
    paint(c, inEllipse(23, 10.5, 2.2, 1.6), "A3"); px(c, 23, 10, "G2"); px(c, 23, 11, "G2");
    paint(c, inEllipse(40, 10.5, 2.2, 1.6), "A3"); px(c, 40, 10, "G2"); px(c, 40, 11, "G2");
    // gold beak (the mouth)
    px(c, 30, 27, "G2"); px(c, 31, 27, "G2"); px(c, 32, 27, "G2");
    px(c, 30, 28, "G1"); px(c, 31, 28, "G1"); px(c, 32, 28, "G1");
    // cream belly patch
    paint(c, inEllipse(31.5, 41, 8, 6), "P3");
    paint(c, rim(inEllipse(31.5, 41, 8, 6), 0, -2), "P2");
    glint(c, 26, 12, "A4");
    // wings + the magnifier, held left — cream lens, aqua glint
    arms(c, { base: "A2", shadow: "A1" }, "side");
    stamp(c, 8, 31, MAGNIFIER, { g: "G2", n: "P3", a: "A3" });
    return c;
  },
},

/* 002 — mcp: the leaf toolkit, everything plugs in *******************/
{
  id: "mcp",
  meta: { standing: true, symmetric: true },
  draw(c) {
    chibi(c, {
      hy: 20, hrx: 14, hry: 11,
      by: 39, bw: 27, bh: 18,
      ramp: { base: "L2", light: "L3", shadow: "L1" },
      face: { eyeY: 23, mouth: "smile", cheek: "G2" },
    });
    // plug antennae: navy stems, gold tips, a prong of light
    for (const sx of [26, 37]) {
      for (let y = 7; y <= 10; y++) px(c, sx, y, "N2");
      for (let yy = 5; yy <= 6; yy++) for (let xx = -1; xx <= 1; xx++) px(c, sx + xx, yy, "G2");
      px(c, sx, 4, "G3");
    }
    // the dock: navy frame, cream face, three gold ports — reads as one
    // power strip (three little squares read as specks, rounds 2 and 4)
    paint(c, inRoundRect(31.5, 39, 18, 6, 2), "N2");
    paint(c, inRoundRect(31.5, 39, 14, 4, 1), "P3");
    for (const [ax, bx] of [[26, 27], [31, 32], [36, 37]]) {
      for (let yy = 38; yy <= 39; yy++) for (let xx = ax; xx <= bx; xx++) px(c, xx, yy, "G2");
    }
    glint(c, 24, 12, "L4");
    arms(c, { base: "L2", shadow: "L1" }, "side");
    return c;
  },
},

/* 003 — task: one orb, carried overhead ******************************/
{
  id: "task",
  meta: { standing: true, symmetric: true },
  draw(c) {
    const orb = inEllipse(31.5, 10, 3.5, 3.5); // rows 7..13, rests on the head
    chibi(c, {
      hy: 23, hrx: 12, hry: 9,              // head rows 14..32 — face gets room
      by: 39, bw: 26, bh: 18,
      extra: orb,
      ramp: { base: "C2", light: "C3", shadow: "C1" },
      plateY: 24, plateRx: 9, plateRy: 6.5,
      face: { eyeY: 25, mouthDy: 5, mouth: "smile", cheek: "K2" },
    });
    // the orb: psychic glow, its own tiny ramp
    paint(c, orb, "K2");
    paint(c, rim(orb, 1, 1), "K3");
    paint(c, rim(orb, -1, -1), "K1");
    glint(c, 30, 8, "K4");
    glint(c, 25, 16, "C3");
    // a cream belly patch — interior structure, same as the receiver-bird
    paint(c, inEllipse(31.5, 42, 7, 5), "P3");
    paint(c, rim(inEllipse(31.5, 42, 7, 5), 0, -2), "P2");
    // raised presenting arms
    arms(c, { base: "C2", shadow: "C1" }, "raise", { reach: 10.5, y: 19, w: 3, h: 15 });
    return c;
  },
},

/* 004 — lsp: the amber scholar, monocle and chain ********************/
{
  id: "lsp",
  meta: { standing: true, symmetric: false },
  draw(c) {
    chibi(c, {
      hy: 20, hrx: 14, hry: 11,
      by: 39, bw: 26, bh: 18,
      ramp: { base: "B2", light: "B3", shadow: "B1" },
      face: { eyeY: 23, mouthDy: 5, mouth: "smile" },
    });
    // the monocle: a 2px gold ring around the right eye, chained to the body
    const ring = minus(inEllipse(36.5, 24.5, 5, 4.5), inEllipse(36.5, 24.5, 3, 2.8));
    paint(c, ring, "G2");
    for (let i = 0; i < 4; i++) { px(c, 40 + i, 28 + i, "G2"); px(c, 41 + i, 28 + i, "G2"); }
    glint(c, 24, 12, "G4");
    return c;
  },
},

/* 005 — memory: the archivist, drawer belly, one card out ************/
{
  id: "memory",
  meta: { standing: true, symmetric: true },
  draw(c) {
    chibi(c, {
      hy: 19, hrx: 14, hry: 12,            // the big head rows 7..31
      by: 39.5, bw: 26, bh: 17,
      extra: inEllipse(31.5, 8, 3.5, 3),   // folio crest
      ramp: { base: "C2", light: "C3", shadow: "C1" },
      plateY: 20, plateRx: 10, plateRy: 7.5,
      face: { eyeY: 21, mouthDy: 5, mouth: "smile", cheek: "G2" },
    });
    // crest: a gold leaf on top
    px(c, 31, 6, "G2"); px(c, 32, 6, "G2");
    px(c, 31, 7, "G3"); px(c, 32, 7, "G3");
    // the filing drawer: navy frame, CREAM face (the smudge rule again),
    // a shadow row inside, gold handle
    paint(c, inRoundRect(31.5, 39, 16, 11, 2), "N2");
    paint(c, inRoundRect(31.5, 39.5, 14, 9, 2), "P3");
    for (let xx = 26; xx <= 37; xx++) px(c, xx, 35, "N3");
    paint(c, inRoundRect(31.5, 38.5, 4, 2, 1), "G2");
    // a card slipping out of the top
    for (let xx = 27; xx <= 32; xx++) { px(c, xx, 32, "P3"); px(c, xx, 33, "P3"); }
    for (let xx = 28; xx <= 31; xx++) px(c, xx, 34, "P2");
    glint(c, 23, 10, "C3");
    arms(c, { base: "C2", shadow: "C1" }, "side");
    return c;
  },
},

/* 006 — harness: the magma coach, stopwatch up ***********************/
{
  id: "harness",
  meta: { standing: true, symmetric: false },
  draw(c) {
    chibi(c, {
      hy: 20, hrx: 13, hry: 10,
      by: 38.5, bw: 30, bh: 17,            // the stocky one
      ramp: { base: "M2", light: "M3", shadow: "M1" },
      plateY: 21, plateRx: 10, plateRy: 7,
      face: { eyeY: 22, mouthDy: 5, mouth: "open", cheek: "G2" }, // the coach shouts
    });
    // left arm at the side; right arm raised, hand open
    shade(c, inRoundRect(17, 37, 5, 8, 2), { base: "M2", shadow: "M1", shadowD: [-1, -2] });
    shade(c, inRoundRect(46, 30, 3, 10, 1), { base: "M2", shadow: "M1", shadowD: [-1, -1] });
    px(c, 45, 24, "M3"); px(c, 46, 24, "M3"); px(c, 47, 24, "M3");
    px(c, 45, 25, "M3"); px(c, 46, 25, "M3"); px(c, 47, 25, "M3");
    // the gold stopwatch — big and close, where a held thing reads
    stamp(c, 40, 15, STOPWATCH, { g: "G2", h: "G1", p: "P3", o: "O" });
    glint(c, 22, 13, "M4");
    return c;
  },
},

/* 007 — router: the gold courier, clock belly, cap *******************/
{
  id: "router",
  meta: { standing: true, symmetric: true },
  draw(c) {
    chibi(c, {
      hy: 18, hrx: 12, hry: 9,
      by: 37.5, bw: 24, bh: 21,            // the tall one
      ramp: { base: "G2", light: "G3", shadow: "G1" },
      plateY: 19, plateRx: 9, plateRy: 6.5,
      face: { eyeY: 20, mouthDy: 5, mouth: "smile" },
    });
    // courier cap: navy crown + gold band (no wide navy brim — smudge rule)
    paint(c, inRoundRect(31.5, 7.5, 12, 4, 2), "N2");
    for (let xx = 25; xx <= 38; xx++) px(c, xx, 9, "G1");
    // the clock belly: bold navy ring, cream face, hands at dispatch time
    const clock = inEllipse(31.5, 39, 4.8, 4);
    paint(c, minus(inEllipse(31.5, 39, 6.5, 5.5), clock), "N2");
    paint(c, clock, "P3");
    px(c, 31, 36, "O"); px(c, 32, 36, "O");
    px(c, 31, 37, "O"); px(c, 32, 37, "O");
    px(c, 31, 38, "O"); px(c, 32, 38, "O");
    px(c, 33, 39, "O"); px(c, 34, 39, "O");
    px(c, 31, 39, "O"); px(c, 32, 39, "O");
    glint(c, 24, 12, "G4");
    // navy sleeves — clean, matching the cap (the uniform, not an add-on)
    for (const cx of [17, 46]) paint(c, inRoundRect(cx, 36.5, 4, 7, 2), "N2");
    return c;
  },
},

/* 008 — dream: asleep on a cloud, one star, three z's ****************/
{
  id: "dream",
  meta: { standing: false, symmetric: false },
  draw(c) {
    // the cloud — chunky: flat base + bumps, the classic pixel cloud
    // (pure ellipses read soft/modern — round 1 + 2 both flagged it)
    const cloud = union(
      inRoundRect(31.5, 42, 26, 11, 4),
      inEllipse(25, 37, 5, 4),
      inEllipse(38, 37, 5, 4),
    );
    paint(c, cloud, "P3");
    paint(c, rim(cloud, 1, 3), "P4");
    paint(c, rim(cloud, -1, -3), "P2");
    // contact shadow where the sleeper weighs it down
    paint(c, rim(inEllipse(31.5, 29, 13, 9), -1, -3), "P2");
    // the sleeper, pale psychic — tucked-in chunky form, not a soft ball
    shade(c, inRoundRect(31.5, 29, 22, 17, 7), {
      base: "K3", light: "K4", shadow: "K2", lightD: [1, 3], shadowD: [-1, -3],
    });
    face(c, { eyeY: 26, eyeW: 4, closed: true, cheek: "K1", cheekDy: 3, mouthDy: 5, mouth: "smile", mouthW: 5 });
    // a curl, top-right
    px(c, 42, 29, "K2"); px(c, 43, 29, "K2");
    px(c, 43, 28, "K2"); px(c, 44, 28, "K2");
    // one star, then z's climbing to it — big enough to read
    stamp(c, 45, 9, STAR, { g: "G2", W: "W" });
    stamp(c, 41, 24, Z_BIG, { z: "G2" });
    stamp(c, 46, 19, Z_MID, { z: "G2" });
    stamp(c, 50, 15, Z_SML, { z: "G3" });
    return c;
  },
},

/* 009 — hooks: the magma guardian, shield front and center ***********/
{
  id: "hooks",
  meta: { standing: true, symmetric: true },
  draw(c) {
    chibi(c, {
      hy: 20, hrx: 14, hry: 11,
      by: 39, bw: 30, bh: 18,              // the stout one
      ramp: { base: "M2", light: "M3", shadow: "M1" },
      plateY: 21, plateRx: 10, plateRy: 7.5,
      face: { eyeY: 22, mouthDy: 5, mouth: "smile" }, // calm — the shield shouts
    });
    // the shield: gold border, CREAM field (light — the smudge rule),
    // one clean gold boss — no glint; the shield is the focal point.
    const shield = union(inRoundRect(31.5, 40, 15, 12, 3), inTri(24, 40, 39, 40, 31.5, 50));
    const inner = union(inRoundRect(31.5, 40, 13, 10, 2), inTri(25, 39.5, 38, 39.5, 31.5, 48.5));
    paint(c, shield, "G2");
    paint(c, inner, "P3");
    px(c, 31, 39, "G2"); px(c, 32, 39, "G2");
    px(c, 30, 40, "G2"); px(c, 31, 40, "G2"); px(c, 32, 40, "G2"); px(c, 33, 40, "G2");
    px(c, 31, 41, "G2"); px(c, 32, 41, "G2");
    glint(c, 22, 12, "M4");
    // feet set wider, so they peek from behind the shield
    feet(c, { base: "M2", shadow: "M1" }, { gap: 10 });
    return c;
  },
},

/* 010 — sdlc: the cream badger, mask, vest, one badge ****************/
{
  id: "sdlc",
  meta: { standing: true, symmetric: true },
  draw(c) {
    chibi(c, {
      hy: 19, hrx: 13, hry: 11,
      by: 38.5, bw: 26, bh: 18,
      extra: union(inEllipse(23, 10, 3.5, 3.5), inEllipse(40, 10, 3.5, 3.5)), // round ears
      ramp: { base: "C2", light: "C3", shadow: "C1" },
      plateY: 20, plateRx: 10, plateRy: 8,
    });
    // ears' inner shadow
    paint(c, inEllipse(23, 10, 1.8, 1.8), "C1");
    paint(c, inEllipse(40, 10, 1.8, 1.8), "C1");
    // the badger's blaze — a white stripe from brow to nose, between
    // STANDARD eyes. The mask band was flagged in four of five review
    // rounds; the blaze alone is the cleaner badger signifier.
    face(c, { eyeY: 21, mouthDy: 6, mouth: "smile", cheek: "G2" });
    for (let yy = 13; yy <= 26; yy++) { px(c, 31, yy, "W"); px(c, 32, yy, "W"); }
    px(c, 31, 26, "O"); px(c, 32, 26, "O");
    // the vest: GOLD (light!), navy trim, cream V-neck, navy badge
    const vest = inRoundRect(31.5, 39.5, 18, 14, 3);
    paint(c, vest, "G1");
    paint(c, rim(vest, 0, -1), "N3");
    paint(c, inTri(29, 33, 34, 33, 31.5, 39), "P3");
    px(c, 27, 38, "N2");
    px(c, 26, 39, "N2"); px(c, 27, 39, "N2"); px(c, 28, 39, "N2");
    px(c, 27, 40, "N2");
    px(c, 27, 38, "W");                                   // badge glint
    glint(c, 23, 13, "C3");
    return c;
  },
},
];
