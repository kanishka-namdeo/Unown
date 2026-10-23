/**
 * creature_atlas.mjs — the ten feature creatures, v3: one body plan each.
 *
 * THE V3 DOCTRINE (2026-10-20, the variety round): v2 authored every pixel
 * in code but composed every creature from ONE shared plan — the standing
 * chibi (head ellipse + body roundrect + template face + stubby feet),
 * varied by ramp and one prop. Reviewed side by side it read as ten reskins
 * of the same base character: 9/10 identical body plans, variety 3/10 (the
 * VLM variety probe, docs/landing-research.md Part 17). A bestiary is not a
 * palette swap — the collector genre's whole visual trick is that every
 * entry has a different SILHOUETTE: what reads first is the body plan, the
 * prop second, the palette third. So v3 gives each feature its own plan:
 *
 *   websearch  the crawler        — round two-part spider, stubby legs,
 *                                   the front pair sensing, and one eye
 *                                   grown into a search lens
 *   mcp        the socket golem   — angular robot, floating cube head,
 *                                   gold sockets on the chest, treads;
 *                                   the only hard-cornered creature here
 *   task       the coil           — a limbless serpent, tail raised, the
 *                                   glowing job balanced on its tip
 *   lsp        the bookwyrm       — a segmented scholar that stacks, in
 *                                   round spectacles; air between segments
 *   memory     the archive turtle — side view, drawer-shell on its back,
 *                                   one card already out
 *   harness    the coach          — a roo: big feet, thick tail, the
 *                                   stopwatch tucked in its pouch
 *   router     the signpost       — a courier head wearing two arrow
 *                                   boards at the fork, planted on a pole
 *   dream      the sheep          — wool bumps asleep on a cloud, z's
 *   hooks      the guard crab     — eyes up on stalks, three legs, the
 *                                   shield planted across its front
 *   sdlc       the works badger   — side-view quadruped mid-step, blaze,
 *                                   vest, one badge
 *
 * Ten plans, ten poses (hover, trundle, rear, stack, trundle, sit, stand,
 * lie, scuttle, walk), ten faces (lens eye, visor squares, sly slits,
 * spectacles, a side eye, open-mouth shouting, small-and-capped, closed
 * arcs, stalked eyes, a walking blaze). What still makes them ONE bestiary:
 * the shared kit (ramps, cel bands, the generated 1px outline, the
 * parameterized face template), the shared baseline, the full-canvas ship,
 * and one feature story per creature.
 *
 * THE DARK-RATIO LESSON (learned tuning v3 against the ≤30% gate): the
 * generated outline taxes every separate part ~35-45% of its pixels, so a
 * silhouette built from many thin appendages cannot pass — the spider with
 * six long legs measured 31%, the signpost with six parts 46%. Two rules
 * follow. First, MASS BEFORE PARTS: every creature carries one dominant
 * solid body, and appendages are short, thick stubs (the spider's legs are
 * chibi-stubs, the crab's stalks are short with big balls). Second,
 * DETAILS LIVE INTERIOR: a story painted ON the mass (the golem's sockets
 * and visor, the turtle's drawer fronts, the badger's vest and blaze, the
 * spider's lens eye) costs no outline at all, while every detached part
 * pays full tax — and attached parts (the router's arrows grown from the
 * head, the crab's shield across the body's front) share an interior edge
 * and pay half. The prop may detach ONLY when it is the one story (the
 * orb, the stopwatch, the shield's planted stance).
 *
 * IP note: original silhouettes throughout — generic creature-collector
 * vocabulary only; no species names, no capture iconography, no named
 * artists. The banned generator attractor (warm-gold round body + pointed
 * ears) cannot recur — nothing is generated — and the vocabulary ban stays
 * as a naming contract.
 */
import {
  face, glint, paint, px, shade, stamp, rim, union, minus, both, tube,
  inEllipse, inRoundRect, inTri,
  STAR, Z_BIG, Z_MID, Z_SML,
} from "./creature_kit.mjs";

