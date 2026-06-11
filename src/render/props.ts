import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainHeight } from '../sim/world';
import { PROPS, WORLD_MIN_Z } from '../sim/data';
import { hash2 } from '../sim/rng';
import { GFX, surfaceMat } from './gfx';
import {
  awningStripeMaps, awningStripeTexture, barkMaps, canvasMaps, plankMaps, plankTexture,
  plasterMaps, plasterTexture, roofMaps, roofTexture, stoneMaps, stoneTexture, thatchMaps,
  thatchTexture,
} from './textures';

// Static world props: buildings, tents, campfires, mines, ruins, docks, fences.
// Placement comes from the per-zone content modules (merged into PROPS by
// sim/data.ts) — the collider grid uses the same defs, so positions/footprints
// must not move. The GEOMETRY here is hand-shaped low-poly: gabled roofs with
// overhanging eaves, real timber framing, lathe barrels, noise-displaced
// boulders — no raw primitive should read as a primitive.
//
// After building, every static mesh is baked into world space and merged per
// (material, z-band) — hundreds of little draws collapse into a few dozen,
// and the z-bands keep off-screen settlements frustum-cullable. Animated
// flames and the fire PointLights stay live objects.

export interface PropsResult {
  group: THREE.Group;
  flames: THREE.Mesh[]; // animated campfire flames
  fireLights: THREE.PointLight[];
  /** hides merged prop bands that sit entirely past the fog far plane */
  update(camX: number, camZ: number, fogFar: number): void;
}

const MERGE_BAND_DEPTH = 180;

// ---------------------------------------------------------------------------
// shape helpers — deterministic (hash-keyed) vertex work, no native random
// ---------------------------------------------------------------------------

/** deterministic 0..1 from a 3d point (quantized so coincident verts agree) */
function hash3(x: number, y: number, z: number, seed: number): number {
  return hash2(Math.round(x * 511), Math.round(y * 511) ^ (Math.round(z * 511) * 1013), seed);
}

/** stateless per-prop rand stream keyed on world position */
function propRand(x: number, z: number, n: number): number {
  return hash2(Math.round(x * 37), Math.round(z * 37) + n * 7919, 0x517cc1);
}

/** stateless rand stream keyed on a scalar prop key */
function keyRand(key: number, n: number): number {
  return hash2(Math.round(key * 97), n * 7919, 0x9e3779);
}

/** noise-displaced icosahedron — boulders, rock piles (faceted normals) */
function boulderGeo(r: number, seed: number, detail: number, squashY = 0.78): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(r, detail);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + (hash3(x / r, y / r, z / r, seed) - 0.5) * 0.55;
    pos.setXYZ(i, x * k, y * k * squashY, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** rescales each ring of a unit-radius cylinder: profile(t 0..1 bottom..top) -> radius */
function profileRings(geo: THREE.BufferGeometry, h: number, profile: (t: number) => number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = profile(THREE.MathUtils.clamp((y + h / 2) / h, 0, 1));
    pos.setXYZ(i, pos.getX(i) * k, y, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** re-projects box/slab UVs from local position by dominant normal axis (world-scale texels) */
function worldUV(geo: THREE.BufferGeometry, scale: number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u: number, v: number;
    if (ny >= nx && ny >= nz) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else if (nx >= nz) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv.setXY(i, u / scale, v / scale);
  }
  return geo;
}

function scaleUVs(geo: THREE.BufferGeometry, k: number): THREE.BufferGeometry {
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
  return geo;
}

/** rounded/arched headstone or door silhouette: flat-sided slab with a curved top */
function archedSlabGeo(w: number, hShoulder: number, hTop: number, depth: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-w / 2, hShoulder);
  s.quadraticCurveTo(-w / 2, hTop, 0, hTop);
  s.quadraticCurveTo(w / 2, hTop, w / 2, hShoulder);
  s.lineTo(w / 2, 0);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  return scaleUVs(geo, 0.5);
}

/** pointed (gothic) arch outline for the chapel door */
function pointedArchGeo(w: number, hShoulder: number, hPeak: number, depth: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-w / 2, hShoulder);
  s.quadraticCurveTo(-w / 2, hPeak * 0.92, 0, hPeak);
  s.quadraticCurveTo(w / 2, hPeak * 0.92, w / 2, hShoulder);
  s.lineTo(w / 2, 0);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  return scaleUVs(geo, 0.5);
}

