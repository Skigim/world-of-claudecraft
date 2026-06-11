import * as THREE from 'three';
import { Entity, SimEvent } from '../sim/types';
import type { IWorld } from '../world_api';
import { groundHeight, WATER_LEVEL, zoneBiomeAt } from '../sim/world';
import {
  MOBS, ABILITIES, DUNGEON_X_THRESHOLD, DUNGEON_LIST,
  instanceOrigin, INSTANCE_SLOT_COUNT,
} from '../sim/data';
import type { BiomeId } from '../sim/types';
import { buildBear, buildFarRig, buildRigFor, buildSheep, Rig } from './models';
import { buildProps } from './props';
import { plankTexture, radialGlowTexture, sparkleTexture, stoneMaps, SurfaceMaps } from './textures';
import { Vfx } from './vfx';
import {
  GFX, initGfxTier, sharedUniforms, SUN_ANCHOR, SUN_DIR, surfaceMat,
} from './gfx';
import { buildComposer, PostPipeline } from './post';
import { buildTerrain, TerrainView } from './terrain';
import { buildWater, WaterView } from './water';
import { buildClouds, buildSky, SkyView } from './sky';
import { buildFoliage, FoliageView } from './foliage';

const NAMEPLATE_RANGE = 55;
// Entities further than this from the player are hidden entirely: their rigs
// are several draw calls each and read as sub-pixel specks long before this.
const ENTITY_DRAW_RANGE = 80;
// rigs further than this stop casting articulated shadows (~7 draws each) and
// hand off to a single-draw static-pose shadow proxy (the merged far-LOD mesh
// with a colorWrite-off material) so mid-ground NPCs keep their grounding for
// ~1/7 the cost — the pose freeze is invisible in a shadow blob this far out
const ENTITY_SHADOW_RANGE_SQ = 25 * 25;
const ENTITY_PROXY_SHADOW_RANGE_SQ = 62 * 62;
// loot sparkles further than this are hidden (sub-pixel, real draw cost)
const SPARKLE_DRAW_RANGE_SQ = 40 * 40;
// beyond this, the articulated rig swaps for its single-draw merged far LOD
// (just inside the nameplate range; rigs out there are ~30px tall)
const ENTITY_LOD_RANGE_SQ = 50 * 50;
// fire/torch point lights beyond this never shine (their falloff range is
// shorter anyway); the nearest GFX.maxPointLights within it win the budget
const LIGHT_BUDGET_RANGE_SQ = 55 * 55;
// HDR boosts so the bloom pass picks these out (composer tiers only)
const SELECTION_RING_BOOST = 1.5;
const SPARKLE_BOOST = 1.5;
const PORTAL_BOOST = 2;
const FLAME_EMISSIVE_HIGH = 2.2;
const SUN_HALO_OPACITY = 0.35; // bloom now supplies most of the halo
// lighting rig (high/ultra) — IBL supplies ambient, sun carries the key
const HEMI_INTENSITY = 0.45;
const SUN_INTENSITY = 2.8;
const ENV_INTENSITY = 0.5;
// dungeon interiors: kill the daylight so torchlight carries the scene
// (env at 0.15 still lit rigs sky-blue against the pitch-dark crypt)
const DUNGEON_SUN_INTENSITY = 0.3;
const DUNGEON_ENV_INTENSITY = 0.05;
const DUNGEON_HEMI_INTENSITY = 0.14;
// character rim glow scales up underground so silhouettes split from the murk
const DUNGEON_RIM_BOOST = 2.4;
// dungeon torch point lights: pumped + hung lower so warm pools break up the
// floor (8.2u up at decay 2 left the ground a flat navy mass)
const DUNGEON_LIGHT_Y = 6.4;
const DUNGEON_LIGHT_INTENSITY = 46;
const DUNGEON_LIGHT_DISTANCE = 34;

interface EntityView {
  group: THREE.Group;
  rig: Rig;
  sheepRig: Rig | null; // polymorph form, built lazily
  bearRig: Rig | null; // druid bear form, built lazily
  walkPhase: number;
  attackAnim: number;
  nameplate: HTMLDivElement;
  nameEl: HTMLDivElement;
  hpBar: HTMLDivElement;
  hpFill: HTMLDivElement;
  markerEl: HTMLDivElement;
  sparkle?: THREE.Sprite; // ground objects
  objectMesh?: THREE.Object3D;
  portal?: THREE.Mesh; // dungeon door swirl
  casters: THREE.Object3D[]; // shadow-casting meshes, distance-gated in sync
  shadowOn: boolean;
  // sheep/bear form casters keep their (1-2 draw) articulated shadows through
  // the whole proxy band — the frozen humanoid proxy silhouette would be wrong
  formCasters: THREE.Object3D[];
  formShadowOn: boolean;
  farMesh: THREE.Mesh | null; // single-draw merged LOD shown beyond 55u
  shadowProxy: THREE.Mesh | null; // shadow-only static-pose caster, 25-62u
  isFar: boolean;
}

function collectCasters(root: THREE.Object3D, into: THREE.Object3D[]): void {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).castShadow) into.push(o);
  });
}

// Shadow-only material for the static-pose proxy casters: it writes neither
// color nor depth, so the main pass rasterizes nothing visible, while the
// shadow pass (which swaps in its own depth material and only checks
// castShadow + the main camera's layer mask in three r165) still renders the
// mesh into the shadow map. One shared instance for every proxy.
let shadowOnlyMatSingleton: THREE.Material | null = null;
function shadowOnlyMat(): THREE.Material {
  if (!shadowOnlyMatSingleton) {
    shadowOnlyMatSingleton = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  }
  return shadowOnlyMatSingleton;
}

export class Renderer {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  webgl: THREE.WebGLRenderer;
  views = new Map<number, EntityView>();
  nameplateLayer: HTMLDivElement;
  selectionRing: THREE.Mesh;
  raycaster = new THREE.Raycaster();
  clickTargets: THREE.Object3D[] = [];
  camYaw = Math.PI;
  camPitch = 0.32;
  camDist = 12;
  showNameplates = true;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private sun: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private sky!: THREE.Mesh;
  private skyView!: SkyView;
  private sunSprites: THREE.Sprite[] = [];
  private sunDir = new THREE.Vector3();
  private sunAzimuth = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize();
  private clouds: THREE.Sprite[] = [];
  private waterView: WaterView;
  private terrainView: TerrainView;
  private foliage: FoliageView;
  private fogScratch = new THREE.Color();
  private flames: THREE.Mesh[];
  private fireLights: THREE.PointLight[];
  private propsView!: { update(camX: number, camZ: number, fogFar: number): void };
  private lightRank: { light: THREE.PointLight; d2: number; worldPos: THREE.Vector3 }[] = [];
  private doomedIds: number[] = [];
  private stoneMapsCache: SurfaceMaps | null = null;
  private time = 0;
  vfx: Vfx;

  private lowGfx: boolean;
  private post: PostPipeline | null = null;
  private godRays: THREE.Sprite[] = [];