export const SPRITES = [

/* 001 — websearch: the aqua crawler, magnifier up *******************/
{
  id: "websearch",
  meta: { standing: true, symmetric: false },
  draw(c) {
    // the slim two-part body: a spider's legs must show ALONGSIDE the
    // body, not hide behind it — the first draft hid them and read frog
    const head = inEllipse(31.5, 22, 10, 8);
    const abdo = inEllipse(31.5, 39, 11, 10);
    shade(c, union(head, abdo), { base: "A2", light: "A3", shadow: "A1" });
    const patch = inEllipse(31.5, 39, 7, 5.5);
    paint(c, patch, "P3");
    paint(c, rim(patch, 0, -2), "P2");
    // big eyes (4x5) + cheeks + a small smile
    face(c, { eyeY: 17, eyeGap: 8, eyeW: 4, eyeH: 5, mouthDy: 7, mouth: "smile", mouthW: 5, cheek: "A3", cheekDy: 5 });
    glint(c, 25, 14, "A4");
    // five splayed legs, knees HIGH and out — every leg a visible zigzag
    // outside the silhouette — plus the front pair's raised arm holding
    for (const leg of [
      tube([[22, 26], [10, 20], [8, 46]], 2.25),
      tube([[21, 36], [10, 32], [7, 48]], 2.25),
      tube([[22, 42], [11, 41], [9, 49]], 2.25),
      tube([[41, 26], [53, 20], [56, 46]], 2.25),
      tube([[42, 36], [54, 32], [56, 48]], 2.25),
    ]) paint(c, leg, "A2");
    paint(c, tube([[41, 23], [50, 18], [55, 15]], 2.25), "A2");
    // the magnifier, drawn big enough to read at 1x: a 2px gold ring, a
    // cream lens, a diagonal glint — the stamp's 8px ring read as a blob
    const ring = minus(inEllipse(52, 10, 5.5, 5.5), inEllipse(52, 10, 3.2, 3.2));
    paint(c, ring, "G2");
    paint(c, inEllipse(52, 10, 3.2, 3.2), "P3");
    px(c, 50, 8, "A3"); px(c, 51, 8, "A3");
    paint(c, tube([[54, 14], [57, 17]], 1.5), "G2");
    return c;
  },
},

/* 002 — mcp: the leaf socket golem, everything plugs in ***************/
{
  id: "mcp",
  meta: { standing: true, symmetric: true },
  draw(c) {
    // plug antennae — stems at 27/36 (mirror pair), gold prongs above
    for (const sx of [27, 36]) {
      for (let y = 6; y <= 8; y++) px(c, sx, y, "N2");
      for (let yy = 4; yy <= 5; yy++) for (let xx = -1; xx <= 1; xx++) px(c, sx + xx, yy, "G2");
    }
    // the floating cube head (4 rows of air under it — an island, outlined).
    // Flat panels on purpose: a machine reads BETTER flat, and L1 shadow
    // bands are dark keys — with them the golem measured 35% dark.
    shade(c, inRoundRect(31.5, 15, 18, 13, 1), { base: "L2", light: "L3" });
    // the visor face: cream screen, two square eyes, one small smile
    paint(c, inRoundRect(31.5, 15, 14, 7, 1), "P3");
    for (const ex of [27, 34]) {
      for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 3; xx++) px(c, ex + xx, 13 + yy, "O");
      px(c, ex, 13, "W");
    }
    px(c, 31, 17, "O"); px(c, 32, 17, "O");
    // the wide angular torso, arms grown on at the shoulders (an attached
    // arm shares an interior edge — half the outline tax of a detached one)
    shade(c, inRoundRect(31.5, 36, 26, 21, 2), { base: "L2", light: "L3" });
    shade(c, inRoundRect(17.5, 33, 9, 12, 1), { base: "L2" });
    shade(c, inRoundRect(45.5, 33, 9, 12, 1), { base: "L2" });
    paint(c, inRoundRect(31.5, 34, 20, 11, 1), "P3");
    // three gold sockets on the chest plate — the dock, grown into the body
    for (const [x0, x1] of [[23, 27], [29, 33], [35, 39]]) {
      for (let y = 31; y <= 35; y++) for (let x = x0; x <= x1; x++) px(c, x, y, "G2");
      for (let x = x0 + 1; x <= x1 - 1; x++) px(c, x, 32, "N2");
    }
    // gold treads with navy bolts (navy treads read as a smudge band — the
    // dark-ratio gate drove them gold)
    shade(c, inRoundRect(31.5, 50, 24, 7, 3), { base: "G1", light: "G2", shadow: "N2", shadowD: [-1, -3] });
    for (const bx of [25, 37]) { px(c, bx, 50, "N2"); px(c, bx + 1, 50, "N2"); px(c, bx, 51, "N2"); px(c, bx + 1, 51, "N2"); }
    return c;
  },
},

