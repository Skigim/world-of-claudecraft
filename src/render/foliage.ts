import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  DUNGEON_X_THRESHOLD, WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z, ZONES,
} from '../sim/data';
import type { BiomeId } from '../sim/types';
import {
  generateDecorations, roadDistance, terrainHeight, zoneBiomeAt, WATER_LEVEL,
} from '../sim/world';
import type { Decoration } from '../sim/world';
import { GFX, sharedUniforms, surfaceMat } from './gfx';
import { barkMaps, barkTexture, foliageCardTexture, foliageTexture, grassTuftTexture } from './textures';

// Vegetation: trees, rocks and the grass ring.
//
// - Trees/rocks are InstancedMeshes bucketed per (zone band x 3 x-columns) so
//   frustum culling drops whole off-screen forests.
// - Per-instance HSL color variation rides on instanceColor; the base tint is
//   biome-aware (marsh trees murkier and mossier, peaks pines a darker
//   blue-green).
// - High tier: foliage (not trunks/rocks) sways in the wind via
//   onBeforeCompile on the shared uTime clock.
// - Shapes are hand-built organic merges (one trunk draw + one canopy draw
//   per species per bucket): pines stack ragged noise-rimmed tiers on a
//   gnarled trunk with a root flare plus a crossed alpha-card ring; oaks fork
//   into limbs under a cluster of noise-displaced icosahedron lobes; marsh
//   tree2 becomes a twisted bare swamp tree with sparse drooping lobes and
//   hanging moss cards; rocks are flat-shaded noise-displaced icosahedron
//   boulders (single + stacked-cluster archetypes) with a baked moss or
//   snow-dust top blend.
// - Grass is a player-centered ring (O(radius^2), not O(world^2)) rebuilt
//   when the player moves >12u. Tuft placement hashes the absolute grid cell,
//   so the same tufts always reappear in the same spots. A shader fade
//   dissolves tufts at the ring edge.

const GRASS_REBUILD_DIST = 12;
const TREE_WIND_STRENGTH = 0.06;
const GRASS_WIND_STRENGTH = 0.08;
// two x-halves x 200u z-bands: each bucket is up to ~6 draws (+canopy
// shadows), so bucket count is the foliage draw budget — finer 120u thirds
// cost ~60 extra calls at town for culling that barely bit
const BUCKET_DEPTH = 200;

// Desaturated forest palette: the first pass's lime tints clashed with the
// warm grade and read as pre-overhaul plastic. Tufts also pick up the ground
// hue (vale is no longer pure white) so the meadow belongs to the terrain.
const PINE_TINT: Record<BiomeId, number> = { vale: 0x9bb48d, marsh: 0x87966b, peaks: 0x6f8a7a };
const OAK_TINT: Record<BiomeId, number> = { vale: 0xa7b886, marsh: 0x8d9865, peaks: 0x92a37f };
const ROCK_TINT: Record<BiomeId, number> = { vale: 0x8d8d85, marsh: 0x565c4e, peaks: 0x878e99 };

// rocks only pick up the snow-dust colorway above the terrain snowline —
// low-altitude peaks-biome foothills stay mossy/bare (white rocks on green
// grass read as scattered eggs)
const ROCK_SNOWLINE_Y = 34; // terrain snow tint starts at h~34 (terrain.ts)
const TRUNK_TINT: Record<BiomeId, number> = { vale: 0xffffff, marsh: 0xd2d8bc, peaks: 0xd9dde4 };
const GRASS_TINT: Record<BiomeId, number> = { vale: 0xdde4c0, marsh: 0xbfc492, peaks: 0xc2cec8 };
// marsh tree2 is a swamp tree: murkier canopy than the vale oak, and the
// hanging moss strands multiply the olive tuft texture toward gray-green
const SWAMP_CANOPY_TINT = 0x7e8b58;
const SWAMP_MOSS_TINT = 0xa8b184;
// grass refuses cliff faces (mirrors ROCK_SLOPE_START in terrain.ts)
const GRASS_MAX_SLOPE = 0.62;
const GRASS_SLOPE_EPS = 1.2;

export interface FoliageView {
  group: THREE.Group;
  /** per-frame: grass fade + ring rebuild, fog culling of far tree buckets */
  update(px: number, pz: number, camX: number, camZ: number, fogFar: number): void;
}

