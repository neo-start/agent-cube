import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, Environment, Clone } from '@react-three/drei';
import * as THREE from 'three';
import { NativePostProcessing } from './NativePostProcessing.js';

// ═══════════════════════════════════════════════════════════════════════
// Deterministic hash — no Math.random() in render
// ═══════════════════════════════════════════════════════════════════════

function hash2D(x: number, y: number): number {
  let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  n = n - Math.floor(n);
  return n;
}

// ═══════════════════════════════════════════════════════════════════════
// Model path helper
// ═══════════════════════════════════════════════════════════════════════

const MODEL_BASE = '/models/nature/';
function modelPath(name: string): string {
  return `${MODEL_BASE}${name}.gltf`;
}

// ═══════════════════════════════════════════════════════════════════════
// Preload all models used in the scene
// ═══════════════════════════════════════════════════════════════════════

const TREE_MODELS = ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5',
  'Pine_1', 'Pine_2', 'Pine_3', 'Pine_4', 'Pine_5',
  'TwistedTree_1', 'TwistedTree_2', 'TwistedTree_3', 'TwistedTree_4', 'TwistedTree_5'];

const BUSH_MODELS = ['Bush_Common', 'Bush_Common_Flowers', 'Fern_1', 'Plant_1', 'Plant_1_Big', 'Plant_7', 'Plant_7_Big'];

const FLOWER_MODELS = ['Flower_3_Group', 'Flower_3_Single', 'Flower_4_Group', 'Flower_4_Single'];

const GRASS_MODELS = ['Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Short', 'Grass_Wispy_Tall'];

const ROCK_MODELS = ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3',
  'Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Round_3', 'Pebble_Round_4', 'Pebble_Round_5'];

const ACCENT_MODELS = ['Mushroom_Common', 'Mushroom_Laetiporus', 'Clover_1', 'Clover_2'];

// Preload all
[...TREE_MODELS, ...BUSH_MODELS, ...FLOWER_MODELS, ...GRASS_MODELS, ...ROCK_MODELS, ...ACCENT_MODELS]
  .forEach(name => useGLTF.preload(modelPath(name)));

// ═══════════════════════════════════════════════════════════════════════
// Generic scattered model component
// Places N clones of randomly selected models from a pool
// ═══════════════════════════════════════════════════════════════════════

interface ScatterConfig {
  models: string[];
  count: number;
  radiusMin: number;
  radiusMax: number;
  scaleMin: number;
  scaleMax: number;
  seed: number;
  yOffset?: number;
}