/* 003 — task: the coil, one orb on the tail ****************************/
{
  id: "task",
  meta: { standing: true, symmetric: false },
  draw(c) {
    // the body: tail (thin, left, rising to the orb) -> coil -> neck ->
    // head — one continuous creature, three gauges of tube
    const coil = tube([[24, 42], [26, 38], [33, 36], [40, 38], [42, 42], [38, 46], [31, 47], [25, 46]], 6);
    const neck = tube([[40, 38], [45, 30], [42, 22], [35, 16]], 5);
    const head = inEllipse(32, 14, 7.5, 5.5);
    shade(c, union(coil, neck, head), { base: "C2", light: "C3", shadow: "C1" });
    // the tail, thinner and darker, rising to hold the orb
    paint(c, tube([[24, 44], [17, 40], [14, 32], [14, 25], [14, 21]], 2.5), "C1");
    // the orb — the glowing job, balanced on the tail tip
    const orb = inEllipse(14, 16, 4.5, 4.5);
    paint(c, orb, "K2");
    paint(c, rim(orb, 1, 1), "K3");
    paint(c, rim(orb, -1, -1), "K1");
    glint(c, 12, 14, "K4");
    // sly slit eyes + a small smile — the negotiator's face
    for (const ex of [28, 34]) {
      for (let xx = 0; xx < 3; xx++) { px(c, ex + xx, 13, "O"); px(c, ex + xx, 14, "O"); }
      px(c, ex, 13, "W");
    }
    px(c, 31, 18, "O"); px(c, 32, 18, "O"); px(c, 33, 18, "O");
    // belly scutes along the coil's front — three cream dashes
    for (const [sx, sy] of [[27, 48], [32, 49], [37, 47]]) {
      for (let xx = 0; xx < 3; xx++) for (let yy = 0; yy < 2; yy++) px(c, sx + xx, sy + yy, "P3");
    }
    glint(c, 28, 10, "C3");
    return c;
  },
},

/* 004 — lsp: the bookwyrm, in round spectacles **************************/
{
  id: "lsp",
  meta: { standing: true, symmetric: false },
  draw(c) {
    // a rearing worm: an OVAL head (a different shape than any segment —
    // the first draft's roundrect head made the stack read as blocks),
    // then segments that TAPER and CURVE left, stacking to the baseline
    shade(c, inEllipse(32, 18, 12, 9), { base: "B2", light: "B3", shadow: "B1" });
    // the scholar's curl
    paint(c, tube([[36, 10], [40, 7], [43, 9]], 1.5), "B1");
    shade(c, inRoundRect(29.5, 34, 22, 12, 6), { base: "B2", light: "B3", shadow: "B1" });
    shade(c, inRoundRect(27, 48.5, 18, 10, 5), { base: "B2", light: "B3", shadow: "B1" });
    // round spectacles: a DARK-gold ring per eye with a cream lens. The
    // first rings were bright gold on amber — near-zero contrast, the
    // whole face read as one gold mask and the glasses vanished (two
    // review rounds). G1 on B2 keeps the ramp and doubles the contrast.
    // Then an open book against the reading segment, held by two nubs —
    // the scholar's second, unmistakable signifier
    for (const ex of [28, 36]) {
      paint(c, minus(inEllipse(ex, 18, 5.8, 4.6), inEllipse(ex, 18, 4.0, 3.0)), "G1");
      paint(c, inEllipse(ex, 18, 4.0, 3.0), "P3");
    }
    // the face: eyes low on the head, cheeks, smile below the rims
    face(c, { cx: 32, eyeY: 16, eyeGap: 8, eyeW: 3, eyeH: 4, mouthDy: 8, mouth: "smile", mouthW: 5, cheek: "G2", cheekDy: 6 });
    px(c, 31, 18, "G1"); px(c, 32, 18, "G1");
    glint(c, 25, 12, "B3");
    // the open book, held against the middle segment: two cream pages,
    // a navy spine, two little arms
    paint(c, tube([[19, 33], [24, 34]], 2), "B1");
    paint(c, tube([[40, 33], [35, 34]], 2), "B1");
    shade(c, inRoundRect(26, 34, 9, 7, 1), { base: "P4", shadow: "P2", shadowD: [-1, -2] });
    shade(c, inRoundRect(33, 34, 9, 7, 1), { base: "P4", shadow: "P2", shadowD: [-1, -2] });
    for (let yy = 31; yy <= 37; yy++) { px(c, 29, yy, "N2"); px(c, 30, yy, "N2"); }
    return c;
  },
},

