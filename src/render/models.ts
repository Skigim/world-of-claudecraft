import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Entity, MobFamily } from '../sim/types';
import { MOBS } from '../sim/data';
import { addRimGlow, GFX, surfaceMat } from './gfx';
import { clothNormalTexture } from './textures';

// Procedural character rigs. Every build function returns a group plus the
// animatable parts; the renderer drives walk/attack cycles.
//
// Builders assemble parts from throwaway flat-color Lambert meshes; a final
// merge pass (finalizeRig) bakes those colors into vertex colors and collapses
// everything under each animation pivot into one or two meshes sharing a
// handful of global materials (Standard + fresnel rim on the lit tiers,
// Lambert on low). A 20-draw humanoid becomes ~8 draws and every rig in the
// world shares the same few shader programs. Emissive details (eyes, orbs,
// flames) stay separate meshes via surfaceMat.
//
// Style: hand-crafted stylized low-poly. No raw primitives — every form is a
// tapered capsule, shaped lathe/extrude or noise-displaced polyhedron so
// nothing reads as an unshaped box up close.

export interface RigParts {
  leftArm?: THREE.Object3D;
  rightArm?: THREE.Object3D;
  leftLeg?: THREE.Object3D;
  rightLeg?: THREE.Object3D;
  legs?: THREE.Object3D[]; // quadruped/spider legs (alternating phase by index)
  head?: THREE.Object3D;
  tail?: THREE.Object3D;
  flame?: THREE.Object3D; // kobold candle
}

export interface Rig {
  body: THREE.Group;
  parts: RigParts;
  kind: 'humanoid' | 'wolf' | 'boar' | 'spider' | 'murloc' | 'kobold' | 'skeleton' | 'sheep' | 'elemental' | 'dragonkin';
  height: number;
  // head pivot rest height, captured by finalizeRig so the idle-breathing
  // animation can assign an absolute Y instead of accumulating drift
  headRestY?: number;
}

interface PlainOpts {
  flat?: boolean;
  /** sword blades / mace heads: metalness 0.6, roughness 0.4 after the merge */
  metal?: boolean;
  side?: THREE.Side;
}

// Throwaway flat-color part; finalizeRig() bakes the color into vertex colors
// and merges it away. userData.metal survives into the merge bucket.
function plain(geo: THREE.BufferGeometry, color: number, opts?: PlainOpts): THREE.Mesh {
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    color, flatShading: opts?.flat === true, side: opts?.side ?? THREE.FrontSide,
  }));
  if (opts?.metal) m.userData.metal = true;
  m.castShadow = true;
  return m;
}

function box(w: number, h: number, d: number, color: number, opts?: PlainOpts): THREE.Mesh {
  return plain(new THREE.BoxGeometry(w, h, d), color, opts);
}

// ---------------------------------------------------------------------------
// Organic shape helpers — deterministic only (sin-hash, no Math.random)
// ---------------------------------------------------------------------------

// deterministic 0..1 hash (same family as the foliage hashAt)
function hash01(a: number, b: number, k: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

// Scale x/z per vertex by a profile of the normalized height t (0 bottom →
// 1 top), then recompute smooth normals. Turns capsules into organic forms.
function shapeY(geo: THREE.BufferGeometry, profile: (t: number) => number): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox!;
  const span = Math.max(1e-6, max.y - min.y);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - min.y) / span;
    const s = profile(t);
    pos.setX(i, pos.getX(i) * s);
    pos.setZ(i, pos.getZ(i) * s);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Tapered organic limb on its local Y axis: rTop at the top, rBot at the
// bottom, rounded capsule ends. The straight section is `len` long.
function limbGeo(rTop: number, rBot: number, len: number, radial = 7): THREE.BufferGeometry {
  const r = Math.max(rTop, rBot);
  const geo = new THREE.CapsuleGeometry(r, len, 3, radial);
  return shapeY(geo, (t) => (rBot + (rTop - rBot) * t) / r);
}

function limb(rTop: number, rBot: number, len: number, color: number, opts?: PlainOpts): THREE.Mesh {
  return plain(limbGeo(rTop, rBot, len), color, opts);
}

// Faceted boulder: icosahedron with seeded per-vertex radial noise. The hash
// keys off quantized position so duplicated (non-indexed) verts displace
// together and the surface stays crack-free.
function boulderGeo(r: number, seed: number, amp = 0.3, detail = 1): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(r, detail);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = hash01(Math.round(x * 41), Math.round(y * 53) + Math.round(z * 29), seed);
    const s = 1 - amp / 2 + n * amp;
    pos.setXYZ(i, x * s, y * s, z * s);
  }
  geo.computeVertexNormals();
  return geo;
}

// Quantized-hash vertex displacement along the normal — muscle/hide
// lumpiness for organic rigs. Seam-safe: keys off quantized position so
// coincident verts displace together.
function lumpy(geo: THREE.BufferGeometry, seed: number, amp: number): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = hash01(Math.round(x * 17), Math.round(y * 13) + Math.round(z * 19), seed) - 0.5;
    pos.setXYZ(i, x + nrm.getX(i) * n * amp, y + nrm.getY(i) * n * amp, z + nrm.getZ(i) * n * amp);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Pull a saturated palette color toward stylized dyed cloth — pure primaries
// straight from the sim palette read as plastic.
function muted(color: number, amount = 0.18): number {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s * (1 - amount), hsl.l);
  return c.getHex();
}

// Mitten hand: rounded palm + thumb toward the body (sx = which arm).
function handMesh(color: number, sx: number, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const palmGeo = new THREE.SphereGeometry(0.105, 8, 6);
  palmGeo.scale(0.8, 1.2, 0.95);
  g.add(plain(palmGeo, color));
  const thumb = plain(new THREE.CapsuleGeometry(0.034, 0.06, 2, 5), color);
  thumb.position.set(-sx * 0.075, 0.03, 0.045);
  thumb.rotation.z = sx * 0.5;
  g.add(thumb);
  g.scale.setScalar(scale);
  return g;
}

// Boot with a toe cap; origin at the ankle, sole ~0.08 below origin.
function bootMesh(color: number, w = 1): THREE.Group {
  const g = new THREE.Group();
  const ankle = plain(new THREE.CylinderGeometry(0.105 * w, 0.125 * w, 0.14, 8), color);
  g.add(ankle);
  const toeGeo = new THREE.CapsuleGeometry(0.1 * w, 0.14, 2, 7);
  toeGeo.rotateX(Math.PI / 2);
  toeGeo.scale(1.05, 0.6, 1);
  const toe = plain(toeGeo, color);
  toe.position.set(0, -0.04, 0.12);
  g.add(toe);
  const heel = plain(new THREE.CylinderGeometry(0.1 * w, 0.11 * w, 0.05, 8), shade(color, 0.8));
  heel.position.set(0, -0.055, -0.02);
  g.add(heel);
  return g;
}

// Readable stylized face: white sclera + dark pupil (contrast survives past
// 4u), dark brow bar, nose wedge and a mouth seam.
function addFace(head: THREE.Object3D, skin: number, o?: {
  eyeY?: number; z?: number; eyeColor?: number; eyeR?: number; spread?: number; brow?: number;
}): void {
  const z = o?.z ?? 0.2;
  const eyeY = o?.eyeY ?? 0.02;
  const spread = o?.spread ?? 0.095;
  const eyeR = o?.eyeR ?? 0.055;
  for (const sx of [-1, 1]) {
    const sclera = plain(new THREE.SphereGeometry(eyeR, 7, 6), 0xf4efe2);
    sclera.scale.set(1, 0.82, 0.55);
    sclera.position.set(sx * spread, eyeY, z + 0.03);
    head.add(sclera);
    const pupil = plain(new THREE.SphereGeometry(eyeR * 0.46, 6, 5), o?.eyeColor ?? 0x2a1c10);
    pupil.position.set(sx * spread, eyeY, z + 0.03 + eyeR * 0.5);
    head.add(pupil);
  }
  const browGeo = new THREE.CapsuleGeometry(0.03, 0.2, 2, 5);
  browGeo.rotateZ(Math.PI / 2);
  const brow = plain(browGeo, o?.brow ?? 0x3a2a18);
  brow.scale.set(1, 0.75, 0.85);
  brow.position.set(0, eyeY + 0.09, z + 0.02);
  head.add(brow);
  const noseGeo = new THREE.ConeGeometry(0.045, 0.13, 5);
  noseGeo.rotateX(Math.PI / 2);
  const nose = plain(noseGeo, shade(skin, 0.92));
  nose.position.set(0, eyeY - 0.07, z + 0.045);
  head.add(nose);
  const mouthGeo = new THREE.CapsuleGeometry(0.016, 0.08, 2, 4);
  mouthGeo.rotateZ(Math.PI / 2);
  const mouth = plain(mouthGeo, shade(skin, 0.52));
  mouth.scale.set(1, 0.7, 0.5);
  mouth.position.set(0, eyeY - 0.155, z + 0.035);
  head.add(mouth);
}

// ---------------------------------------------------------------------------
// Rig merge pass
// ---------------------------------------------------------------------------

// Shared merged-rig materials: (flat | metal | side | tier) -> one material
// for every rig in the world. Rim glow sells silhouettes on the lit tiers.
const rigMatCache = new Map<string, THREE.Material>();
let clothNormal: THREE.Texture | null = null;

function rigMergedMat(flat: boolean, metal: boolean, side: THREE.Side): THREE.Material {
  const key = `${flat ? 1 : 0}:${metal ? 1 : 0}:${side}:${GFX.standardMaterials ? 1 : 0}`;
  const cached = rigMatCache.get(key);
  if (cached) return cached;
  if (GFX.standardMaterials && !clothNormal) clothNormal = clothNormalTexture();
  const mat = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: flat, side,
      roughness: metal ? 0.4 : 0.85, metalness: metal ? 0.6 : 0,
      // weave normal on cloth/skin so broad surfaces pick up light texture
      normalMap: metal ? null : clothNormal,
      normalScale: new THREE.Vector2(0.8, 0.8),
    })
    : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: flat, side });
  if (GFX.standardMaterials) addRimGlow(mat);
  rigMatCache.set(key, mat);
  return mat;
}

// plain Lambert color-only meshes can merge; emissive/textured ones cannot
function isMergeable(mesh: THREE.Mesh): boolean {
  if (Array.isArray(mesh.material)) return false;
  const mat = mesh.material;
  if (!(mat instanceof THREE.MeshLambertMaterial)) return false;
  if (mat.map || mat.transparent || mat.opacity < 1 || mat.vertexColors) return false;
  if (mat.emissive.r > 0 || mat.emissive.g > 0 || mat.emissive.b > 0) return false;
  return true;
}