export function buildProps(seed: number): PropsResult {
  const group = new THREE.Group();
  const flames: THREE.Mesh[] = [];
  const fireLights: THREE.PointLight[] = [];

  // High tier: normal-mapped Standard pairs with roughness; low keeps a
  // Lambert set with albedo-only canvases. All mats are hoisted + shared
  // (surfaceMat dedupes) so the static merge below stays a handful of draws.
  const usePbr = GFX.standardMaterials;
  let wallMat: THREE.Material, roofMat: THREE.Material, stoneMat: THREE.Material;
  let woodMat: THREE.Material, woodDarkMat: THREE.Material, plankMat: THREE.Material;
  let thatchMat: THREE.Material, awningMat: THREE.Material;
  if (usePbr) {
    const plaster = plasterMaps();
    const roof = roofMaps();
    const stone = stoneMaps();
    const bark = barkMaps();
    const plank = plankMaps();
    const thatch = thatchMaps();
    const awning = awningStripeMaps();
    wallMat = surfaceMat({ map: plaster.map, normalMap: plaster.normalMap, roughness: 0.92 });
    roofMat = surfaceMat({ map: roof.map, normalMap: roof.normalMap, roughness: 0.8 });
    stoneMat = surfaceMat({ map: stone.map, normalMap: stone.normalMap, color: 0xb8b8b2, roughness: 0.95 });
    woodMat = surfaceMat({ map: bark.map, normalMap: bark.normalMap, roughness: 0.9 });
    woodDarkMat = surfaceMat({ map: bark.map, normalMap: bark.normalMap, color: 0xb0a08e, roughness: 0.9 });
    plankMat = surfaceMat({ map: plank.map, normalMap: plank.normalMap, roughness: 0.85 });
    thatchMat = surfaceMat({ map: thatch.map, normalMap: thatch.normalMap, roughness: 1 });
    awningMat = surfaceMat({ map: awning.map, normalMap: awning.normalMap, side: THREE.DoubleSide, roughness: 0.9 });
  } else {
    wallMat = new THREE.MeshLambertMaterial({ map: plasterTexture() });
    roofMat = new THREE.MeshLambertMaterial({ map: roofTexture() });
    stoneMat = new THREE.MeshLambertMaterial({ map: stoneTexture() });
    woodMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
    woodDarkMat = new THREE.MeshLambertMaterial({ color: 0x4a3320 });
    plankMat = new THREE.MeshLambertMaterial({ map: plankTexture() });
    thatchMat = new THREE.MeshLambertMaterial({ map: thatchTexture() });
    awningMat = new THREE.MeshLambertMaterial({ map: awningStripeTexture(), side: THREE.DoubleSide });
  }
  // tents: woven cloth maps on the lit tiers; low keeps flat color
  const cloth = usePbr ? canvasMaps() : null;
  const canvasMat = cloth
    ? surfaceMat({ map: cloth.map, normalMap: cloth.normalMap, side: THREE.DoubleSide, roughness: 0.95 })
    : surfaceMat({ color: 0xc9b48a, side: THREE.DoubleSide, roughness: 0.95 });
  // shaded variant for door flaps/rolled rims so they read against the body
  const canvasDarkMat = cloth
    ? surfaceMat({ map: cloth.map, normalMap: cloth.normalMap, color: 0xa08c6a, side: THREE.DoubleSide, roughness: 0.95 })
    : surfaceMat({ color: 0xa08c6a, side: THREE.DoubleSide, roughness: 0.95 });
  const windowMat = surfaceMat({
    color: 0x35506b, emissive: 0x1a2c40, emissiveIntensity: usePbr ? 1.2 : 0.7, roughness: 0.4,
  });
  const breadMat = surfaceMat({ color: 0xc8954a, roughness: 0.9 });
  const jugMat = surfaceMat({ color: 0x7a9cc6, roughness: 0.55 });
  const appleMat = surfaceMat({ color: 0xa83a28, roughness: 0.6 });
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  // lit very-dark-warm interior for shallow openings (tent doors, belfries,
  // hut mouths) — unlit pure black reads as a pasted-on decal
  const recessMat = surfaceMat({ color: 0x14100b, roughness: 1 });
  const oreMat = surfaceMat({ color: 0xb87333, roughness: 0.5, metalness: usePbr ? 0.45 : 0 });
  const mudMat = surfaceMat({ color: 0x6e7f4e, flatShading: true, roughness: 1 });
  const ropeMat = surfaceMat({ color: 0x9a7e52, roughness: 1 });
  const metalMat = surfaceMat({ color: 0x3e4044, roughness: 0.5, metalness: usePbr ? 0.55 : 0 });
  const lanternMat = surfaceMat({ color: 0xffcc66, emissive: 0xff9933, emissiveIntensity: usePbr ? 2 : 1.2, roughness: 0.4 });

  const ground = (x: number, z: number) => terrainHeight(x, z, seed);
  // segment counts: low tier (software GL) keeps lighter meshes
  const SEG = usePbr ? 9 : 7;
  const ROCK_DETAIL = usePbr ? 1 : 0;

  // emissive glass / black hole-fillers opt out of shadow casting; shadowed()
  // runs after the builders so a plain `castShadow = false` would be clobbered
  const noShadow = new Set<THREE.Mesh>();
  function shadowed<T extends THREE.Object3D>(o: T): T {
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        (c as THREE.Mesh).castShadow = !noShadow.has(c as THREE.Mesh);
        (c as THREE.Mesh).receiveShadow = true;
      }
    });
    return o;
  }

  function box(g: THREE.Group, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  }

  // ---- gabled roof: slope slabs + eave/gable overhang + ridge beam + bargeboards ----
  // ridge runs along local X; planar-mapped UVs (no wedge distortion).
  interface GableOpts { gableMat: THREE.Material | null; trim: boolean; mat?: THREE.Material }
  function gableRoof(g: THREE.Group, w: number, d: number, baseY: number, roofH: number, ov: number, o: GableOpts): void {
    const slopeMat = o.mat ?? roofMat;
    const halfSpan = d / 2 + ov;
    const ang = Math.atan2(roofH, d / 2);
    const slopeLen = halfSpan / Math.cos(ang) + 0.12;
    const ridgeY = baseY + roofH;
    const len = w + ov * 2;
    for (const s of [1, -1]) {
      const slab = worldUV(new THREE.BoxGeometry(len, 0.13, slopeLen), 2.3);
      const m = new THREE.Mesh(slab, slopeMat);
      m.rotation.x = s * ang;
      m.position.set(0, ridgeY - (slopeLen / 2) * Math.sin(ang) + 0.05, s * (slopeLen / 2) * Math.cos(ang));
      g.add(m);
      if (o.trim) {
        for (const sx of [1, -1]) {
          const bb = box(g, woodDarkMat, 0.08, 0.24, slopeLen - 0.1, sx * (len / 2 - 0.04),
            ridgeY - (slopeLen / 2) * Math.sin(ang) - 0.08, s * (slopeLen / 2) * Math.cos(ang));
          bb.rotation.x = s * ang;
        }
      }
    }
    if (o.gableMat) {
      for (const sx of [1, -1]) {
        const shape = new THREE.Shape();
        shape.moveTo(-d / 2, 0);
        shape.lineTo(d / 2, 0);
        shape.lineTo(0, roofH - 0.04);
        shape.closePath();
        const geo = scaleUVs(new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false }), 0.35);
        geo.rotateY(Math.PI / 2);
        const m = new THREE.Mesh(geo, o.gableMat);
        m.position.set(sx * (w / 2 - 0.05) - 0.07, baseY, 0);
        g.add(m);
        // king post + collar beam + diagonal struts so the gable triangle is
        // never a bare plaster panel
        box(g, woodDarkMat, 0.12, roofH - 0.25, 0.1, sx * (w / 2 + 0.04), baseY + (roofH - 0.25) / 2, 0);
        box(g, woodDarkMat, 0.1, 0.11, d * 0.55, sx * (w / 2 + 0.04), baseY + roofH * 0.42, 0);
        for (const sz of [1, -1]) {
          const strut = box(g, woodDarkMat, 0.09, roofH * 0.5, 0.09, sx * (w / 2 + 0.04), baseY + roofH * 0.22, sz * d * 0.17);
          strut.rotation.x = sz * 0.65;
        }
      }
    }
    if (o.trim) {
      const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, len + 0.14, 6), woodDarkMat);
      ridge.rotation.z = Math.PI / 2;
      ridge.position.y = ridgeY + 0.03;
      g.add(ridge);
    }
  }

  // ---- recessed window with frame trim + sill (front face at local +z = off) ----
  function windowUnit(g: THREE.Group, x: number, y: number, off: number): void {
    const glass = box(g, windowMat, 0.66, 0.74, 0.06, x, y, off + 0.02);
    noShadow.add(glass);
    for (const sx of [1, -1]) box(g, woodDarkMat, 0.1, 0.94, 0.12, x + sx * 0.4, y, off + 0.08);
    box(g, woodDarkMat, 0.9, 0.1, 0.12, x, y + 0.44, off + 0.08); // header
    box(g, woodDarkMat, 0.34, 0.05, 0.07, x, y, off + 0.06); // center mullion shadow bar
    box(g, plankMat, 1.0, 0.09, 0.2, x, y - 0.44, off + 0.1); // sill
  }

  // ---- recessed plank door in a timber frame with a stone step ----
  function doorUnit(g: THREE.Group, off: number, w = 1.05, h = 2.0): void {
    const panel = box(g, plankMat, w, h, 0.08, 0, h / 2 + 0.06, off + 0.02);
    noShadow.add(panel);
    for (const sx of [1, -1]) box(g, woodDarkMat, 0.13, h + 0.16, 0.16, sx * (w / 2 + 0.1), h / 2 + 0.1, off + 0.06);
    box(g, woodDarkMat, w + 0.46, 0.15, 0.18, 0, h + 0.2, off + 0.07); // lintel
    box(g, stoneMat, w + 0.5, 0.13, 0.55, 0, 0.06, off + 0.26); // step
  }

  // ---- timber frame skeleton proud of the plaster walls ----
  function timberFrame(g: THREE.Group, w: number, d: number, y0: number, h: number, key: number): void {
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) box(g, woodDarkMat, 0.18, h, 0.18, sx * (w / 2), y0 + h / 2, sz * (d / 2));
    }
    for (const lvl of [y0 + h - 0.1, y0 + h * 0.52]) {
      for (const sz of [1, -1]) box(g, woodDarkMat, w + 0.16, 0.13, 0.13, 0, lvl, sz * (d / 2 + 0.015));
      for (const sx of [1, -1]) box(g, woodDarkMat, 0.13, 0.13, d + 0.16, sx * (w / 2 + 0.015), lvl, 0);
    }
    // diagonal braces on the gable-side walls, direction varies per building
    const braceLen = h * 0.46;
    for (const sx of [1, -1]) {
      const b = box(g, woodDarkMat, 0.11, braceLen, 0.1, sx * (w / 2 + 0.02), y0 + h * 0.3, d * -0.22);
      b.rotation.x = (keyRand(key, 1) > 0.5 ? 1 : -1) * 0.55;
      const b2 = box(g, woodDarkMat, 0.11, braceLen, 0.1, sx * (w / 2 + 0.02), y0 + h * 0.3, d * 0.22);
      b2.rotation.x = (keyRand(key, 2) > 0.5 ? 1 : -1) * 0.55;
    }
    // bare rear face (-z, no door/windows): seeded vertical studs + diagonal
    // so the back wall keeps a framing rhythm instead of one bare rail
    for (const ux of [-w * 0.25, w * 0.25]) {
      const jx = ux + (keyRand(key, 5 + ux) - 0.5) * w * 0.08;
      box(g, woodDarkMat, 0.12, h - 0.2, 0.11, jx, y0 + (h - 0.2) / 2, -(d / 2 + 0.02));
    }
    const db = box(g, woodDarkMat, 0.11, h * 0.42, 0.1, w * (keyRand(key, 9) - 0.5) * 0.12, y0 + h * 0.32, -(d / 2 + 0.02));
    db.rotation.z = (keyRand(key, 7) > 0.5 ? 1 : -1) * 0.5;
  }

  function chimney(g: THREE.Group, x: number, z: number, topY: number): void {
    const shaft = new THREE.Mesh(worldUV(new THREE.BoxGeometry(0.62, topY, 0.62), 1.6), stoneMat);
    shaft.position.set(x, topY / 2, z);
    g.add(shaft);
    box(g, stoneMat, 0.86, 0.16, 0.86, x, topY + 0.08, z);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.34, 6), stoneMat);
    pot.position.set(x, topY + 0.32, z);
    g.add(pot);
  }

  // ---- houses ----
  function house(x: number, z: number, w: number, d: number, rot: number, tall = false): void {
    const g = new THREE.Group();
    const hWall = tall ? 4.2 : 3.2;
    const fH = 0.55;
    const roofH = 2.2;
    const key = x * 13.7 + z * 3.1;
    // stone foundation course, slightly proud
    const found = new THREE.Mesh(worldUV(new THREE.BoxGeometry(w + 0.34, fH, d + 0.34), 1.7), stoneMat);
    found.position.y = fH / 2;
    g.add(found);
    const walls = new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, hWall - fH, d), 2.8), wallMat);
    walls.position.y = fH + (hWall - fH) / 2;
    g.add(walls);
    timberFrame(g, w, d, fH, hWall - fH, key);
    gableRoof(g, w, d, hWall, roofH, 0.5, { gableMat: wallMat, trim: true });
    doorUnit(g, d / 2);
    if (tall) {
      // porch hood over the inn door
      const porch = new THREE.Group();
      gableRoof(porch, 1.7, 1.1, 2.55, 0.55, 0.12, { gableMat: null, trim: true });
      porch.position.z = d / 2 + 0.42;
      g.add(porch);
      for (const sx of [1, -1]) {
        const strut = box(g, woodDarkMat, 0.09, 0.95, 0.09, sx * 0.78, 2.32, d / 2 + 0.55);
        strut.rotation.x = -0.6;
      }
    }
    for (const sx of [-w / 3, w / 3]) windowUnit(g, sx, 1.9, d / 2);
    if (tall) for (const sx of [-w / 3, w / 3]) windowUnit(g, sx, 3.35, d / 2);
    // seeded rear window so the back facade isn't blank on most houses
    if (keyRand(key, 21) > 0.35) {
      const rear = new THREE.Group();
      windowUnit(rear, 0, 0, 0);
      rear.position.set((keyRand(key, 22) - 0.5) * w * 0.2, 1.9, -d / 2); // clear of the rear studs
      rear.rotation.y = Math.PI;
      g.add(rear);
    }
    chimney(g, w / 3, -d / 4, hWall + roofH + 0.35);
    g.position.set(x, ground(x, z), z);
    g.rotation.y = rot;
    group.add(shadowed(g));
  }

  // ---- chapel: gable front, pointed-arch door, rose window, octagonal spire ----
  function chapel(x: number, z: number, w: number, d: number, rot: number): void {
    const g = new THREE.Group();
    const hWall = 4;
    const fH = 0.6;
    const roofH = 2.5;
    const found = new THREE.Mesh(worldUV(new THREE.BoxGeometry(w + 0.36, fH, d + 0.36), 1.7), stoneMat);
    found.position.y = fH / 2;
    g.add(found);
    const nave = new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, hWall - fH, d), 2.8), wallMat);
    nave.position.y = fH + (hWall - fH) / 2;
    g.add(nave);
    // stone corner quoins + stepped side buttresses on the long nave walls
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) box(g, stoneMat, 0.3, hWall - fH, 0.3, sx * (w / 2), fH + (hWall - fH) / 2, sz * (d / 2));
      for (const bz of [-d / 4, 0, d / 4]) {
        box(g, stoneMat, 0.34, 2.3, 0.52, sx * (w / 2 + 0.12), fH + 1.15, bz);
        box(g, stoneMat, 0.26, 1.1, 0.4, sx * (w / 2 + 0.07), fH + 2.85, bz);
      }
      // proud stone plinth + timber mid rail give the nave wall rhythm at range
      box(g, stoneMat, 0.14, 0.32, d - 0.2, sx * (w / 2 + 0.04), fH + 0.16, 0);
      box(g, woodDarkMat, 0.12, 0.13, d - 0.2, sx * (w / 2 + 0.03), fH + 2.1, 0);
    }
    // roof ridge runs along z (gable faces the door)
    const roofG = new THREE.Group();
    gableRoof(roofG, d, w, hWall, roofH, 0.45, { gableMat: wallMat, trim: true });
    roofG.rotation.y = Math.PI / 2;
    g.add(roofG);
    // pointed-arch stone surround + recessed plank door
    const surround = new THREE.Mesh(pointedArchGeo(1.7, 1.7, 2.75, 0.26), stoneMat);
    surround.position.set(0, fH, d / 2 - 0.02);
    g.add(surround);
    const door = new THREE.Mesh(pointedArchGeo(1.24, 1.55, 2.45, 0.1), plankMat);
    door.position.set(0, fH + 0.02, d / 2 + 0.06);
    g.add(door);
    box(g, stoneMat, 1.9, 0.14, 0.6, 0, fH - 0.07, d / 2 + 0.3); // threshold step
    // rose window disc + stone ring on the gable
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.1, 12), windowMat);
    rose.rotation.x = Math.PI / 2;
    rose.position.set(0, hWall + 1.05, d / 2 + 0.16);
    noShadow.add(rose);
    g.add(rose);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.09, 5, 12), stoneMat);
    ring.position.set(0, hWall + 1.05, d / 2 + 0.18);
    g.add(ring);
    // side windows
    for (const sx of [1, -1]) {
      for (const wz of [-d / 4, d / 4]) {
        const win = new THREE.Group();
        windowUnit(win, 0, 0, 0);
        win.position.set(sx * (w / 2), 2.4, wz);
        win.rotation.y = sx * Math.PI / 2;
        g.add(win);
      }
    }
    // tower + octagonal spire + finial
    const tower = new THREE.Mesh(worldUV(new THREE.BoxGeometry(1.5, 3.4, 1.5), 2.2), wallMat);
    tower.position.set(0, hWall + 1.6, 2.2);
    g.add(tower);
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) box(g, woodDarkMat, 0.14, 3.4, 0.14, sx * 0.75, hWall + 1.6, 2.2 + sz * 0.75);
    }
    // belfry opening + louvre slats on every tower face (never a blank quad)
    for (let face = 0; face < 4; face++) {
      const bg = new THREE.Group();
      const opening = box(bg, recessMat, 0.4, 0.62, 0.05, 0, 0, 0);
      noShadow.add(opening);
      for (let slat = 0; slat < 3; slat++) {
        const louvre = box(bg, woodDarkMat, 0.44, 0.07, 0.1, 0, -0.18 + slat * 0.18, 0.03);
        louvre.rotation.x = 0.5;
      }
      box(bg, woodDarkMat, 0.52, 0.08, 0.08, 0, 0.38, 0.02); // header
      box(bg, woodDarkMat, 0.52, 0.08, 0.08, 0, -0.38, 0.02); // sill
      const ang = (face * Math.PI) / 2;
      bg.position.set(Math.sin(ang) * 0.78, hWall + 2.5, 2.2 + Math.cos(ang) * 0.78);
      bg.rotation.y = ang;
      g.add(bg);
    }
    box(g, woodDarkMat, 1.78, 0.16, 1.78, 0, hWall + 3.34, 2.2); // spire base trim
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 1.06, 2.5, 8), roofMat);
    spire.position.set(0, hWall + 4.6, 2.2);
    g.add(spire);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), metalMat);
    finial.position.set(0, hWall + 5.93, 2.2);
    g.add(finial);
    const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.04, 0.5, 4), metalMat);
    spike.position.set(0, hWall + 6.2, 2.2);
    g.add(spike);
    g.position.set(x, ground(x, z), z);
    g.rotation.y = rot;
    group.add(shadowed(g));
  }

  for (const b of PROPS.buildings) {
    if (b.kind === 'chapel') chapel(b.x, b.z, b.w, b.d, b.rot);
    else house(b.x, b.z, b.w, b.d, b.rot, b.kind === 'inn');
  }

  // ---- market stalls: paneled counter, curved striped awning, goods ----
  function stall(sx0: number, sz0: number, srot: number): void {
    const g = new THREE.Group();
    const key = sx0 * 7.7 + sz0 * 2.3;
    for (const [px, pz] of [[-1.55, -0.95], [1.55, -0.95], [-1.55, 0.95], [1.55, 0.95]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.085, 2.5, 6), woodMat);
      post.position.set(px, 1.25, pz);
      post.rotation.z = (keyRand(key, px > 0 ? 3 : 4) - 0.5) * 0.06;
      g.add(post);
    }
    const base = new THREE.Mesh(worldUV(new THREE.BoxGeometry(2.9, 0.78, 1.3), 1.4), plankMat);
    base.position.y = 0.41;
    g.add(base);
    box(g, woodDarkMat, 3.16, 0.1, 1.52, 0, 0.85, 0); // counter top slab
    for (let i = 0; i < 5; i++) {
      box(g, woodDarkMat, 0.09, 0.66, 0.06, -1.2 + i * 0.6, 0.4, 0.66); // front paneling battens
    }
    box(g, woodDarkMat, 2.9, 0.1, 0.08, 0, 0.1, 0.66); // skirt rail
    // curved scalloped awning
    const aw = new THREE.PlaneGeometry(3.7, 2.4, 10, 5);
    const ap = aw.getAttribute('position');
    for (let i = 0; i < ap.count; i++) {
      const px = ap.getX(i), py = ap.getY(i);
      let dip = -0.17 * (1 - (px / 1.85) * (px / 1.85));
      if (py < -1.05) dip -= 0.085 * Math.abs(Math.sin(px * 4.4));
      ap.setZ(i, dip);
    }
    aw.computeVertexNormals();
    const awning = new THREE.Mesh(aw, awningMat);
    awning.rotation.x = -Math.PI / 2 + 0.16;
    awning.position.y = 2.52;
    g.add(awning);
    // goods on display
    for (const [bx, bz, br] of [[-0.85, 0.1, 0.5], [-0.45, -0.25, 2.2]]) {
      const bread = new THREE.Mesh(new THREE.SphereGeometry(0.17, 7, 5), breadMat);
      bread.scale.set(1.5, 0.75, 0.85);
      bread.position.set(bx, 1.0, bz);
      bread.rotation.y = br;
      g.add(bread);
    }
    const jugPts = [[0.02, 0], [0.16, 0.02], [0.21, 0.12], [0.17, 0.27], [0.09, 0.33], [0.1, 0.41], [0.135, 0.44]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const jug = new THREE.Mesh(new THREE.LatheGeometry(jugPts, SEG), jugMat);
    jug.position.set(0.55, 0.9, 0.2);
    g.add(jug);
    box(g, plankMat, 0.62, 0.16, 0.62, 1.05, 0.98, -0.25); // apple tray
    for (let i = 0; i < 4; i++) {
      const apple = new THREE.Mesh(new THREE.SphereGeometry(0.085, 6, 5), appleMat);
      apple.position.set(0.9 + keyRand(key, 10 + i) * 0.32, 1.1, -0.4 + keyRand(key, 20 + i) * 0.32);
      g.add(apple);
    }
    g.position.set(sx0, ground(sx0, sz0), sz0);
    g.rotation.y = srot;
    group.add(shadowed(g));
  }
  for (const s of PROPS.stalls) stall(s.x, s.z, s.rot);

  // ---- wells: jittered stone drum, A-frame, windlass, rope + bucket ----
  function well(wx: number, wz: number): void {
    const g = new THREE.Group();
    const drumGeo = new THREE.CylinderGeometry(1.16, 1.32, 0.95, 12, 3);
    const dp = drumGeo.getAttribute('position');
    for (let i = 0; i < dp.count; i++) {
      const px = dp.getX(i), py = dp.getY(i), pz = dp.getZ(i);
      const rr = Math.hypot(px, pz);
      if (rr < 0.5) continue; // keep cap centers
      const k = 1 + (hash3(px, py, pz, 31) - 0.5) * 0.12;
      dp.setXYZ(i, px * k, py, pz * k);
    }
    drumGeo.computeVertexNormals();
    scaleUVs(drumGeo, 1.6);
    const drum = new THREE.Mesh(drumGeo, stoneMat);
    drum.position.y = 0.48;
    g.add(drum);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.36, 1.3, 0.16, 12), stoneMat);
    rim.position.y = 1.0;
    g.add(rim);
    // A-frame legs crossing under the ridge
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 2.1, 6), woodMat);
        leg.position.set(sx * 1.02, 1.85, sz * 0.3);
        leg.rotation.x = -sz * 0.3;
        g.add(leg);
      }
    }
    // windlass axle + crank
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.35, 6), woodDarkMat);
    axle.rotation.z = Math.PI / 2;
    axle.position.y = 2.18;
    g.add(axle);
    const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 5), woodDarkMat);
    crank.position.set(1.25, 2.05, 0);
    g.add(crank);
    // little plank gabled roof (shingle rows read as brick at this scale)
    gableRoof(g, 1.9, 1.4, 2.55, 0.95, 0.22, { gableMat: null, trim: true, mat: plankMat });
    // rope + hanging bucket
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.85, 4), ropeMat);
    rope.position.y = 1.78;
    g.add(rope);
    const bucketPts = [[0.03, 0], [0.13, 0.01], [0.17, 0.24], [0.155, 0.26]].map(([r, y]) => new THREE.Vector2(r, y));
    const bucket = new THREE.Mesh(new THREE.LatheGeometry(bucketPts, SEG), plankMat);
    bucket.position.y = 1.18;
    g.add(bucket);
    const hoop = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.05, SEG, 1, true), metalMat);
    hoop.position.y = 1.38;
    g.add(hoop);
    g.position.set(wx, ground(wx, wz), wz);
    group.add(shadowed(g));
  }
  for (const w of PROPS.wells) well(w.x, w.z);

  // ---- graveyards: shaped headstones with lean ----
  for (const gy of PROPS.graveyards) {
    for (let i = 0; i < 6; i++) {
      const gx = gy.x + (i % 3) * 2.2, gz = gy.z + Math.floor(i / 3) * 2.6;
      const st = new THREE.Group();
      const kind = i % 3;
      if (kind === 0) {
        st.add(new THREE.Mesh(archedSlabGeo(0.74, 0.78, 1.12, 0.17), stoneMat));
      } else if (kind === 1) {
        st.add(new THREE.Mesh(archedSlabGeo(0.6, 0.5, 1.3, 0.2), stoneMat));
      } else {
        const v = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.25, 0.15), stoneMat);
        v.position.y = 0.62;
        st.add(v);
        const h = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.19, 0.15), stoneMat);
        h.position.y = 0.92;
        st.add(h);
      }
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.14, 0.5), stoneMat);
      plinth.position.y = 0.04;
      st.add(plinth);
      st.position.set(gx, ground(gx, gz) - 0.04, gz);
      st.rotation.set(
        (propRand(gx, gz, 1) - 0.5) * 0.2,
        i * 0.4 + (propRand(gx, gz, 2) - 0.5) * 0.5,
        (propRand(gx, gz, 3) - 0.5) * 0.22,
      );
      group.add(shadowed(st));
    }
  }

  // ---- town fences: tapered leaning pickets + jittered rails ----
  function fenceRun(x1: number, z1: number, x2: number, z2: number): void {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.floor(len / 2.4);
    for (let i = 0; i <= n; i++) {
      const t = i / Math.max(1, n);
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      const hJit = (propRand(x, z, 1) - 0.5) * 0.14;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.095, 1.1 + hJit, 4), woodMat);
      post.rotation.y = Math.PI / 4;
      post.position.set(x, ground(x, z) + 0.52 + hJit / 2, z);
      post.rotation.x = (propRand(x, z, 2) - 0.5) * 0.13;
      post.rotation.z = (propRand(x, z, 3) - 0.5) * 0.13;
      group.add(shadowed(post));
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.14, 4), woodMat);
      cap.position.set(x, ground(x, z) + 1.1 + hJit, z);
      cap.rotation.copy(post.rotation);
      group.add(shadowed(cap));
      if (i < n) {
        const nx = x1 + (x2 - x1) * ((i + 0.5) / n), nz = z1 + (z2 - z1) * ((i + 0.5) / n);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 2.45), woodMat);
        rail.position.set(nx, ground(nx, nz) + 0.84 + (propRand(nx, nz, 4) - 0.5) * 0.07, nz);
        rail.lookAt(x2, rail.position.y, z2);
        rail.rotation.z = (propRand(nx, nz, 5) - 0.5) * 0.1;
        group.add(shadowed(rail));
        const rail2 = rail.clone();
        rail2.position.y -= 0.4;
        rail2.rotation.z = (propRand(nx, nz, 6) - 0.5) * 0.1;
        group.add(rail2);
      }
    }
  }
  for (const f of PROPS.fences) fenceRun(f.x1, f.z1, f.x2, f.z2);

  // ---- campfires: leaning tapered logs, boulder ring, teardrop flame ----
  const flamePts = [[0, 0], [0.16, 0.1], [0.27, 0.28], [0.3, 0.45], [0.22, 0.66], [0.1, 0.84], [0.001, 0.95]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const flameGeo = new THREE.LatheGeometry(flamePts, 7);
  const upVec = new THREE.Vector3(0, 1, 0);
  function campfire(x: number, z: number): void {
    const g = new THREE.Group();
    const y = ground(x, z);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + propRand(x, z, i) * 0.5;
      const logGeo = new THREE.CylinderGeometry(0.05, 0.085, 1.15, 5);
      logGeo.translate(0, 0.575, 0);
      const log = new THREE.Mesh(logGeo, woodDarkMat);
      const e = 0.55 + propRand(x, z, i + 9) * 0.18;
      const dir = new THREE.Vector3(-Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
      log.quaternion.setFromUnitVectors(upVec, dir);
      log.position.set(Math.sin(a) * 0.58, 0.05, Math.cos(a) * 0.58);
      g.add(log);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + propRand(x, z, i + 30) * 0.5;
      const r = 0.78 + (propRand(x, z, i + 40) - 0.5) * 0.12;
      const stone = new THREE.Mesh(boulderGeo(0.16 + propRand(x, z, i + 50) * 0.07, i + 3, 0), stoneMat);
      stone.position.set(Math.sin(a) * r, 0.07, Math.cos(a) * r);
      stone.rotation.y = propRand(x, z, i + 60) * Math.PI;
      g.add(stone);
    }
    const flame = new THREE.Mesh(flameGeo, new THREE.MeshLambertMaterial({
      color: 0xffaa33, emissive: 0xff6600, emissiveIntensity: usePbr ? 2.2 : 1.4,
      transparent: true, opacity: 0.92,
    }));
    flame.position.y = 0.12;
    g.add(flame);
    flames.push(flame);
    const light = new THREE.PointLight(0xff8830, 12, 16, 2);
    light.position.y = 1.2;
    g.add(light);
    fireLights.push(light);
    g.position.set(x, y, z);
    group.add(shadowed(g));
    noShadow.add(flame);
  }
  for (const [x, z] of PROPS.campfires) campfire(x, z);

  // ---- bandit tents: draped cloth with panel sag, crossed poles, door flap ----
  function tent(x: number, z: number, rot: number, scale = 1): void {
    const g = new THREE.Group();
    const r0 = 1.85 * scale, h = 2.3 * scale;
    const body = new THREE.CylinderGeometry(1, 1, h, usePbr ? 12 : 8, 6, true);
    const bp = body.getAttribute('position');
    const quarter = Math.PI / 2;
    for (let i = 0; i < bp.count; i++) {
      const py = bp.getY(i);
      const t = (py + h / 2) / h;
      const a = Math.atan2(bp.getZ(i), bp.getX(i));
      // seams offset 45deg so the door (at +z) lands mid-panel where sag is deepest
      const p = (((a + Math.PI / 4) % quarter) + quarter) % quarter / quarter;
      const mid = 1 - Math.abs(p * 2 - 1);
      let r = (1 - t) * r0 + t * 0.07 * scale;
      r *= 1 - 0.22 * mid * Math.sin(Math.PI * Math.min(1, t * 1.2));
      r += (1 - t) * 0.07 * scale * Math.sin(a * 7 + 1.3);
      bp.setXYZ(i, Math.cos(a) * r, py, Math.sin(a) * r);
    }
    // tighten the weave repeat so texel rows can't smear into wide bands
    const buv = body.getAttribute('uv');
    for (let i = 0; i < buv.count; i++) buv.setXY(i, buv.getX(i) * 3, buv.getY(i) * 2.4);
    body.computeVertexNormals();
    const cloth = new THREE.Mesh(body, canvasMat);
    cloth.position.y = h / 2;
    g.add(cloth);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.16 * scale, 0.34 * scale, 6), canvasMat);
    cap.position.y = h + 0.04 * scale;
    g.add(cap);
    // crossed ridge poles poking out of the apex in a visible X
    for (const s of [1, -1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, h + 1.3 * scale, 5), woodMat);
      pole.rotation.z = s * 0.3;
      pole.position.y = (h + 0.85 * scale) / 2;
      pole.position.x = -s * 0.12 * scale;
      g.add(pole);
    }
    // shadowed door opening recessed behind a canvas rim, + folded-back flap
    const tilt = Math.atan2(r0 - 0.07 * scale, h);
    const doorShape = new THREE.Shape();
    doorShape.moveTo(-0.52 * scale, 0);
    doorShape.lineTo(0.52 * scale, 0);
    doorShape.lineTo(0, 1.5 * scale);
    doorShape.closePath();
    const hole = new THREE.Mesh(new THREE.ShapeGeometry(doorShape), recessMat);
    hole.position.set(0, 0.02, 1.78 * scale);
    hole.rotation.x = -tilt;
    noShadow.add(hole);
    g.add(hole);
    // rolled canvas rim strips along the opening edges (hide the cut edge)
    for (const sr of [1, -1]) {
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05 * scale, 0.065 * scale, 1.6 * scale, 5), canvasDarkMat);
      rim.position.set(sr * 0.27 * scale, 0.72 * scale, 1.85 * scale - 0.72 * scale * Math.tan(tilt) * 0.9);
      rim.rotation.z = sr * 0.33;
      rim.rotation.x = -tilt;
      g.add(rim);
    }
    // door flap: darker shaded canvas, curved like dropped fabric, overlapping
    // half of the opening
    const flapShape = new THREE.Shape();
    flapShape.moveTo(0, 0);
    flapShape.lineTo(0.78 * scale, 0);
    flapShape.quadraticCurveTo(0.55 * scale, 0.75 * scale, 0, 1.5 * scale);
    flapShape.closePath();
    const flapGeo = new THREE.ShapeGeometry(flapShape, 6);
    const fp = flapGeo.getAttribute('position');
    for (let i = 0; i < fp.count; i++) {
      // belly the flap outward so it drapes instead of lying flat
      const fx = fp.getX(i), fy = fp.getY(i);
      fp.setZ(i, fp.getZ(i) + Math.sin(Math.min(1, fy / (1.5 * scale)) * Math.PI) * 0.1 * scale + fx * 0.12);
    }
    flapGeo.computeVertexNormals();
    const flap = new THREE.Mesh(flapGeo, canvasDarkMat);
    flap.position.set(-0.42 * scale, 0.02, 1.86 * scale);
    flap.rotation.y = 0.45;
    flap.rotation.x = -tilt * 0.8;
    flap.rotation.z = -0.08;
    g.add(flap);
    g.position.set(x, ground(x, z), z);
    g.rotation.y = rot;
    group.add(shadowed(g));
  }
  for (const t of PROPS.tents) tent(t.x, t.z, t.rot, t.scale);

  // ---- crates: plank box with corner braces + edge strips ----
  for (const [x, z] of PROPS.crates) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(worldUV(new THREE.BoxGeometry(0.84, 0.84, 0.84), 0.95), plankMat);
    body.position.y = 0.45;
    g.add(body);
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) box(g, woodDarkMat, 0.1, 0.92, 0.1, sx * 0.4, 0.45, sz * 0.4);
    }
    for (const sy of [0.06, 0.84]) {
      for (const s of [1, -1]) {
        box(g, woodDarkMat, 0.88, 0.08, 0.08, 0, sy, s * 0.41);
        box(g, woodDarkMat, 0.08, 0.08, 0.88, s * 0.41, sy, 0);
      }
    }
    g.position.set(x, ground(x, z), z);
    g.rotation.y = (x * 13 + z * 7) % 1;
    g.rotation.x = (propRand(x, z, 7) - 0.5) * 0.05;
    group.add(shadowed(g));
  }

  // ---- shared barrel (lathe staves + iron hoops) ----
  const barrelPts = [[0.03, 0], [0.26, 0.01], [0.32, 0.12], [0.36, 0.3], [0.375, 0.42], [0.36, 0.54], [0.32, 0.72], [0.26, 0.83], [0.03, 0.84]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  function barrel(g: THREE.Group, x: number, y: number, z: number): void {
    const b = new THREE.Mesh(new THREE.LatheGeometry(barrelPts, usePbr ? 11 : 8), plankMat);
    b.position.set(x, y, z);
    g.add(b);
    for (const [hy, hr] of [[0.16, 0.345], [0.68, 0.34]]) {
      const hoop = new THREE.Mesh(new THREE.CylinderGeometry(hr, hr, 0.07, usePbr ? 11 : 8, 1, true), metalMat);
      hoop.position.set(x, y + hy, z);
      g.add(hoop);
    }
  }

  // ---- mine entrances: beveled timber portal, boulder surround, cart, lantern ----
  function mine(x: number, z: number, rot: number): void {
    const g = new THREE.Group();
    for (const sx of [-1.4, 1.4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 3.45, 4), woodMat);
      post.rotation.y = Math.PI / 4;
      post.position.set(sx, 1.72, 0);
      g.add(post);
      box(g, stoneMat, 0.85, 0.3, 0.85, sx, 0.12, 0.05); // footing pad
      const brace = box(g, woodMat, 0.18, 0.95, 0.2, sx * 0.78, 2.85, 0.05);
      brace.rotation.z = sx > 0 ? 0.65 : -0.65;
    }
    box(g, woodMat, 3.9, 0.5, 0.62, 0, 3.32, 0); // lintel
    box(g, woodMat, 4.4, 0.24, 0.78, 0, 3.7, 0); // cap beam
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3), holeMat);
    hole.position.set(0, 1.5, -0.2);
    noShadow.add(hole);
    g.add(hole);
    // noise-displaced boulder pile swallowing the portal
    const rocks: [number, number, number, number][] = [
      [0, 2.6, -2.8, 2.7], [-2.9, 1.0, -2.0, 1.9], [2.9, 1.1, -2.2, 2.0],
      [-1.6, 0.5, -0.9, 1.1], [1.8, 0.45, -0.8, 1.0], [0.3, 4.0, -4.4, 2.2],
    ];
    for (let i = 0; i < rocks.length; i++) {
      const [rx, ry, rz, rr] = rocks[i];
      const rock = new THREE.Mesh(boulderGeo(rr, i + 11, ROCK_DETAIL, 0.72), stoneMat);
      rock.position.set(rx, ry, rz);
      rock.rotation.y = propRand(x, z, i + 70) * Math.PI;
      g.add(rock);
    }
    // ore cart on plank wheels
    const cart = new THREE.Group();
    const cartBody = new THREE.Mesh(worldUV(new THREE.BoxGeometry(1.35, 0.55, 0.85), 0.9), plankMat);
    cartBody.position.y = 0.62;
    cart.add(cartBody);
    for (const s of [1, -1]) {
      box(cart, woodDarkMat, 1.42, 0.1, 0.09, 0, 0.92, s * 0.43);
      for (const sx of [1, -1]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.09, SEG), woodDarkMat);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(sx * 0.42, 0.24, s * 0.5);
        cart.add(wheel);
      }
    }
    for (let i = 0; i < 3; i++) {
      const ore = new THREE.Mesh(boulderGeo(0.22 + propRand(x, z, i + 80) * 0.08, i + 21, 0, 1), oreMat);
      ore.position.set(-0.3 + i * 0.32, 1.0, (propRand(x, z, i + 90) - 0.5) * 0.3);
      cart.add(ore);
    }
    cart.position.set(2.8, 0, 1.6);
    cart.rotation.y = 0.5;
    g.add(cart);
    // hanging lantern on the portal frame
    const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 4), metalMat);
    hook.position.set(1.15, 2.95, 0.42);
    hook.rotation.x = Math.PI / 2;
    g.add(hook);
    const lampTop = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.12, 6), metalMat);
    lampTop.position.set(1.15, 2.78, 0.52);
    g.add(lampTop);
    const lampGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.105, 0.2, 6), lanternMat);
    lampGlass.position.set(1.15, 2.62, 0.52);
    noShadow.add(lampGlass);
    g.add(lampGlass);
    g.position.set(x, ground(x, z), z);
    g.rotation.y = rot;
    group.add(shadowed(g));
  }
  for (const m of PROPS.mines) mine(m.x, m.z, m.rot);

  // ---- ruin rings: entasis columns with jagged broken tops ----
  function columnGeo(h: number, key: number, capital: boolean): THREE.BufferGeometry {
    const geo = new THREE.CylinderGeometry(1, 1, h, SEG, 4);
    profileRings(geo, h, (t) => {
      const base = 0.52 - 0.1 * t;
      return base * (1 + 0.09 * Math.sin(Math.PI * Math.min(1, t * 1.25)));
    });
    if (!capital) {
      // jagged break: rim + cap verts drop by an angle-keyed amount
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < h / 2 - 0.01) continue;
        const a = Math.atan2(pos.getZ(i), pos.getX(i));
        const n = hash3(Math.cos(a), Math.sin(a), 0, key);
        pos.setY(i, pos.getY(i) - 0.12 - n * 0.55);
      }
    }
    const flat = geo.toNonIndexed();
    flat.computeVertexNormals();
    return flat;
  }
  function ruinColumn(h: number, key: number, capital: boolean): THREE.Group {
    const c = new THREE.Group();
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.2, 0.98), stoneMat);
    plinth.position.y = 0.1;
    c.add(plinth);
    const baseRing = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.66, 0.18, SEG), stoneMat);
    baseRing.position.y = 0.26;
    c.add(baseRing);
    const shaft = new THREE.Mesh(columnGeo(h, key, capital), stoneMat);
    shaft.position.y = 0.34 + h / 2;
    c.add(shaft);
    if (capital) {
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.46, 0.22, SEG), stoneMat);
      neck.position.y = 0.34 + h + 0.08;
      c.add(neck);
      const abacus = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.18, 0.95), stoneMat);
      abacus.position.y = 0.34 + h + 0.27;
      c.add(abacus);
    }
    return c;
  }
  function ruins(cx: number, cz: number, ringR: number, columns: number): void {
    for (let i = 0; i < columns; i++) {
      const ang = (i / columns) * Math.PI * 2;
      const x = cx + Math.sin(ang) * ringR, z = cz + Math.cos(ang) * ringR;
      const h = i % 3 === 0 ? 1.1 : 2.4 + (i % 2) * 1.2;
      const intact = i % 4 === 1;
      const col = ruinColumn(h, i * 17 + 5, intact);
      col.position.set(x, ground(x, z) - 0.06, z);
      col.rotation.y = propRand(x, z, 8) * Math.PI;
      col.rotation.z = (i % 3 === 0 ? 0.16 : 0.03) * (i % 2 ? 1 : -1);
      group.add(shadowed(col));
    }
    // fallen column cracked into drifting segments
    const fy = ground(cx - 2, cz - 3);
    for (let s = 0; s < 3; s++) {
      const segGeo = new THREE.CylinderGeometry(1, 1, 1.06, SEG, 2);
      profileRings(segGeo, 1.06, () => 0.46 + 0.03 * Math.sin(s * 2.1));
      const pos = segGeo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getY(i)) < 0.52) continue;
        const a = Math.atan2(pos.getZ(i), pos.getX(i));
        pos.setY(i, pos.getY(i) - Math.sign(pos.getY(i)) * hash3(Math.cos(a), Math.sin(a), s, 77) * 0.2);
      }
      const flatSeg = segGeo.toNonIndexed();
      flatSeg.computeVertexNormals();
      const piece = new THREE.Mesh(flatSeg, stoneMat);
      piece.rotation.z = Math.PI / 2 + (propRand(cx, cz, s + 100) - 0.5) * 0.12;
      piece.rotation.y = 0.6 + (propRand(cx, cz, s + 110) - 0.5) * 0.3;
      piece.position.set(
        cx - 2 + Math.cos(0.6) * (s - 1) * 1.3,
        fy + 0.38,
        cz - 3 - Math.sin(0.6) * (s - 1) * 1.3,
      );
      group.add(shadowed(piece));
    }
    // broken arch: intact column carrying a tipped lintel chunk
    const archCol = ruinColumn(3.3, 999, true);
    archCol.position.set(cx, ground(cx, cz + 8) - 0.05, cz + 8);
    group.add(shadowed(archCol));
    const lintelGeo = new THREE.BoxGeometry(2.2, 0.62, 0.74, 2, 2, 2);
    const lp = lintelGeo.getAttribute('position');
    for (let i = 0; i < lp.count; i++) {
      const k = hash3(lp.getX(i), lp.getY(i), lp.getZ(i), 13);
      lp.setXYZ(i, lp.getX(i) + (k - 0.5) * 0.09, lp.getY(i) + (k - 0.5) * 0.07, lp.getZ(i) + (k - 0.5) * 0.09);
    }
    const lintelFlat = lintelGeo.toNonIndexed();
    lintelFlat.computeVertexNormals();
    const lintel = new THREE.Mesh(lintelFlat, stoneMat);
    lintel.position.set(cx + 1, ground(cx, cz + 8) + 4.0, cz + 8);
    lintel.rotation.z = -0.18;
    group.add(shadowed(lintel));
  }
  for (const r of PROPS.ruinRings) ruins(r.x, r.z, r.ringR, r.columns);

  // ---- fishing docks: planked deck, mooring posts with rope rings, mini house hut ----
  function dock(x: number, z: number, rot: number, hutLocal: { x: number; z: number; hw: number; hd: number }): void {
    const y = ground(x, z);
    const g = new THREE.Group();
    const key = x * 3.3 + z * 1.7;
    // individual deck planks with gaps + jitter
    for (let i = 0; i < 11; i++) {
      const pz = -6.35 + i * 0.62;
      const plank = new THREE.Mesh(worldUV(new THREE.BoxGeometry(1.8, 0.09, 0.52), 1.3), plankMat);
      plank.position.set(0, 0.42 + (keyRand(key, i) - 0.5) * 0.025, pz);
      plank.rotation.y = (keyRand(key, i + 12) - 0.5) * 0.035;
      g.add(plank);
    }
    for (const sx of [1, -1]) box(g, woodDarkMat, 0.13, 0.15, 7.1, sx * 0.78, 0.32, -3); // stringers
    for (const [px, pz] of [[-0.85, -1], [0.85, -1], [-0.85, -4.5], [0.85, -4.5]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 2.0, 6), woodDarkMat);
      post.position.set(px, -0.2, pz);
      g.add(post);
    }
    // mooring posts rising above deck, rope rings sagging on them
    for (const [px, pz] of [[-0.85, -6.2], [0.85, -6.2]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 2.9, 6), woodDarkMat);
      post.position.set(px, 0.25, pz);
      post.rotation.z = px > 0 ? 0.06 : -0.06;
      g.add(post);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.11, 0.1, 6), woodDarkMat);
      cap.position.set(px + (px > 0 ? -0.08 : 0.08), 1.72, pz);
      g.add(cap);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 5, 9), ropeMat);
      ring.position.set(px, 1.35, pz);
      ring.rotation.x = Math.PI / 2 - 0.25;
      g.add(ring);
    }
    // hut: the house treatment in miniature
    const hut = new THREE.Group();
    const hw = hutLocal.hw * 2, hd = hutLocal.hd * 2;
    const hutWalls = new THREE.Mesh(worldUV(new THREE.BoxGeometry(hw, 2.2, hd), 2.4), wallMat);
    hutWalls.position.y = 1.1;
    hut.add(hutWalls);
    timberFrame(hut, hw, hd, 0, 2.2, key + 3);
    gableRoof(hut, hw, hd, 2.2, 1.15, 0.35, { gableMat: wallMat, trim: true });
    doorUnit(hut, hd / 2, 0.95, 1.8);
    windowUnit(hut, -hw / 4, 1.5, hd / 2);
    hut.position.set(hutLocal.x, 0, hutLocal.z);
    g.add(hut);
    barrel(g, 1, 0.4, 0.5);
    barrel(g, 0.45, 0.4, 1.1);
    g.position.set(x, y, z);
    g.rotation.y = rot;
    group.add(shadowed(g));
  }
  for (const d of PROPS.docks) dock(d.x, d.z, d.rot, d.hutLocal);

  // ---- murloc mud huts: lumpen hand-packed domes, ragged thatch, doorways
  // facing the camp center so players actually see them ----
  const hutCenter = PROPS.mudHuts.reduce(
    (acc, [hx, hz]) => ({ x: acc.x + hx / PROPS.mudHuts.length, z: acc.z + hz / PROPS.mudHuts.length }),
    { x: 0, z: 0 },
  );
  for (const [x, z] of PROPS.mudHuts) {
    const g = new THREE.Group();
    const hutSeed = Math.round(x * 7 + z * 13);
    const domeGeo = new THREE.SphereGeometry(1.25, usePbr ? 11 : 8, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    const dp = domeGeo.getAttribute('position');
    for (let i = 0; i < dp.count; i++) {
      const px = dp.getX(i), py = dp.getY(i), pz = dp.getZ(i);
      // strong noise over the FULL height — the base must not stay a perfect circle
      const infl = 0.45 + 0.55 * (py / 1.25);
      const k = 1 + (hash3(px, py, pz, 7 + hutSeed) - 0.5) * 0.3 * infl;
      dp.setXYZ(i, px * k, py * (0.86 + (hash3(px, py, pz, 8 + hutSeed) - 0.5) * 0.1 * infl), pz * k);
    }
    domeGeo.computeVertexNormals();
    const dome = new THREE.Mesh(domeGeo, mudMat);
    g.add(dome);
    // thatch skirt: radius AND hem jittered so the fringe hangs unevenly
    const skirtGeo = new THREE.CylinderGeometry(1.3, 1.52, 0.5, 12, 2, true);
    const sp = skirtGeo.getAttribute('position');
    for (let i = 0; i < sp.count; i++) {
      const a = Math.atan2(sp.getZ(i), sp.getX(i));
      const rJit = 1 + (hash3(Math.cos(a), Math.sin(a), sp.getY(i), 11 + hutSeed) - 0.5) * 0.18;
      let py = sp.getY(i);
      if (py < -0.24) py += (hash3(Math.cos(a), Math.sin(a), 0, 9 + hutSeed) - 0.5) * 0.22;
      sp.setXYZ(i, sp.getX(i) * rJit, py, sp.getZ(i) * rJit);
    }
    skirtGeo.computeVertexNormals();
    const skirt = new THREE.Mesh(skirtGeo, thatchMat);
    skirt.position.y = 0.62;
    g.add(skirt);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.34, 6), thatchMat);
    knot.position.y = 1.12;
    knot.rotation.z = (propRand(x, z, 12) - 0.5) * 0.3;
    g.add(knot);
    // doorway aimed at the camp heart, sunk into a mud lip
    const face = Math.atan2(hutCenter.x - x, hutCenter.z - z);
    const doorway = new THREE.Mesh(new THREE.CircleGeometry(0.4, 8, 0, Math.PI), recessMat);
    doorway.position.set(Math.sin(face) * 1.08, 0.03, Math.cos(face) * 1.08);
    doorway.rotation.y = face;
    doorway.rotation.x = -0.12;
    noShadow.add(doorway);
    g.add(doorway);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 5, 8, Math.PI), mudMat);
    lip.position.set(Math.sin(face) * 1.12, 0.05, Math.cos(face) * 1.12);
    lip.rotation.y = face;
    g.add(lip);
    // hand-built lean: per-hut tilt + squash
    g.rotation.x = (propRand(x, z, 13) - 0.5) * 0.14;
    g.rotation.z = (propRand(x, z, 14) - 0.5) * 0.14;
    g.scale.set(0.92 + propRand(x, z, 15) * 0.25, 0.88 + propRand(x, z, 16) * 0.3, 0.92 + propRand(x, z, 17) * 0.25);
    g.position.set(x, ground(x, z), z);
    group.add(shadowed(g));
  }

  const staticMeshes = mergeStaticMeshes(group, new Set(flames));
  return {
    group,
    flames,
    fireLights,
    update(camX: number, camZ: number, fogFar: number): void {
      for (const sm of staticMeshes) {
        const sphere = sm.geometry.boundingSphere;
        if (!sphere) continue;
        sm.visible = Math.hypot(sphere.center.x - camX, sphere.center.z - camZ) - sphere.radius < fogFar;
      }
    },
  };
}