// deterministic 0..1 hash on integer grid cells / world coords
function hashAt(a: number, b: number, k: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

// fog-cullable handle for one instanced bucket mesh
interface BucketMesh {
  mesh: THREE.InstancedMesh;
  x: number;
  z: number;
  radius: number;
}

// Wind sway injection for foliage materials (canopy + grass cards). Phase
// comes from the instance's world origin so neighbouring trees desynchronise.
function addWind(mat: THREE.Material, strength: number): void {
  if (!GFX.windSway) return;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.uniforms.uWindStrength = { value: strength };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform float uWindStrength;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float windPhase = instanceMatrix[3][0] * 0.15 + instanceMatrix[3][2] * 0.17;
        #else
          float windPhase = 0.0;
        #endif
        float windAmt = (sin(uTime * 1.7 + windPhase) + 0.5 * sin(uTime * 3.1 + windPhase * 1.3))
          * uWindStrength * smoothstep(0.0, 1.0, transformed.y);
        transformed.x += windAmt;
        transformed.z += windAmt * 0.6;`);
  };
}

// Deterministic hash keyed on the quantised vertex position: seam/cap/pole
// twin vertices land in the same cell, so welded shapes stay welded after
// noise displacement.
function quantHash(x: number, y: number, z: number, k: number): number {
  const qx = Math.round(x * 20) / 20, qy = Math.round(y * 20) / 20, qz = Math.round(z * 20) / 20;
  return hashAt(qx * 13.7 + qz * 31.1, qy * 7.3, k);
}

// One pine foliage tier: a drooped cone whose rim is pushed in/out and up/down
// per vertex so the silhouette reads as ragged branch clumps, not a cone.
function raggedTier(radius: number, height: number, droop: number, key: number): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(radius, height, 8, 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const radial = Math.min(1, Math.hypot(x, z) / radius);
    const rs = 1 + (quantHash(x, y, z, key) - 0.5) * 0.55 * radial;
    const dy = (quantHash(x, y, z, key + 17) - 0.5) * 0.6 * radial - droop * radial * radial;
    pos.setXYZ(i, x * rs, y + dy, z * rs);
  }
  geo.computeVertexNormals();
  return geo;
}

// Smooth trilinear value noise on the hashAt lattice — continuous across
// vertices (white per-vertex hash turns dense meshes into spiky messes).
function valueNoise3(x: number, y: number, z: number, k: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const sm = (t: number): number => t * t * (3 - 2 * t);
  const u = sm(x - xi), v = sm(y - yi), w = sm(z - zi);
  const h = (a: number, b: number, cc: number): number => hashAt(a * 13.7 + cc * 31.1, b * 7.3, k);
  const lp = (a: number, b: number, t: number): number => a + (b - a) * t;
  return lp(
    lp(lp(h(xi, yi, zi), h(xi + 1, yi, zi), u), lp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    lp(lp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), lp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

// Icosahedron lobe with two octaves of radial value noise — a lumpy foliage
// cloud. Normals are reset to the radial direction for soft rounded shading
// (icosahedron faces are unwelded, so computeVertexNormals would facet).
// Big lobes get detail 2 so close-up silhouettes stay leafy, not triangular.
function noisyLobe(radius: number, amp: number, key: number, detail = 1): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const coarse = (valueNoise3(x * 1.1, y * 1.1, z * 1.1, key) - 0.5) * 2 * amp;
    const fine = (valueNoise3(x * 3.1, y * 3.1, z * 3.1, key + 9) - 0.5) * amp * 0.8;
    const s = 1 + coarse + fine;
    pos.setXYZ(i, x * s, y * s, z * s);
    const il = 1 / (Math.hypot(x, y, z) || 1);
    nrm.setXYZ(i, x * il, y * il, z * il);
    // continuous spherical UVs: the polyhedron's per-face islands turn every
    // edge into a texture seam, which reads as giant hard triangles up close
    uv.setXY(i, Math.atan2(z, x) / (Math.PI * 2) + 0.5, Math.acos(Math.max(-1, Math.min(1, y * il))) / Math.PI);
  }
  return geo;
}

// y-squash a lobe (foliage clouds are wider than tall)
function squash(geo: THREE.BufferGeometry, k: number): THREE.BufferGeometry {
  return geo.applyMatrix4(new THREE.Matrix4().makeScale(1, k, 1));
}

// Tapered trunk with per-ring radius wobble, per-vertex gnarl and an optional
// lean / S-bend; base sits at y=0. Original radial normals are kept — the
// wobble is small and recomputing them would crack the UV seam.
function gnarledTrunk(
  rBase: number, rTop: number, height: number, lean: number, sBend: number, key: number,
  heightSegs = 4,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(rTop, rBase, height, 6, heightSegs);
  geo.translate(0, height / 2, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = Math.min(1, Math.max(0, y / height));
    const ring = 1 + (hashAt(Math.round(y * 20), key, 4) - 0.5) * 0.28;
    const gnarl = 1 + (quantHash(x, y, z, key + 5) - 0.5) * 0.14;
    const bend = Math.sin(t * Math.PI) * sBend + t * t * lean;
    pos.setXYZ(i, x * ring * gnarl + bend, y, z * ring * gnarl + bend * 0.4);
  }
  return geo;
}

// Tapered limb: base at (bx,by,bz), tilted `tilt` rad from vertical, spun to
// the `yaw` direction. Used for oak forks and bare swamp branches.
function branchLimb(
  rBase: number, rTop: number, len: number, tilt: number, yaw: number,
  bx: number, by: number, bz: number,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(rTop, rBase, len, 5, 1);
  geo.translate(0, len / 2, 0);
  geo.rotateZ(tilt);
  geo.rotateY(yaw);
  geo.translate(bx, by, bz);
  return geo;
}

// Short tapered root spur radiating from the trunk base at angle `a`.
function rootSpur(r: number, len: number, a: number): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(r, len, 4);
  geo.translate(0, len / 2, 0);
  geo.rotateZ(-1.25); // apex leans toward +x, nearly horizontal
  geo.rotateY(a);
  geo.translate(Math.cos(a) * r, 0.1, -Math.sin(a) * r);
  return geo;
}

// Ring of root spurs — merged into the trunk geometry so the base flares
// organically instead of a cylinder stabbing the ground.
function rootFlare(count: number, trunkR: number, len: number, key: number): THREE.BufferGeometry[] {
  const spurs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + hashAt(i, key, 6) * 1.1;
    spurs.push(rootSpur(
      trunkR * (0.45 + hashAt(i, key, 7) * 0.25),
      len * (0.8 + hashAt(i, key, 8) * 0.5),
      a,
    ));
  }
  return spurs;
}

// Noise-displaced icosahedron boulder; the facets come from the flat-shaded
// material, so post-noise normals are left alone.
function boulder(radius: number, amp: number, key: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const s = 1 + (quantHash(x, y, z, key) - 0.5) * 2 * amp;
    pos.setXYZ(i, x * s, y * s, z * s);
  }
  return geo;
}

// Upward-facing rock vertices blend toward `tint` (moss or snow dust) and the
// underside picks up baked AO; both multiply the per-instance gray.
function bakeTopTint(geo: THREE.BufferGeometry, tint: THREE.Color): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const upness = y / (Math.hypot(x, y, z) || 1);
    const t = THREE.MathUtils.smoothstep(upness, 0.05, 0.8);
    const ao = 1 + Math.min(0, upness) * 0.24;
    arr[i * 3] = (1 + (tint.r - 1) * t) * ao;
    arr[i * 3 + 1] = (1 + (tint.g - 1) * t) * ao;
    arr[i * 3 + 2] = (1 + (tint.b - 1) * t) * ao;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Crossed alpha-card pair hanging below a swamp canopy lobe (top edge at y),
// using the grass-tuft texture flipped so the blades droop downward.
function mossStrand(w: number, h: number, x: number, y: number, z: number, yaw: number): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(w, h);
  a.rotateZ(Math.PI);
  const b = a.clone().rotateY(Math.PI / 2);
  const geo = mergeGeometries([a, b]);
  geo.rotateY(yaw);
  geo.translate(x, y - h / 2, z);
  return geo;
}

// biome tint + per-instance HSL jitter, deterministic from world position
function tintFor(d: Decoration, hex: number, out: THREE.Color, jitter = 1): THREE.Color {
  out.setHex(hex);
  out.offsetHSL(
    (hashAt(d.x, d.z, 1) - 0.5) * 0.09 * jitter,
    (hashAt(d.x, d.z, 2) - 0.5) * 0.18 * jitter,
    (hashAt(d.x, d.z, 3) - 0.5) * 0.12 * jitter,
  );
  return out;
}

// per-canopy-layer brightness baked as vertex colors (multiplies instanceColor)
function bakeShade(geo: THREE.BufferGeometry, v: number): THREE.BufferGeometry {
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  arr.fill(v);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// darker under-canopy -> lit crown vertical gradient, multiplied over the
// per-layer shade — without it trees read as uniformly lit green jellies
function bakeVerticalShade(geo: THREE.BufferGeometry, dark = 0.62, light = 1.14): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const span = Math.max(1e-5, bb.max.y - bb.min.y);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = geo.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - bb.min.y) / span;
    const k = dark + (light - dark) * t * t * (3 - 2 * t);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return geo;
}

// ---------------------------------------------------------------------------
// Trees & rocks
// ---------------------------------------------------------------------------

function buildTrees(parent: THREE.Group, seed: number, registry: BucketMesh[]): void {
  const usePbr = GFX.standardMaterials;
  const decos = generateDecorations(seed);
  const buckets = new Map<string, Decoration[]>();
  for (const d of decos) {
    const col = d.x < 0 ? 0 : 1;
    const band = Math.floor((d.z - WORLD_MIN_Z) / BUCKET_DEPTH);
    const key = `${band}:${col}`;
    const list = buckets.get(key);
    if (list) list.push(d);
    else buckets.set(key, [d]);
  }

  // materials shared across every bucket (tint lives on instanceColor)
  const trunkMat = usePbr
    ? (() => {
      const bark = barkMaps();
      return surfaceMat({ map: bark.map, normalMap: bark.normalMap, roughness: 0.95 });
    })()
    : new THREE.MeshLambertMaterial({ map: barkTexture() });
  const leafTex = foliageTexture(usePbr); // high-contrast leaf clusters on the lit tiers
  // double the tiling on canopies: the native cone/sphere UVs stretched the
  // 128px detail into long diagonal smears on big canopy faces
  if (usePbr) leafTex.repeat.set(2, 2);
  // vertexColors carry the per-canopy-layer shading (the cone stack / blob
  // cluster is one merged geometry = one draw per bucket)
  const leafMat = usePbr
    ? new THREE.MeshStandardMaterial({ map: leafTex, roughness: 0.9, vertexColors: true })
    : new THREE.MeshLambertMaterial({ map: leafTex, vertexColors: true });
  addWind(leafMat, TREE_WIND_STRENGTH);
  let cardMat: THREE.Material | null = null;
  let mossMat: THREE.Material | null = null;
  if (usePbr) {
    cardMat = new THREE.MeshStandardMaterial({
      map: foliageCardTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9,
    });
    addWind(cardMat, TREE_WIND_STRENGTH);
    mossMat = new THREE.MeshStandardMaterial({
      map: grassTuftTexture(26), alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.95,
    });
    addWind(mossMat, TREE_WIND_STRENGTH * 1.6); // loose strands swing more than boughs
  }
  // vertexColors carry the baked moss/snow top blend + under-AO
  const rockMat = usePbr
    ? new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1.0, vertexColors: true })
    : new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true });

  // shared geometries — every species is a pre-merged organic shape, local
  // frame with the trunk base at y=0 (instances sink a little so root flares
  // grip slopes); the uniform instance scale keeps proportions

  // pine: gnarled trunk + root flare; four ragged tiers + a tip spike, upper
  // tiers spaced so slivers of trunk show through the gaps
  const pineTrunkGeo = mergeGeometries([
    gnarledTrunk(0.34, 0.12, 6.4, 0.22, 0, 11),
    ...rootFlare(4, 0.34, 0.85, 12),
  ]);
  const pineCanopyGeo = bakeVerticalShade(mergeGeometries([
    bakeShade(raggedTier(2.5, 1.9, 0.5, 31).translate(0.12, 2.1, -0.08), 1.0),
    bakeShade(raggedTier(1.95, 1.7, 0.4, 32).rotateY(1.3).translate(-0.15, 3.15, 0.1), 1.14),
    bakeShade(raggedTier(1.45, 1.5, 0.3, 33).rotateY(2.6).translate(0.1, 4.2, 0.1), 0.98),
    bakeShade(raggedTier(1.0, 1.35, 0.2, 34).rotateY(4.0).translate(-0.07, 5.2, -0.08), 1.1),
    bakeShade(raggedTier(0.5, 1.3, 0.1, 35).translate(0, 6.2, 0), 1.04),
  ]), 0.78, 1.12); // dark floor stays lifted: tier undersides must not go black
  let cardGeo: THREE.BufferGeometry | null = null;
  if (usePbr) {
    const lo = bakeShade(new THREE.PlaneGeometry(4.5, 2.4), 1.0).translate(0, 2.7, 0);
    const lo2 = lo.clone().rotateY(Math.PI / 2);
    const hi = bakeShade(new THREE.PlaneGeometry(2.9, 1.7), 1.08).rotateY(Math.PI / 4).translate(0, 4.8, 0);
    const hi2 = hi.clone().rotateY(Math.PI / 2);
    cardGeo = mergeGeometries([lo, lo2, hi, hi2]);
  }

  // oak: trunk forks into limbs that vanish into a cluster of six
  // noise-displaced icosahedron lobes, two drooping low
  const oakTrunkGeo = mergeGeometries([
    gnarledTrunk(0.55, 0.3, 2.5, 0.1, 0.05, 13),
    branchLimb(0.26, 0.11, 2.5, 0.5, 0.4, 0.15, 2.0, 0),
    branchLimb(0.23, 0.1, 2.2, 0.62, 2.5, -0.12, 1.9, 0.05),
    branchLimb(0.16, 0.07, 1.6, 0.95, 4.4, 0, 1.6, -0.1),
    ...rootFlare(4, 0.5, 0.8, 14),
  ]);
  // the crown lobe goes detail 2 on the lit tiers so a camera inside the
  // canopy sees leafy curvature, not giant flat triangles (the rest stay
  // detail 1 to hold the triangle budget)
  const lobeDetail = usePbr ? 2 : 1;
  const oakCanopyGeo = bakeVerticalShade(mergeGeometries([
    bakeShade(squash(noisyLobe(1.85, 0.3, 41, lobeDetail), 0.85).translate(0.1, 4.3, 0), 1.0),
    bakeShade(squash(noisyLobe(1.35, 0.32, 42), 0.8).translate(1.55, 3.85, 0.5), 1.12),
    bakeShade(squash(noisyLobe(1.3, 0.3, 43), 0.78).translate(-1.5, 3.9, -0.45), 0.92),
    bakeShade(squash(noisyLobe(1.05, 0.3, 44), 0.75).translate(0.45, 5.15, -0.3), 1.08),
    bakeShade(squash(noisyLobe(1.0, 0.34, 45), 0.62).translate(1.05, 3.0, -1.25), 0.9),
    bakeShade(squash(noisyLobe(0.95, 0.32, 46), 0.6).translate(-0.95, 2.95, 1.2), 0.96),
  ]), 0.66, 1.12);
  // sparse alpha leaf-card rim breaks the oak silhouette edge (pines have one)
  let oakCardGeo: THREE.BufferGeometry | null = null;
  if (usePbr) {
    const a = bakeShade(new THREE.PlaneGeometry(4.6, 2.6), 1.02).translate(0, 4.2, 0);
    const b = a.clone().rotateY(Math.PI / 2);
    const cTop = bakeShade(new THREE.PlaneGeometry(3.0, 1.8), 1.08).rotateY(Math.PI / 4).translate(0, 5.3, 0);
    oakCardGeo = mergeGeometries([a, b, cTop]);
  }

  // marsh swamp tree: twisted lanky trunk with bare limbs, buttress roots,
  // sparse flattened lobes and hanging moss strands
  const swampTrunkGeo = mergeGeometries([
    gnarledTrunk(0.5, 0.12, 4.8, 0.55, 0.5, 15, 5),
    branchLimb(0.13, 0.05, 1.9, 1.15, 0.7, 0.6, 3.6, 0.25),
    branchLimb(0.12, 0.05, 1.6, -1.2, 2.4, 0.6, 4.1, 0.25),
    branchLimb(0.1, 0.04, 1.2, 1.35, 4.3, 0.55, 2.6, 0.2),
    ...rootFlare(5, 0.52, 1.05, 16),
  ]);
  const swampCanopyGeo = bakeVerticalShade(mergeGeometries([
    bakeShade(squash(noisyLobe(1.3, 0.34, 47), 0.5).translate(1.0, 4.9, 0.4), 1.0),
    bakeShade(squash(noisyLobe(1.05, 0.36, 48), 0.48).translate(-0.45, 5.2, -0.3), 0.92),
    bakeShade(squash(noisyLobe(0.9, 0.34, 49), 0.45).translate(0.4, 5.5, 0.7), 1.06),
    bakeShade(squash(noisyLobe(0.75, 0.36, 50), 0.5).translate(-0.7, 4.45, 1.3), 0.9),
  ]), 0.52, 1.04);
  const swampMossGeo = usePbr ? mergeGeometries([
    mossStrand(0.55, 1.6, 1.35, 4.55, 0.6, 0.3),
    mossStrand(0.5, 1.3, -0.55, 4.9, -0.5, 1.4),
    mossStrand(0.6, 1.8, 0.3, 5.1, 0.9, 2.3),
    mossStrand(0.45, 1.2, -0.75, 4.15, 1.2, 0.9),
    mossStrand(0.5, 1.5, 0.9, 4.5, -0.35, 1.9),
  ]) : null;

  // rocks: single boulder + split/stacked cluster archetypes, one colorway
  // with a mossy top (vale/marsh) and one with snow dust (peaks)
  const rockSet = (tint: THREE.Color): { single: THREE.BufferGeometry; cluster: THREE.BufferGeometry } => ({
    single: bakeTopTint(boulder(0.95, 0.3, 21), tint),
    cluster: mergeGeometries([
      bakeTopTint(boulder(0.7, 0.3, 22), tint).translate(-0.28, 0.02, 0.12),
      bakeTopTint(boulder(0.52, 0.34, 23), tint).rotateY(1.3).translate(0.6, -0.12, 0.34),
      bakeTopTint(boulder(0.4, 0.3, 24), tint).rotateY(2.4).translate(0.1, 0.58, -0.12),
    ]),
  });
  const mossRocks = rockSet(new THREE.Color(0.55, 0.78, 0.38));
  const snowRocks = rockSet(new THREE.Color(1.45, 1.52, 1.6));

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sv = new THREE.Vector3();
  const c = new THREE.Color();

  for (const items of buckets.values()) {
    const pines = items.filter((d) => d.kind === 'tree');
    const oaks = items.filter((d) => d.kind === 'tree2' && d.biome !== 'marsh');
    const swamps = items.filter((d) => d.kind === 'tree2' && d.biome === 'marsh');
    const rocks = items.filter((d) => d.kind === 'rock');

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const d of items) {
      minX = Math.min(minX, d.x);
      maxX = Math.max(maxX, d.x);
      minZ = Math.min(minZ, d.z);
      maxZ = Math.max(maxZ, d.z);
    }
    const bx = (minX + maxX) / 2, bz = (minZ + maxZ) / 2;
    const bRadius = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 18; // canopy margin
    const register = (mesh: THREE.InstancedMesh): void => {
      registry.push({ mesh, x: bx, z: bz, radius: bRadius });
    };

    if (pines.length > 0) {
      const trunk = new THREE.InstancedMesh(pineTrunkGeo, trunkMat, pines.length);
      const canopy = new THREE.InstancedMesh(pineCanopyGeo, leafMat, pines.length);
      const cards = cardGeo && cardMat ? new THREE.InstancedMesh(cardGeo, cardMat, pines.length) : null;
      pines.forEach((t, i) => {
        const y = terrainHeight(t.x, t.z, seed);
        const s = t.scale * 1.5;
        q.setFromAxisAngle(up, t.variant * 2.1 + hashAt(t.x, t.z, 11) * 2.0);
        m.compose(v.set(t.x, y - 0.25 * s, t.z), q, sv.set(s, s, s));
        trunk.setMatrixAt(i, m);
        canopy.setMatrixAt(i, m);
        cards?.setMatrixAt(i, m);
        tintFor(t, PINE_TINT[t.biome], c);
        canopy.setColorAt(i, c);
        cards?.setColorAt(i, c);
        trunk.setColorAt(i, tintFor(t, TRUNK_TINT[t.biome], c, 0.5));
      });
      canopy.castShadow = true; // trunks skip the shadow pass: the canopy owns it
      for (const im of [trunk, canopy]) {
        im.receiveShadow = true; // forests sit inside each other's shade
        parent.add(im);
        register(im);
      }
      if (cards) {
        cards.receiveShadow = true;
        parent.add(cards); // no shadow cast: the cones already cast one
        register(cards);
      }
    }

    if (oaks.length > 0) {
      const trunk = new THREE.InstancedMesh(oakTrunkGeo, trunkMat, oaks.length);
      const canopy = new THREE.InstancedMesh(oakCanopyGeo, leafMat, oaks.length);
      const cards = oakCardGeo && cardMat ? new THREE.InstancedMesh(oakCardGeo, cardMat, oaks.length) : null;
      oaks.forEach((t, i) => {
        const y = terrainHeight(t.x, t.z, seed);
        const s = t.scale * 1.3;
        q.setFromAxisAngle(up, t.variant * 2.1 + hashAt(t.x, t.z, 11) * 2.0);
        m.compose(v.set(t.x, y - 0.2 * s, t.z), q, sv.set(s, s, s));
        trunk.setMatrixAt(i, m);
        canopy.setMatrixAt(i, m);
        cards?.setMatrixAt(i, m);
        canopy.setColorAt(i, tintFor(t, OAK_TINT[t.biome], c));
        cards?.setColorAt(i, c);
        trunk.setColorAt(i, tintFor(t, TRUNK_TINT[t.biome], c, 0.5));
      });
      canopy.castShadow = true;
      for (const im of [trunk, canopy]) {
        im.receiveShadow = true;
        parent.add(im);
        register(im);
      }
      if (cards) {
        cards.receiveShadow = true;
        parent.add(cards); // no shadow cast: the lobes already cast one
        register(cards);
      }
    }

    if (swamps.length > 0) {
      const trunk = new THREE.InstancedMesh(swampTrunkGeo, trunkMat, swamps.length);
      const canopy = new THREE.InstancedMesh(swampCanopyGeo, leafMat, swamps.length);
      const moss = swampMossGeo && mossMat
        ? new THREE.InstancedMesh(swampMossGeo, mossMat, swamps.length)
        : null;
      swamps.forEach((t, i) => {
        const y = terrainHeight(t.x, t.z, seed);
        const s = t.scale * 1.35;
        q.setFromAxisAngle(up, t.variant * 2.1 + hashAt(t.x, t.z, 12) * 2.5);
        m.compose(v.set(t.x, y - 0.2 * s, t.z), q, sv.set(s, s, s));
        trunk.setMatrixAt(i, m);
        canopy.setMatrixAt(i, m);
        moss?.setMatrixAt(i, m);
        canopy.setColorAt(i, tintFor(t, SWAMP_CANOPY_TINT, c));
        moss?.setColorAt(i, tintFor(t, SWAMP_MOSS_TINT, c, 0.6));
        trunk.setColorAt(i, tintFor(t, TRUNK_TINT.marsh, c, 0.5));
      });
      canopy.castShadow = true;
      for (const im of [trunk, canopy]) {
        im.receiveShadow = true;
        parent.add(im);
        register(im);
      }
      if (moss) {
        moss.receiveShadow = true;
        parent.add(moss); // no shadow cast: thin strands, the lobes own it
        register(moss);
      }
    }

    if (rocks.length > 0) {
      const isCluster = (r: Decoration): boolean => hashAt(r.x, r.z, 7) > 0.72;
      const isSnowy = (r: Decoration): boolean =>
        r.biome === 'peaks' && terrainHeight(r.x, r.z, seed) > ROCK_SNOWLINE_Y;
      const rockGroups: Array<[Decoration[], THREE.BufferGeometry]> = [
        [rocks.filter((r) => !isSnowy(r) && !isCluster(r)), mossRocks.single],
        [rocks.filter((r) => !isSnowy(r) && isCluster(r)), mossRocks.cluster],
        [rocks.filter((r) => isSnowy(r) && !isCluster(r)), snowRocks.single],
        [rocks.filter((r) => isSnowy(r) && isCluster(r)), snowRocks.cluster],
      ];
      for (const [list, geo] of rockGroups) {
        if (list.length === 0) continue;
        const rockMesh = new THREE.InstancedMesh(geo, rockMat, list.length);
        list.forEach((r, i) => {
          const y = terrainHeight(r.x, r.z, seed);
          const h1 = hashAt(r.x, r.z, 8), h2 = hashAt(r.x, r.z, 9), h3 = hashAt(r.x, r.z, 10);
          // slight tilt + non-uniform scale: one geometry reads as round
          // boulders, low slabs and tall stones depending on the draw
          const sxz1 = r.scale * (0.85 + h2 * 0.5);
          const sxz2 = r.scale * (0.85 + h1 * 0.45);
          const maxH = Math.max(sxz1, sxz2);
          // floor the height at 0.55x the horizontal so slabs stay chunky,
          // and keep big slabs nearly level (tilted discs read as pancakes)
          const sy = Math.max(r.scale * 0.7 * (0.75 + h3 * 0.5), 0.55 * maxH);
          const tiltAmp = maxH > 1.3 ? 0.16 : 0.34;
          q.setFromEuler(e.set((h1 - 0.5) * tiltAmp, r.variant * 1.7 + h3 * 2.0, (h2 - 0.5) * tiltAmp));
          // sink deeper so displaced undersides bury on slopes
          m.compose(v.set(r.x, y + 0.1 * sy, r.z), q, sv.set(sxz1, sy, sxz2));
          rockMesh.setMatrixAt(i, m);
          // low-altitude peaks rocks drop the icy blue-gray for a warm field
          // stone — pale rocks on green foothill grass read as eggs
          const rockHex = r.biome === 'peaks' && !isSnowy(r) ? 0x6f6e62 : ROCK_TINT[r.biome];
          rockMesh.setColorAt(i, tintFor(r, rockHex, c));
        });
        // no rock shadows cast: sub-pixel at typical camera range, real draw cost
        rockMesh.receiveShadow = true;
        parent.add(rockMesh);
        register(rockMesh);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Grass ring
// ---------------------------------------------------------------------------

interface GrassRing {
  update(px: number, pz: number): void;
}

// wind sway + edge fade for the grass tufts; the fade keys off the tuft's
// instance origin so whole tufts dissolve cleanly against alphaTest
function applyGrassShader(
  mat: THREE.Material,
  uniforms: { uPlayerPos: { value: THREE.Vector2 }; uFadeFar: { value: number } },
): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.uniforms.uPlayerPos = uniforms.uPlayerPos;
    sh.uniforms.uFadeFar = uniforms.uFadeFar;
    const wind = GFX.windSway
      ? `
        float windPhase = tuftBase.x * 0.31 + tuftBase.y * 0.27;
        float windAmt = (sin(uTime * 1.7 + windPhase) + 0.5 * sin(uTime * 3.1 + windPhase * 1.3))
          * ${GRASS_WIND_STRENGTH.toFixed(3)} * smoothstep(0.0, 0.7, transformed.y);
        transformed.x += windAmt;
        transformed.z += windAmt * 0.6;`
      : '';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        varying vec2 vTuftWorld;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 tuftBase = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 tuftBase = vec2(0.0);
        #endif
        ${wind}
        vTuftWorld = tuftBase;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vTuftWorld;
        uniform vec2 uPlayerPos;
        uniform float uFadeFar;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.a *= 1.0 - smoothstep(uFadeFar * 0.7, uFadeFar, distance(vTuftWorld, uPlayerPos));`);
  };
}