// Bakes the part color into vertex colors with a cheap top-light AO: faces
// looking down sit in their own shade, top faces catch the sky. Sells contact
// and form on rigs without a real AO pass (GTAO is ultra-only).
function bakeColor(geo: THREE.BufferGeometry, color: THREE.Color): void {
  const count = geo.attributes.position.count;
  const pos = geo.attributes.position;
  const normal = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const ny = normal ? normal.getY(i) : 0;
    let shade = ny >= 0 ? 1 + ny * 0.06 : 1 + ny * 0.35;
    // subtle quantized-hash value jitter breaks the flat-vinyl read on broad
    // cloth/hide surfaces (seam-safe: keyed off position, not vertex index)
    const n = hash01(
      Math.round(pos.getX(i) * 21),
      Math.round(pos.getY(i) * 21) + Math.round(pos.getZ(i) * 17), 5,
    );
    shade *= 0.95 + n * 0.1;
    arr[i * 3] = color.r * shade;
    arr[i * 3 + 1] = color.g * shade;
    arr[i * 3 + 2] = color.b * shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

// Collapse every plain mesh under each animation pivot (body root, arms,
// legs, head, tail) into one merged vertex-colored mesh per material class.
// Pivot transforms, RigParts and animations are untouched.
function finalizeRig(rig: Rig): Rig {
  rig.headRestY = rig.parts.head?.position.y;
  const roots = new Set<THREE.Object3D>([rig.body]);
  const p = rig.parts;
  for (const node of [p.leftArm, p.rightArm, p.leftLeg, p.rightLeg, p.head, p.tail, p.flame]) {
    if (node) roots.add(node);
  }
  for (const leg of p.legs ?? []) roots.add(leg);

  interface Bucket {
    flat: boolean; metal: boolean; side: THREE.Side; castShadow: boolean;
    geoms: THREE.BufferGeometry[]; sources: THREE.Mesh[];
  }
  const byRoot = new Map<THREE.Object3D, Map<string, Bucket>>();
  const rel = new THREE.Matrix4();

  rig.body.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !isMergeable(mesh)) return;
    const mat = mesh.material as THREE.MeshLambertMaterial;
    const flat = mat.flatShading === true;
    const metal = mesh.userData.metal === true;
    if (roots.has(mesh) || mesh.children.length > 0) {
      // pivots (quadruped legs, tails) and meshes carrying children stay put;
      // just upgrade them onto the shared vertex-colored material
      bakeColor(mesh.geometry, mat.color);
      mesh.material = rigMergedMat(flat, metal, mat.side);
      return;
    }
    // bake the transform relative to the nearest animation pivot
    rel.identity();
    let node: THREE.Object3D | null = mesh;
    while (node && !roots.has(node)) {
      node.updateMatrix();
      rel.premultiply(node.matrix);
      node = node.parent;
    }
    if (!node) return; // not parented under the rig (defensive)
    const key = `${flat ? 1 : 0}:${metal ? 1 : 0}:${mat.side}:${mesh.castShadow ? 1 : 0}`;
    let buckets = byRoot.get(node);
    if (!buckets) {
      buckets = new Map();
      byRoot.set(node, buckets);
    }
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { flat, metal, side: mat.side, castShadow: mesh.castShadow, geoms: [], sources: [] };
      buckets.set(key, bucket);
    }
    // normalize to non-indexed so extruded/polyhedron parts (blades, boulders)
    // merge with indexed capsules/cylinders — mergeGeometries refuses to mix
    const cloned = mesh.geometry.clone().applyMatrix4(rel);
    const geo = cloned.index ? cloned.toNonIndexed() : cloned;
    if (geo !== cloned) cloned.dispose();
    geo.clearGroups();
    bakeColor(geo, mat.color);
    bucket.geoms.push(geo);
    bucket.sources.push(mesh);
  });

  for (const [root, buckets] of byRoot) {
    for (const bucket of buckets.values()) {
      const merged = mergeGeometries(bucket.geoms, false);
      // only drop the source meshes once the merge succeeded — a failed merge
      // keeps the originals visible instead of silently losing body parts
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, rigMergedMat(bucket.flat, bucket.metal, bucket.side));
      mesh.castShadow = bucket.castShadow;
      root.add(mesh);
      for (const src of bucket.sources) src.removeFromParent();
    }
  }
  return rig;
}

// Single-draw far LOD: the whole rig in its pristine pose merged into one
// static vertex-colored mesh. Beyond ~55u the articulated rig (and its 7+
// draws) swaps for this; emissive details are dropped (sub-pixel out there).
// Must be built BEFORE any animation runs so the pose is neutral.
export function buildFarRig(rig: Rig): THREE.Mesh | null {
  const geoms: THREE.BufferGeometry[] = [];
  const rel = new THREE.Matrix4();
  rig.body.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material;
    // only the shared vertex-colored merge materials participate
    if (Array.isArray(mat) || !(mat as THREE.MeshStandardMaterial).vertexColors) return;
    if (!mesh.geometry.attributes.color) return;
    rel.identity();
    let node: THREE.Object3D | null = mesh;
    while (node && node !== rig.body) {
      node.updateMatrix();
      rel.premultiply(node.matrix);
      node = node.parent;
    }
    if (!node) return;
    const cloned = mesh.geometry.clone().applyMatrix4(rel);
    // same non-indexed normalization as finalizeRig, so rigs that kept an
    // un-merged indexed part still get their single-draw far LOD
    geoms.push(cloned.index ? cloned.toNonIndexed() : cloned);
  });
  if (geoms.length === 0) return null;
  const merged = mergeGeometries(geoms, false);
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, rigMergedMat(false, false, THREE.FrontSide));
  // never casts itself — the renderer clones it onto a shadow-only layer as a
  // single-draw proxy caster for everything past the articulated shadow gate
  mesh.castShadow = false;
  return mesh;
}

// Multiply each RGB channel of a hex color (f < 1 darkens, f > 1 lightens).
function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

const SKIN = 0xd9a47f;
const SKIN_DARK = 0xb9846a;
const GOLD = 0xc9a227;
const STEEL = 0xd6dde4;
const WOOD = 0x7a5230;
const GRIP_LEATHER = 0x3b2a16;

// ---------------------------------------------------------------------------
// Weapons — real silhouettes, slightly oversized (stylized)
// ---------------------------------------------------------------------------

// Beveled blade pointing -y from the origin: extruded outline with a bevel
// ridge that reads as the fuller. Width/length are the finished bounds.
function bladeGeo(width: number, length: number, tipLen: number, depth: number): THREE.BufferGeometry {
  const bevel = depth * 0.45;
  const half = Math.max(0.012, width / 2 - bevel);
  const s = new THREE.Shape();
  s.moveTo(-half, bevel);
  s.lineTo(-half, length - tipLen);
  s.lineTo(0, length - bevel);
  s.lineTo(half, length - tipLen);
  s.lineTo(half, bevel);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: depth * 0.1, bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1,
  });
  geo.translate(0, 0, -depth * 0.05 - bevel / 2);
  geo.rotateX(Math.PI); // point down
  return geo;
}

function swordModel(bladeColor = STEEL, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const blade = plain(bladeGeo(0.17, 1.02, 0.26, 0.06), bladeColor, { metal: true });
  blade.position.y = -0.03;
  g.add(blade);
  const guardGeo = new THREE.CapsuleGeometry(0.042, 0.3, 2, 6);
  guardGeo.rotateZ(Math.PI / 2);
  guardGeo.scale(1, 0.8, 0.7);
  g.add(plain(guardGeo, GOLD, { metal: true }));
  const grip = plain(new THREE.CylinderGeometry(0.034, 0.038, 0.24, 7), GRIP_LEATHER);
  grip.position.y = 0.13;
  g.add(grip);
  for (const wy of [0.08, 0.16]) {
    const wrap = plain(new THREE.CylinderGeometry(0.042, 0.042, 0.024, 7), 0x241809);
    wrap.position.y = wy;
    g.add(wrap);
  }
  const pommel = plain(new THREE.SphereGeometry(0.052, 7, 6), GOLD, { metal: true });
  pommel.position.y = 0.26;
  g.add(pommel);
  g.scale.setScalar(scale);
  return g;
}

function daggerModel(): THREE.Group {
  const g = new THREE.Group();
  const blade = plain(bladeGeo(0.12, 0.52, 0.16, 0.05), STEEL, { metal: true });
  blade.position.y = -0.02;
  g.add(blade);
  const guardGeo = new THREE.CapsuleGeometry(0.032, 0.16, 2, 6);
  guardGeo.rotateZ(Math.PI / 2);
  guardGeo.scale(1, 0.8, 0.7);
  g.add(plain(guardGeo, 0x6b5a2a, { metal: true }));
  const grip = plain(new THREE.CylinderGeometry(0.028, 0.032, 0.17, 7), GRIP_LEATHER);
  grip.position.y = 0.1;
  g.add(grip);
  const pommel = plain(new THREE.SphereGeometry(0.04, 7, 6), 0x6b5a2a, { metal: true });
  pommel.position.y = 0.2;
  g.add(pommel);
  return g;
}

function staffModel(): THREE.Group {
  const g = new THREE.Group();
  const shaft = limb(0.052, 0.038, 1.45, WOOD);
  g.add(shaft);
  const collar = plain(new THREE.CylinderGeometry(0.062, 0.072, 0.08, 7), GOLD, { metal: true });
  collar.position.y = 0.72;
  g.add(collar);
  // crescent headpiece cradling the orb
  const crescent = plain(new THREE.TorusGeometry(0.17, 0.036, 5, 12, Math.PI * 1.45), WOOD);
  crescent.position.y = 0.95;
  crescent.rotation.z = -1.225 * Math.PI;
  g.add(crescent);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), surfaceMat({
    color: 0x69ccf0, emissive: 0x1b4f72,
    emissiveIntensity: GFX.standardMaterials ? 1.5 : 0.6, roughness: 0.4,
  }));
  orb.position.y = 0.95;
  g.add(orb);
  const butt = plain(new THREE.ConeGeometry(0.045, 0.1, 6), 0x8d8d85, { metal: true });
  butt.rotation.x = Math.PI;
  butt.position.y = -0.82;
  g.add(butt);
  return g;
}

function maceModel(): THREE.Group {
  const g = new THREE.Group();
  const handle = limb(0.04, 0.034, 0.78, 0x6b4a2b);
  g.add(handle);
  const core = plain(limbGeo(0.1, 0.115, 0.2, 8), 0x9aa0a6, { metal: true });
  core.position.y = 0.42;
  g.add(core);
  // six flanges with tapered outer edges
  for (let i = 0; i < 6; i++) {
    const fg = new THREE.BoxGeometry(0.024, 0.32, 0.14, 1, 2, 1);
    const pos = fg.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      if (pos.getZ(v) > 0.02) pos.setY(v, pos.getY(v) * 0.5);
    }
    fg.computeVertexNormals();
    fg.translate(0, 0, 0.13);
    const flange = plain(fg, 0x9aa0a6, { metal: true, flat: true });
    flange.position.y = 0.42;
    flange.rotation.y = (i * Math.PI) / 3;
    g.add(flange);
  }
  const tip = plain(new THREE.ConeGeometry(0.05, 0.12, 6), 0x9aa0a6, { metal: true });
  tip.position.y = 0.6;
  g.add(tip);
  const pommel = plain(new THREE.SphereGeometry(0.045, 7, 6), 0x9aa0a6, { metal: true });
  pommel.position.y = -0.4;
  g.add(pommel);
  return g;
}

function pickModel(): THREE.Group {
  const g = new THREE.Group();
  const handle = limb(0.042, 0.05, 0.85, WOOD);
  g.add(handle);
  const collar = plain(new THREE.CylinderGeometry(0.065, 0.07, 0.12, 7), 0x8d8d85, { metal: true });
  collar.position.y = 0.42;
  g.add(collar);
  for (const s of [-1, 1]) {
    const spike = plain(new THREE.ConeGeometry(0.06, 0.5, 6), 0x8d8d85, { metal: true });
    spike.rotation.z = -s * (Math.PI / 2 + 0.22);
    spike.position.set(s * 0.26, 0.41, 0);
    g.add(spike);
  }
  return g;
}

function bowModel(): THREE.Group {
  const g = new THREE.Group();
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, -0.62, 0),
    new THREE.Vector3(0, 0, 0.5),
    new THREE.Vector3(0, 0.62, 0),
  );
  g.add(plain(new THREE.TubeGeometry(curve, 10, 0.038, 5), WOOD));
  for (const ty of [-0.62, 0.62]) {
    const tipCap = plain(new THREE.SphereGeometry(0.034, 6, 5), shade(WOOD, 0.7));
    tipCap.position.set(0, ty, 0);
    g.add(tipCap);
  }
  const grip = plain(new THREE.CylinderGeometry(0.052, 0.052, 0.18, 6), GRIP_LEATHER);
  grip.position.set(0, 0, 0.25);
  g.add(grip);
  const string = plain(new THREE.CylinderGeometry(0.009, 0.009, 1.24, 4), 0xd8d8c8);
  g.add(string);
  return g;
}