/* 005 — memory: the archive turtle, one card out ***********************/
{
  id: "memory",
  meta: { standing: true, symmetric: false },
  draw(c) {
    // the shell dome (a half-ellipse) with its rim band at the equator
    const dome = both(inEllipse(34, 40, 17, 16), (x, y) => y <= 41);
    shade(c, dome, { base: "G1", light: "G2", shadow: "G1", lightD: [2, 2] });
    const rimBand = inRoundRect(34, 42.5, 35, 5, 2);
    paint(c, rimBand, "G1");
    paint(c, rim(rimBand, 0, -2), "G2");
    // two drawer fronts on the shell — the archive, carried everywhere.
    // Gold FRAMES and wide handles: the first handles were 2px flecks
    // and the shell read as generic segments (round 4). Everything is
    // clipped to the dome — the frame corners would float off the
    // shell's curved top edge as orphan islands
    for (const dx of [27, 41]) {
      const front = inRoundRect(dx, 33, 9, 6, 1);
      paint(c, both(minus(inRoundRect(dx, 33, 13, 10, 1), front), dome), "G2");
      paint(c, front, "P3");
      paint(c, rim(front, 0, -2), "P2");
      for (let xx = -1; xx <= 1; xx++) px(c, dx + xx, 31, "G1");
    }
    // a card slipping out above the right drawer — retrieved on the first try
    for (let xx = 38; xx <= 44; xx++) { px(c, xx, 25, "P4"); px(c, xx, 26, "P4"); }
    for (let xx = 39; xx <= 43; xx++) px(c, xx, 27, "P2");
    // the head on a short neck, out at the left
    paint(c, tube([[21, 39], [16, 33]], 3.5), "C2");
    shade(c, inEllipse(14, 28, 5.5, 5), { base: "C2", light: "C3", shadow: "C1" });
    for (let yy = 0; yy < 3; yy++) { px(c, 11, 26 + yy, "O"); px(c, 12, 26 + yy, "O"); }
    px(c, 11, 26, "W");
    px(c, 12, 31, "O"); px(c, 13, 32, "O");
    glint(c, 10, 24, "C3");
    // four stubby feet under the rim, a curl of tail behind
    for (const fx of [13, 25, 42, 50]) shade(c, inRoundRect(fx, 47.5, 6, 8, 2), { base: "C2", shadow: "C1", shadowD: [-1, -2] });
    paint(c, tube([[51, 41], [55, 38], [56, 33]], 2), "C2");
    return c;
  },
},