function ScatteredModels({ models, count, radiusMin, radiusMax, scaleMin, scaleMax, seed, yOffset = 0 }: ScatterConfig) {
  const scenes = models.map(name => useGLTF(modelPath(name)).scene);

  const placements = useMemo(() => {
    const result: { modelIdx: number; position: [number, number, number]; rotationY: number; scale: number }[] = [];
    for (let i = 0; i < count; i++) {
      const angle = hash2D(i, seed) * Math.PI * 2;
      const r = radiusMin + Math.sqrt(hash2D(i, seed + 1)) * (radiusMax - radiusMin);
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const modelIdx = Math.floor(hash2D(i, seed + 2) * models.length) % models.length;
      const rotationY = hash2D(i, seed + 3) * Math.PI * 2;
      const scale = scaleMin + hash2D(i, seed + 4) * (scaleMax - scaleMin);
      result.push({ modelIdx, position: [x, yOffset, z], rotationY, scale });
    }
    return result;
  }, [count, radiusMin, radiusMax, scaleMin, scaleMax, seed, yOffset, models.length]);

  return (
    <group>
      {placements.map((p, i) => (
        <Clone
          key={i}
          object={scenes[p.modelIdx]}
          position={p.position}
          rotation={[0, p.rotationY, 0]}
          scale={p.scale}
        />
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Trees — 20 trees, mixed types, spread across the field
// ═══════════════════════════════════════════════════════════════════════

function Trees() {
  return (
    <ScatteredModels
      models={TREE_MODELS}
      count={20}
      radiusMin={4}
      radiusMax={25}
      scaleMin={0.8}
      scaleMax={1.5}
      seed={100}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Bushes & Plants — 40 scattered bushes/ferns/plants
// ═══════════════════════════════════════════════════════════════════════

function Bushes() {
  return (
    <ScatteredModels
      models={BUSH_MODELS}
      count={40}
      radiusMin={2}
      radiusMax={22}
      scaleMin={0.6}
      scaleMax={1.3}
      seed={200}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Flowers — 35 flower groups/singles
// ═══════════════════════════════════════════════════════════════════════

function Flowers() {
  return (
    <ScatteredModels
      models={FLOWER_MODELS}
      count={35}
      radiusMin={1}
      radiusMax={18}
      scaleMin={0.7}
      scaleMax={1.2}
      seed={300}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Grass patches — 300 grass clumps spread densely
// ═══════════════════════════════════════════════════════════════════════

function GrassPatches() {
  return (
    <ScatteredModels
      models={GRASS_MODELS}
      count={300}
      radiusMin={0}
      radiusMax={20}
      scaleMin={0.5}
      scaleMax={1.4}
      seed={400}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Rocks — 15 rocks and pebbles
// ═══════════════════════════════════════════════════════════════════════

function Rocks() {
  return (
    <ScatteredModels
      models={ROCK_MODELS}
      count={15}
      radiusMin={2}
      radiusMax={20}
      scaleMin={0.4}
      scaleMax={1.0}
      seed={500}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Accents — mushrooms and clovers, small details
// ═══════════════════════════════════════════════════════════════════════

function Accents() {
  return (
    <ScatteredModels
      models={ACCENT_MODELS}
      count={8}
      radiusMin={2}
      radiusMax={15}
      scaleMin={0.8}
      scaleMax={1.3}
      seed={600}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════
// FBM noise utilities (kept for distant mountains)
// ═══════════════════════════════════════════════════════════════════════

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2D(ix, iy);
  const b = hash2D(ix + 1, iy);
  const c = hash2D(ix, iy + 1);
  const d = hash2D(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbmNoise(x: number, y: number, octaves: number): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * smoothNoise(x * freq, y * freq);
    amp *= 0.5;
    freq *= 2.0;
  }
  return val;
}

// ═══════════════════════════════════════════════════════════════════════
// Distant Mountains — FBM-generated silhouettes (kept from previous)
// ═══════════════════════════════════════════════════════════════════════

interface MountainLayerConfig {
  zOffset: number;
  xSpread: number;
  segments: number;
  peakCount: number;
  maxHeight: number;
  minHeight: number;
  noiseScale: number;
  noiseOctaves: number;
  color: string;
  seed: number;
}

function buildMountainGeometry(cfg: MountainLayerConfig): THREE.BufferGeometry {
  const widthSegs = cfg.segments;
  const heightSegs = 20;
  const geo = new THREE.PlaneGeometry(cfg.xSpread, cfg.maxHeight, widthSegs, heightSegs);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  const profile: number[] = [];
  for (let ix = 0; ix <= widthSegs; ix++) {
    const t = ix / widthSegs;
    let h = 0;
    for (let p = 0; p < cfg.peakCount; p++) {
      const peakPos = hash2D(cfg.seed + p, 0.5) * 0.8 + 0.1;
      const peakWidth = 0.08 + hash2D(cfg.seed + p, 1.5) * 0.15;
      const peakHeight = cfg.minHeight + hash2D(cfg.seed + p, 2.5) * (cfg.maxHeight - cfg.minHeight);
      const dist = Math.abs(t - peakPos);
      h = Math.max(h, peakHeight * Math.exp(-dist * dist / (peakWidth * peakWidth)));
    }
    h += fbmNoise(t * cfg.noiseScale + cfg.seed, cfg.seed * 3.7, cfg.noiseOctaves) * cfg.maxHeight * 0.25;
    const edgeFade = Math.min(t, 1 - t) * 5;
    h *= Math.min(edgeFade, 1);
    profile.push(Math.max(h, 0.1));
  }

  for (let iy = 0; iy <= heightSegs; iy++) {
    const vFrac = iy / heightSegs;
    for (let ix = 0; ix <= widthSegs; ix++) {
      const idx = iy * (widthSegs + 1) + ix;
      const maxH = profile[ix];
      pos.setY(idx, vFrac * maxH);
      const zJitter = fbmNoise(ix * 0.3 + cfg.seed, iy * 0.5 + cfg.seed, 2) * 0.8;
      pos.setZ(idx, zJitter);
    }
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

const MOUNTAIN_LAYERS: MountainLayerConfig[] = [
  { zOffset: -28, xSpread: 80, segments: 80, peakCount: 5, maxHeight: 12, minHeight: 3, noiseScale: 8, noiseOctaves: 5, color: '#5B8C5A', seed: 42 },
  { zOffset: -40, xSpread: 100, segments: 60, peakCount: 4, maxHeight: 15, minHeight: 5, noiseScale: 5, noiseOctaves: 3, color: '#8BA7C7', seed: 137 },
  { zOffset: -55, xSpread: 120, segments: 40, peakCount: 6, maxHeight: 10, minHeight: 4, noiseScale: 3, noiseOctaves: 2, color: '#B8CCE0', seed: 271 },
];

function MountainLayer({ config }: { config: MountainLayerConfig }) {
  const geo = useMemo(() => buildMountainGeometry(config), [config]);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color: config.color,
    roughness: 0.9,
    flatShading: true,
  }), [config]);

  return <mesh geometry={geo} material={mat} position={[0, 0, config.zOffset]} />;
}

function Mountains() {
  return (
    <group>
      {MOUNTAIN_LAYERS.map((layer, i) => (
        <MountainLayer key={i} config={layer} />
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Ground — large green plane with subtle gradient
// ═══════════════════════════════════════════════════════════════════════

function Ground() {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(80, 80, 64, 64);
    const pos = g.attributes.position as THREE.BufferAttribute;
    // Gentle FBM undulation
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const elevation = fbmNoise(x * 0.06, y * 0.06, 3) * 0.3 - 0.1;
      pos.setZ(i, elevation);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }, []);

  return (
    <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
      <meshStandardMaterial color="#4A7C34" roughness={0.85} />
    </mesh>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Floating particles — simple golden sparkles
// ═══════════════════════════════════════════════════════════════════════

const PARTICLE_VERTEX = /* glsl */ `
  uniform float uTime;
  attribute float aPhase;
  attribute float aSpeed;
  varying float vAlpha;
  void main() {
    vec3 pos = position;
    pos.x += sin(uTime * aSpeed + aPhase) * 1.2;
    pos.y += sin(uTime * aSpeed * 0.7 + aPhase * 2.0) * 0.5 + sin(uTime * 0.3) * 0.15;
    pos.z += cos(uTime * aSpeed * 0.5 + aPhase * 1.5) * 1.0;
    vAlpha = 0.3 + 0.5 * (0.5 + 0.5 * sin(uTime * 2.0 + aPhase * 3.0));
    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = 3.5 * (60.0 / -mvPos.z);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const PARTICLE_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float soft = 1.0 - smoothstep(0.15, 0.5, dist);
    vec3 col = vec3(1.0, 0.95, 0.75);
    gl_FragColor = vec4(col, soft * vAlpha);
  }
`;

function FloatingParticles() {
  const count = 80;
  const pointsRef = useRef<THREE.Points>(null);

  const { geo, mat } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (hash2D(i, 50) - 0.5) * 20;
      positions[i * 3 + 1] = 0.3 + hash2D(i, 51) * 2.0;
      positions[i * 3 + 2] = (hash2D(i, 52) - 0.5) * 20;
      phases[i] = hash2D(i, 53) * Math.PI * 2;
      speeds[i] = 0.3 + hash2D(i, 54) * 0.4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    g.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geo: g, mat: m };
  }, []);

  useFrame((s) => { mat.uniforms.uTime.value = s.clock.elapsedTime; });

  return <points ref={pointsRef} geometry={geo} material={mat} />;
}

// ═══════════════════════════════════════════════════════════════════════
// Lighting
// ═══════════════════════════════════════════════════════════════════════

function GrasslandLighting() {
  return (
    <>
      {/* Warm ambient — golden hour base */}
      <ambientLight intensity={0.35} color="#FFE8C8" />

      {/* Main sun — low angle for long shadows and warm glow */}
      <directionalLight
        position={[15, 10, 12]}
        intensity={2.2}
        color="#FFD89E"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-bias={-0.0005}
      />

      {/* Cool fill light from opposite side — adds depth */}
      <directionalLight position={[-8, 6, -6]} intensity={0.4} color="#9EC4E0" />

      {/* Rim/back light — subtle edge highlight */}
      <directionalLight position={[-3, 8, -15]} intensity={0.6} color="#FFB870" />

      {/* Hemisphere: warm sky to cool-green ground */}
      <hemisphereLight args={['#FFECD2', '#3A6B28', 0.5]} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main Export
// ═══════════════════════════════════════════════════════════════════════

export function GrasslandEnvironment() {
  return (
    <>
      {/* HDRI sky + environment lighting */}
      <Environment files="/models/nature/noon_grass_1k.hdr" background />

      <GrasslandLighting />

      {/* Warm atmospheric fog — shorter start for more depth layering */}
      <fog attach="fog" args={['#E8DFCF', 20, 70]} />

      <Ground />
      <GrassPatches />
      <Trees />
      <Bushes />
      <Flowers />
      <Rocks />
      <Accents />
      <Mountains />
      <FloatingParticles />

      {/* Native Three.js post-processing (replaces crashed @react-three/postprocessing) */}
      <NativePostProcessing
        bloomStrength={0.25}
        bloomRadius={0.4}
        bloomThreshold={0.82}
      />
    </>
  );
}