// Knotted ogre club, thick end down (weapons hang head-down at rest).
function clubModel(): THREE.Group {
  const g = new THREE.Group();
  g.add(limb(0.06, 0.18, 1.05, 0x55432c));
  for (let i = 0; i < 4; i++) {
    const knot = plain(new THREE.SphereGeometry(0.05 + 0.02 * hash01(i, 3, 1), 6, 5), 0x4a3823);
    const a = hash01(i, 7, 2) * Math.PI * 2;
    const ky = -0.15 - i * 0.12;
    knot.position.set(Math.cos(a) * 0.15, ky, Math.sin(a) * 0.15);
    g.add(knot);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Humanoids
// ---------------------------------------------------------------------------

export function buildHumanoid(e: Entity, opts: {
  shirt: number; pants: number; skin?: number; hair?: number;
  weapon?: 'sword' | 'staff' | 'dagger' | 'pick' | 'mace' | 'bow' | 'none';
  shoulders?: boolean; hood?: boolean; robe?: boolean;
  /** class color: faint emissive glint on belt + shoulder pads */
  accent?: number;
}): Rig {
  const body = new THREE.Group();
  const parts: RigParts = {};
  const skin = opts.skin ?? SKIN;
  const hair = opts.hair ?? 0x4a3320;
  // pull pure sim-palette primaries toward dyed-cloth tones
  let shirt = muted(opts.shirt);
  const pants = muted(opts.pants);
  // class colors that land near the skin hue (warrior tan) make the torso
  // read bare — pull those down toward leather so the rig reads dressed
  {
    const sHsl = { h: 0, s: 0, l: 0 };
    const kHsl = { h: 0, s: 0, l: 0 };
    new THREE.Color(shirt).getHSL(sHsl);
    new THREE.Color(skin).getHSL(kHsl);
    if (Math.abs(sHsl.h - kHsl.h) < 0.05 && Math.abs(sHsl.l - kHsl.l) < 0.24) {
      shirt = shade(shirt, 0.68);
    }
  }
  const accentMat = (color: number): THREE.Material => surfaceMat({
    color, emissive: opts.accent, emissiveIntensity: 0.25, roughness: 0.85, rim: true,
  });

  // torso: capsule reshaped — broad chest, tapered waist, hip flare
  const torsoGeo = new THREE.CapsuleGeometry(0.42, 0.55, 4, 10);
  shapeY(torsoGeo, (t) => {
    if (t < 0.35) return 0.9 - 0.14 * (t / 0.35);
    if (t < 0.8) return 0.76 + 0.26 * ((t - 0.35) / 0.45);
    return 1.02 - 0.12 * ((t - 0.8) / 0.2);
  });
  torsoGeo.scale(0.98, 0.69, 0.55);
  const torso = plain(torsoGeo, shirt);
  torso.position.y = 1.46;
  body.add(torso);

  // neck bridging torso to skull
  const neck = plain(new THREE.CylinderGeometry(0.085, 0.105, 0.14, 7), skin);
  neck.position.y = 1.98;
  body.add(neck);

  // baldric strap over the shoulder for martial kits — gear over plain cloth
  if (!opts.robe && (opts.weapon ?? 'sword') !== 'none') {
    const baldricGeo = new THREE.TorusGeometry(0.5, 0.038, 5, 16);
    baldricGeo.rotateY(Math.PI / 2); // ring wraps front-to-back over the torso
    baldricGeo.scale(1, 1.04, 0.5);
    const baldric = plain(baldricGeo, 0x4a3322);
    baldric.position.set(0, 1.42, 0.02);
    baldric.rotation.z = -0.55; // over the right shoulder, down to the left hip
    body.add(baldric);
  }

  // belt: shaped band + buckle (accent glint when classed)
  const beltGeo = new THREE.CylinderGeometry(0.4, 0.43, 0.14, 10, 1, true);
  beltGeo.scale(1, 1, 0.66);
  const belt = plain(beltGeo, GRIP_LEATHER);
  belt.position.y = 1.02;
  body.add(belt);
  const buckleGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.035, 8);
  buckleGeo.rotateX(Math.PI / 2);
  const buckle = opts.accent !== undefined
    ? new THREE.Mesh(buckleGeo, accentMat(GOLD))
    : plain(buckleGeo, GOLD, { metal: true });
  buckle.castShadow = true;
  buckle.position.set(0, 1.02, 0.275);
  body.add(buckle);

  if (opts.robe) {
    // flared lathe skirt hanging from the waist (part of the body, not legs)
    const skirtGeo = new THREE.LatheGeometry([
      new THREE.Vector2(0.34, 0), new THREE.Vector2(0.38, -0.3),
      new THREE.Vector2(0.46, -0.64), new THREE.Vector2(0.55, -0.96),
      new THREE.Vector2(0.57, -1.02),
    ], 12);
    skirtGeo.scale(1, 1, 0.8);
    const skirt = plain(skirtGeo, shirt, { side: THREE.DoubleSide });
    skirt.position.y = 1.06;
    body.add(skirt);
    const hemGeo = new THREE.LatheGeometry([
      new THREE.Vector2(0.555, -0.9), new THREE.Vector2(0.585, -1.03),
    ], 12);
    hemGeo.scale(1, 1, 0.8);
    const hem = plain(hemGeo, shade(shirt, 0.68), { side: THREE.DoubleSide });
    hem.position.y = 1.06;
    body.add(hem);
  } else {
    // hip wrap under the belt
    const hips = plain(limbGeo(0.32, 0.29, 0.1, 10), pants);
    hips.scale.set(1, 0.6, 0.62);
    hips.position.y = 0.94;
    body.add(hips);
  }

  const head = new THREE.Group();
  // flattened-sphere skull + chin mass
  const skullGeo = new THREE.SphereGeometry(0.27, 10, 8);
  skullGeo.scale(0.88, 0.86, 0.92);
  head.add(plain(skullGeo, skin));
  const chinGeo = new THREE.SphereGeometry(0.27, 8, 6);
  chinGeo.scale(0.72, 0.52, 0.78);
  const chin = plain(chinGeo, skin);
  chin.position.set(0, -0.115, 0.03);
  head.add(chin);
  // ears
  for (const sx of [-1, 1]) {
    const earGeo = new THREE.SphereGeometry(0.075, 6, 5);
    earGeo.scale(0.35, 0.6, 0.5);
    const ear = plain(earGeo, skin);
    ear.position.set(sx * 0.225, 0, 0.01);
    head.add(ear);
  }
  addFace(head, skin, { brow: opts.hood ? 0x2f2218 : shade(hair, 0.8) });
  if (opts.hood) {
    // pointed lathe hood, tilted well back so the face catches light
    const hoodGeo = new THREE.LatheGeometry([
      new THREE.Vector2(0.3, -0.18), new THREE.Vector2(0.33, 0.0),
      new THREE.Vector2(0.3, 0.16), new THREE.Vector2(0.22, 0.3),
      new THREE.Vector2(0.1, 0.4), new THREE.Vector2(0.0, 0.44),
    ], 10);
    hoodGeo.scale(1, 1, 1.05);
    const hood = plain(hoodGeo, shirt, { side: THREE.DoubleSide });
    hood.rotation.x = 0.3;
    hood.position.set(0, 0.06, -0.07);
    head.add(hood);
  } else {
    // shaped hair cap: spherical shell swept low at the nape, high at the brow
    const hairGeo = new THREE.SphereGeometry(0.295, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62);
    hairGeo.scale(0.92, 0.85, 0.97);
    const hairCap = plain(hairGeo, hair, { side: THREE.DoubleSide });
    hairCap.rotation.x = -0.3;
    hairCap.position.set(0, 0.055, -0.02);
    head.add(hairCap);
    const hairBackGeo = new THREE.SphereGeometry(0.16, 8, 6);
    hairBackGeo.scale(1.25, 1.0, 0.75);
    const hairBack = plain(hairBackGeo, hair);
    hairBack.position.set(0, -0.02, -0.17);
    head.add(hairBack);
  }
  head.position.y = 2.18;
  parts.head = head;
  body.add(head);

  if (opts.shoulders) {
    const padColor = 0x59616c; // worn steel — clearly armor, never flesh-toned
    for (const sx of [-1, 1]) {
      // flattened pauldron plate hugging the deltoid, tipped outward
      const padGeo = new THREE.SphereGeometry(0.26, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
      padGeo.scale(1.02, 0.62, 1.18);
      const pad = opts.accent !== undefined
        ? new THREE.Mesh(padGeo, accentMat(padColor))
        : plain(padGeo, padColor, { metal: true });
      pad.castShadow = true;
      pad.position.set(sx * 0.56, 1.86, 0);
      pad.rotation.z = sx * 0.45;
      body.add(pad);
      const bandGeo = new THREE.TorusGeometry(0.235, 0.026, 5, 12);
      bandGeo.rotateX(Math.PI / 2);
      bandGeo.scale(1, 1, 1.18);
      const band = plain(bandGeo, 0x33383f, { metal: true });
      band.position.set(sx * 0.59, 1.825, 0);
      band.rotation.z = sx * 0.45;
      body.add(band);
    }
  }

  let rightForearm: THREE.Group | null = null;
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    // deltoid bulge smooths the shoulder joint
    const deltGeo = new THREE.SphereGeometry(0.145, 7, 6);
    deltGeo.scale(1, 0.85, 0.9);
    const delt = plain(deltGeo, shirt);
    delt.position.y = -0.02;
    arm.add(delt);
    const upper = limb(0.12, 0.095, 0.26, shirt);
    upper.position.y = -0.24;
    // forearm sub-assembly bends at the elbow — relaxed pose, not ramrod
    const forearm = new THREE.Group();
    forearm.position.y = -0.5;
    forearm.rotation.x = -0.22;
    const cuff = limb(0.105, 0.1, 0.05, shade(shirt, 0.75));
    cuff.position.y = 0.02;
    const lower = limb(0.09, 0.072, 0.24, skin);
    lower.position.y = -0.18;
    const hand = handMesh(SKIN_DARK, sx);
    hand.position.y = -0.46;
    forearm.add(cuff, lower, hand);
    arm.add(upper, forearm);
    arm.position.set(sx * 0.55, 1.88, 0);
    arm.rotation.z = sx * 0.12; // arms hang slightly away from the torso
    if (sx === -1) parts.leftArm = arm; else { parts.rightArm = arm; rightForearm = forearm; }
    body.add(arm);

    const legColor = opts.robe ? shirt : pants;
    const leg = new THREE.Group();
    const thigh = limb(0.16, 0.12, 0.28, legColor);
    thigh.position.y = -0.24;
    const shin = limb(0.115, 0.085, 0.26, legColor);
    shin.position.y = -0.68;
    const boot = bootMesh(0x2c2014);
    boot.position.set(0, -0.92, 0.02);
    leg.add(thigh, shin, boot);
    leg.position.set(sx * 0.2, 1.0, 0);
    leg.rotation.z = sx * 0.045; // slight stance splay
    if (sx === -1) parts.leftLeg = leg; else parts.rightLeg = leg;
    body.add(leg);
  }

  // weapon rides the right forearm so it follows the baked elbow bend
  const weapon = opts.weapon ?? 'sword';
  if (weapon !== 'none' && rightForearm) {
    let w: THREE.Object3D;
    if (weapon === 'staff') {
      w = staffModel();
      w.position.set(0.05, -0.35, 0.05);
    } else if (weapon === 'dagger') {
      w = daggerModel();
      w.position.set(0, -0.45, 0.12);
    } else if (weapon === 'pick') {
      w = pickModel();
      w.position.set(0, -0.25, 0.1);
    } else if (weapon === 'mace') {
      w = maceModel();
      w.position.set(0, -0.3, 0.1);
    } else if (weapon === 'bow') {
      w = bowModel();
      w.position.set(0, -0.2, 0.1);
      w.rotation.z = Math.PI / 2.6;
      w.rotation.y = 0.45; // yaw the D-profile toward the default camera
    } else {
      w = swordModel();
      w.position.set(0, -0.45, 0.14);
    }
    w.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    rightForearm.add(w);
  }

  return { body, parts, kind: 'humanoid', height: 2.6 };
}

// ---------------------------------------------------------------------------
// Beasts
// ---------------------------------------------------------------------------

export function buildWolf(e: Entity): Rig {
  const body = new THREE.Group();
  const parts: RigParts = {};
  const fur = e.color;
  const furDark = 0x55595c;

  // chest-heavy organic torso (capsule tapered toward the hips)
  const torsoGeo = limbGeo(0.42, 0.33, 0.72, 9);
  torsoGeo.rotateX(Math.PI / 2);
  torsoGeo.scale(0.85, 0.92, 1);
  lumpy(torsoGeo, 31, 0.05);
  const torso = plain(torsoGeo, fur);
  torso.position.set(0, 0.9, -0.05);
  body.add(torso);
  // dark saddle along the spine + pale belly — back-to-belly fur gradient
  const saddleGeo = new THREE.CapsuleGeometry(0.3, 0.7, 3, 8);
  saddleGeo.rotateX(Math.PI / 2);
  saddleGeo.scale(0.95, 0.55, 1);
  const saddle = plain(saddleGeo, shade(fur, 0.78));
  saddle.position.set(0, 1.12, -0.1);
  body.add(saddle);
  const bellyGeo = new THREE.CapsuleGeometry(0.26, 0.6, 3, 8);
  bellyGeo.rotateX(Math.PI / 2);
  bellyGeo.scale(0.9, 0.5, 1);
  const bellyFur = plain(bellyGeo, shade(fur, 1.22));
  bellyFur.position.set(0, 0.68, 0.0);
  body.add(bellyFur);
  // shaggy chest ruff
  const ruff = plain(boulderGeo(0.32, 11, 0.18), furDark, { flat: true });
  ruff.scale.set(1.05, 1.1, 0.95);
  ruff.position.set(0, 0.88, 0.55);
  body.add(ruff);

  const head = new THREE.Group();
  const skullGeo = new THREE.SphereGeometry(0.24, 9, 7);
  skullGeo.scale(0.95, 0.85, 1.0);
  head.add(plain(skullGeo, fur));
  // proper tapered snout + nose + jaw
  const snoutGeo = limbGeo(0.085, 0.14, 0.2);
  snoutGeo.rotateX(Math.PI / 2);
  snoutGeo.scale(1, 0.8, 1);
  const snout = plain(snoutGeo, furDark);
  snout.position.set(0, -0.06, 0.32);
  head.add(snout);
  const nose = plain(new THREE.SphereGeometry(0.045, 6, 5), 0x1a1a1a);
  nose.position.set(0, -0.02, 0.5);
  head.add(nose);
  const jawGeo = new THREE.CapsuleGeometry(0.05, 0.14, 2, 5);
  jawGeo.rotateX(Math.PI / 2);
  const jaw = plain(jawGeo, shade(furDark, 0.8));
  jaw.position.set(0, -0.16, 0.3);
  head.add(jaw);
  for (const sx of [-1, 1]) {
    const earGeo = new THREE.ConeGeometry(0.085, 0.26, 5);
    earGeo.scale(1, 1, 0.55);
    const ear = plain(earGeo, furDark);
    ear.position.set(sx * 0.14, 0.28, -0.02);
    ear.rotation.z = -sx * 0.22;
    head.add(ear);
    const eye = plain(new THREE.SphereGeometry(0.035, 6, 5), 0x2a1c0c);
    eye.position.set(sx * 0.13, 0.05, 0.2);
    head.add(eye);
  }
  head.position.set(0, 1.18, 0.95);
  parts.head = head;
  body.add(head);

  // bushy two-mass tail hanging off the rump
  const tail = new THREE.Group();
  const tailGeo = limbGeo(0.045, 0.115, 0.42);
  tailGeo.rotateX(-Math.PI / 2);
  tailGeo.translate(0, 0, -0.3);
  tail.add(plain(tailGeo, furDark));
  const tailBase = plain(new THREE.SphereGeometry(0.11, 6, 5), furDark);
  tailBase.position.z = -0.08;
  tail.add(tailBase);
  tail.position.set(0, 1.05, -0.95);
  tail.rotation.x = 0.55;
  parts.tail = tail;
  body.add(tail);

  parts.legs = [];
  // staggered stance: front pair wider than the hinds, hinds angled out so
  // the legs never read as four parallel tubes head-on
  for (const [sx, sz] of [[-0.3, 0.55], [0.3, 0.55], [-0.23, -0.55], [0.23, -0.55]]) {
    const leg = new THREE.Group();
    const isHind = sz < 0;
    const haunchGeo = new THREE.SphereGeometry(isHind ? 0.16 : 0.14, 7, 6);
    haunchGeo.scale(0.75, 1.15, 1.0);
    const haunch = plain(haunchGeo, fur);
    haunch.position.y = -0.08;
    const shank = limb(0.09, 0.06, 0.28, furDark);
    shank.position.y = -0.33;
    const pawGeo = new THREE.SphereGeometry(0.085, 7, 5);
    pawGeo.scale(1, 0.55, 1.35);
    const paw = plain(pawGeo, furDark);
    paw.position.set(0, -0.58, 0.04);
    leg.add(haunch, shank, paw);
    leg.position.set(sx, 0.62, sz);
    leg.rotation.z = (sx < 0 ? -1 : 1) * (isHind ? 0.1 : 0.03); // feet splay outward
    parts.legs.push(leg);
    body.add(leg);
  }
  return { body, parts, kind: 'wolf', height: 1.6 };
}

export function buildBoar(e: Entity): Rig {
  const body = new THREE.Group();
  const parts: RigParts = {};
  const hide = e.color;

  // barrel torso with humped shoulders
  const torsoGeo = limbGeo(0.45, 0.38, 0.68, 9);
  torsoGeo.rotateX(Math.PI / 2);
  const torso = plain(torsoGeo, hide);
  torso.position.set(0, 0.74, -0.05);
  body.add(torso);
  const humpGeo = new THREE.SphereGeometry(0.36, 8, 6);
  humpGeo.scale(1.0, 0.8, 0.95);
  const hump = plain(humpGeo, hide);
  hump.position.set(0, 1.0, 0.32);
  body.add(hump);
  // bristle mohawk along the spine
  for (let i = 0; i < 4; i++) {
    const bristleGeo = new THREE.ConeGeometry(0.09, 0.2 - i * 0.02, 4);
    bristleGeo.scale(1, 1, 0.5);
    const bristle = plain(bristleGeo, 0x5d3a10, { flat: true });
    bristle.position.set(0, 1.24 - i * 0.07, 0.45 - i * 0.3);
    body.add(bristle);
  }

  const head = new THREE.Group();
  const skullGeo = new THREE.SphereGeometry(0.28, 9, 7);
  skullGeo.scale(1, 0.9, 1.05);
  head.add(plain(skullGeo, hide));
  // tapered snout with a pink disc + nostrils
  const snoutGeo = limbGeo(0.125, 0.17, 0.2);
  snoutGeo.rotateX(Math.PI / 2);
  const snout = plain(snoutGeo, hide);
  snout.position.set(0, -0.08, 0.28);
  head.add(snout);
  const discGeo = new THREE.CylinderGeometry(0.115, 0.125, 0.06, 8);
  discGeo.rotateX(Math.PI / 2);
  const disc = plain(discGeo, 0xc99b77);
  disc.position.set(0, -0.08, 0.45);
  head.add(disc);
  // dark rim ring so the snout disc reads at range
  const rimGeo = new THREE.TorusGeometry(0.118, 0.02, 5, 10);
  const rim = plain(rimGeo, 0x6e3d12);
  rim.position.set(0, -0.08, 0.465);
  head.add(rim);
  for (const sx of [-1, 1]) {
    const nostril = plain(new THREE.SphereGeometry(0.028, 5, 4), 0x53290a);
    nostril.position.set(sx * 0.05, -0.08, 0.487);
    head.add(nostril);
    // big bright up-curving tusks — the boar's signature silhouette
    const tusk = plain(new THREE.ConeGeometry(0.06, 0.32, 5), 0xfff8e0);
    tusk.position.set(sx * 0.18, -0.15, 0.36);
    tusk.rotation.x = -0.45;
    tusk.rotation.z = -sx * 0.7;
    head.add(tusk);
    // pointed alert ears, flat like leather
    const earGeo = new THREE.ConeGeometry(0.09, 0.22, 4);
    earGeo.scale(0.6, 1, 0.3);
    const ear = plain(earGeo, 0x7a4413);
    ear.position.set(sx * 0.22, 0.3, -0.04);
    ear.rotation.z = sx * 0.35;
    head.add(ear);
    const eyeW = plain(new THREE.SphereGeometry(0.04, 5, 4), 0xe8d9b0);
    eyeW.position.set(sx * 0.16, 0.05, 0.215);
    head.add(eyeW);
    const eye = plain(new THREE.SphereGeometry(0.024, 5, 4), 0x1d1208);
    eye.position.set(sx * 0.16, 0.05, 0.245);
    head.add(eye);
  }
  head.position.set(0, 0.85, 0.92);
  parts.head = head;
  body.add(head);

  parts.legs = [];
  for (const [sx, sz] of [[-0.32, 0.5], [0.32, 0.5], [-0.32, -0.5], [0.32, -0.5]]) {
    const leg = new THREE.Group();
    const stump = limb(0.095, 0.07, 0.26, 0x6e3d12);
    stump.position.y = -0.22;
    const hoof = plain(new THREE.CylinderGeometry(0.065, 0.075, 0.09, 6), 0x2c1c0c);
    hoof.position.y = -0.45;
    leg.add(stump, hoof);
    leg.position.set(sx, 0.5, sz);
    parts.legs.push(leg);
    body.add(leg);
  }
  return { body, parts, kind: 'boar', height: 1.45 };
}

export function buildSpider(e: Entity): Rig {
  const body = new THREE.Group();
  const parts: RigParts = {};
  const chitin = e.color;
  const legChitin = 0x1d0a26;

  // lumpy rounded abdomen + cephalothorax
  const abdomen = plain(boulderGeo(0.6, 5, 0.14), chitin, { flat: true });
  abdomen.scale.set(1, 0.85, 1.25);
  abdomen.position.set(0, 0.95, -0.52);
  body.add(abdomen);
  const spinneret = plain(new THREE.ConeGeometry(0.12, 0.28, 6), shade(chitin, 0.7), { flat: true });
  spinneret.rotation.x = Math.PI / 2 + 0.5;
  spinneret.position.set(0, 0.78, -1.18);
  body.add(spinneret);
  const thoraxGeo = new THREE.SphereGeometry(0.38, 9, 7);
  thoraxGeo.scale(1, 0.8, 1.1);
  const thorax = plain(thoraxGeo, 0x2e1437, { flat: true });
  thorax.position.set(0, 0.82, 0.32);
  body.add(thorax);
  // eyes: two big emissive + two small bead eyes
  for (const sx of [-0.12, 0.12]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), surfaceMat({
      color: 0xff3333, emissive: 0x661111,
      emissiveIntensity: GFX.standardMaterials ? 1.4 : 1,
    }));
    eye.position.set(sx, 0.95, 0.66);
    body.add(eye);
  }
  for (const sx of [-0.22, 0.22]) {
    const bead = plain(new THREE.SphereGeometry(0.035, 5, 4), 0x0d0511);
    bead.position.set(sx, 0.9, 0.62);
    body.add(bead);
  }
  // fangs
  for (const sx of [-0.1, 0.1]) {
    const fang = plain(new THREE.ConeGeometry(0.045, 0.2, 5), 0xd5d8dc);
    fang.position.set(sx, 0.62, 0.6);
    fang.rotation.x = Math.PI - 0.25;
    body.add(fang);
  }
  // jointed legs: femur up-out to a knee, tibia down to the foot tip
  parts.legs = [];
  for (let i = 0; i < 4; i++) {
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group();
      const femur = plain(limbGeo(0.038, 0.052, 0.5, 6), legChitin);
      femur.position.set(0, 0.14, 0.275);
      femur.rotation.x = 1.1;
      const knee = plain(new THREE.SphereGeometry(0.05, 6, 5), shade(legChitin, 1.6));
      knee.position.set(0, 0.28, 0.55);
      const tibia = plain(limbGeo(0.012, 0.035, 1.1, 6), legChitin);
      tibia.position.set(0, -0.285, 0.775);
      tibia.rotation.x = 2.76;
      leg.add(femur, knee, tibia);
      leg.position.set(sx * 0.3, 0.85, 0.3 - i * 0.26);
      leg.rotation.y = sx * (0.6 + i * 0.25);
      parts.legs.push(leg);
      body.add(leg);
    }
  }
  return { body, parts, kind: 'spider', height: 1.4 };
}