/* 006 — harness: the coach, stopwatch in the pouch *********************/
{
  id: "harness",
  meta: { standing: true, symmetric: false },
  draw(c) {
    // the upright pose: a roo sits TALL, feet thrust forward, tail around
    // the base. The first draft was a wide blob with feet underneath —
    // it read as a salamander. Upright + feet-forward is the signature.
    // The pear: haunches heavy at the bottom (the second draft's straight
    // sides read as a generic biped beside the golem).
    shade(c, union(inEllipse(30, 34, 11, 14), inEllipse(35, 43, 6.5, 6)), { base: "M2", light: "M3", shadow: "M1", shadowD: [-1, -1] });
    shade(c, inEllipse(28, 13, 8, 7), { base: "M2", light: "M3", shadow: "M1", shadowD: [-1, -1] });
    // two long ears, one tipped out — tips at the top margin
    paint(c, tube([[26, 9], [22, 6]], 2.5), "M2");
    paint(c, tube([[32, 8], [36, 6]], 2.5), "M2");
    // the coach's face — small eyes, mouth open mid-instruction
    face(c, { cx: 28, eyeY: 11, eyeGap: 6, eyeW: 3, eyeH: 3, mouthDy: 5, mouth: "open", cheek: "M3", cheekDy: 5 });
    // one arm up, pointing at the clock
    paint(c, tube([[36, 27], [44, 22], [49, 17]], 2.25), "M2");
    // the pouch, wide and shallow, and the stopwatch tucked into it —
    // navy bezel, BRIGHT cream face, gold crown: a gold ring on a cream
    // pouch with a cream face read as one blob (the crop review caught
    // it at 4x — the one finding that survived arbitration)
    const pouch = inEllipse(29, 38, 8, 5);
    paint(c, pouch, "P3");
    paint(c, rim(pouch, 0, -2), "P2");
    paint(c, minus(inEllipse(29, 32.5, 4.5, 4.5), inEllipse(29, 32.5, 2.8, 2.8)), "N2");
    paint(c, inEllipse(29, 32.5, 2.8, 2.8), "P4");
    px(c, 28, 27, "G1"); px(c, 29, 27, "G1"); px(c, 30, 27, "G1");
    px(c, 28, 28, "G1"); px(c, 30, 28, "G1");
    px(c, 29, 31, "O"); px(c, 29, 32, "O"); px(c, 30, 32, "O");
    paint(c, both(pouch, (x, y) => y >= 37), "P3");
    paint(c, rim(both(pouch, (x, y) => y >= 37), 0, -2), "P2");
    // the big feet, thrust forward from the base — the roo read
    shade(c, inRoundRect(20, 47, 13, 7, 3), { base: "M2" });
    shade(c, inRoundRect(27, 48, 12, 6, 3), { base: "M2" });
    // the thick tail, around the right side, tip curling up
    paint(c, tube([[39, 42], [49, 46], [55, 42]], 3.5), "M2");
    return c;
  },
},