function buildGrassRing(parent: THREE.Group, seed: number): GrassRing {
  const radius = GFX.grassRadius;
  const step = GFX.grassStep;
  const cells = Math.ceil((radius * 2) / step) + 2;
  const maxCount = Math.ceil(cells * cells * 0.5);

  // high tier reads as a lush meadow: wider tufts with more blades; low keeps
  // the legacy sprite size
  const lush = GFX.standardMaterials;
  const quad = new THREE.PlaneGeometry(lush ? 1.45 : 1.1, lush ? 0.9 : 0.7);
  quad.translate(0, lush ? 0.42 : 0.35, 0);
  const quad2 = quad.clone().rotateY(Math.PI / 2);
  const geo = mergeGeometries([quad, quad2]);

  const tuftTex = grassTuftTexture(lush ? 30 : 18);
  const uniforms = { uPlayerPos: { value: new THREE.Vector2(1e6, 1e6) }, uFadeFar: { value: radius } };
  const mat = lush
    ? new THREE.MeshStandardMaterial({
      map: tuftTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9,
    })
    : new THREE.MeshLambertMaterial({
      map: tuftTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide,
    });
  applyGrassShader(mat, uniforms);

  const im = new THREE.InstancedMesh(geo, mat, maxCount);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.frustumCulled = false; // ring is centered on the player; bounds churn isn't worth it
  im.receiveShadow = true; // tufts must darken inside canopy shade, not glow through it
  im.count = 0;
  parent.add(im);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sv = new THREE.Vector3();
  const c = new THREE.Color();
  let lastX = Infinity;
  let lastZ = Infinity;

  const rebuild = (px: number, pz: number): void => {
    let n = 0;
    const i0 = Math.floor((px - radius) / step), i1 = Math.ceil((px + radius) / step);
    const j0 = Math.floor((pz - radius) / step), j1 = Math.ceil((pz + radius) / step);
    const r2 = radius * radius;
    for (let i = i0; i <= i1 && n < maxCount; i++) {
      for (let j = j0; j <= j1 && n < maxCount; j++) {
        const r = hashAt(i, j, 0);
        if (r > 0.5) continue; // ~half the cells grow a tuft
        const x = i * step + (hashAt(i, j, 1) - 0.5) * step * 1.4;
        const z = j * step + (hashAt(i, j, 2) - 0.5) * step * 1.4;
        const dx = x - px, dz = z - pz;
        if (dx * dx + dz * dz > r2) continue;
        if (Math.abs(x) > WORLD_MAX_X - 16 || z < WORLD_MIN_Z + 16 || z > WORLD_MAX_Z - 16) continue;
        const h = terrainHeight(x, z, seed);
        if (h < WATER_LEVEL + 1.6) continue;
        // no blades pasted onto cliff faces
        const hx = terrainHeight(x + GRASS_SLOPE_EPS, z, seed) - terrainHeight(x - GRASS_SLOPE_EPS, z, seed);
        const hz = terrainHeight(x, z + GRASS_SLOPE_EPS, seed) - terrainHeight(x, z - GRASS_SLOPE_EPS, seed);
        if (Math.hypot(hx, hz) / (2 * GRASS_SLOPE_EPS) > GRASS_MAX_SLOPE) continue;
        let nearHub = false;
        for (const zn of ZONES) {
          if (Math.hypot(x - zn.hub.x, z - zn.hub.z) < 15) { nearHub = true; break; }
        }
        if (nearHub) continue;
        if (roadDistance(x, z) < 3.2) continue;
        const s = (lush ? 0.55 : 0.45) + r * (lush ? 1.1 : 1);
        q.setFromAxisAngle(up, r * 12.4);
        m.compose(v.set(x, h, z), q, sv.set(s, s, s));
        im.setMatrixAt(n, m);
        c.setHex(GRASS_TINT[zoneBiomeAt(z)]);
        c.offsetHSL(
          (hashAt(i, j, 3) - 0.5) * 0.05,
          (hashAt(i, j, 4) - 0.5) * 0.12,
          (hashAt(i, j, 5) - 0.5) * 0.1,
        );
        im.setColorAt(n, c);
        n++;
      }
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  };

  return {
    update(px: number, pz: number): void {
      uniforms.uPlayerPos.value.set(px, pz);
      if (px > DUNGEON_X_THRESHOLD) {
        // dungeon instances live far outside the strip — no meadow indoors
        if (im.count !== 0) im.count = 0;
        lastX = Infinity;
        return;
      }
      if (Math.hypot(px - lastX, pz - lastZ) > GRASS_REBUILD_DIST) {
        lastX = px;
        lastZ = pz;
        rebuild(px, pz);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildFoliage(seed: number): FoliageView {
  const group = new THREE.Group();
  group.name = 'foliage';
  const bucketMeshes: BucketMesh[] = [];
  buildTrees(group, seed, bucketMeshes);
  const grass = buildGrassRing(group, seed);
  return {
    group,
    update(px: number, pz: number, camX: number, camZ: number, fogFar: number): void {
      grass.update(px, pz);
      // buckets fully behind the fog wall are pure overdraw
      for (const b of bucketMeshes) {
        b.mesh.visible = Math.hypot(b.x - camX, b.z - camZ) - b.radius < fogFar;
      }
    },
  };
}