export function buildMurloc(e: Entity): Rig {
  const body = new THREE.Group();
  const parts: RigParts = {};
  const skin = e.color;
  const belly = 0xd9e4aa;

  // hunched froggy torso with a belly bulge
  const torsoGeo = new THREE.CapsuleGeometry(0.32, 0.3, 4, 9);
  shapeY(torsoGeo, (t) => 0.85 + 0.3 * Math.sin(t * Math.PI));
  torsoGeo.scale(1, 0.95, 0.82);
  const torso = plain(torsoGeo, skin);
  torso.position.y = 0.78;
  torso.rotation.x = 0.25;
  body.add(torso);
  const bellyGeo = new THREE.SphereGeometry(0.26, 8, 6);
  bellyGeo.scale(1, 1.25, 0.45);
  const bellyPlate = plain(bellyGeo, belly);
  bellyPlate.position.set(0, 0.72, 0.2);
  bellyPlate.rotation.x = 0.25;
  body.add(bellyPlate);

  const head = new THREE.Group();
  // big wide skull with bulging eyes and a wide mouth
  const skullGeo = new THREE.SphereGeometry(0.34, 10, 8);
  skullGeo.scale(1.22, 0.8, 1.05);
  head.add(plain(skullGeo, skin));
  for (const sx of [-1, 1]) {
    const ball = plain(new THREE.SphereGeometry(0.095, 7, 6), 0xfff2b0);
    ball.position.set(sx * 0.2, 0.18, 0.16);
    head.add(ball);
    const pupil = plain(new THREE.SphereGeometry(0.042, 5, 4), 0x111111);
    pupil.position.set(sx * 0.2, 0.2, 0.245);
    head.add(pupil);
    // cheek fins
    const cheekGeo = new THREE.ConeGeometry(0.1, 0.26, 4);
    cheekGeo.scale(1, 1, 0.3);
    const cheek = plain(cheekGeo, 0xe67e22, { side: THREE.DoubleSide });
    cheek.position.set(sx * 0.4, -0.02, -0.02);
    cheek.rotation.z = sx * 1.35;
    head.add(cheek);
  }
  // wide mouth: dark interior slit + protruding lower jaw lip
  const mouthGeo = new THREE.SphereGeometry(0.24, 8, 5);
  mouthGeo.scale(1.05, 0.28, 0.85);
  const mouth = plain(mouthGeo, 0x5a2a22);
  mouth.position.set(0, -0.12, 0.14);
  head.add(mouth);
  const jawGeo = new THREE.SphereGeometry(0.26, 8, 5);
  jawGeo.scale(1.05, 0.32, 0.9);
  const jawLip = plain(jawGeo, shade(skin, 0.85));
  jawLip.position.set(0, -0.19, 0.1);
  head.add(jawLip);
  // spiky dorsal crest fin (shaped profile, not a cone)
  const crestShape = new THREE.Shape();
  crestShape.moveTo(-0.34, 0);
  crestShape.lineTo(-0.22, 0.3);
  crestShape.lineTo(-0.12, 0.08);
  crestShape.lineTo(0.0, 0.34);
  crestShape.lineTo(0.1, 0.08);
  crestShape.lineTo(0.2, 0.26);
  crestShape.lineTo(0.3, 0);
  crestShape.closePath();
  const crestGeo = new THREE.ShapeGeometry(crestShape);
  crestGeo.rotateY(-Math.PI / 2); // shape x → world z
  const crest = plain(crestGeo, 0xe67e22, { side: THREE.DoubleSide });
  crest.position.set(0, 0.24, -0.05);
  head.add(crest);
  head.position.set(0, 1.28, 0.12);
  parts.head = head;
  body.add(head);

  for (const sx of [-1, 1]) {
    // webbed arms
    const arm = new THREE.Group();
    const upper = limb(0.062, 0.048, 0.3, skin);
    upper.position.y = -0.2;
    const handGeo = new THREE.SphereGeometry(0.09, 7, 5);
    handGeo.scale(1.3, 0.5, 1.15);
    const hand = plain(handGeo, shade(skin, 1.1));
    hand.position.y = -0.44;
    arm.add(upper, hand);
    arm.position.set(sx * 0.4, 1.0, 0.1);
    if (sx === -1) parts.leftArm = arm; else parts.rightArm = arm;
    body.add(arm);

    // frog-crouch legs: bent knee baked into the group, big webbed feet
    const leg = new THREE.Group();
    const thigh = limb(0.085, 0.07, 0.2, skin);
    thigh.position.set(0, -0.1, 0.07);
    thigh.rotation.x = -0.7;
    const shin = limb(0.062, 0.05, 0.2, skin);
    shin.position.set(0, -0.28, 0.08);
    shin.rotation.x = 0.55;
    const footGeo = new THREE.SphereGeometry(0.1, 7, 5);
    footGeo.scale(1.25, 0.3, 1.9);
    const foot = plain(footGeo, belly);
    foot.position.set(0, -0.46, 0.12);
    leg.add(thigh, shin, foot);
    leg.position.set(sx * 0.18, 0.5, 0);
    if (sx === -1) parts.leftLeg = leg; else parts.rightLeg = leg;
    body.add(leg);
  }
  return { body, parts, kind: 'murloc', height: 1.7 };
}