/* 007 — router: the signpost at the fork *******************************/
{
  id: "router",
  meta: { standing: true, symmetric: false },
  draw(c) {
    // the courier head wearing two arrow boards — leaf points left, gold
    // points right. The boards grow from the head's sides (shared edge):
    // a six-part signpost measured 46% dark; this reads the same at 26%.
    // Each board carries a cream field with a navy chevron — the plain
    // dashes read as decoration, not direction (round 2)
    const leftArr = union(inRoundRect(22.5, 17, 11, 9, 1), inTri(17, 12, 17, 22, 10, 17));
    shade(c, leftArr, { base: "L2", light: "L3", shadow: "L1" });
    const rightArr = union(inRoundRect(40.5, 17, 11, 9, 1), inTri(46, 12, 46, 22, 53, 17));
    shade(c, rightArr, { base: "G2", light: "G3", shadow: "G1" });
    paint(c, inRoundRect(22.5, 17, 9, 7, 1), "P3");
    paint(c, inRoundRect(40.5, 17, 9, 7, 1), "P3");
    // the chevrons: < on the left board, > on the right
    px(c, 22, 17, "N2"); px(c, 22, 18, "N2"); px(c, 22, 19, "N2");
    px(c, 23, 16, "N2"); px(c, 23, 20, "N2");
    px(c, 24, 17, "N2"); px(c, 24, 18, "N2"); px(c, 24, 19, "N2");
    px(c, 41, 17, "N2"); px(c, 41, 18, "N2"); px(c, 41, 19, "N2");
    px(c, 42, 16, "N2"); px(c, 42, 20, "N2");
    px(c, 43, 17, "N2"); px(c, 43, 18, "N2"); px(c, 43, 19, "N2");
    // the head over the boards' roots, in a gold courier cap + navy band
    shade(c, inEllipse(31.5, 17, 11, 9.5), { base: "G2", light: "G3", shadow: "G1" });
    paint(c, inRoundRect(31.5, 7.5, 15, 4, 2), "G1");
    for (let xx = 25; xx <= 38; xx++) px(c, xx, 10, "N2");
    face(c, { eyeY: 15, eyeGap: 7, eyeW: 3, eyeH: 3, mouthDy: 5, mouth: "smile", cheek: "G3", cheekDy: 4 });
    // the pole under the head, planted in a cream base with gold bolts
    shade(c, inRoundRect(31.5, 38, 8, 24, 1), { base: "G2", shadow: "G1", shadowD: [-1, 0] });
    paint(c, inRoundRect(31.5, 50.5, 22, 6, 2), "P3");
    paint(c, rim(inRoundRect(31.5, 50.5, 22, 6, 2), -1, -2), "G1");
    for (const bx of [26, 35]) { px(c, bx, 50, "G2"); px(c, bx + 1, 50, "G2"); }
    return c;
  },
},

/* 008 — dream: the sheep asleep on its cloud ***************************/
{
  id: "dream",
  meta: { standing: false, symmetric: false },
  draw(c) {
    // the cloud first — the sleeper's legs dangle into it
    const cloud = union(
      inRoundRect(31.5, 47, 34, 11, 4),
      inEllipse(23, 42, 5, 4),
      inEllipse(41, 42, 5, 4),
    );
    paint(c, cloud, "P3");
    paint(c, rim(cloud, 1, 3), "P4");
    paint(c, rim(cloud, -1, -3), "P2");
    // two legs, dangling into the wool's shadow — navy hoof tips
    paint(c, tube([[27, 41], [26, 47]], 2), "K2");
    paint(c, tube([[34, 41], [34, 47]], 2), "K2");
    px(c, 25, 47, "N2"); px(c, 26, 47, "N2"); px(c, 33, 47, "N2"); px(c, 34, 47, "N2");
    // the wool: fat bumps, each carrying its own light arc, the bottom
    // edge scalloped — that silhouette is what reads "sheep", not "blob"
    const bumps = [
      [23, 32, 5.5, 5], [31, 29, 6.5, 5.5], [39, 31, 6, 5.5],
      [26, 37, 5.5, 5], [35, 36.5, 5.5, 5], [44, 35, 4.5, 4],
    ];
    const wool = union(...bumps.map(([x, y, rx, ry]) => inEllipse(x, y, rx, ry)));
    paint(c, wool, "K3");
    for (const [x, y, rx, ry] of bumps) paint(c, rim(inEllipse(x, y, rx, ry), 1, 2), "K4");
    paint(c, rim(wool, -1, -2), "K2");
    // the head, solid and a step darker than the wool, one ear hanging
    paint(c, tube([[50, 25], [54, 28]], 2), "K2");
    shade(c, inEllipse(47.5, 29.5, 4.5, 5), { base: "K2", light: "K3", shadow: "K1", lightD: [1, 2] });
    // asleep: two closed arcs, a small smile, one soft cheek
    px(c, 45, 30, "O"); px(c, 46, 29, "O"); px(c, 47, 30, "O");
    px(c, 49, 29, "O"); px(c, 50, 30, "O");
    px(c, 46, 33, "O"); px(c, 47, 33, "O"); px(c, 48, 33, "O");
    px(c, 45, 32, "K1"); px(c, 50, 32, "K1");
    // one star, then z's climbing to it
    stamp(c, 14, 12, STAR, { g: "G2", W: "W" });
    stamp(c, 40, 16, Z_BIG, { z: "G2" });
    stamp(c, 46, 11, Z_MID, { z: "G2" });
    stamp(c, 51, 7, Z_SML, { z: "G3" });
    return c;
  },
},