  constructor(private sim: IWorld, canvas: HTMLCanvasElement, nameplateLayer: HTMLDivElement) {
    this.nameplateLayer = nameplateLayer;
    // No default-framebuffer MSAA on any tier: high/ultra get AA from the
    // composer's MSAA HalfFloat target, low is meant to run without AA — and
    // requesting it here would hit software GL (the autodetect can only run
    // after the context exists) with the most expensive setting there is.
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    initGfxTier(this.webgl); // software-GL autodetect needs the live context
    this.lowGfx = GFX.tier === 'low';
    const LOW_GFX = this.lowGfx;
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, GFX.pixelRatioCap));
    this.webgl.setSize(window.innerWidth, window.innerHeight);
    this.webgl.shadowMap.enabled = !LOW_GFX;
    this.webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping; // OutputPass reads this on the composer path
    this.webgl.toneMappingExposure = 1.12;
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 950);

    this.scene.fog = new THREE.Fog(0xa6c6e0, 130, 470);

    // sky dome — follows the camera so the world strip never outruns it.
    // High tier: shader gradient + sun glow with biome-aware horizon tints;
    // low keeps the legacy canvas-gradient dome.
    this.skyView = buildSky(LOW_GFX, SUN_ANCHOR);
    this.sky = this.skyView.dome;
    this.scene.add(this.sky);

    // IBL: prefilter the sky dome itself so PBR materials get sky-matched
    // ambient specular/diffuse (low keeps the flat Lambert look instead)
    if (!LOW_GFX) {
      const pmrem = new THREE.PMREMGenerator(this.webgl);
      const envScene = new THREE.Scene();
      envScene.add(this.sky.clone());
      const envRT = pmrem.fromScene(envScene, 0.04, 0.1, 1100); // far must cover the 560u dome
      this.scene.environment = envRT.texture;
      this.scene.environmentIntensity = ENV_INTENSITY;
      pmrem.dispose();
    }

    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x46603a, LOW_GFX ? 1.0 : HEMI_INTENSITY);
    this.scene.add(hemi);
    this.hemi = hemi;
    const sun = new THREE.DirectionalLight(LOW_GFX ? 0xfff0cd : 0xffedd0, LOW_GFX ? 2.2 : SUN_INTENSITY);
    sun.position.copy(SUN_ANCHOR);
    sun.castShadow = !LOW_GFX;
    sun.shadow.mapSize.set(GFX.shadowMap, GFX.shadowMap);
    sun.shadow.camera.near = 30;
    sun.shadow.camera.far = 480;
    // 95u half-extent: the whole mid-ground shadows (a 50u box left every
    // tree/house past it on uniformly lit grass); ~4.6cm texels at 4096
    const S = LOW_GFX ? 75 : 95;
    sun.shadow.camera.left = -S;
    sun.shadow.camera.right = S;
    sun.shadow.camera.top = S;
    sun.shadow.camera.bottom = -S;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = LOW_GFX ? 0.02 : 0.05;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.sunDir.copy(SUN_DIR);

    // visible sun disc + bloom halo
    const sunCanvas = (core: boolean): THREE.CanvasTexture => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
      if (core) {
        g.addColorStop(0, 'rgba(255,252,238,1)');
        g.addColorStop(0.35, 'rgba(255,238,180,0.95)');
        g.addColorStop(1, 'rgba(255,220,140,0)');
      } else {
        g.addColorStop(0, 'rgba(255,236,180,0.55)');
        g.addColorStop(1, 'rgba(255,220,150,0)');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    };
    for (const [tex, scale] of [[sunCanvas(true), 60], [sunCanvas(false), 190]] as const) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, fog: false, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending,
        // bloom supplies the big halo on the composer path; the painted one
        // would double up and wash out the sky
        opacity: scale === 190 && !LOW_GFX ? SUN_HALO_OPACITY : 1,
      }));
      sp.scale.set(scale, scale, 1);
      sp.renderOrder = -9;
      this.sunSprites.push(sp);
      this.scene.add(sp);
    }

    // god-ray shafts: elongated additive gradient sprites hanging sunward of
    // the camera; opacity follows how directly the camera faces the sun
    if (!LOW_GFX) {
      const shaft = document.createElement('canvas');
      shaft.width = 64;
      shaft.height = 256;
      const sctx = shaft.getContext('2d')!;
      const gh = sctx.createLinearGradient(0, 0, 0, 256);
      gh.addColorStop(0, 'rgba(255,240,200,0)');
      gh.addColorStop(0.45, 'rgba(255,240,200,0.55)');
      gh.addColorStop(0.6, 'rgba(255,240,200,0.5)');
      gh.addColorStop(1, 'rgba(255,240,200,0)');
      sctx.fillStyle = gh;
      sctx.fillRect(0, 0, 64, 256);
      const gw = sctx.createLinearGradient(0, 0, 64, 0);
      gw.addColorStop(0, 'rgba(0,0,0,1)');
      gw.addColorStop(0.5, 'rgba(0,0,0,0)');
      gw.addColorStop(1, 'rgba(0,0,0,1)');
      sctx.globalCompositeOperation = 'destination-out';
      sctx.fillStyle = gw;
      sctx.fillRect(0, 0, 64, 256);
      const shaftTex = new THREE.CanvasTexture(shaft);
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: shaftTex, transparent: true, opacity: 0, fog: false,
          depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
          rotation: 0.42 + i * 0.13,
        }));
        sp.scale.set(26 + i * 16, 150 + i * 35, 1);
        sp.renderOrder = -8;
        this.godRays.push(sp);
        this.scene.add(sp);
      }
    }

    // clouds, spread over the whole zone strip (3 sprite variants + a faint
    // high cirrus layer on the full pipeline)
    for (const cl of buildClouds(LOW_GFX).sprites) {
      this.clouds.push(cl);
      this.scene.add(cl);
    }

    this.terrainView = buildTerrain(this.sim.cfg.seed);
    this.scene.add(this.terrainView.group);
    this.waterView = buildWater(this.sim.cfg.seed);
    for (const mesh of this.waterView.meshes) this.scene.add(mesh);

    this.foliage = buildFoliage(this.sim.cfg.seed);
    this.scene.add(this.foliage.group);
    const props = buildProps(this.sim.cfg.seed);
    this.scene.add(props.group);
    this.flames = props.flames;
    this.fireLights = props.fireLights;
    this.propsView = props;

    // selection ring
    const ringGeo = new THREE.RingGeometry(0.9, 1.15, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.selectionRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xd4af37, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    // particle system: projectiles, impacts, heal glows, ambience
    this.vfx = new Vfx(this.scene, (id, frac) => {
      const v = this.views.get(id);
      if (!v) return null;
      const e = this.sim.entities.get(id);
      const h = v.rig.height * (e?.scale ?? 1) * frac;
      return new THREE.Vector3(v.group.position.x, v.group.position.y + h, v.group.position.z);
    });
    this.vfx.setViewportScale(this.webgl.domElement.clientHeight * this.webgl.getPixelRatio(), 60);

    for (const e of sim.entities.values()) this.createView(e);

    // post chain (bloom + grade, GTAO on ultra); low renders direct
    if (GFX.composer) this.post = buildComposer(this.webgl, this.scene, this.camera);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      // dragging between monitors changes devicePixelRatio: refresh it before
      // resizing so the canvas/composer/vfx don't keep the old DPI
      const ratio = Math.min(window.devicePixelRatio, GFX.pixelRatioCap);
      this.webgl.setPixelRatio(ratio);
      this.webgl.setSize(window.innerWidth, window.innerHeight);
      if (this.post) {
        this.post.composer.setPixelRatio(ratio);
        this.post.setSize(window.innerWidth, window.innerHeight);
      }
      this.vfx.setViewportScale(this.webgl.domElement.clientHeight * this.webgl.getPixelRatio(), 60);
    });
  }

  // Visual reactions to sim events (called by the HUD for every event,
  // including those between other players and mobs).
  handleEvent(ev: SimEvent): void {
    switch (ev.type) {
      case 'spellfx':
        if (ev.fx === 'projectile') this.vfx.projectile(ev.sourceId, ev.targetId, ev.school);
        else if (ev.fx === 'tick') this.vfx.tick(ev.targetId, ev.school);
        else this.vfx.nova(ev.targetId, ev.school);
        break;
      case 'damage':
        // every melee/ranged swing animates the attacker for all to see
        if (ev.school === 'physical' && ev.sourceId !== -1) this.triggerAttack(ev.sourceId);
        if (ev.kind === 'hit' && ev.amount > 0 && ev.school === 'physical') {
          this.vfx.meleeSpark(ev.targetId, ev.crit);
        }
        break;
      case 'heal2':
        if (ev.amount > 0 || ev.crit) this.vfx.healGlow(ev.targetId);
        break;
      case 'aura': {
        const tgt = this.sim.entities.get(ev.targetId);
        if (ev.gained && tgt?.kind === 'player') this.vfx.buffSwirl(ev.targetId);
        break;
      }
      case 'levelup':
        this.vfx.levelUpPillar(this.sim.playerId);
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Entity views
  // -------------------------------------------------------------------------

  // Shared object-view resources: views must not own materials/textures, or
  // interest churn leaks them (removeView only disposes per-view geometry).
  private doorStoneMat: THREE.Material | null = null;
  private crateMat: THREE.Material | null = null;
  private crateLidMat: THREE.Material | null = null;
  private sparkleMat: THREE.SpriteMaterial | null = null;

  private createView(e: Entity): void {
    const group = new THREE.Group();
    let rig: Rig;
    let sparkle: THREE.Sprite | undefined;
    let objectMesh: THREE.Object3D | undefined;

    let portal: THREE.Mesh | undefined;
    if (e.kind === 'object' && (e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit')) {
      // dungeon doorway: stone arch with a swirling portal
      const entering = e.templateId === 'dungeon_door';
      const tint = entering ? 0x9a5df0 : 0x6ab8ff;
      rig = { body: new THREE.Group(), parts: {}, kind: 'humanoid', height: 4.6 };
      this.doorStoneMat ??= new THREE.MeshLambertMaterial({ color: 0x6a6a72 });
      const stone = this.doorStoneMat;
      // carved stone arch: pointed outer/inner outline + keystone + plinths
      // (no raw pillar-and-lintel boxes)
      const outer = new THREE.Shape();
      outer.moveTo(-2.1, 0);
      outer.lineTo(-2.1, 3.1);
      outer.quadraticCurveTo(-2.1, 4.85, 0, 5.05);
      outer.quadraticCurveTo(2.1, 4.85, 2.1, 3.1);
      outer.lineTo(2.1, 0);
      outer.closePath();
      const inner = new THREE.Path();
      inner.moveTo(-1.3, -0.5);
      inner.lineTo(-1.3, 2.9);
      inner.quadraticCurveTo(-1.3, 4.05, 0, 4.22);
      inner.quadraticCurveTo(1.3, 4.05, 1.3, 2.9);
      inner.lineTo(1.3, -0.5);
      inner.closePath();
      outer.holes.push(inner);
      const archGeo = new THREE.ExtrudeGeometry(outer, {
        depth: 0.7, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 1,
      });
      archGeo.translate(0, 0, -0.35);
      const arch = new THREE.Mesh(archGeo, stone);
      arch.castShadow = true;
      rig.body.add(arch);
      const keystone = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.95), stone);
      keystone.position.set(0, 4.75, 0);
      keystone.castShadow = true;
      rig.body.add(keystone);
      for (const sx of [-1.7, 1.7]) {
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.7, 1.15), stone);
        plinth.position.set(sx, 0.35, 0);
        plinth.castShadow = true;
        rig.body.add(plinth);
      }
      const portalMat = new THREE.MeshBasicMaterial({
        color: tint, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      if (!this.lowGfx) portalMat.color.multiplyScalar(PORTAL_BOOST); // HDR swirl -> bloom
      portal = new THREE.Mesh(new THREE.CircleGeometry(1.55, 24), portalMat);
      portal.position.y = 2.15;
      portal.scale.set(1, 1.35, 1);
      rig.body.add(portal);
      const glow = new THREE.PointLight(tint, 9, 15, 2);
      glow.position.y = 2.4;
      rig.body.add(glow);
      objectMesh = rig.body;
    } else if (e.kind === 'object') {
      rig = { body: new THREE.Group(), parts: {}, kind: 'humanoid', height: 1.2 };
      // braced plank crate matching the props.ts crates — never a bare cube
      this.crateMat ??= new THREE.MeshLambertMaterial({ map: plankTexture() });
      this.crateLidMat ??= new THREE.MeshLambertMaterial({ color: 0x4a3320 });
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.78, 0.78), this.crateMat);
      crate.position.y = 0.42;
      crate.castShadow = true;
      rig.body.add(crate);
      for (const sx of [1, -1]) {
        for (const sz of [1, -1]) {
          const brace = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.86, 0.1), this.crateLidMat);
          brace.position.set(sx * 0.37, 0.42, sz * 0.37);
          rig.body.add(brace);
        }
      }
      for (const sy of [0.06, 0.78]) {
        for (const s of [1, -1]) {
          const stripA = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.08, 0.08), this.crateLidMat);
          stripA.position.set(0, sy, s * 0.38);
          const stripB = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.82), this.crateLidMat);
          stripB.position.set(s * 0.38, sy, 0);
          rig.body.add(stripA, stripB);
        }
      }
      rig.body.rotation.y = (e.id % 7) * 0.45; // break identical alignment
      objectMesh = rig.body;
      if (!this.sparkleMat) {
        this.sparkleMat = new THREE.SpriteMaterial({ map: sparkleTexture(), transparent: true, depthWrite: false });
        if (!this.lowGfx) this.sparkleMat.color.setScalar(SPARKLE_BOOST); // gold glint via bloom
      }
      sparkle = new THREE.Sprite(this.sparkleMat);
      sparkle.scale.set(0.9, 0.9, 1);
      sparkle.position.y = 1.35;
      group.add(sparkle);
    } else {
      rig = buildRigFor(e);
    }
    rig.body.scale.multiplyScalar(e.scale);
    group.add(rig.body);

    group.position.set(e.pos.x, e.pos.y, e.pos.z);
    group.userData.entityId = e.id;
    rig.body.traverse((o) => { o.userData.entityId = e.id; });
    this.scene.add(group);
    this.clickTargets.push(rig.body);

    // nameplate
    const np = document.createElement('div');
    np.className = 'nameplate';
    const marker = document.createElement('div');
    marker.className = 'np-marker';
    const nameEl = document.createElement('div');
    nameEl.className = 'np-name';
    nameEl.textContent = e.name;
    const hpBar = document.createElement('div');
    hpBar.className = 'np-hpbar';
    const hpFill = document.createElement('div');
    hpFill.className = 'np-hpfill';
    hpBar.appendChild(hpFill);
    np.append(marker, nameEl, hpBar);
    this.nameplateLayer.appendChild(np);

    const casters: THREE.Object3D[] = [];
    collectCasters(group, casters);
    // far LOD must be captured from the pristine pose, before any animation
    let farMesh: THREE.Mesh | null = null;
    let shadowProxy: THREE.Mesh | null = null;
    if (e.kind !== 'object') {
      farMesh = buildFarRig(rig);
      if (farMesh) {
        farMesh.scale.copy(rig.body.scale);
        farMesh.visible = false;
        farMesh.userData.entityId = e.id;
        group.add(farMesh);
        if (!this.lowGfx) {
          // shares the far-LOD geometry; the shadow-only material writes no
          // color/depth so the main camera draws nothing visible while the
          // shadow pass still renders it into the shadow map
          shadowProxy = new THREE.Mesh(farMesh.geometry, shadowOnlyMat());
          shadowProxy.scale.copy(rig.body.scale);
          shadowProxy.castShadow = true;
          shadowProxy.visible = false;
          group.add(shadowProxy);
        }
      }
    }
    this.views.set(e.id, {
      group, rig, sheepRig: null, bearRig: null, walkPhase: 0, attackAnim: 0,
      nameplate: np, nameEl, hpBar, hpFill, markerEl: marker, sparkle, objectMesh, portal,
      casters, shadowOn: true, formCasters: [], formShadowOn: true, farMesh, shadowProxy, isFar: false,
    });
  }

  triggerAttack(entityId: number): void {
    const v = this.views.get(entityId);
    if (v) v.attackAnim = 0.35;
  }

  // -------------------------------------------------------------------------
  // Per-frame sync
  // -------------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // The Hollow Crypt interior, built lazily per instance origin.
  // ---------------------------------------------------------------------

  private builtInteriors = new Set<string>();
  private fogState: 'outdoor' | 'dungeon' | 'underwater' = 'outdoor';

  private buildInterior(interior: string, ox: number, oz: number): void {
    // one builder per DungeonDef.interior key
    if (interior === 'sanctum') this.buildSanctum(ox, oz);
    else this.buildCrypt(ox, oz);
  }

  // Additive light-pool decal under a dungeon torch: the point-light budget
  // only keeps the nearest few lights live, so the floor pools are baked in.
  private glowDecalGeo: THREE.BufferGeometry | null = null;
  private glowDecalTex: THREE.Texture | null = null;
  private glowDecalMats = new Map<number, THREE.MeshBasicMaterial>();

  private addTorchGlow(g: THREE.Group, x: number, z: number, colorHex: number): void {
    if (this.lowGfx) return;
    if (!this.glowDecalGeo) this.glowDecalGeo = new THREE.CircleGeometry(6.6, 20).rotateX(-Math.PI / 2);
    if (!this.glowDecalTex) this.glowDecalTex = radialGlowTexture();
    let mat = this.glowDecalMats.get(colorHex);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        map: this.glowDecalTex, color: colorHex, transparent: true, opacity: 0.46,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this.glowDecalMats.set(colorHex, mat);
    }
    const glow = new THREE.Mesh(this.glowDecalGeo, mat);
    glow.position.set(x, 0.07, z);
    glow.renderOrder = 1; // after the floor it floats over
    g.add(glow);
  }

  // Dungeon torch: animated flame cone + budgeted point light + floor pool.
  private addDungeonTorch(g: THREE.Group, x: number, z: number, flameColor: number, flameEmissive: number, lightColor: number): void {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 6), new THREE.MeshLambertMaterial({
      color: flameColor, emissive: flameEmissive, emissiveIntensity: this.lowGfx ? 1.6 : FLAME_EMISSIVE_HIGH,
      transparent: true, opacity: 0.92,
    }));
    flame.position.set(x, 8.4, z);
    g.add(flame);
    this.flames.push(flame);
    const light = new THREE.PointLight(lightColor, 10, this.lowGfx ? 22 : DUNGEON_LIGHT_DISTANCE, 2);
    // with daylight no longer leaking underground the torches carry the
    // scene — pump them and hang them low enough to pool on the floor
    if (!this.lowGfx) light.userData.baseIntensity = DUNGEON_LIGHT_INTENSITY;
    light.position.set(x, this.lowGfx ? 8.2 : DUNGEON_LIGHT_Y, z);
    g.add(light);
    this.fireLights.push(light);
    this.addTorchGlow(g, x, z, lightColor);
  }

  // Interior masonry: normal-mapped stone blocks under the torch pools on the
  // lit tiers (tint over the mid-gray stone maps lands on the legacy hues);
  // low keeps the flat Lambert look.
  private interiorStone(tintLight: number, tintDark: number, legacyLight: number, legacyDark: number): {
    stone: THREE.Material; stoneDark: THREE.Material; bone: THREE.Material;
  } {
    if (this.lowGfx) {
      return {
        stone: new THREE.MeshLambertMaterial({ color: legacyLight }),
        stoneDark: new THREE.MeshLambertMaterial({ color: legacyDark }),
        bone: new THREE.MeshLambertMaterial({ color: 0xd8d4c0, flatShading: true }),
      };
    }
    if (!this.stoneMapsCache) this.stoneMapsCache = stoneMaps();
    const maps = this.stoneMapsCache;
    return {
      stone: surfaceMat({ map: maps.map, normalMap: maps.normalMap, color: tintLight, roughness: 0.95 }),
      stoneDark: surfaceMat({ map: maps.map, normalMap: maps.normalMap, color: tintDark, roughness: 0.95 }),
      bone: surfaceMat({ color: 0xd8d4c0, flatShading: true, roughness: 0.9 }),
    };
  }

  // hewn dungeon pillar: plinth + entasis (bulged) shaft + capital — replaces
  // the plain cylinder so interiors stop reading as box rooms with tubes
  private dungeonPillar(g: THREE.Group, stone: THREE.Material, x: number, z: number): void {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 2.1), stone);
    plinth.position.set(x, 0.35, z);
    plinth.castShadow = true;
    g.add(plinth);
    const shaftGeo = scaleUv(new THREE.CylinderGeometry(0.74, 0.98, 7.3, 8, 4), 1.5, 2);
    const pos = shaftGeo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + 3.65) / 7.3;
      const k = 1 + Math.sin(t * Math.PI) * 0.14;
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    shaftGeo.computeVertexNormals();
    const shaft = new THREE.Mesh(shaftGeo, stone);
    shaft.position.set(x, 4.05, z);
    shaft.castShadow = true;
    g.add(shaft);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.55, 1.95), stone);
    cap.position.set(x, 7.95, z);
    cap.castShadow = true;
    g.add(cap);
  }

  // pilaster relief + cornice course along the long side walls (inner face at
  // |x| = wallX) so they stop reading as flat extruded slabs
  private dressDungeonWalls(g: THREE.Group, stoneDark: THREE.Material, zFrom: number, zTo: number, wallX = 22): void {
    for (let z = zFrom; z <= zTo; z += 12.5) {
      for (const sx of [-1, 1]) {
        const pil = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8.2, 1.6), stoneDark);
        pil.position.set(sx * (wallX + 0.1), 4.1, z);
        g.add(pil);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 2.0), stoneDark);
        cap.position.set(sx * (wallX + 0.1), 8.45, z);
        g.add(cap);
      }
    }
    for (const sx of [-1, 1]) {
      const cornice = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, zTo - zFrom + 16), stoneDark);
      cornice.position.set(sx * (wallX + 0.15), 8.75, (zFrom + zTo) / 2);
      g.add(cornice);
    }
  }

  // corner rubble: a low cluster of displaced rocks (deterministic by seed)
  private rubblePile(g: THREE.Group, mat: THREE.Material, x: number, z: number, r: number, seed: number): void {
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.IcosahedronGeometry(r * (0.55 + ((seed * 37 + i * 61) % 17) / 34), 1);
      const pos = geo.getAttribute('position');
      for (let v = 0; v < pos.count; v++) {
        const h = Math.sin(pos.getX(v) * 41.3 + pos.getY(v) * 53.7 + pos.getZ(v) * 29.1 + seed) * 0.5 + 0.5;
        const k = 0.8 + h * 0.45;
        pos.setXYZ(v, pos.getX(v) * k, pos.getY(v) * k * 0.62, pos.getZ(v) * k);
      }
      geo.computeVertexNormals();
      const rock = new THREE.Mesh(geo, mat);
      rock.position.set(x + Math.sin(seed * 3.1 + i * 2.4) * r * 0.9, 0.18, z + Math.cos(seed * 5.7 + i * 1.9) * r * 0.9);
      rock.rotation.y = seed + i * 1.7;
      g.add(rock);
    }
  }

  private buildCrypt(ox: number, oz: number): void {
    const g = new THREE.Group();
    const { stone, stoneDark, bone } = this.interiorStone(0xc6c6d4, 0x8c8c9c, 0x6a6a72, 0x4a4a52);

    const floor = new THREE.Mesh(scaleUv(new THREE.BoxGeometry(46, 0.5, 132), 10, 28), stoneDark);
    floor.position.set(0, -0.25, 47);
    floor.receiveShadow = true;
    g.add(floor);
    // walls
    for (const sx of [-23, 23]) {
      const wall = new THREE.Mesh(scaleUv(new THREE.BoxGeometry(2, 9, 132), 28, 2), stone);
      wall.position.set(sx, 4.5, 47);
      g.add(wall);
    }
    const backWall = new THREE.Mesh(scaleUv(new THREE.BoxGeometry(48, 9, 2), 10, 2), stone);
    backWall.position.set(0, 4.5, 112);
    g.add(backWall);
    const frontWall = new THREE.Mesh(scaleUv(new THREE.BoxGeometry(48, 9, 2), 10, 2), stone);
    frontWall.position.set(0, 4.5, -19);
    g.add(frontWall);
    this.dressDungeonWalls(g, stoneDark, -12, 106);
    // pillars + torches
    for (let z = 10; z <= 100; z += 15) {
      for (const sx of [-14, 14]) {
        this.dungeonPillar(g, stone, sx, z);
        this.addDungeonTorch(g, sx, z, 0x7fd4ff, 0x2288cc, 0x66bbff);
      }
    }
    // collapsed masonry in the corners
    this.rubblePile(g, stoneDark, -19, -13, 1.1, 3);
    this.rubblePile(g, stoneDark, 19, 6, 0.9, 7);
    this.rubblePile(g, stoneDark, -18, 70, 1.0, 11);
    this.rubblePile(g, stoneDark, 19, 108, 1.2, 15);
    // sarcophagi along the walls
    for (let z = 16; z <= 92; z += 19) {
      for (const sx of [-19, 19]) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 4.2), stoneDark);
        s.position.set(sx, 0.7, z);
        s.castShadow = true;
        g.add(s);
      }
    }
    // bone piles
    for (let i = 0; i < 10; i++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), bone);
      const bp = b.geometry.getAttribute('position');
      for (let v = 0; v < bp.count; v++) {
        const k = 0.8 + (Math.sin(bp.getX(v) * 47.1 + bp.getZ(v) * 31.7 + i) * 0.5 + 0.5) * 0.5;
        bp.setXYZ(v, bp.getX(v) * k, bp.getY(v) * k, bp.getZ(v) * k);
      }
      b.geometry.computeVertexNormals();
      b.position.set(Math.sin(i * 2.4) * 14, 0.3, 12 + i * 9.5);
      b.scale.set(1.2, 0.5, 1);
      g.add(b);
    }
    // boss dais
    const dais = new THREE.Mesh(scaleUv(new THREE.CylinderGeometry(9, 10, 1, 12), 4, 1), stone);
    dais.position.set(0, 0.5, 96);
    dais.receiveShadow = true;
    g.add(dais);

    g.position.set(ox, 0, oz);
    this.scene.add(g);
  }

  // Gravewyrm Sanctum: a stretched three-chamber crypt (z 0..158) — the
  // Boneworks, the Ritual Vault and the Wyrm's Hollow — separated by narrowed
  // waists, lit by green ritual fire. Wall/pillar geometry must stay in sync
  // with SANCTUM_COLLIDERS in sim/colliders.ts.
  private buildSanctum(ox: number, oz: number): void {
    const g = new THREE.Group();
    const { stone, stoneDark, bone } = this.interiorStone(0xb0a8c0, 0x767088, 0x5e5a66, 0x3f3b48);

    const floor = new THREE.Mesh(scaleUv(new THREE.BoxGeometry(46, 0.5, 178), 10, 38), stoneDark);
    floor.position.set(0, -0.25, 69.5);
    floor.receiveShadow = true;
    g.add(floor);
    // walls
    for (const sx of [-23, 23]) {
      const wall = new THREE.Mesh(scaleUv(new THREE.BoxGeometry(2, 9, 178), 38, 2), stone);
      wall.position.set(sx, 4.5, 69.5);
      g.add(wall);
    }
    const backWall = new THREE.Mesh(scaleUv(new THREE.BoxGeometry(48, 9, 2), 10, 2), stone);
    backWall.position.set(0, 4.5, 158);
    g.add(backWall);
    const frontWall = new THREE.Mesh(scaleUv(new THREE.BoxGeometry(48, 9, 2), 10, 2), stone);
    frontWall.position.set(0, 4.5, -19);
    g.add(frontWall);
    // chamber waists: wall stubs leaving a ~10yd centre passage
    for (const sx of [-14, 14]) {
      const stub1 = new THREE.Mesh(scaleUv(new THREE.BoxGeometry(18, 9, 10), 4, 2), stone);
      stub1.position.set(sx, 4.5, 67); // Boneworks -> Korgath's Hall
      g.add(stub1);
      const stub2 = new THREE.Mesh(scaleUv(new THREE.BoxGeometry(18, 9, 6), 4, 2), stone);
      stub2.position.set(sx, 4.5, 115); // Ritual Vault -> Wyrm's Hollow
      g.add(stub2);
    }
    this.dressDungeonWalls(g, stoneDark, -12, 152);
    // stone arch bands over the chamber-waist passages
    for (const waistZ of [67, 115]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(12, 1.2, 1.8), stone);
      band.position.set(0, 8.3, waistZ);
      g.add(band);
      const keystone = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.5, 2.0), stone);
      keystone.position.set(0, 7.1, waistZ);
      g.add(keystone);
      for (const sx of [-1, 1]) {
        const haunch = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.1, 1.8), stone);
        haunch.position.set(sx * 3.4, 6.6, waistZ);
        haunch.rotation.z = sx * 0.38;
        g.add(haunch);
      }
    }
    // pillars + green ritual torches (waist bands skipped)
    for (const z of [10, 25, 40, 55, 85, 100, 125, 140]) {
      for (const sx of [-14, 14]) {
        this.dungeonPillar(g, stone, sx, z);
        this.addDungeonTorch(g, sx, z, 0xa6ffb8, 0x22cc55, 0x55e08a);
      }
    }
    // collapsed masonry along the chamber edges
    this.rubblePile(g, stoneDark, -19, 4, 1.0, 5);
    this.rubblePile(g, stoneDark, 19, 48, 1.1, 9);
    this.rubblePile(g, stoneDark, -19, 95, 1.0, 13);
    this.rubblePile(g, stoneDark, 18, 150, 1.2, 17);
    // bone piles strewn between the chambers (none inside the waist walls)
    for (let i = 0; i < 14; i++) {
      const z = 12 + i * 10;
      if ((z > 60 && z < 74) || (z > 110 && z < 120)) continue;
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), bone);
      const bp = b.geometry.getAttribute('position');
      for (let v = 0; v < bp.count; v++) {
        const k = 0.8 + (Math.sin(bp.getX(v) * 47.1 + bp.getZ(v) * 31.7 + i) * 0.5 + 0.5) * 0.5;
        bp.setXYZ(v, bp.getX(v) * k, bp.getY(v) * k, bp.getZ(v) * k);
      }
      b.geometry.computeVertexNormals();
      b.position.set(Math.sin(i * 2.1) * 14, 0.3, z);
      b.scale.set(1.3, 0.5, 1.1);
      g.add(b);
    }
    // Korzul's great dais
    const dais = new THREE.Mesh(scaleUv(new THREE.CylinderGeometry(11, 12, 1.2, 14), 4, 1), stone);
    dais.position.set(0, 0.6, 146);
    dais.receiveShadow = true;
    g.add(dais);

    g.position.set(ox, 0, oz);
    this.scene.add(g);
  }

  // Outdoor fog presets per biome (high tier eases between them as the
  // player crosses zone bands; low keeps the legacy vale fog everywhere).
  private static BIOME_FOG: Record<BiomeId, { color: number; near: number; far: number }> = {
    vale: { color: 0xa6c6e0, near: 130, far: 470 },
    marsh: { color: 0xa3b294, near: 80, far: 330 },
    peaks: { color: 0xbdd3ec, near: 160, far: 560 },
  };

  private outdoorFogPreset(): { color: number; near: number; far: number } {
    if (this.lowGfx) return Renderer.BIOME_FOG.vale;
    return Renderer.BIOME_FOG[zoneBiomeAt(this.sim.player.pos.z)];
  }

  private updateAmbience(px: number, camY: number, dt: number): void {
    const inside = px > DUNGEON_X_THRESHOLD;
    if (inside) {
      // build the interior copy the player is standing in
      for (const dungeon of DUNGEON_LIST) {
        for (let i = 0; i < INSTANCE_SLOT_COUNT; i++) {
          const key = `${dungeon.id}:${i}`;
          if (this.builtInteriors.has(key)) continue;
          const o = instanceOrigin(dungeon.index, i);
          if (Math.abs(px - o.x) < 200 && Math.abs(this.sim.player.pos.z - o.z) < 250) {
            this.builtInteriors.add(key);
            this.buildInterior(dungeon.interior, o.x, o.z);
          }
        }
      }
    }
    const desired = inside ? 'dungeon' : camY < WATER_LEVEL - 0.05 ? 'underwater' : 'outdoor';
    const fog = this.scene.fog as THREE.Fog;
    if (desired !== this.fogState) {
      this.fogState = desired;
      if (desired === 'dungeon') {
        fog.color.setHex(0x05060a);
        fog.near = 18;
        fog.far = 90;
      } else if (desired === 'underwater') {
        fog.color.setHex(0x17506e);
        fog.near = 2;
        fog.far = 48;
      } else {
        const preset = this.outdoorFogPreset();
        fog.color.setHex(preset.color);
        fog.near = preset.near;
        fog.far = preset.far;
      }
      // interiors must not leak daylight: drop sun + sky ambient + IBL
      // underground so the torch point lights own the scene; restore outside.
      // The rim glow cranks up instead — silhouettes must split from the murk.
      if (!this.lowGfx) {
        const underground = desired === 'dungeon';
        this.sun.intensity = underground ? DUNGEON_SUN_INTENSITY : SUN_INTENSITY;
        this.hemi.intensity = underground ? DUNGEON_HEMI_INTENSITY : HEMI_INTENSITY;
        this.scene.environmentIntensity = underground ? DUNGEON_ENV_INTENSITY : ENV_INTENSITY;
        sharedUniforms.uRimBoost.value = underground ? DUNGEON_RIM_BOOST : 1;
      }
      return;
    }
    // outdoors: ease fog toward the current biome's preset (~2s)
    if (desired === 'outdoor' && !this.lowGfx) {
      const preset = this.outdoorFogPreset();
      const k = 1 - Math.exp(-dt * 1.5);
      fog.color.lerp(this.fogScratch.setHex(preset.color), k);
      fog.near += (preset.near - fog.near) * k;
      fog.far += (preset.far - fog.far) * k;
    }
  }

  // Drop the view of an entity that left the world / our interest area.
  private removeView(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.group);
    v.nameplate.remove();
    const idx = this.clickTargets.indexOf(v.rig.body);
    if (idx >= 0) this.clickTargets.splice(idx, 1);
    // Free this view's GPU resources: geometries are unique per view (merged
    // rig buckets, far LOD, lazy form rigs, door/crate boxes) and leak GL
    // buffers + VAOs for the renderer's lifetime if not disposed on interest
    // churn / instance despawn. Materials and textures are shared caches
    // (rigMergedMat / surfaceMat / sparkle / door stone) and must survive —
    // the per-view portal swirl material is the only one owned here. Sprites
    // share three's global sprite geometry, so only real meshes are disposed.
    v.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    if (v.portal) (v.portal.material as THREE.Material).dispose();
    this.views.delete(id);
  }

  sync(alpha: number, dt: number, renderFacingOverride: number | null): void {
    this.time += dt;
    sharedUniforms.uTime.value = this.time;
    const sim = this.sim;
    const p = sim.player;

    // dynamic worlds: create views for newcomers, drop views for leavers
    // (doomed ids collected into a reused scratch array — no per-frame alloc)
    for (const e of sim.entities.values()) {
      if (!this.views.has(e.id)) this.createView(e);
    }
    this.doomedIds.length = 0;
    for (const id of this.views.keys()) {
      if (!sim.entities.has(id)) this.doomedIds.push(id);
    }
    for (const id of this.doomedIds) this.removeView(id);

    for (const e of sim.entities.values()) {
      const v = this.views.get(e.id);
      if (!v) continue;
      // form swaps (polymorph sheep, druid bear) — computed up front because
      // the shadow gates below must not show the humanoid proxy under a form
      const polyed = e.auras.some((a) => a.kind === 'polymorph');
      const bear = !polyed && e.auras.some((a) => a.kind === 'form_bear');
      // distance cull: far rigs are invisible specks but cost real draw calls
      if (e.id !== p.id) {
        const cdx = e.pos.x - p.pos.x, cdz = e.pos.z - p.pos.z;
        const d2 = cdx * cdx + cdz * cdz;
        if (d2 > ENTITY_DRAW_RANGE * ENTITY_DRAW_RANGE) {
          v.group.visible = false;
          continue;
        }
        v.group.visible = true; // the object branch below may re-hide loot
        // mid-distance rigs keep rendering but leave the shadow pass
        const wantShadow = d2 < ENTITY_SHADOW_RANGE_SQ;
        if (wantShadow !== v.shadowOn) {
          v.shadowOn = wantShadow;
          for (const caster of v.casters) (caster as THREE.Mesh).castShadow = wantShadow;
        }
        v.isFar = d2 > ENTITY_LOD_RANGE_SQ;
        // past the articulated gate the static-pose proxy carries the shadow;
        // while a form is active its own rig keeps casting instead
        const inProxyBand = d2 < ENTITY_PROXY_SHADOW_RANGE_SQ;
        if (v.shadowProxy) v.shadowProxy.visible = !wantShadow && inProxyBand && !polyed && !bear;
        const wantFormShadow = wantShadow || inProxyBand;
        if (wantFormShadow !== v.formShadowOn) {
          v.formShadowOn = wantFormShadow;
          for (const caster of v.formCasters) (caster as THREE.Mesh).castShadow = wantFormShadow;
        }
      }
      const x = e.prevPos.x + (e.pos.x - e.prevPos.x) * alpha;
      const y = e.prevPos.y + (e.pos.y - e.prevPos.y) * alpha;
      const z = e.prevPos.z + (e.pos.z - e.prevPos.z) * alpha;
      v.group.position.set(x, y, z);
      let facing = e.prevFacing + shortestAngle(e.prevFacing, e.facing) * alpha;
      if (e.id === p.id && renderFacingOverride !== null) facing = renderFacingOverride;
      v.group.rotation.y = facing;

      if (e.kind === 'object') {
        const vis = e.lootable;
        v.group.visible = vis;
        if (v.sparkle && vis) {
          // sub-pixel beyond ~45u but still a full transparent draw each
          const sdx = e.pos.x - p.pos.x, sdz = e.pos.z - p.pos.z;
          v.sparkle.visible = sdx * sdx + sdz * sdz < SPARKLE_DRAW_RANGE_SQ;
          const pulse = 0.75 + Math.sin(this.time * 3 + e.id) * 0.25;
          v.sparkle.scale.set(pulse, pulse, 1);
          v.sparkle.material.rotation = this.time * 0.8;
        }
        if (v.portal && vis) {
          v.portal.rotation.z = this.time * 1.4;
          (v.portal.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(this.time * 2.2 + e.id) * 0.15;
        }
        continue;
      }

      // swimming pose: prone at the surface, stroking arms
      const swimming = !e.dead
        && groundHeight(e.pos.x, e.pos.z, this.sim.cfg.seed) < WATER_LEVEL - 0.8
        && e.pos.y <= WATER_LEVEL - 0.5;

      // lazy form rig builds; form casters follow the wider proxy-band gate
      if (polyed && !v.sheepRig) {
        v.sheepRig = buildSheep();
        v.sheepRig.body.scale.multiplyScalar(e.scale);
        v.group.add(v.sheepRig.body);
        collectCasters(v.sheepRig.body, v.formCasters);
        if (!v.formShadowOn) v.sheepRig.body.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
      }
      if (bear && !v.bearRig) {
        v.bearRig = buildBear();
        v.bearRig.body.scale.multiplyScalar(e.scale);
        v.group.add(v.bearRig.body);
        collectCasters(v.bearRig.body, v.formCasters);
        if (!v.formShadowOn) v.bearRig.body.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
      }
      if (v.sheepRig) v.sheepRig.body.visible = polyed;
      if (v.bearRig) v.bearRig.body.visible = bear;
      // distant rigs render as their single-draw merged LOD instead
      const useFar = v.isFar && !polyed && !bear && v.farMesh !== null;
      if (v.farMesh) v.farMesh.visible = useFar;
      v.rig.body.visible = !polyed && !bear && !useFar;
      const activeRig = polyed && v.sheepRig ? v.sheepRig : bear && v.bearRig ? v.bearRig : v.rig;
      const parts = activeRig.parts;

      // animation
      const speed = Math.hypot(e.pos.x - e.prevPos.x, e.pos.z - e.prevPos.z) / Math.max(dt, 1e-4) * 0.05;
      const moving = speed > 0.02;
      if (moving) v.walkPhase += dt * 9 * Math.min(2, speed * 6);
      const swing = moving ? Math.sin(v.walkPhase) * 0.55 : 0;

      if (parts.leftLeg || parts.rightLeg) {
        // biped
        if (parts.leftLeg) parts.leftLeg.rotation.x = swing;
        if (parts.rightLeg) parts.rightLeg.rotation.x = -swing;
        if (parts.leftArm) parts.leftArm.rotation.x = -swing * 0.65;
        if (parts.rightArm && v.attackAnim <= 0) parts.rightArm.rotation.x = swing * 0.65;
        if (v.attackAnim > 0) {
          v.attackAnim -= dt;
          const t = 1 - Math.max(0, v.attackAnim) / 0.35;
          if (parts.rightArm) parts.rightArm.rotation.x = -Math.sin(t * Math.PI) * 1.9;
        }
        // idle breathing — absolute around the captured rest height (adding
        // to the current position accumulated frame-rate-dependent drift)
        if (!moving && parts.head && activeRig.headRestY !== undefined) {
          parts.head.position.y = activeRig.headRestY + Math.sin(this.time * 1.8 + e.id) * 0.012;
        }
      } else if (parts.legs) {
        if (activeRig.kind === 'spider') {
          parts.legs.forEach((leg, i) => {
            const base = (i % 2 === 0 ? 1 : -1) * 0.18;
            leg.rotation.x = moving ? Math.sin(v.walkPhase * 1.6 + i * 0.9) * 0.35 : Math.sin(this.time * 2 + i) * 0.05;
            leg.rotation.z = base;
          });
        } else {
          parts.legs.forEach((leg, i) => {
            leg.rotation.x = moving ? Math.sin(v.walkPhase + (i % 2) * Math.PI) * 0.7 : 0;
          });
        }
        if (v.attackAnim > 0) {
          v.attackAnim -= dt;
          const t = 1 - Math.max(0, v.attackAnim) / 0.35;
          if (parts.head) parts.head.rotation.x = Math.sin(t * Math.PI) * 0.6;
        } else if (parts.head) {
          parts.head.rotation.x = 0;
        }
        if (parts.tail) parts.tail.rotation.x = 0.55 + Math.sin(this.time * 4 + e.id) * 0.15;
      }

      // death pose
      if (e.dead) {
        activeRig.body.rotation.z = Math.PI / 2;
        activeRig.body.rotation.x = 0;
        activeRig.body.position.y = 0.4;
      } else {
        activeRig.body.rotation.z = 0;
        activeRig.body.rotation.x = 0;
        activeRig.body.position.y = 0;
        if (e.castingAbility && parts.leftArm && parts.rightArm) {
          parts.leftArm.rotation.x = -2.4;
          parts.rightArm.rotation.x = -2.4;
          this.vfx.castSparkle(e.id, ABILITIES[e.castingAbility]?.school ?? 'arcane', dt);
        }
        // sitting pose
        if (e.kind === 'player' && (e.sitting || e.eating || e.drinking)) {
          activeRig.body.position.y = -0.8;
          if (parts.leftLeg) parts.leftLeg.rotation.x = -1.4;
          if (parts.rightLeg) parts.rightLeg.rotation.x = -1.4;
        }
        if (swimming) {
          // prone freestyle at the surface
          activeRig.body.rotation.x = 1.18;
          activeRig.body.position.y = 1.0 + Math.sin(this.time * 2 + e.id) * 0.08;
          const ph = moving ? v.walkPhase : this.time * 2.4;
          if (parts.leftArm) parts.leftArm.rotation.x = Math.sin(ph) * 1.25 - 1.5;
          if (parts.rightArm && v.attackAnim <= 0) parts.rightArm.rotation.x = Math.sin(ph + Math.PI) * 1.25 - 1.5;
          if (parts.leftLeg) parts.leftLeg.rotation.x = Math.sin(ph * 2) * 0.4;
          if (parts.rightLeg) parts.rightLeg.rotation.x = Math.sin(ph * 2 + Math.PI) * 0.4;
          if (moving) this.vfx.swimRipple(v.group.position, dt * 3);
          else this.vfx.swimRipple(v.group.position, dt);
        }
      }
      // the far LOD and shadow proxy mirror the body pose (death tip-over,
      // sitting, swimming)
      if (v.farMesh && v.farMesh.visible) {
        v.farMesh.rotation.copy(activeRig.body.rotation);
        v.farMesh.position.copy(activeRig.body.position);
      }
      if (v.shadowProxy && v.shadowProxy.visible) {
        v.shadowProxy.rotation.copy(activeRig.body.rotation);
        v.shadowProxy.position.copy(activeRig.body.position);
      }
    }

    // selection ring
    const target = p.targetId !== null ? sim.entities.get(p.targetId) : null;
    if (target) {
      const tv = this.views.get(target.id)!;
      this.selectionRing.position.copy(tv.group.position);
      this.selectionRing.position.y += 0.08;
      this.selectionRing.scale.setScalar(target.scale);
      const ringMat = this.selectionRing.material as THREE.MeshBasicMaterial;
      ringMat.color.setHex(target.hostile ? 0xcc2222 : 0xd4af37);
      if (!this.lowGfx) ringMat.color.multiplyScalar(SELECTION_RING_BOOST); // subtle bloom edge
      this.selectionRing.visible = true;
    } else {
      this.selectionRing.visible = false;
    }

    // fire flicker + rising embers
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const fl = 0.85 + Math.sin(this.time * 9 + i * 2.4) * 0.12 + Math.sin(this.time * 23 + i) * 0.06;
      f.scale.set(fl, fl * (1 + Math.sin(this.time * 13 + i) * 0.12), fl);
      const mat = f.material as THREE.MeshLambertMaterial;
      if (mat.color.r > mat.color.b) {
        f.getWorldPosition(this.tmpV);
        this.vfx.campfireEmber(this.tmpV, dt);
      }
    }
    for (let i = 0; i < this.fireLights.length; i++) {
      const light = this.fireLights[i];
      const base = (light.userData.baseIntensity as number | undefined) ?? 11;
      light.intensity = base + Math.sin(this.time * 11 + i * 1.7) * 2.5 * (base / 11);
    }
    this.budgetFireLights(p.pos.x, p.pos.z);

    // clouds drift (the high cirrus layer crawls slower); on the lit tiers
    // they tint warm sunward / cool anti-sun to anchor the key light's azimuth
    for (const cl of this.clouds) {
      cl.position.x += dt * ((cl.userData.drift as number | undefined) ?? 1.6);
      if (cl.position.x > 320) cl.position.x = -320;
      if (!this.lowGfx) {
        const along = ((cl.position.x - this.camera.position.x) * this.sunAzimuth.x
          + (cl.position.z - this.camera.position.z) * this.sunAzimuth.z) / 320;
        const t = Math.max(-1, Math.min(1, along)) * 0.5 + 0.5;
        (cl.material as THREE.SpriteMaterial).color.setRGB(
          0.86 + 0.14 * t, 0.90 + 0.05 * t, 1.0 - 0.13 * t,
        );
      }
    }

    // water shimmer (low-tier texture scroll; shader water rides uTime)
    this.waterView.update(this.time);
    // fully-fogged terrain chunks / tree buckets are dropped before the
    // frustum; the grass ring follows the player
    const fogFar = (this.scene.fog as THREE.Fog).far;
    this.terrainView.update(this.camera.position.x, this.camera.position.z, fogFar);
    this.propsView.update(this.camera.position.x, this.camera.position.z, fogFar);
    this.foliage.update(p.pos.x, p.pos.z, this.camera.position.x, this.camera.position.z, fogFar);

    this.vfx.update(dt);

    this.updateCamera(alpha);
    this.updateAmbience(p.pos.x, this.camera.position.y, dt);
    // shadow frustum follows the player
    const pv = this.views.get(p.id);
    if (pv) {
      const pp = pv.group.position;
      this.sun.position.set(pp.x + SUN_ANCHOR.x, pp.y + SUN_ANCHOR.y, pp.z + SUN_ANCHOR.z);
      this.sun.target.position.set(pp.x, pp.y, pp.z);
    }
    // sky dome + sun disc ride along with the camera
    this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.sky.visible = this.fogState === 'outdoor';
    if (this.sky.visible) this.skyView.setCameraZ(this.camera.position.z, dt);
    for (const sp of this.sunSprites) {
      sp.position.copy(this.camera.position).addScaledVector(this.sunDir, 760);
      sp.visible = this.fogState === 'outdoor';
    }
    this.updateGodRays();

    this.updateNameplates();
    if (this.post) this.post.render();
    else this.webgl.render(this.scene, this.camera);
  }

  // Forward-renderer point-light budget: every campfire/torch light exists,
  // but only the nearest GFX.maxPointLights within range shine each frame.
  // Rank entries are pooled (extended only when interiors add lights) and
  // world positions cached once — the lights never move — so this hot loop
  // allocates nothing and skips the sort while the budget isn't contended.
  private budgetFireLights(px: number, pz: number): void {
    const ranked = this.lightRank;
    while (ranked.length < this.fireLights.length) {
      const light = this.fireLights[ranked.length];
      ranked.push({ light, d2: 0, worldPos: light.getWorldPosition(new THREE.Vector3()) });
    }
    for (const entry of ranked) {
      const dx = entry.worldPos.x - px, dz = entry.worldPos.z - pz;
      entry.d2 = dx * dx + dz * dz;
    }
    if (ranked.length > GFX.maxPointLights) ranked.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < ranked.length; i++) {
      ranked[i].light.visible = i < GFX.maxPointLights && ranked[i].d2 < LIGHT_BUDGET_RANGE_SQ;
    }
  }

  // light shafts fade in as the camera turns toward the sun, outdoor only
  private updateGodRays(): void {
    if (this.godRays.length === 0) return;
    const outdoor = this.fogState === 'outdoor';
    // azimuth-only alignment — the chase cam always pitches down while the
    // sun sits high, so a full 3D dot product would never light the shafts
    this.camera.getWorldDirection(this.tmpV);
    this.tmpV.y = 0;
    this.tmpV.normalize();
    const sunAzimuth = this.tmpV2.set(this.sunDir.x, 0, this.sunDir.z).normalize();
    const facing = Math.max(0, this.tmpV.dot(sunAzimuth));
    const side = this.tmpV.set(sunAzimuth.z, 0, -sunAzimuth.x); // sunAzimuth x up
    for (let i = 0; i < this.godRays.length; i++) {
      const sp = this.godRays[i];
      sp.visible = outdoor;
      if (!outdoor) continue;
      const sway = Math.sin(this.time * 0.13 + i * 2.1) * 10;
      // hang the shafts sunward of the camera but near eye height so they
      // cross a third-person frame instead of floating 150u overhead
      sp.position.copy(this.camera.position)
        .addScaledVector(sunAzimuth, 48 + i * 26)
        .addScaledVector(side, (i - 1) * 30 + sway);
      sp.position.y = this.camera.position.y + 16 + i * 7;
      sp.material.opacity = facing * facing * facing * (0.30 - i * 0.05);
    }
  }

  private updateCamera(alpha: number): void {
    const p = this.sim.player;
    const px = p.prevPos.x + (p.pos.x - p.prevPos.x) * alpha;
    const py = p.prevPos.y + (p.pos.y - p.prevPos.y) * alpha;
    const pz = p.prevPos.z + (p.pos.z - p.prevPos.z) * alpha;
    const eyeY = py + 2.0;
    const cx = px - Math.sin(this.camYaw) * Math.cos(this.camPitch) * this.camDist;
    const cy = eyeY + Math.sin(this.camPitch) * this.camDist;
    const cz = pz - Math.cos(this.camYaw) * Math.cos(this.camPitch) * this.camDist;
    const groundY = groundHeight(cx, cz, this.sim.cfg.seed) + 0.6;
    this.camera.position.set(cx, Math.max(cy, groundY), cz);
    this.camera.lookAt(px, eyeY, pz);
  }

  private updateNameplates(): void {
    const sim = this.sim;
    const p = sim.player;
    const w = window.innerWidth, h = window.innerHeight;
    for (const e of sim.entities.values()) {
      const v = this.views.get(e.id);
      if (!v) continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const isSelf = e.id === p.id;
      const isDoor = e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit';
      const hidden = isSelf || dist > NAMEPLATE_RANGE
        || (e.dead && !e.lootable && e.kind === 'mob')
        || (e.kind === 'object' && !isDoor)
        || (!this.showNameplates && e.kind === 'mob' && !e.dead);
      if (hidden) {
        v.nameplate.style.display = 'none';
        continue;
      }
      this.tmpV.copy(v.group.position);
      this.tmpV.y += v.rig.height * e.scale + 0.5;
      this.tmpV.project(this.camera);
      if (this.tmpV.z > 1) { v.nameplate.style.display = 'none'; continue; }
      const sx = (this.tmpV.x * 0.5 + 0.5) * w;
      const sy = (-this.tmpV.y * 0.5 + 0.5) * h;
      v.nameplate.style.display = '';
      v.nameplate.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px) translate(-50%, -100%)`;

      if (e.kind === 'object') {
        // dungeon doorways announce themselves
        v.nameEl.style.color = '#c084ff';
        v.nameEl.textContent = e.name;
        v.hpBar.style.display = 'none';
        v.markerEl.textContent = '';
      } else if (e.kind === 'player') {
        // other players: friendly blue with an hp bar
        v.nameEl.style.color = '#7fb8ff';
        v.nameEl.textContent = `${e.name}`;
        v.hpBar.style.display = e.dead ? 'none' : '';
        v.hpFill.style.width = `${(100 * e.hp / Math.max(1, e.maxHp)).toFixed(1)}%`;
        v.markerEl.textContent = '';
      } else if (e.kind === 'npc') {
        v.nameEl.style.color = '#9fdc7f';
        v.nameEl.textContent = e.name;
        v.hpBar.style.display = 'none';
        let marker = '';
        let cls = '';
        for (const qid of e.questIds) {
          const st = sim.questState(qid);
          if (st === 'ready') { marker = '?'; cls = 'ready'; break; }
          if (st === 'available') { marker = '!'; cls = 'avail'; }
          else if (st === 'active' && !marker) { marker = '?'; cls = 'active'; }
        }
        v.markerEl.textContent = marker;
        v.markerEl.className = 'np-marker ' + cls;
      } else {
        const diff = e.level - p.level;
        const template = MOBS[e.templateId];
        const elite = !!template?.elite;
        v.nameEl.style.color = e.dead ? '#999' : diff >= 3 ? '#ff4444' : diff >= 1 ? '#ffaa33' : diff >= -2 ? '#ffe97a' : diff >= -5 ? '#7fdc4f' : '#9d9d9d';
        v.nameEl.textContent = e.dead ? `${e.name} (corpse)` : `[${e.level}${elite ? '+' : ''}] ${e.name}`;
        v.hpBar.style.display = e.dead ? 'none' : '';
        v.hpFill.style.width = `${(100 * e.hp / Math.max(1, e.maxHp)).toFixed(1)}%`;
        v.markerEl.textContent = e.lootable ? '$' : elite && !e.dead ? '◆' : '';
        v.markerEl.className = 'np-marker loot';
      }
    }
  }

  pick(clientX: number, clientY: number): number | null {
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.clickTargets, true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        if (o.userData.entityId !== undefined && o.userData.entityId !== this.sim.playerId) {
          const e = this.sim.entities.get(o.userData.entityId as number);
          if (e?.kind === 'object' && !e.lootable) return null;
          return o.userData.entityId as number;
        }
        o = o.parent;
      }
    }
    return null;
  }

  worldToScreen(x: number, y: number, z: number): { x: number; y: number; behind: boolean } {
    this.tmpV.set(x, y, z).project(this.camera);
    return {
      x: (this.tmpV.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this.tmpV.y * 0.5 + 0.5) * window.innerHeight,
      behind: this.tmpV.z > 1,
    };
  }
}

function shortestAngle(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Tile a geometry's 0..1 UVs so shared textures keep a sane world-space
// density on big interior boxes/cylinders.
function scaleUv(geo: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}