export function buildKobold(e: Entity): Rig {
  const rig = buildHumanoid(e, {
    shirt: 0x6b4f33, pants: 0x4a3623, skin: e.color, hair: 0x3a2a18, weapon: 'pick',
  });
  rig.body.scale.setScalar(0.8);
  const head = rig.parts.head!;
  // rat snout over the human nose
  const snoutGeo = limbGeo(0.055, 0.1, 0.14);
  snoutGeo.rotateX(Math.PI / 2);
  const snout = plain(snoutGeo, e.color);
  snout.position.set(0, -0.06, 0.27);
  head.add(snout);
  const noseTip = plain(new THREE.SphereGeometry(0.032, 5, 4), 0x1f1410);
  noseTip.position.set(0, -0.04, 0.39);
  head.add(noseTip);
  // big rat ears
  for (const sx of [-1, 1]) {
    const earGeo = new THREE.ConeGeometry(0.1, 0.24, 5);
    earGeo.scale(1, 1, 0.35);
    const ear = plain(earGeo, e.color);
    ear.position.set(sx * 0.24, 0.22, -0.02);
    ear.rotation.z = sx * 0.9;
    head.add(ear);
  }
  // the iconic head candle: wax stub + drips + flame
  const candle = plain(new THREE.CylinderGeometry(0.05, 0.062, 0.2, 7), 0xf5eee0);
  candle.position.set(0, 0.36, 0);
  head.add(candle);
  const drip = plain(new THREE.SphereGeometry(0.028, 5, 4), 0xf5eee0);
  drip.position.set(0.045, 0.3, 0.02);
  head.add(drip);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.17, 6), surfaceMat({
    color: 0xffc04d, emissive: 0xff8800,
    emissiveIntensity: GFX.standardMaterials ? 2.0 : 1.2,
  }));
  flame.position.set(0, 0.54, 0);
  head.add(flame);
  rig.parts.flame = flame;
  return { ...rig, kind: 'kobold', height: 2.1 };
}

export function buildSkeleton(e: Entity): Rig {
  const body = new THREE.Group();
  const parts: RigParts = {};
  const bone = 0xe8e6da;
  const boneDark = 0xb9b5a3;

  // real bone shapes: shaft + epiphysis knobs at both ends
  const boneSeg = (len: number, r: number, color: number): THREE.Group => {
    const g = new THREE.Group();
    const shaft = plain(new THREE.CylinderGeometry(r * 0.6, r * 0.68, Math.max(0.05, len - r), 6), color);
    g.add(shaft);
    for (const end of [-1, 1]) {
      const knobGeo = new THREE.SphereGeometry(r, 6, 5);
      knobGeo.scale(1.05, 0.8, 1.05);
      const knob = plain(knobGeo, color);
      knob.position.y = end * (len / 2 - r * 0.4);
      g.add(knob);
    }
    return g;
  };

  // ribcage: squashed oval hoops with per-rib jitter — never perfect circles
  for (let i = 0; i < 4; i++) {
    const ribGeo = new THREE.TorusGeometry(0.26 - i * 0.022, 0.03, 5, 12);
    ribGeo.rotateX(Math.PI / 2);
    ribGeo.scale(1, 0.88, 0.74);
    const rib = plain(ribGeo, bone);
    rib.position.set((hash01(i, 2, 9) - 0.5) * 0.02, 1.78 - i * 0.155, 0.04);
    rib.rotation.x = 0.1 + (hash01(i, 5, 9) - 0.5) * 0.14;
    rib.rotation.y = (hash01(i, 8, 9) - 0.5) * 0.16;
    body.add(rib);
  }
  for (let i = 0; i < 6; i++) {
    const vertGeo = new THREE.SphereGeometry(0.055, 6, 5);
    vertGeo.scale(1.15, 0.8, 1);
    const vert = plain(vertGeo, boneDark);
    vert.position.set(0, 1.06 + i * 0.16, -0.08);
    body.add(vert);
  }
  // clavicle bar + pelvis ring + sacrum
  const clavGeo = new THREE.CapsuleGeometry(0.025, 0.5, 2, 5);
  clavGeo.rotateZ(Math.PI / 2);
  const clav = plain(clavGeo, bone);
  clav.position.set(0, 1.94, 0.02);
  body.add(clav);
  const pelvisGeo = new THREE.TorusGeometry(0.17, 0.05, 5, 10);
  pelvisGeo.rotateX(Math.PI / 2);
  pelvisGeo.scale(1.2, 0.75, 0.9);
  const pelvis = plain(pelvisGeo, bone);
  pelvis.position.y = 1.0;
  body.add(pelvis);
  const sacrumGeo = new THREE.SphereGeometry(0.08, 6, 5);
  sacrumGeo.scale(1, 0.85, 0.8);
  const sacrum = plain(sacrumGeo, boneDark);
  sacrum.position.set(0, 0.99, -0.05);
  body.add(sacrum);

  // skull: cranium + eye sockets + nasal + half-torus jaw
  const head = new THREE.Group();
  const craniumGeo = new THREE.SphereGeometry(0.215, 9, 7);
  craniumGeo.scale(0.92, 1.0, 0.98);
  lumpy(craniumGeo, 17, 0.045); // weathered bone, not a ping-pong ball
  const cranium = plain(craniumGeo, bone);
  cranium.position.y = 0.04;
  head.add(cranium);
  for (const sx of [-1, 1]) {
    const socket = plain(new THREE.SphereGeometry(0.06, 6, 5), 0x15120e);
    socket.position.set(sx * 0.085, 0.05, 0.155);
    head.add(socket);
  }
  const nasalGeo = new THREE.SphereGeometry(0.032, 5, 4);
  nasalGeo.scale(0.8, 1.2, 0.6);
  const nasal = plain(nasalGeo, 0x15120e);
  nasal.position.set(0, -0.05, 0.185);
  head.add(nasal);
  const teeth = box(0.15, 0.035, 0.03, 0xf4f1e4);
  teeth.position.set(0, -0.125, 0.16);
  head.add(teeth);
  const jawGeo = new THREE.TorusGeometry(0.105, 0.027, 5, 10, Math.PI);
  jawGeo.rotateX(Math.PI / 2);
  const jaw = plain(jawGeo, boneDark);
  jaw.position.set(0, -0.18, 0.05);
  head.add(jaw);
  const chin = plain(new THREE.SphereGeometry(0.04, 5, 4), boneDark);
  chin.position.set(0, -0.18, 0.15);
  head.add(chin);
  head.position.y = 2.12;
  parts.head = head;
  body.add(head);

  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    const humerus = boneSeg(0.42, 0.055, bone);
    humerus.position.y = -0.22;
    const forearm = boneSeg(0.4, 0.048, bone);
    forearm.position.y = -0.62;
    const handGeo = new THREE.SphereGeometry(0.06, 6, 5);
    handGeo.scale(0.8, 1.15, 0.9);
    const hand = plain(handGeo, boneDark);
    hand.position.y = -0.86;
    arm.add(humerus, forearm, hand);
    arm.position.set(sx * 0.42, 1.85, 0);
    if (sx === -1) parts.leftArm = arm; else parts.rightArm = arm;
    body.add(arm);

    const leg = new THREE.Group();
    const femur = boneSeg(0.48, 0.06, bone);
    femur.position.y = -0.24;
    const tibia = boneSeg(0.44, 0.05, bone);
    tibia.position.y = -0.68;
    const footGeo = new THREE.CapsuleGeometry(0.05, 0.14, 2, 5);
    footGeo.rotateX(Math.PI / 2);
    footGeo.scale(1.1, 0.6, 1);
    const foot = plain(footGeo, boneDark);
    foot.position.set(0, -0.92, 0.07);
    leg.add(femur, tibia, foot);
    leg.position.set(sx * 0.16, 0.95, 0);
    if (sx === -1) parts.leftLeg = leg; else parts.rightLeg = leg;
    body.add(leg);
  }
  // rusted notched sword
  const rusty = swordModel(0x8a7a55, 0.85);
  rusty.position.set(0, -0.86, 0.12);
  parts.rightArm!.add(rusty);
  return { body, parts, kind: 'skeleton', height: 2.5 };
}