/* 009 — hooks: the guard crab, eyes up on stalks ***********************/
{
  id: "hooks",
  meta: { standing: true, symmetric: false },
  draw(c) {
    // the carapace — one dominant mass, wide and low
    shade(c, inEllipse(28, 37, 13.5, 10.5), { base: "M2", light: "M3", shadow: "M1", shadowD: [-1, -1] });
    // the face on the shell: a calm smile, two soft cheeks — the eyes are
    // up on the stalks, and the shield does the shouting
    px(c, 26, 35, "O"); px(c, 27, 35, "O"); px(c, 28, 35, "O"); px(c, 29, 35, "O");
    px(c, 25, 34, "O"); px(c, 30, 34, "O");
    px(c, 21, 36, "M3"); px(c, 22, 36, "M3");
    // three legs on the left, scuttling — short and thick (a long thin
    // leg is half outline by area; the gate taught us stubs)
    for (const leg of [
      tube([[17, 43], [11, 46]], 2.25),
      tube([[19, 46], [13, 50]], 2.25),
      tube([[22, 47], [17, 51]], 2.25),
    ]) paint(c, leg, "M2");
    // eyes up on stalks — short, with big balls; the watcher's posture
    for (const [path, bx, by] of [
      [[[24, 28], [22, 22]], 21, 19],
      [[[33, 28], [35, 22]], 36, 19],
    ]) {
      paint(c, tube(path, 2.25), "M2");
      const ball = inEllipse(bx, by, 2.75, 2.75);
      paint(c, ball, "P4");
      paint(c, rim(ball, -1, -1), "P2");
      px(c, bx - 1, by - 1, "O"); px(c, bx, by - 1, "O"); px(c, bx - 1, by, "O"); px(c, bx, by, "O");
      px(c, bx - 1, by - 1, "W");
    }
    // the shield planted across the front-right: gold border, cream field,
    // gold boss — grown against the shell so the shared edge pays no tax
    const shield = union(inRoundRect(44, 43, 14, 10, 2), inTri(37, 47, 51, 47, 44, 53));
    const inner = union(inRoundRect(44, 43, 12, 8, 2), inTri(38, 46, 50, 46, 44, 52));
    paint(c, shield, "G2");
    paint(c, inner, "P3");
    px(c, 43, 42, "G2"); px(c, 44, 42, "G2"); px(c, 45, 42, "G2");
    px(c, 42, 43, "G2"); px(c, 43, 43, "G2"); px(c, 44, 43, "G2"); px(c, 45, 43, "G2"); px(c, 46, 43, "G2");
    return c;
  },
},