// Bake every static prop mesh into world space and merge per
// (material, castShadow, z-band). Flames (animated) survive untouched, as do
// the PointLights (not meshes). The merged meshes replace the originals on
// the same group; emptied sub-groups are left in place (they carry lights).
// Geometries are de-indexed before merging so indexed primitives and the
// noise-displaced non-indexed shapes can share a bucket.
function mergeStaticMeshes(group: THREE.Group, keep: Set<THREE.Object3D>): THREE.Mesh[] {
  group.updateMatrixWorld(true);
  interface Bucket { material: THREE.Material; castShadow: boolean; geoms: THREE.BufferGeometry[] }
  const buckets = new Map<string, Bucket>();
  const merged: THREE.Mesh[] = [];
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || keep.has(mesh)) return;
    const material = mesh.material as THREE.Material;
    const worldZ = mesh.matrixWorld.elements[14];
    const band = Math.floor((worldZ - WORLD_MIN_Z) / MERGE_BAND_DEPTH);
    const key = `${material.uuid}:${mesh.castShadow ? 1 : 0}:${band}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material, castShadow: mesh.castShadow, geoms: [] };
      buckets.set(key, bucket);
    }
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    bucket.geoms.push(geo.applyMatrix4(mesh.matrixWorld));
    merged.push(mesh);
  });
  for (const mesh of merged) {
    mesh.removeFromParent();
    mesh.geometry.dispose(); // never uploaded — merge runs before first render
  }
  const out: THREE.Mesh[] = [];
  for (const bucket of buckets.values()) {
    const geo = mergeGeometries(bucket.geoms, false);
    if (!geo) continue;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, bucket.material);
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    out.push(mesh);
  }
  return out;
}