// Hunched marsh troll: stooped spine, arms past the knees, tusked jaw, mossy
// back. Head pivot stays at the humanoid idle height (2.18) with the skull
// hung low and forward inside the group so the hunch reads while the biped
// idle/walk animation still works.
export function buildTroll(e: Entity): Rig {
  const body = new THREE.Group();
  const parts: RigParts = {};
  const skin = e.color;
  const skinDark = shade(skin, 0.7);
  const moss = shade(skin, 0.55);

  // torso pitched forward, broad shoulders tapering to narrow hips; hash
  // lumps break the balloon-smooth capsule read
  const torsoGeo = new THREE.CapsuleGeometry(0.46, 0.6, 4, 10);
  shapeY(torsoGeo, (t) => 0.72 + 0.32 * t);
  torsoGeo.scale(1, 0.85, 0.62);
  lumpy(torsoGeo, 41, 0.08);
  const torso = plain(torsoGeo, skin);
  torso.position.set(0, 1.5, 0.06);
  torso.rotation.x = 0.32;
  body.add(torso);
  // rope strap slung across the chest
  const strapGeo = new THREE.TorusGeometry(0.52, 0.038, 5, 14);
  strapGeo.scale(1, 1, 0.66);
  const strap = plain(strapGeo, 0x6b5638);
  strap.position.set(0, 1.5, 0.06);
  strap.rotation.set(0.32, 0, 0.75);
  body.add(strap);
  // bone-tooth necklace hanging at the collar
  for (let i = -2; i <= 2; i++) {
    const toothGeo = new THREE.ConeGeometry(0.028, 0.12 - Math.abs(i) * 0.02, 4);
    toothGeo.rotateX(Math.PI);
    const tooth = plain(toothGeo, 0xe8e0c8, { flat: true });
    tooth.position.set(i * 0.1, 1.78 - Math.abs(i) * 0.035, 0.36 - Math.abs(i) * 0.03);
    tooth.rotation.x = 0.32;
    body.add(tooth);
  }
  // mossy lumpy back hump
  const hump = plain(boulderGeo(0.32, 7, 0.24), moss, { flat: true });
  hump.scale.set(1.15, 0.65, 0.95);
  hump.position.set(0, 1.92, -0.18);
  hump.rotation.x = 0.32;
  body.add(hump);
  // ragged loincloth skirt
  const clothGeo = new THREE.LatheGeometry([
    new THREE.Vector2(0.3, 0), new THREE.Vector2(0.36, -0.24),
    new THREE.Vector2(0.42, -0.46),
  ], 9);
  clothGeo.scale(1, 1, 0.8);
  const cloth = plain(clothGeo, 0x5d4a30, { side: THREE.DoubleSide, flat: true });
  cloth.position.y = 1.1;
  body.add(cloth);

  const head = new THREE.Group();
  const skullGeo = new THREE.SphereGeometry(0.24, 9, 7);
  skullGeo.scale(0.95, 0.88, 1.05);
  const skull = plain(skullGeo, skin);
  skull.position.set(0, -0.4, 0.3);
  head.add(skull);
  // heavy brow + sunken eyes
  const browGeo = new THREE.CapsuleGeometry(0.05, 0.24, 2, 5);
  browGeo.rotateZ(Math.PI / 2);
  const brow = plain(browGeo, skinDark);
  brow.position.set(0, -0.32, 0.46);
  head.add(brow);
  for (const sx of [-1, 1]) {
    const eye = plain(new THREE.SphereGeometry(0.038, 5, 4), 0xd8c468);
    eye.position.set(sx * 0.1, -0.4, 0.48);
    head.add(eye);
  }
  // big hooked nose
  const noseGeo = new THREE.SphereGeometry(0.085, 6, 5);
  noseGeo.scale(0.65, 1.1, 0.9);
  const nose = plain(noseGeo, skinDark);
  nose.position.set(0, -0.47, 0.54);
  head.add(nose);
  // underbite jaw with up-tusks
  const jawGeo = new THREE.SphereGeometry(0.17, 7, 5);
  jawGeo.scale(1.15, 0.5, 0.9);
  const jaw = plain(jawGeo, skinDark);
  jaw.position.set(0, -0.62, 0.4);
  head.add(jaw);
  for (const sx of [-1, 1]) {
    const tusk = plain(new THREE.ConeGeometry(0.04, 0.2, 5), 0xf0ead2);
    tusk.position.set(sx * 0.13, -0.52, 0.48);
    tusk.rotation.x = -0.2;
    tusk.rotation.z = -sx * 0.12;
    head.add(tusk);
    // long pointed ears swept back
    const earGeo = new THREE.ConeGeometry(0.07, 0.34, 4);
    earGeo.scale(1, 1, 0.4);
    const ear = plain(earGeo, skinDark);
    ear.position.set(sx * 0.3, -0.32, 0.1);
    ear.rotation.z = sx * 1.25;
    ear.rotation.y = sx * 0.4;
    head.add(ear);
  }
  head.position.y = 2.18;
  parts.head = head;
  body.add(head);

  for (const sx of [-1, 1]) {
    // long ropey arms, knuckles past the knees
    const arm = new THREE.Group();
    const deltGeo = new THREE.SphereGeometry(0.17, 7, 6);
    lumpy(deltGeo, 43 + sx, 0.05);
    const delt = plain(deltGeo, skin);
    delt.position.y = -0.03;
    const upper = plain(lumpy(limbGeo(0.14, 0.11, 0.34), 45 + sx, 0.05), skin);
    upper.position.y = -0.3;
    const lower = plain(lumpy(limbGeo(0.105, 0.085, 0.36), 47 + sx, 0.05), moss);
    lower.position.y = -0.88;
    // hide wraps around the forearm
    for (const wy of [-0.74, -0.98]) {
      const wrap = plain(new THREE.CylinderGeometry(0.105, 0.11, 0.07, 7), 0x4d3a28);
      wrap.position.y = wy;
      arm.add(wrap);
    }
    const hand = handMesh(skinDark, sx, 1.55);
    hand.position.y = -1.26;
    arm.add(delt, upper, lower, hand);
    arm.position.set(sx * 0.58, 1.82, 0.1);
    if (sx === -1) parts.leftArm = arm; else parts.rightArm = arm;
    body.add(arm);

    // short bandy legs with big flat feet
    const leg = new THREE.Group();
    const thigh = limb(0.17, 0.13, 0.2, skin);
    thigh.position.y = -0.2;
    const shin = limb(0.12, 0.1, 0.2, skinDark);
    shin.position.y = -0.58;
    const footGeo = new THREE.CapsuleGeometry(0.11, 0.22, 2, 6);
    footGeo.rotateX(Math.PI / 2);
    footGeo.scale(1.2, 0.55, 1);
    const foot = plain(footGeo, skinDark);
    foot.position.set(0, -0.84, 0.1);
    leg.add(thigh, shin, foot);
    leg.position.set(sx * 0.24, 0.94, 0);
    if (sx === -1) parts.leftLeg = leg; else parts.rightLeg = leg;
    body.add(leg);
  }

  return { body, parts, kind: 'humanoid', height: 2.4 };
}

// Massive ogre: barrel torso, swinging belly, tiny head sunk between the
// shoulders, knotted club in the right fist. Standard biped parts.
export function buildOgre(e: Entity): Rig {
  const body = new THREE.Group();
  const parts: RigParts = {};
  const skin = e.color;
  const skinDark = shade(skin, 0.72);

  // barrel torso bulging at the gut
  const torsoGeo = new THREE.CapsuleGeometry(0.62, 0.7, 4, 11);
  shapeY(torsoGeo, (t) => {
    if (t < 0.4) return 0.88 + 0.3 * Math.sin((t / 0.4) * Math.PI * 0.5);
    return 1.18 - 0.34 * ((t - 0.4) / 0.6);
  });
  torsoGeo.scale(1, 0.82, 0.68);
  lumpy(torsoGeo, 51, 0.09);
  const torso = plain(torsoGeo, skin);
  torso.position.y = 1.56;
  body.add(torso);
  // pale swinging belly
  const bellyGeo = new THREE.SphereGeometry(0.42, 9, 7);
  bellyGeo.scale(1.15, 0.95, 0.7);
  lumpy(bellyGeo, 53, 0.06);
  const belly = plain(bellyGeo, shade(skin, 1.18));
  belly.position.set(0, 1.26, 0.26);
  body.add(belly);
  // rope strap over the left shoulder down to the belt
  const strapGeo = new THREE.TorusGeometry(0.72, 0.05, 5, 14);
  strapGeo.scale(1, 1, 0.6);
  const strap = plain(strapGeo, 0x6b5638);
  strap.position.set(0, 1.5, 0.05);
  strap.rotation.set(0.1, 0, -0.7);
  body.add(strap);
  // battered iron shoulder plate on the strap shoulder
  const plateGeo = new THREE.SphereGeometry(0.34, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
  plateGeo.scale(1, 0.68, 1.1);
  lumpy(plateGeo, 55, 0.05);
  const shoulderPlate = plain(plateGeo, 0x4f555e, { metal: true, flat: true });
  shoulderPlate.position.set(-0.62, 2.12, 0);
  shoulderPlate.rotation.z = -0.4;
  body.add(shoulderPlate);
  // ragged loincloth flap under the belt
  const clothGeo = new THREE.CapsuleGeometry(0.2, 0.34, 2, 7);
  clothGeo.scale(1.15, 1, 0.3);
  lumpy(clothGeo, 57, 0.08);
  const loincloth = plain(clothGeo, 0x5d4a30, { flat: true });
  loincloth.position.set(0, 0.78, 0.4);
  loincloth.rotation.x = 0.12;
  body.add(loincloth);
  // trapezius bulk sinking the head between the shoulders
  for (const sx of [-1, 1]) {
    const trapGeo = new THREE.SphereGeometry(0.26, 8, 6);
    trapGeo.scale(1.1, 0.7, 0.85);
    const trap = plain(trapGeo, skin);
    trap.position.set(sx * 0.42, 2.08, 0);
    body.add(trap);
  }
  // heavy belt
  const beltGeo = new THREE.CylinderGeometry(0.6, 0.64, 0.2, 11, 1, true);
  beltGeo.scale(1, 1, 0.68);
  const belt = plain(beltGeo, 0x4d3a20);
  belt.position.y = 0.98;
  body.add(belt);
  const buckleGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.04, 8);
  buckleGeo.rotateX(Math.PI / 2);
  const buckle = plain(buckleGeo, 0x8d8d85, { metal: true });
  buckle.position.set(0, 0.98, 0.42);
  body.add(buckle);

  const head = new THREE.Group();
  const skullGeo = new THREE.SphereGeometry(0.21, 8, 7);
  skullGeo.scale(0.95, 0.9, 1);
  const skull = plain(skullGeo, skin);
  skull.position.y = 0.1;
  head.add(skull);
  // underbite jaw + lower tusks
  const jawGeo = new THREE.SphereGeometry(0.16, 7, 5);
  jawGeo.scale(1.2, 0.55, 0.95);
  const jaw = plain(jawGeo, skinDark);
  jaw.position.set(0, -0.04, 0.08);
  head.add(jaw);
  for (const sx of [-1, 1]) {
    // big up-jutting tusks — read at 8u, not toothpicks
    const tusk = plain(new THREE.ConeGeometry(0.055, 0.28, 5), 0xfff8e0);
    tusk.position.set(sx * 0.11, 0.08, 0.18);
    tusk.rotation.x = -0.3;
    tusk.rotation.z = -sx * 0.15;
    head.add(tusk);
    // bright sclera + pupil so the head reads as a face
    const sclera = plain(new THREE.SphereGeometry(0.036, 6, 5), 0xf2e6c8);
    sclera.scale.set(1, 0.8, 0.55);
    sclera.position.set(sx * 0.08, 0.14, 0.185);
    head.add(sclera);
    const pupil = plain(new THREE.SphereGeometry(0.017, 5, 4), 0x301d0c);
    pupil.position.set(sx * 0.08, 0.14, 0.205);
    head.add(pupil);
    const ear = plain(new THREE.SphereGeometry(0.05, 5, 4), skinDark);
    ear.scale.set(0.4, 0.8, 0.6);
    ear.position.set(sx * 0.2, 0.08, 0);
    head.add(ear);
  }
  const browGeo = new THREE.CapsuleGeometry(0.04, 0.16, 2, 5);
  browGeo.rotateZ(Math.PI / 2);
  const brow = plain(browGeo, skinDark);
  brow.position.set(0, 0.19, 0.16);
  head.add(brow);
  head.position.y = 2.18;
  parts.head = head;
  body.add(head);

  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    const deltGeo = new THREE.SphereGeometry(0.24, 8, 6);
    lumpy(deltGeo, 61 + sx, 0.06);
    const delt = plain(deltGeo, skin);
    delt.position.y = -0.02;
    const upper = plain(lumpy(limbGeo(0.2, 0.16, 0.3), 63 + sx, 0.06), skin);
    upper.position.y = -0.3;
    const lower = plain(lumpy(limbGeo(0.17, 0.14, 0.28), 65 + sx, 0.06), skinDark);
    lower.position.y = -0.78;
    // hide wraps on the forearms
    for (const wy of [-0.68, -0.9]) {
      const wrap = plain(new THREE.CylinderGeometry(0.17, 0.175, 0.09, 8), 0x4d3a28);
      wrap.position.y = wy;
      arm.add(wrap);
    }
    const fist = handMesh(skinDark, sx, 2.1);
    fist.position.y = -1.1;
    arm.add(delt, upper, lower, fist);
    arm.position.set(sx * 0.82, 2.0, 0);
    if (sx === -1) parts.leftArm = arm; else parts.rightArm = arm;
    body.add(arm);

    const leg = new THREE.Group();
    const thigh = plain(lumpy(limbGeo(0.23, 0.18, 0.24), 67 + sx, 0.06), skin);
    thigh.position.y = -0.24;
    const shin = plain(lumpy(limbGeo(0.17, 0.15, 0.2), 69 + sx, 0.06), skinDark);
    shin.position.y = -0.66;
    const footGeo = new THREE.CapsuleGeometry(0.15, 0.26, 2, 7);
    footGeo.rotateX(Math.PI / 2);
    footGeo.scale(1.2, 0.6, 1);
    const foot = plain(footGeo, 0x3b2a16);
    foot.position.set(0, -0.92, 0.08);
    leg.add(thigh, shin, foot);
    leg.position.set(sx * 0.3, 1.02, 0);
    if (sx === -1) parts.leftLeg = leg; else parts.rightLeg = leg;
    body.add(leg);
  }

  // knotted club, head-down like the other hand weapons
  const club = clubModel();
  club.position.set(0, -1.0, 0.2);
  parts.rightArm!.add(club);

  return { body, parts, kind: 'humanoid', height: 2.8 };
}