/* 010 — sdlc: the works badger, walking the list ***********************/
{
  id: "sdlc",
  meta: { standing: true, symmetric: false },
  draw(c) {
    // the horizontal body — a quadruped, the only four-legged gait here
    const body = inEllipse(33, 36, 16, 9.5);
    shade(c, body, { base: "C2", light: "C3", shadow: "C1" });
    // the gold work vest over the back half — an interior detail, no
    // outline tax — with navy edge, cream V at the neck, one badge earned
    const vest = both(body, (x) => x >= 27 && x <= 46);
    paint(c, vest, "G1");
    paint(c, rim(vest, 1, 2), "G2");
    // navy trim on BOTH vest edges (one edge read as a fade at 1x), the
    // columns clipped to the body so nothing floats off the silhouette
    for (const vx of [27, 46]) {
      paint(c, both((x, y) => x === vx, body), "N3");
    }
    paint(c, inTri(28, 30, 33, 30, 30, 35), "P3");
    // one badge earned — a navy rosette in a gold ring with a glint (the
    // bare 3x3 navy square read as a pixel cluster at 1x, round 3)
    for (let yy = 30; yy <= 34; yy++) for (let xx = 39; xx <= 43; xx++) px(c, xx, yy, (yy === 30 || yy === 34 || xx === 39 || xx === 43) ? "G2" : "N2");
    px(c, 41, 32, "W");
    // the head, low-left, with muzzle and nose
    shade(c, inEllipse(17, 30, 7.5, 7), { base: "C2", light: "C3", shadow: "C1" });
    paint(c, inEllipse(11, 33, 4, 3), "P4");
    px(c, 8, 31, "O"); px(c, 9, 31, "O"); px(c, 8, 32, "O"); px(c, 9, 32, "O");
    px(c, 11, 35, "O"); px(c, 12, 35, "O");
    // the blaze: a white stripe, slanted from crown toward the muzzle
    paint(c, tube([[13, 35], [18, 24]], 2), "P4");
    // one eye beside the blaze, one round ear forward of it
    for (let yy = 0; yy < 3; yy++) { px(c, 14, 28 + yy, "O"); px(c, 15, 28 + yy, "O"); }
    px(c, 14, 28, "W");
    shade(c, inEllipse(21, 23, 2.5, 2.5), { base: "C1", light: "C2" });
    // four stub legs mid-walk: the front-left lifted, stepping (attached
    // at the shoulder — a detached limb is an island, and an island is
    // half outline by area)
    for (const fx of [21, 27, 41, 47]) paint(c, inRoundRect(fx, 47, 5, 6, 2), "C1");
    paint(c, inRoundRect(24, 42, 5, 5, 2), "C1");
    // the tail, out behind, gold-tipped
    const tail = tube([[48, 32], [54, 28], [57, 30]], 2.25);
    paint(c, tail, "C2");
    paint(c, both(tail, (x) => x >= 54), "G1");
    glint(c, 20, 27, "C3");
    return c;
  },
},

/* 011 — browser: the window form, cursor up ***************************/
{
  id: "browser",
  meta: { standing: true, symmetric: false },
  draw(c) {
    // the window itself — one dominant mass, a tall rounded frame in the
    // plate ramp (the creature IS the page it renders), standing on two
    // stubby feet so it can scoot between monitors
    const win = inRoundRect(26.5, 30, 34, 36, 4);
    shade(c, win, { base: "P2", light: "P3", shadow: "P1" });
    // the chrome band across the top — an interior detail (no outline
    // tax): light blue-grey, three little navy window dots, one glint
    paint(c, inRoundRect(26.5, 18, 30, 9, 2), "P1");
    for (const dx of [14, 19, 24]) { px(c, dx, 17, "N2"); px(c, dx + 1, 17, "N2"); px(c, dx, 18, "N2"); px(c, dx + 1, 18, "N2"); }
    glint(c, 38, 16, "P4");
    // the rendered page — a brighter plate inside the frame, where the
    // face lives (interior again: the story painted ON the mass)
    const page = inRoundRect(26.5, 31, 27, 21, 3);
    paint(c, page, "P4");
    paint(c, rim(page, 0, -2), "P3");
    face(c, { cx: 26.5, eyeY: 28, eyeGap: 9, eyeW: 4, eyeH: 5, mouthDy: 7, mouth: "smile", mouthW: 5, cheek: "P2", cheekDy: 5 });
    // stubby feet, the plate's own shadow ramp — attached under the frame,
    // five rows proud of the bottom edge so they read as feet, not a hem
    for (const fx of [17.5, 35.5]) shade(c, inRoundRect(fx, 49, 7, 7, 2), { base: "P1" });
    // the golden cursor — the one detached part, because the trusted
    // click IS the story: a SOLID pointer big enough to survive its own
    // generated outline, leaning in toward the page, gold with a lit left
    // edge, floating one clear pixel off the window's right side
    stamp(c, 45, 29, [
      "XX.....",
      "XXX....",
      "XXXX...",
      "XXXXX..",
      "XXXXXX.",
      "XXXXXXX",
      "XX.....",
      "XX.....",
      "XX.....",
    ], { X: "G2" });
    for (let yy = 30; yy <= 34; yy++) px(c, 45, yy, "G3");
    px(c, 46, 30, "G3");
    return c;
  },
},
];