// Elemental: a glowing core orbited by five floating faceted boulders. No
// limbs, so the renderer skips walk animation — fine for a drifting rock.
export function buildElemental(e: Entity): Rig {
  const body = new THREE.Group();
  const parts: RigParts = {};
  // crystalline emissive core: a cluster of faceted shards, not a ping-pong ball
  const coreMat = surfaceMat({
    color: e.color, emissive: e.color, emissiveIntensity: GFX.standardMaterials ? 1.5 : 0.9,
  });
  const coreShards: [number, number, number, number][] = [
    [0, 1.25, 0, 0.42], [0.2, 1.04, 0.14, 0.2], [-0.18, 1.46, -0.1, 0.18],
  ];
  let coreSeed = 11;
  for (const [x, y, z, r] of coreShards) {
    const shard = new THREE.Mesh(boulderGeo(r, coreSeed, 0.4, 0), coreMat);
    shard.position.set(x, y, z);
    shard.rotation.set(x * 5, y * 3, z * 7);
    body.add(shard);
    coreSeed += 1;
  }
  const rock = shade(e.color, 0.45);
  const chunks: [number, number, number, number][] = [
    [0.72, 1.05, 0.18, 0.34], [-0.6, 1.5, -0.3, 0.3], [0.2, 1.85, -0.5, 0.26],
    [-0.45, 0.85, 0.5, 0.38], [0.5, 1.6, 0.55, 0.24],
  ];
  let seed = 1;
  for (const [x, y, z, r] of chunks) {
    const chunk = plain(boulderGeo(r, seed, 0.5), rock, { flat: true });
    chunk.position.set(x, y, z);
    chunk.rotation.set(x * 3, y * 3, z * 3); // varied tumble per chunk
    body.add(chunk);
    seed += 1;
  }
  return { body, parts, kind: 'elemental', height: 2.2 };
}

// Dragonkin wyrm: muscular tapered neck and horned head, webbed wing
// membranes, four haunched legs (quadruped anim), tapered ridged tail. Korzul
// wears it at scale 1.8, the sanctum drakonid at 0.8 via the template hint.
export function buildDragonkin(e: Entity): Rig {
  const body = new THREE.Group();
  const parts: RigParts = {};
  const scales = e.color;
  const plate = shade(scales, 0.6);
  const belly = shade(scales, 1.35);

  // long low organic torso, chest-heavy; hash lumps read as scaled hide at
  // boss scale (Korzul renders this at 1.8x)
  const torsoGeo = limbGeo(0.34, 0.48, 1.0, 10);
  torsoGeo.rotateX(-Math.PI / 2); // thick end forward
  torsoGeo.scale(1, 0.85, 1);
  lumpy(torsoGeo, 71, 0.06);
  const torso = plain(torsoGeo, scales);
  torso.position.set(0, 1.08, 0.1);
  body.add(torso);
  const bellyGeo = new THREE.CapsuleGeometry(0.3, 1.0, 3, 8);
  bellyGeo.rotateX(Math.PI / 2);
  bellyGeo.scale(1.05, 0.45, 1);
  const bellyPlate = plain(bellyGeo, belly);
  bellyPlate.position.set(0, 0.82, 0.15);
  body.add(bellyPlate);
  // dorsal ridge fins
  for (let i = 0; i < 5; i++) {
    const ridgeGeo = new THREE.ConeGeometry(0.11, 0.3 - i * 0.03, 4);
    ridgeGeo.scale(0.45, 1, 1);
    const ridge = plain(ridgeGeo, plate, { flat: true });
    ridge.position.set(0, 1.5 - i * 0.02, 0.75 - i * 0.42);
    ridge.rotation.x = -0.25;
    body.add(ridge);
  }

  // muscular tapered neck rising from the chest
  const neckGeo = limbGeo(0.17, 0.27, 0.7, 9);
  lumpy(neckGeo, 73, 0.05);
  const neck = plain(neckGeo, scales);
  neck.position.set(0, 1.62, 1.18);
  neck.rotation.x = -0.7;
  body.add(neck);
  // overlapping dorsal scale plates riding the back of the neck
  for (let i = 0; i < 3; i++) {
    const scaleGeo = new THREE.SphereGeometry(0.17 - i * 0.02, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.55);
    scaleGeo.scale(0.9, 0.7, 1.1);
    const scalePlate = plain(scaleGeo, plate, { flat: true });
    scalePlate.position.set(0, 1.52 + i * 0.26, 0.82 + i * 0.2);
    scalePlate.rotation.x = -0.85;
    body.add(scalePlate);
  }
  const throatGeo = new THREE.CapsuleGeometry(0.14, 0.5, 2, 7);
  throatGeo.scale(1, 1, 0.7);
  const throat = plain(throatGeo, belly);
  throat.position.set(0, 1.6, 1.3);
  throat.rotation.x = -0.7;
  body.add(throat);

  // horned skull at the end of the neck; head pivot drives the bite anim
  const head = new THREE.Group();
  const skullGeo = new THREE.SphereGeometry(0.23, 9, 7);
  skullGeo.scale(1.0, 0.85, 1.15);
  const skull = plain(skullGeo, scales);
  skull.position.set(0, 0.02, 0.05);
  head.add(skull);
  const snoutGeo = limbGeo(0.1, 0.16, 0.28);
  snoutGeo.rotateX(Math.PI / 2);
  snoutGeo.scale(1.1, 0.72, 1);
  const snout = plain(snoutGeo, plate);
  snout.position.set(0, -0.02, 0.42);
  head.add(snout);
  const jawGeo = new THREE.CapsuleGeometry(0.09, 0.3, 2, 6);
  jawGeo.rotateX(Math.PI / 2);
  jawGeo.scale(1.1, 0.5, 1);
  const jaw = plain(jawGeo, shade(scales, 0.5));
  jaw.position.set(0, -0.17, 0.35);
  head.add(jaw);
  // nostril bumps + brow ridges
  for (const sx of [-1, 1]) {
    const nostril = plain(new THREE.SphereGeometry(0.035, 5, 4), shade(plate, 0.8));
    nostril.position.set(sx * 0.06, 0.06, 0.62);
    head.add(nostril);
    const browGeo = new THREE.CapsuleGeometry(0.04, 0.12, 2, 5);
    browGeo.rotateX(Math.PI / 2);
    const browRidge = plain(browGeo, plate);
    browRidge.position.set(sx * 0.13, 0.15, 0.18);
    browRidge.rotation.x = -0.3;
    head.add(browRidge);
    // two-segment swept-back horns
    const horn1 = plain(limbGeo(0.04, 0.06, 0.2, 6), 0xd8cfb8);
    horn1.position.set(sx * 0.13, 0.25, -0.12);
    horn1.rotation.x = -1.05;
    horn1.rotation.z = -sx * 0.12;
    head.add(horn1);
    const horn2 = plain(limbGeo(0.014, 0.038, 0.2, 6), 0xd8cfb8);
    horn2.position.set(sx * 0.15, 0.33, -0.32);
    horn2.rotation.x = -1.5;
    horn2.rotation.z = -sx * 0.15;
    head.add(horn2);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), surfaceMat({
      color: 0xffc24d, emissive: 0xff8a00,
      emissiveIntensity: GFX.standardMaterials ? 2.0 : 1.4,
    }));
    eye.position.set(sx * 0.16, 0.05, 0.3);
    head.add(eye);
  }
  head.position.set(0, 2.05, 1.62);
  parts.head = head;
  body.add(head);

  // webbed wings: shaped membrane with scalloped trailing edge + finger spars
  const membraneShape = new THREE.Shape();
  membraneShape.moveTo(0, 0);
  membraneShape.lineTo(1.55, 0.5);
  membraneShape.quadraticCurveTo(1.45, 0.05, 1.25, -0.42);
  membraneShape.quadraticCurveTo(1.05, -0.2, 0.82, -0.55);
  membraneShape.quadraticCurveTo(0.6, -0.3, 0.36, -0.5);
  membraneShape.quadraticCurveTo(0.16, -0.28, 0, -0.3);
  membraneShape.closePath();
  const membraneGeoR = new THREE.ShapeGeometry(membraneShape, 10);
  {
    // sag the membrane between the finger spars so it drapes like skin
    // instead of lying flat like paper (+z here maps to world -y / down)
    const sparAngs = [0.312, -0.324, -0.59];
    const mpos = membraneGeoR.attributes.position;
    for (let i = 0; i < mpos.count; i++) {
      const x = mpos.getX(i), y = mpos.getY(i);
      const r = Math.hypot(x, y);
      if (r < 0.08) continue;
      const a = Math.atan2(y, x);
      let d = Infinity;
      for (const sa of sparAngs) d = Math.min(d, Math.abs(a - sa));
      mpos.setZ(i, mpos.getZ(i) + Math.min(1, d / 0.3) * 0.16 * r);
    }
    membraneGeoR.computeVertexNormals();
  }
  for (const sx of [-1, 1]) {
    const wing = new THREE.Group();
    const planeGroup = new THREE.Group();
    const memGeo = sx === 1 ? membraneGeoR : membraneGeoR.clone().scale(-1, 1, 1);
    const membrane = plain(memGeo, shade(scales, 0.5), { side: THREE.DoubleSide });
    planeGroup.add(membrane);
    // arm bone along the leading edge + two finger spars to the scallop tips
    const spars: [number, number, number, number, number][] = [
      // [len, rBase, tipX, tipY, rTip]
      [1.6, 0.05, 1.55, 0.5, 0.02],
      [1.3, 0.032, 1.25, -0.42, 0.012],
      [0.96, 0.028, 0.82, -0.55, 0.01],
    ];
    for (const [len, rBase, tx, ty, rTip] of spars) {
      const ang = Math.atan2(ty, tx);
      const spar = plain(limbGeo(rTip, rBase, len - rBase - rTip, 5), plate);
      spar.position.set(sx * tx / 2, ty / 2, 0.012);
      spar.rotation.z = sx > 0 ? ang - Math.PI / 2 : Math.PI / 2 - ang;
      planeGroup.add(spar);
    }
    const shoulderKnob = plain(new THREE.SphereGeometry(0.09, 6, 5), plate);
    planeGroup.add(shoulderKnob);
    planeGroup.rotation.x = Math.PI / 2; // shape +y → world +z (forward)
    wing.add(planeGroup);
    wing.position.set(sx * 0.3, 1.52, 0.1);
    wing.rotation.z = sx * 0.35;
    wing.rotation.y = sx * 0.4;
    body.add(wing);
  }

  // four haunched legs for the quadruped walk cycle
  parts.legs = [];
  for (const [sx, sz] of [[-0.42, 0.7], [0.42, 0.7], [-0.42, -0.7], [0.42, -0.7]]) {
    const leg = new THREE.Group();
    const isHind = sz < 0;
    const haunchGeo = new THREE.SphereGeometry(isHind ? 0.21 : 0.17, 7, 6);
    haunchGeo.scale(0.7, 1.2, 1.05);
    const haunch = plain(haunchGeo, scales);
    haunch.position.y = -0.1;
    const shank = limb(0.085, 0.065, 0.32, plate);
    shank.position.y = -0.42;
    const footGeo = new THREE.CapsuleGeometry(0.08, 0.16, 2, 6);
    footGeo.rotateX(Math.PI / 2);
    footGeo.scale(1.2, 0.55, 1);
    const foot = plain(footGeo, plate);
    foot.position.set(0, -0.74, 0.06);
    leg.add(haunch, shank, foot);
    // claw tips
    for (const cx of [-0.05, 0.05]) {
      const claw = plain(new THREE.ConeGeometry(0.025, 0.09, 4), 0xd8cfb8);
      claw.rotation.x = Math.PI / 2 - 0.3;
      claw.position.set(cx, -0.75, 0.2);
      leg.add(claw);
    }
    leg.position.set(sx, 0.78, sz);
    parts.legs.push(leg);
    body.add(leg);
  }

  // tapered ridged tail; the outer pivot pre-rotates against the renderer's
  // 0.55 base sway so the tail trails low instead of sticking up
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 1.15, -1.0);
  tailPivot.rotation.x = -0.45;
  const tail = new THREE.Group();
  const tailGeo = limbGeo(0.045, 0.21, 1.3, 8);
  tailGeo.rotateX(-Math.PI / 2);
  tailGeo.translate(0, 0, -0.75);
  lumpy(tailGeo, 77, 0.045);
  tail.add(plain(tailGeo, scales));
  for (let i = 0; i < 3; i++) {
    const spikeGeo = new THREE.ConeGeometry(0.05, 0.16, 4);
    spikeGeo.scale(0.5, 1, 1);
    const spike = plain(spikeGeo, plate, { flat: true });
    spike.position.set(0, 0.16 - i * 0.045, -0.3 - i * 0.4);
    spike.rotation.x = -0.4;
    tail.add(spike);
  }
  const tailSpike = plain(new THREE.ConeGeometry(0.08, 0.4, 5), plate, { flat: true });
  tailSpike.position.set(0, 0, -1.55);
  tailSpike.rotation.x = -Math.PI / 2;
  tail.add(tailSpike);
  tailPivot.add(tail);
  parts.tail = tail;
  body.add(tailPivot);

  return { body, parts, kind: 'dragonkin', height: 2.4 };
}

// Druid bear form: a stout brown quadruped on the wolf rig pattern.
export function buildBear(): Rig {
  const body = new THREE.Group();
  const parts: RigParts = {};
  const fur = 0x6e4a2a;
  const furDark = 0x4f3115;
  // heavy organic torso with a shoulder hump
  const torsoGeo = limbGeo(0.54, 0.46, 0.85, 10);
  torsoGeo.rotateX(Math.PI / 2);
  torsoGeo.scale(0.95, 0.9, 1);
  const torso = plain(torsoGeo, fur);
  torso.position.set(0, 1.02, -0.05);
  body.add(torso);
  const humpGeo = new THREE.SphereGeometry(0.36, 8, 6);
  humpGeo.scale(1, 0.8, 0.9);
  const hump = plain(humpGeo, fur);
  hump.position.set(0, 1.34, 0.42);
  body.add(hump);

  const head = new THREE.Group();
  const skullGeo = new THREE.SphereGeometry(0.3, 9, 7);
  skullGeo.scale(1, 0.9, 1);
  head.add(plain(skullGeo, fur));
  const snoutGeo = limbGeo(0.11, 0.16, 0.14);
  snoutGeo.rotateX(Math.PI / 2);
  snoutGeo.scale(1, 0.8, 1);
  const snout = plain(snoutGeo, furDark);
  snout.position.set(0, -0.08, 0.3);
  head.add(snout);
  const nose = plain(new THREE.SphereGeometry(0.05, 6, 5), 0x1a1a1a);
  nose.position.set(0, -0.04, 0.43);
  head.add(nose);
  for (const sx of [-1, 1]) {
    const earGeo = new THREE.SphereGeometry(0.1, 6, 5);
    earGeo.scale(0.9, 0.9, 0.45);
    const ear = plain(earGeo, furDark);
    ear.position.set(sx * 0.2, 0.3, -0.05);
    head.add(ear);
    const eye = plain(new THREE.SphereGeometry(0.035, 5, 4), 0x1d1208);
    eye.position.set(sx * 0.13, 0.06, 0.26);
    head.add(eye);
  }
  head.position.set(0, 1.35, 1.05);
  parts.head = head;
  body.add(head);

  parts.legs = [];
  for (const [sx, sz] of [[-0.36, 0.62], [0.36, 0.62], [-0.36, -0.62], [0.36, -0.62]]) {
    const leg = new THREE.Group();
    const upper = limb(0.16, 0.12, 0.3, furDark);
    upper.position.y = -0.22;
    const pawGeo = new THREE.SphereGeometry(0.12, 7, 5);
    pawGeo.scale(1.1, 0.5, 1.3);
    const paw = plain(pawGeo, furDark);
    paw.position.set(0, -0.64, 0.04);
    leg.add(upper, paw);
    leg.position.set(sx, 0.7, sz);
    parts.legs.push(leg);
    body.add(leg);
  }
  return finalizeRig({ body, parts, kind: 'wolf', height: 1.9 });
}

// Polymorph form
export function buildSheep(): Rig {
  const body = new THREE.Group();
  const parts: RigParts = {};
  // lumpy wool blob
  const wool = plain(boulderGeo(0.5, 9, 0.18), 0xf2f0e6, { flat: true });
  wool.scale.set(1, 0.85, 1.3);
  wool.position.y = 0.72;
  body.add(wool);
  const head = new THREE.Group();
  const faceGeo = new THREE.SphereGeometry(0.16, 8, 6);
  faceGeo.scale(0.9, 1.05, 1.05);
  head.add(plain(faceGeo, 0x2c2c2c));
  // wool tuft on top
  const tuft = plain(boulderGeo(0.11, 4, 0.3), 0xf2f0e6, { flat: true });
  tuft.position.set(0, 0.13, -0.03);
  head.add(tuft);
  for (const sx of [-1, 1]) {
    const earGeo = new THREE.SphereGeometry(0.09, 6, 5);
    earGeo.scale(0.9, 0.45, 0.35);
    const ear = plain(earGeo, 0x2c2c2c);
    ear.position.set(sx * 0.17, 0.04, 0);
    ear.rotation.z = sx * 0.5;
    head.add(ear);
    const eye = plain(new THREE.SphereGeometry(0.026, 5, 4), 0xe8e4d8);
    eye.position.set(sx * 0.09, 0.05, 0.13);
    head.add(eye);
  }
  head.position.set(0, 0.92, 0.62);
  parts.head = head;
  body.add(head);
  parts.legs = [];
  for (const [sx, sz] of [[-0.2, 0.35], [0.2, 0.35], [-0.2, -0.35], [0.2, -0.35]]) {
    const leg = new THREE.Group();
    const shin = limb(0.048, 0.038, 0.26, 0x2c2c2c);
    shin.position.y = -0.18;
    const hoof = plain(new THREE.CylinderGeometry(0.035, 0.04, 0.05, 6), 0x1a1a1a);
    hoof.position.y = -0.37;
    leg.add(shin, hoof);
    leg.position.set(sx, 0.42, sz);
    parts.legs.push(leg);
    body.add(leg);
  }
  return finalizeRig({ body, parts, kind: 'sheep', height: 1.2 });
}

// Generic armed humanoid — the family default for 'humanoid' mobs and the
// fallback for any template the renderer does not recognise.
function buildGenericHumanoid(e: Entity, hood = false): Rig {
  return buildHumanoid(e, { shirt: e.color, pants: 0x33302b, weapon: 'sword', hood });
}

// One rig builder per mob family; individual templates only override below
// where their look differs from the family default.
const FAMILY_BUILDERS: Record<MobFamily, (e: Entity) => Rig> = {
  beast: buildWolf,
  humanoid: (e) => buildGenericHumanoid(e),
  murloc: buildMurloc,
  spider: buildSpider,
  kobold: buildKobold,
  undead: buildSkeleton,
  troll: buildTroll,
  ogre: buildOgre,
  elemental: buildElemental,
  dragonkin: buildDragonkin,
};

const MOB_OVERRIDES: Record<string, (e: Entity) => Rig> = {
  wild_boar: buildBoar,
  old_greyjaw: (e) => {
    // hulking grizzled wolf: extra bulk on top of the template scale hint,
    // plus a dark battle-worn shaggy ruff across the shoulders
    const rig = buildWolf(e);
    rig.body.scale.multiplyScalar(1.08);
    const ruff = plain(boulderGeo(0.36, 13, 0.22), 0x2f3436, { flat: true });
    ruff.scale.set(1.3, 0.7, 0.95);
    ruff.position.set(0, 1.15, 0.42);
    rig.body.add(ruff);
    return rig;
  },
  gorrak: (e) => {
    const rig = buildHumanoid(e, { shirt: e.color, pants: 0x2c1a33, weapon: 'sword', shoulders: true });
    // boss spikes rising off the pauldrons
    for (const sx of [-1, 1]) {
      const spike = plain(new THREE.ConeGeometry(0.14, 0.42, 5), 0x2c2c34);
      spike.position.set(sx * 0.56, 2.22, 0);
      spike.rotation.z = sx * 0.25;
      rig.body.add(spike);
    }
    return rig;
  },
  vale_bandit: (e) => buildGenericHumanoid(e, true),
};

export function buildRigFor(e: Entity): Rig {
  if (e.kind === 'mob') {
    const override = MOB_OVERRIDES[e.templateId];
    if (override) return finalizeRig(override(e));
    const family = MOBS[e.templateId]?.family;
    const builder = family ? FAMILY_BUILDERS[family] : undefined;
    return finalizeRig((builder ?? buildGenericHumanoid)(e));
  }
  if (e.kind === 'player') {
    const cls = e.templateId;
    const robed = cls === 'mage' || cls === 'priest' || cls === 'warlock';
    const weapon: 'sword' | 'staff' | 'dagger' | 'mace' | 'bow' =
      cls === 'rogue' ? 'dagger'
        : cls === 'hunter' ? 'bow'
          : cls === 'paladin' || cls === 'shaman' ? 'mace'
            : robed || cls === 'druid' ? 'staff'
              : 'sword';
    return finalizeRig(buildHumanoid(e, {
      shirt: e.color,
      pants: robed ? e.color : 0x33302b,
      weapon,
      shoulders: cls === 'warrior' || cls === 'paladin' || cls === 'shaman',
      robe: robed,
      hair: 0x6b4423,
      accent: e.color,
    }));
  }
  // npcs
  const npcWeapons: Record<string, 'sword' | 'staff' | 'none' | 'pick' | 'mace' | 'bow'> = {
    marshal_redbrook: 'sword', brother_aldric: 'staff', foreman_odell: 'pick',
    // Fenbridge (zone 2)
    warden_fenwick: 'sword', scout_maren: 'bow', brother_aldric_fen: 'staff', smith_haldren: 'mace',
    // Highwatch (zone 3)
    captain_thessaly: 'sword', scout_maren_highwatch: 'bow', armorer_hode: 'mace',
    loremaster_caddis: 'staff', brother_aldric_highwatch: 'staff',
  };
  return finalizeRig(buildHumanoid(e, {
    shirt: e.color,
    pants: 0x4a4138,
    weapon: npcWeapons[e.templateId] ?? 'none',
    // Brother Aldric recurs in every zone hub under new ids; keep him robed
    robe: e.templateId.startsWith('brother_aldric'),
    hair: 0x7a6a50,
  }));
}
