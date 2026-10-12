import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CAR_CATALOG, BODY_LABELS, getCarLabel } from './cars.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const ui = {
  loading: $('loading-screen'), loadingProgress: $('loading-progress'), loadingLabel: $('loading-label'),
  garage: $('garage-panel'), garageOpen: $('garage-open'), garageCollapse: $('garage-collapse'),
  carSearch: $('car-search'), brandFilter: $('brand-filter'), carList: $('car-list'), visibleCount: $('visible-count'),
  selectedName: $('selected-name'), selectedYear: $('selected-year'), selectedType: $('selected-type'), selectedDrive: $('selected-drive'),
  selectedSpeed: $('selected-speed'), selectedPower: $('selected-power'), selectedZero: $('selected-zero'),
  modeTitle: $('mode-title'), missionState: $('mission-state'), missionName: $('mission-name'), missionDesc: $('mission-desc'),
  objective: $('objective-value'), distance: $('distance-value'), missionBtn: $('mission-btn'), freeMode: $('free-mode'), parkingMode: $('parking-mode'),
  speed: $('speed-value'), gear: $('gear-value'), gearLabel: $('gear-label'), rpm: $('rpm-value'), rpmBar: $('rpm-bar'),
  steer: $('steer-value'), session: $('session-time'), bestPark: $('best-park'), driveStatus: $('drive-status'),
  cameraBtn: $('camera-btn'), pauseBtn: $('pause-btn'), pausedOverlay: $('paused-overlay'), resumeBtn: $('resume-btn'),
  toast: $('toast'), toastMessage: $('toast-message'), worldStatus: $('world-status')
};

let renderer, scene, camera, sun;
let playerRoot = null;
let activeVehicle = null;
let selectedCarIndex = 0;
let parkedVehicleRoots = [];
let staticColliders = [];
let targetMarker = null;
let activeTarget = null;
let targetIndex = 0;
let mode = 'free';
let paused = false;
let cameraMode = 0;
let velocity = 0;
let steeringInput = 0;
let steeringAngle = 0;
let engineRpm = 850;
let elapsedSession = 0;
let lastFrame = 0;
let toastTimeout;
let completedParks = 0;
let bestPark = null;
let collisionFlash = 0;
let targetComplete = false;
let worldReady = false;
const keys = new Set();
const clock = new THREE.Clock();
const cameraTarget = new THREE.Vector3();
const cameraDesired = new THREE.Vector3();
const tmpVec3 = new THREE.Vector3();
const clockStart = performance.now();

const TARGETS = [
  { x: 16.5, z: 20.0, yaw: 0, name: 'Bay A-15', label: 'STANDARD BAY' },
  { x: -19.5, z: 9.0, yaw: Math.PI, name: 'Bay B-03', label: 'REVERSE PARK' },
  { x: 13.5, z: -20.0, yaw: 0, name: 'Bay C-14', label: 'REVERSE PARK' },
  { x: -10.5, z: -9.0, yaw: Math.PI, name: 'Bay D-06', label: 'STANDARD BAY' },
  { x: 7.5, z: 20.0, yaw: 0, name: 'Bay A-12', label: 'STANDARD BAY' }
];

function disposeObjectTree(root) {
  if (!root) return;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    const list = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
    for (const mat of list) {
      materials.add(mat);
      for (const value of Object.values(mat)) if (value && value.isTexture) textures.add(value);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function wrapAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function typeName(type) { return BODY_LABELS[type] || type.toUpperCase(); }
function speedLimit(car) { return (car.topSpeed || 180) / 3.6; }
function styleMaterial(color, roughness = .42, metalness = .1, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }); }

function createNoiseTexture(base, speckle, amount = 6000, size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  let seed = 4751;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < amount; i++) {
    const a = Math.floor(13 + rand() * 30);
    ctx.fillStyle = `rgba(${speckle[0]},${speckle[1]},${speckle[2]},${rand() * .13})`;
    const s = rand() * 1.7 + .25;
    ctx.fillRect(rand() * size, rand() * size, s, s);
  }
  // Subtle broad mottling gives the surfaces a non-flat, game-ready finish.
  for (let i = 0; i < 160; i++) {
    const x = rand() * size, y = rand() * size, r = 3 + rand() * 25;
    ctx.fillStyle = `rgba(255,255,255,${rand() * .025})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeSkyTexture() {
  const c = document.createElement('canvas'); c.width = 1536; c.height = 768;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, '#36769a'); g.addColorStop(.38, '#75a8c2'); g.addColorStop(.70, '#b4c7c8'); g.addColorStop(1, '#e8d8bb');
  ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
  // Soft, hand-drawn cloud bands for a warmer open-world horizon.
  let seed = 2203; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 85; i++) {
    const x = rand() * c.width, y = c.height * (.32 + rand() * .34), w = 45 + rand() * 210, h = 8 + rand() * 27;
    ctx.save(); ctx.globalAlpha = .025 + rand() * .055; ctx.fillStyle = '#fff8e9'; ctx.shadowColor = '#fff8e9'; ctx.shadowBlur = 22 + rand() * 18;
    ctx.beginPath(); ctx.ellipse(x, y, w, h, (rand()-.5)*.18, 0, Math.PI*2); ctx.fill(); ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c); tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

function makeTextTexture(title, subtitle = '', width = 1024, height = 256) {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#071b26'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#143b43'; ctx.fillRect(0, 0, width, 13);
  ctx.fillStyle = '#5de6d0'; ctx.fillRect(0, height - 13, width, 13);
  ctx.fillStyle = '#effaf8'; ctx.font = '900 78px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(title.toUpperCase(), width / 2, height * .44);
  if (subtitle) { ctx.fillStyle = '#8eacb7'; ctx.font = '700 22px Arial, sans-serif'; ctx.fillText(subtitle.toUpperCase(), width / 2, height * .73); }
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

function addBox(parent, x, y, z, w, h, d, material, radius = 0) {
  let geometry;
  if (radius > 0 && w > radius * 2 && h > radius * 2 && d > radius * 2) {
    geometry = new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, h / 3, w / 3, d / 3));
  } else geometry = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addQuad(parent, points, material, offset = 0) {
  const vertices = [];
  for (const p of points) vertices.push(p[0], p[1], p[2] + offset);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material); mesh.material.side = THREE.DoubleSide; mesh.castShadow = false; mesh.receiveShadow = false; parent.add(mesh); return mesh;
}

function carDims(type) {
  const presets = {
    hatch: { length: 4.12, width: 1.79, roofY: 1.55, wheelRadius: .35, wheelbase: 2.56, cabinFront: .94, cabinRear: -.99, hoodZ: 1.31, hoodLen: 1.1, trunkZ: -1.42, trunkLen: .54 },
    sedan: { length: 4.68, width: 1.84, roofY: 1.57, wheelRadius: .36, wheelbase: 2.78, cabinFront: 1.02, cabinRear: -.91, hoodZ: 1.43, hoodLen: 1.36, trunkZ: -1.58, trunkLen: .92 },
    suv: { length: 4.78, width: 1.92, roofY: 1.84, wheelRadius: .39, wheelbase: 2.82, cabinFront: 1.16, cabinRear: -1.28, hoodZ: 1.48, hoodLen: 1.1, trunkZ: -1.56, trunkLen: .62 },
    van: { length: 5.24, width: 1.96, roofY: 2.06, wheelRadius: .38, wheelbase: 3.18, cabinFront: 1.75, cabinRear: -1.63, hoodZ: 1.9, hoodLen: .55, trunkZ: -2.05, trunkLen: .6 },
    pickup: { length: 5.24, width: 1.96, roofY: 1.72, wheelRadius: .4, wheelbase: 3.18, cabinFront: 1.02, cabinRear: -.57, hoodZ: 1.64, hoodLen: 1.22, trunkZ: -1.82, trunkLen: 1.4 },
    coupe: { length: 4.45, width: 1.9, roofY: 1.42, wheelRadius: .35, wheelbase: 2.62, cabinFront: .87, cabinRear: -.8, hoodZ: 1.35, hoodLen: 1.28, trunkZ: -1.42, trunkLen: .75 }
  };
  return { ...presets[type || 'sedan'] };
}

function makeWheel(parent, x, z, radius, wheelWidth, darkRubber, rimMat, brakeMat, isFront) {
  const pivot = new THREE.Group(); pivot.position.set(x, radius * 1.01, z); parent.add(pivot);
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, wheelWidth, 28, 1, false), darkRubber);
  tire.rotation.z = Math.PI / 2; tire.castShadow = true; tire.receiveShadow = true; pivot.add(tire);
  // Sidewall rings and a machined alloy face on each side.
  const faceR = radius * .66;
  const outerSide = x >= 0 ? 1 : -1;
  for (const side of [outerSide]) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(faceR, faceR, .035, 24, 1, false), rimMat);
    disc.rotation.z = Math.PI / 2; disc.position.x = side * (wheelWidth * .5 + .008); disc.castShadow = true; pivot.add(disc);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * .16, radius * .16, .044, 16), brakeMat);
    hub.rotation.z = Math.PI / 2; hub.position.x = side * (wheelWidth * .5 + .035); pivot.add(hub);
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(.035, .045, radius * .56), rimMat);
      spoke.position.set(side * (wheelWidth * .5 + .027), Math.sin(i * Math.PI * 2 / 5) * radius * .28, Math.cos(i * Math.PI * 2 / 5) * radius * .28);
      spoke.rotation.x = i * Math.PI * 2 / 5; spoke.castShadow = true; pivot.add(spoke);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(faceR * .93, .012, 6, 28), rimMat);
    ring.rotation.y = Math.PI / 2; ring.position.x = side * (wheelWidth * .5 + .029); pivot.add(ring);
  }
  // A small front wheel brake hint adds depth behind the open spokes.
  const rotor = new THREE.Mesh(new THREE.CylinderGeometry(radius * .53, radius * .53, .018, 24), styleMaterial(0x68767a, .48, .65));
  rotor.rotation.z = Math.PI / 2; rotor.position.x = outerSide * wheelWidth * .12; pivot.add(rotor);
  pivot.userData.isFront = isFront;
  return pivot;
}

function makeCar(car, staticDisplay = false) {
  const d = carDims(car.type);
  const root = new THREE.Group();
  root.userData.vehicle = car;
  const paint = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(car.paint || '#718a99'), roughness: .31, metalness: .34, clearcoat: .65, clearcoatRoughness: .22 });
  const lowerPaint = styleMaterial(new THREE.Color(car.paint || '#718a99').multiplyScalar(.76), .42, .22);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x152a36, roughness: .17, metalness: .28, transparent: true, opacity: .88, clearcoat: .8, side: THREE.DoubleSide });
  const rubber = styleMaterial(0x11171b, .88, .03);
  const rim = styleMaterial(0xaebdc2, .28, .84);
  const brake = styleMaterial(0x303a40, .45, .6);
  const black = styleMaterial(0x101a20, .4, .28);
  const trim = styleMaterial(0x8999a0, .32, .78);
  const headlight = new THREE.MeshStandardMaterial({ color: 0xdaf5ff, emissive: 0x86d8ee, emissiveIntensity: .7, roughness: .18, metalness: .1 });
  const taillight = new THREE.MeshStandardMaterial({ color: 0xe22f36, emissive: 0x9d101b, emissiveIntensity: .65, roughness: .28 });
  const frontZ = d.length / 2;
  const rearZ = -d.length / 2;

  // Lower shell, sculpted hood, trunk/tail and bumper layers.
  addBox(root, 0, .56, 0, d.width, .48, d.length * .93, paint, .14);
  addBox(root, 0, .69, .02, d.width * .96, .29, d.length * .82, paint, .16);
  addBox(root, 0, .82, d.hoodZ, d.width * .87, .17, d.hoodLen, paint, .1);
  if (car.type === 'sedan' || car.type === 'coupe') {
    addBox(root, 0, .79, d.trunkZ, d.width * .84, .15, d.trunkLen, paint, .07);
  }
  if (car.type === 'suv' || car.type === 'van') {
    addBox(root, 0, .76, d.trunkZ, d.width * .87, .22, d.trunkLen, paint, .1);
  }
  if (car.type === 'pickup') {
    addBox(root, 0, .66, -1.72, d.width * .72, .13, 1.25, black, .03);
    addBox(root, 0, .79, -1.72, d.width * .72, .08, 1.22, styleMaterial(0x333e42, .67, .13), .025);
    for (const side of [-1, 1]) {
      addBox(root, side * d.width * .39, .83, -1.68, .08, .21, 1.36, lowerPaint, .02);
      addBox(root, side * d.width * .39, .94, -1.68, .06, .025, 1.28, trim, .008);
    }
    addBox(root, 0, .87, -2.35, d.width * .77, .2, .07, paint, .025);
  }
  addBox(root, 0, .42, frontZ - .08, d.width * .91, .17, .28, lowerPaint, .05);
  addBox(root, 0, .42, rearZ + .07, d.width * .91, .17, .25, lowerPaint, .05);
  addBox(root, 0, .365, 0, d.width * .88, .09, d.length * .65, black, .04);
  // Lower splitter / diffuser and wheel-arch shadows.
  addBox(root, 0, .34, frontZ - .07, d.width * .78, .045, .21, black, .016);
  addBox(root, 0, .34, rearZ + .06, d.width * .77, .05, .18, black, .015);

  // Cabin as a sloped eight-vertex shell, with individually surfaced glass panels.
  const wb = d.width * (car.type === 'van' ? .45 : .43), wt = d.width * (car.type === 'van' ? .405 : .355);
  const y0 = .79, yr = d.roofY, zf = d.cabinFront, zr = d.cabinRear;
  const zft = zf - (car.type === 'van' ? .33 : .39), zrt = zr + (car.type === 'van' ? .18 : .29);
  const verts = [
    -wb,y0,zf, wb,y0,zf, -wb,y0,zr, wb,y0,zr,
    -wt,yr,zft, wt,yr,zft, -wt,yr,zrt, wt,yr,zrt
  ];
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex([0,1,5,0,5,4, 2,6,7,2,7,3, 0,4,6,0,6,2, 1,3,7,1,7,5, 4,5,7,4,7,6]); geo.computeVertexNormals();
  const shell = new THREE.Mesh(geo, paint); shell.castShadow = true; shell.receiveShadow = true; root.add(shell);
  // Windshield and rear glass panels.
  addQuad(root, [[-wb*.88,.94,zf-.035],[wb*.88,.94,zf-.035],[wt*.89,yr-.105,zft+.045],[-wt*.89,yr-.105,zft+.045]], glass);
  addQuad(root, [[-wb*.86,.94,zr+.035],[wb*.86,.94,zr+.035],[wt*.88,yr-.105,zrt-.04],[-wt*.88,yr-.105,zrt-.04]], glass);
  // Side windows: two panes with a clear B-pillar. Slightly proud of the shell to avoid z-fighting.
  for (const side of [-1, 1]) {
    const xb = side * (wb + .009), xt = side * (wt + .009);
    const split = lerp(zf - .14, zr + .1, car.type === 'van' ? .5 : .49);
    addQuad(root, [[xb,.94,zf-.13],[xb,.94,split-.05],[xt,yr-.14,zrt+.17],[xt,yr-.14,zft+.06]], glass);
    addQuad(root, [[xb,.94,split+.04],[xb,.94,zr+.13],[xt,yr-.14,zrt-.06],[xt,yr-.14,split-.12]], glass);
    // Beltline, window trim, handles and mirror housings.
    addBox(root, side * (d.width * .485), .77, .04, .025, .025, d.length * .57, trim, .006);
    addBox(root, side * (d.width * .485), .78, -.43, .025, .025, .11, trim, .005);
    const mirror = addBox(root, side * (d.width * .52), 1.03, zf - .24, .19, .12, .22, lowerPaint, .045);
    mirror.rotation.z = side * -.08;
    addBox(root, side * (d.width * .51), .51, 0, .035, .22, d.length * .49, black, .01);
  }
  // Roof cap and subtle panoramic panel.
  addBox(root, 0, yr + .005, (zft + zrt) / 2, d.width * (car.type === 'van' ? .78 : .69), .075, Math.max(.65, zft - zrt + .13), paint, .075);
  if (['sedan', 'suv', 'coupe'].includes(car.type)) {
    addBox(root, 0, yr + .047, (zft + zrt) / 2, d.width * .36, .014, Math.max(.42, (zft - zrt) * .42), styleMaterial(0x172b35, .22, .35), .025);
  }

  // Front grille, model-neutral badge, LED headlights, tail lights and plates.
  addBox(root, 0, .60, frontZ * .98, d.width * .42, .17, .035, black, .025);
  addBox(root, 0, .60, frontZ + .012, d.width * .35, .018, .012, trim, .004);
  const badge = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, .018, 16), trim);
  badge.rotation.z = Math.PI / 2; badge.position.set(0, .68, frontZ + .03); root.add(badge);
  for (const side of [-1, 1]) {
    const lamp = addBox(root, side * d.width * .32, .73, frontZ - .005, d.width * .21, .10, .035, headlight, .025);
    lamp.rotation.z = side * -.025;
    addBox(root, side * d.width * .34, .76, rearZ + .013, d.width * .16, .10, .035, taillight, .018);
    addBox(root, side * d.width * .36, .48, frontZ + .06, .12, .055, .035, styleMaterial(0xe5e7d7, .32, .3), .015);
    // Hood character lines and sculpted lower side sill.
    const crease = addBox(root, side * d.width * .29, .915, d.hoodZ, .018, .008, d.hoodLen * .73, styleMaterial(0x9caab0, .35, .35), .004);
    crease.rotation.x = .005;
    addBox(root, side * d.width * .475, .42, -.04, .055, .10, d.length * .51, black, .02);
  }
  addBox(root, 0, .58, frontZ + .02, .52, .10, .03, styleMaterial(0xe8ede9, .3, .28), .018);
  addBox(root, 0, .58, rearZ - .018, .52, .09, .03, styleMaterial(0xe3e8e6, .3, .28), .018);
  addBox(root, 0, .87, rearZ - .01, d.width * .62, .022, .035, lowerPaint, .01);
  // Door seams and handles add visual scale and make the body read more like a car.
  for (const side of [-1, 1]) {
    for (const z of [-.58, .50]) addBox(root, side * (d.width * .481), .66, z, .018, .19, .018, styleMaterial(0x3c4a50, .72, .18), .004);
    addBox(root, side * (d.width * .493), .78, -.34, .12, .025, .035, trim, .006);
    addBox(root, side * (d.width * .493), .78, .56, .11, .025, .035, trim, .006);
  }
  if (car.type === 'van') {
    addBox(root, 0, .86, -1.05, d.width * .87, .14, .62, paint, .035);
    addBox(root, 0, 1.00, -1.05, d.width * .81, .018, .54, glass, .015);
    addBox(root, d.width * .49, .98, -1.17, .02, .44, .02, lowerPaint, .006);
  }

  const wheels = [];
  const halfTrack = d.width * .49;
  const frontAxle = d.wheelbase * .5, rearAxle = -d.wheelbase * .5;
  for (const xSide of [-1, 1]) {
    wheels.push(makeWheel(root, xSide * halfTrack, frontAxle, d.wheelRadius, .25, rubber, rim, brake, true));
    wheels.push(makeWheel(root, xSide * halfTrack, rearAxle, d.wheelRadius, .25, rubber, rim, brake, false));
    // Dark wheel-arch lips to visually seat each wheel into the body.
    for (const z of [frontAxle, rearAxle]) {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(d.wheelRadius * 1.08, .035, 5, 24, Math.PI), black);
      arch.rotation.y = Math.PI / 2; arch.position.set(xSide * (d.width * .477), d.wheelRadius * 1.01, z); root.add(arch);
    }
  }
  // Front wipers, windshield top edge and subtle roof antenna.
  for (const side of [-1, 1]) {
    const wiper = addBox(root, side * .20, 1.005, zf - .1, .34, .018, .024, black, .005);
    wiper.rotation.y = side * .13;
  }
  addBox(root, 0, yr + .1, (zft + zrt) / 2, .035, .11, .06, black, .01);
  if (car.type === 'pickup') {
    addBox(root, 0, .94, -1.1, d.width * .69, .08, .035, paint, .015);
  }

  root.userData.wheels = wheels;
  root.userData.dims = d;
  root.userData.paint = paint;
  root.userData.staticDisplay = staticDisplay;
  if (staticDisplay) root.traverse(node => { if (node.isMesh) { node.castShadow = false; node.receiveShadow = false; } });
  return root;
}

function makeGround() {
  const grassTex = createNoiseTexture('#6b8057', [28, 51, 22], 7500, 512);
  grassTex.repeat.set(30, 30);
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, color: 0xb9c7a5, roughness: 1 });
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), grassMat); grass.rotation.x = -Math.PI / 2; grass.position.y = -.13; grass.receiveShadow = true; scene.add(grass);
  const asphaltTex = createNoiseTexture('#343d42', [190, 202, 204], 10000, 512); asphaltTex.repeat.set(14, 11);
  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex, color: 0xd4d9d7, roughness: .94, metalness: .02 });
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(108, 84), asphalt); lot.rotation.x = -Math.PI / 2; lot.position.y = -.025; lot.receiveShadow = true; scene.add(lot);
  // Neat pale concrete apron and curb strips.
  const curbMat = styleMaterial(0x9ca7a8, .8, .02);
  addBox(scene, 0, .03, -42.35, 108, .13, .3, curbMat);
  addBox(scene, 0, .03, 42.35, 108, .13, .3, curbMat);
  addBox(scene, -54, .03, 0, .3, .13, 84, curbMat);
  addBox(scene, 54, .03, 0, .3, .13, 84, curbMat);
  // Access road loop around the compound.
  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, color: 0xc7cecf, roughness: .91 });
  const road1 = new THREE.Mesh(new THREE.PlaneGeometry(145, 9), roadMat); road1.rotation.x = -Math.PI / 2; road1.position.set(0, -.018, -49); road1.receiveShadow = true; scene.add(road1);
  const road2 = new THREE.Mesh(new THREE.PlaneGeometry(145, 9), roadMat); road2.rotation.x = -Math.PI / 2; road2.position.set(0, -.018, 49); road2.receiveShadow = true; scene.add(road2);
  const road3 = new THREE.Mesh(new THREE.PlaneGeometry(9, 98), roadMat); road3.rotation.x = -Math.PI / 2; road3.position.set(-60, -.017, 0); road3.receiveShadow = true; scene.add(road3);
  const road4 = new THREE.Mesh(new THREE.PlaneGeometry(9, 98), roadMat); road4.rotation.x = -Math.PI / 2; road4.position.set(60, -.017, 0); road4.receiveShadow = true; scene.add(road4);
  const roadLine = styleMaterial(0xe4e1cf, .86, .02);
  for (let x = -68; x <= 68; x += 7) {
    addBox(scene, x, .012, -49, 3.2, .01, .07, roadLine);
    addBox(scene, x, .012, 49, 3.2, .01, .07, roadLine);
  }
  // Painted lot bay layout: open at the aisle, closed by a thin back stop line.
  const paintWhite = styleMaterial(0xe2e6e2, .76, .02);
  const rowZ = [-20, -9, 9, 20];
  for (const z of rowZ) {
    const back = z + (z > 0 ? -2.55 : 2.55);
    addBox(scene, 0, .009, back, 54, .012, .045, paintWhite);
    for (let x = -27; x <= 27.1; x += 3.0) {
      addBox(scene, x, .009, z, .042, .012, 5.15, paintWhite);
    }
  }
  // A central practice lane, stop line, arrows and pedestrian crossing.
  const yellow = styleMaterial(0xf4c65f, .72, .02);
  addBox(scene, -46, .01, 0, 4, .012, .08, yellow);
  addBox(scene, 46, .01, 0, 4, .012, .08, yellow);
  for (let i = -4; i <= 4; i++) addBox(scene, 43.2 + i * .45, .014, -2.1, .23, .012, 4.0, paintWhite);
  // Training islands and speed-calming strips.
  addBox(scene, -33, .045, 0, .7, .09, 9, styleMaterial(0xc8d0ca, .9, .02), .04);
  addBox(scene, 33, .045, 0, .7, .09, 9, styleMaterial(0xc8d0ca, .9, .02), .04);
  for (let i = 0; i < 5; i++) addBox(scene, -1.6 + i * .8, .035, 3.1, .27, .05, .55, styleMaterial(0xe8e6d9, .7, .04), .02);
  // Parking-target pad; the bright outline is switched between bays with the challenge.
  // Crosswalk bars.
  for (let i = 0; i < 8; i++) addBox(scene, -8.4 + i * 2.4, .012, 0, 1.15, .012, .5, paintWhite);
  addBox(scene, 0, .005, 31.3, 68, .01, .06, yellow);
}

function makeTargetMarker(target) {
  if (targetMarker) { scene.remove(targetMarker); disposeObjectTree(targetMarker); }
  targetMarker = new THREE.Group();
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x65ffe1, transparent: true, opacity: .96 });
  const glowSoft = new THREE.MeshBasicMaterial({ color: 0x20d9bd, transparent: true, opacity: .12, side: THREE.DoubleSide, depthWrite: false });
  const w = 2.8, l = 5.15, y = .03;
  const line = (x, z, width, depth) => { const m = new THREE.Mesh(new THREE.BoxGeometry(width, .022, depth), glowMat); m.position.set(x, y, z); targetMarker.add(m); };
  line(target.x - w/2, target.z, .045, l); line(target.x + w/2, target.z, .045, l);
  line(target.x, target.z - l/2, w, .045); line(target.x, target.z + l/2, w, .045);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(w, l), glowSoft); pad.rotation.x = -Math.PI / 2; pad.position.set(target.x, .018, target.z); targetMarker.add(pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.55, .045, 7, 32), glowMat); ring.rotation.x = Math.PI / 2; ring.position.set(target.x, .07, target.z); targetMarker.add(ring);
  const postMat = styleMaterial(0x1a3b42, .45, .15);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(.04, .05, 1.45, 8), postMat); post.position.set(target.x, .73, target.z - l/2 + .25); targetMarker.add(post);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(.62, .52, .07), styleMaterial(0x0d2832, .36, .15)); sign.position.set(target.x, 1.35, target.z - l/2 + .25); targetMarker.add(sign);
  const pMat = new THREE.Mesh(new THREE.PlaneGeometry(.32, .32), new THREE.MeshBasicMaterial({ map: makeTextTexture('P', target.name, 256, 160), transparent: false, side: THREE.DoubleSide }));
  // The world-text plane has its own texture; face it toward the driver's approach.
  pMat.rotation.y = 0; pMat.position.set(target.x, 1.35, target.z - l/2 + .205); targetMarker.add(pMat);
  targetMarker.userData.ring = ring;
  scene.add(targetMarker);
}

function addRoadArrow(x, z, yaw = 0) {
  const arrowMat = styleMaterial(0xe1e6e1, .75, .01);
  const arrow = new THREE.Group(); arrow.position.set(x, .012, z); arrow.rotation.y = yaw; scene.add(arrow);
  addBox(arrow, 0, 0, -.15, .14, .01, .9, arrowMat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(.38, .6, 3), arrowMat); head.rotation.x = Math.PI / 2; head.position.z = .42; head.scale.set(1, 1, 1); arrow.add(head);
}

function makeBuilding(x, z, width, height, depth, color, label, facing = 1) {
  const group = new THREE.Group(); group.position.set(x, 0, z); scene.add(group);
  const wall = styleMaterial(color, .86, .02); const roof = styleMaterial(0x404f55, .77, .07);
  addBox(group, 0, height/2, 0, width, height, depth, wall, .06);
  addBox(group, 0, height + .12, 0, width + .45, .24, depth + .45, roof, .045);
  const glass = new THREE.MeshStandardMaterial({ color: 0x274e5a, roughness: .26, metalness: .25, emissive: 0x0b2229, emissiveIntensity: .15 });
  const frontZ = facing > 0 ? depth/2 + .018 : -depth/2 - .018;
  const columns = Math.max(2, Math.floor(width / 2.5));
  for (let i = 0; i < columns; i++) {
    const wx = -width/2 + width * (i + .5) / columns;
    addBox(group, wx, height * .62, frontZ, Math.min(1.35, width/columns * .68), height * .3, .045, glass, .025);
    addBox(group, wx, height * .25, frontZ, Math.min(1.35, width/columns * .68), .065, .05, styleMaterial(0x273941, .72, .05));
  }
  addBox(group, 0, .95, frontZ + (facing > 0 ? .035 : -.035), Math.min(2.1, width*.22), 1.9, .12, styleMaterial(0x263940, .68, .04), .04);
  if (label) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(width*.75, 10), Math.min(2.1, height*.3)), new THREE.MeshBasicMaterial({ map: makeTextTexture(label, 'DRIVER TRAINING · EST 2024'), toneMapped: false }));
    board.position.set(0, Math.min(height - .75, height*.76), frontZ + (facing > 0 ? .045 : -.045)); if (facing < 0) board.rotation.y = Math.PI; group.add(board);
  }
  return group;
}

function addTree(x, z, scale = 1) {
  const trunk = styleMaterial(0x5d4939, .95, .01); const leaves = [0x52764c,0x668455,0x7b925c].map(c => styleMaterial(c, .92, 0));
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(scale); scene.add(g);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.18, .25, 1.45, 7), trunk); stem.position.y = .72; stem.castShadow = true; g.add(stem);
  for (let i = 0; i < 3; i++) { const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(.95 - i*.08, 1), leaves[i]); crown.position.set((i-1)*.32, 1.65 + i*.39, (i%2 ? .16 : -.14)); crown.scale.set(1,1.02,1); crown.castShadow = true; g.add(crown); }
  return g;
}

function addStreetLamp(x, z) {
  const metal = styleMaterial(0x26353b, .45, .68); const lamp = new THREE.Group(); lamp.position.set(x, 0, z); scene.add(lamp);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.055, .09, 5.6, 8), metal); pole.position.y = 2.8; pole.castShadow = true; lamp.add(pole);
  const arm = addBox(lamp, .58, 5.35, 0, 1.25, .075, .09, metal, .025); arm.rotation.z = -.04;
  const light = new THREE.Mesh(new THREE.BoxGeometry(.55,.12,.26), new THREE.MeshStandardMaterial({ color: 0xd9e6cd, emissive: 0xffe0a6, emissiveIntensity: .6, roughness: .25 })); light.position.set(1.0,5.27,0); lamp.add(light);
}

function addCone(x, z, scale = 1) {
  const orange = styleMaterial(0xf27a36, .57, .01), white = styleMaterial(0xf5f0db, .5, .03), base = styleMaterial(0x242f34, .7, .05);
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(scale); scene.add(g);
  addBox(g, 0, .045, 0, .44, .09, .44, base, .04);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(.035, .18, .58, 12), orange); cone.position.y = .38; cone.castShadow = true; g.add(cone);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(.074,.106,.09,12), white); stripe.position.y = .42; g.add(stripe);
  staticColliders.push({ x, z, radius: .42 * scale, kind: 'cone' });
}

function createWorld() {
  scene = new THREE.Scene();
  scene.background = makeSkyTexture();
  scene.fog = new THREE.FogExp2(0xb4c6c8, .0032);
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, .1, 900);
  camera.position.set(0, 6, -10);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.17;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const hemi = new THREE.HemisphereLight(0xe4f5ff, 0x56634b, 2.0); scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffefcf, 3.1); sun.position.set(-34, 52, -19); sun.castShadow = true;
  const shadowResolution = window.innerWidth < 700 ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowResolution, shadowResolution); sun.shadow.camera.left = -72; sun.shadow.camera.right = 72; sun.shadow.camera.top = 72; sun.shadow.camera.bottom = -72; sun.shadow.camera.near = 1; sun.shadow.camera.far = 150; sun.shadow.bias = -.00035; sun.shadow.normalBias = .035; scene.add(sun);
  const fill = new THREE.DirectionalLight(0x82b7cc, .65); fill.position.set(45, 20, 26); scene.add(fill);
  makeGround();

  // A South African-feeling outer training compound and low urban/suburban silhouettes.
  makeBuilding(-49, -7, 14, 5.5, 32, 0xc2c2b2, 'APEX DRIVE SA', 1);
  makeBuilding(50, 14, 12, 4.6, 18, 0xd2cfc3, 'WORKSHOP', -1);
  makeBuilding(-45, 38, 9, 3.5, 8, 0xb3b7b0, '', 1);
  makeBuilding(47, -36, 11, 4.0, 10, 0xc6c7bb, '', -1);
  makeBuilding(-71, -25, 15, 7.5, 17, 0x9fa9a7, '', 1);
  makeBuilding(73, 29, 15, 6.7, 15, 0xb8b6a7, '', -1);
  // Low boundary walls, fencing sections and gate posts.
  const wallMat = styleMaterial(0x8d9a94, .92, .01), fenceMat = styleMaterial(0x455b60, .78, .2);
  for (let x = -40; x <= 40; x += 2) {
    if (Math.abs(x) < 8) continue;
    const post = new THREE.Mesh(new THREE.BoxGeometry(.07, 1.1, .07), fenceMat); post.position.set(x, .55, 42.6); post.castShadow = true; scene.add(post);
  }
  addBox(scene, -22, .43, 42.6, 31, .055, .055, wallMat); addBox(scene, 22, .43, 42.6, 31, .055, .055, wallMat);
  addBox(scene, -41.5, .35, 0, .5, .7, 64, wallMat, .04); addBox(scene, 41.5, .35, 0, .5, .7, 64, wallMat, .04);
  // Trees and lamps outside the traffic lines.
  for (const p of [[-40,-34,1.0],[-40,-20,.85],[-40,16,.95],[-41,31,.9],[39,-32,.95],[40,-16,.8],[40,20,1.0],[40,33,.95],[-29,45,.9],[25,46,.88]]) addTree(...p);
  for (const p of [[-36,-35],[-36,35],[36,-35],[36,35],[-6,-37],[19,-37],[-6,37],[19,37]]) addStreetLamp(...p);
  // Utility poles and overhead cable make the skyline feel lived-in without blocking play space.
  const poleMat = styleMaterial(0x6b6454, .9, .02);
  for (const x of [-67, 67]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.07,.11,7,8), poleMat); pole.position.set(x,3.5,0); pole.castShadow = true; scene.add(pole);
    for (const z of [-22,0,22]) { const ins = new THREE.Mesh(new THREE.BoxGeometry(.7,.07,.07),poleMat); ins.position.set(x,6.3,z); scene.add(ins); }
  }
  // Arrows, parking bumps and training cones.
  addRoadArrow(0, -2.2, 0); addRoadArrow(25, 0, Math.PI/2); addRoadArrow(-25, 0, -Math.PI/2);
  for (const x of [-29,-26,-23,23,26,29]) addCone(x, 3.9, .85);
  for (const x of [-18,-14,-10,10,14,18]) addCone(x, -31, .8);
  // Decorative parked vehicles: these are scene dressing, not part of the selectable 100-car list.
  const parkedSlots = [
    { i: 14, x: -22.5, z: -20, yaw: Math.PI }, { i: 18, x: -13.5, z: 20, yaw: 0 },
    { i: 32, x: 22.5, z: -9, yaw: Math.PI }, { i: 42, x: 28.5, z: 20, yaw: 0 },
    { i: 73, x: -28.5, z: 9, yaw: Math.PI }, { i: 84, x: 19.5, z: 9, yaw: Math.PI },
    { i: 4, x: -25.5, z: 20, yaw: 0 }, { i: 35, x: 28.5, z: -20, yaw: Math.PI }
  ];
  for (const slot of parkedSlots) {
    const car = CAR_CATALOG[slot.i]; const root = makeCar(car, true); root.position.set(slot.x, 0, slot.z); root.rotation.y = slot.yaw; scene.add(root); parkedVehicleRoots.push(root);
    const dim = carDims(car.type); staticColliders.push({ x: slot.x, z: slot.z, radius: Math.max(dim.length, dim.width) * .56, kind: 'car' });
  }
  // Collision buffer around large buildings and yard boundaries.
  for (const c of [{x:-49,z:-7,r:9},{x:50,z:14,r:8},{x:-45,z:38,r:7},{x:47,z:-36,r:8}]) staticColliders.push({ ...c, kind:'building' });
  makeTargetMarker(TARGETS[0]);
}

function buildGarageFilters() {
  const brands = [...new Set(CAR_CATALOG.map(c => c.make))].sort((a,b)=>a.localeCompare(b));
  for (const brand of brands) {
    const option = document.createElement('option'); option.value = brand; option.textContent = brand; ui.brandFilter.appendChild(option);
  }
  renderGarageList();
}

function renderGarageList() {
  const query = ui.carSearch.value.trim().toLowerCase(); const brand = ui.brandFilter.value;
  const results = CAR_CATALOG.map((car, index) => ({ car, index })).filter(({car}) => {
    const text = `${car.make} ${car.model} ${car.year} ${car.type}`.toLowerCase();
    return (brand === 'all' || car.make === brand) && (!query || text.includes(query));
  });
  ui.visibleCount.textContent = `${results.length} MODEL${results.length === 1 ? '' : 'S'}`;
  ui.carList.innerHTML = '';
  if (!results.length) {
    const empty = document.createElement('div'); empty.style.cssText = 'padding:25px 12px;color:#7895a1;font-size:10px;text-align:center;line-height:1.7'; empty.textContent = 'No vehicles match that search. Try another model or manufacturer.'; ui.carList.appendChild(empty); return;
  }
  const frag = document.createDocumentFragment();
  for (const {car, index} of results) {
    const row = document.createElement('button'); row.className = `car-row${index === selectedCarIndex ? ' selected' : ''}`; row.type = 'button'; row.setAttribute('role','option'); row.setAttribute('aria-selected', String(index === selectedCarIndex));
    const swatch = document.createElement('span'); swatch.className='car-swatch'; swatch.style.setProperty('--paint', car.paint);
    const main = document.createElement('span'); main.className='car-row-main';
    const name = document.createElement('span'); name.className='car-row-name'; name.textContent = getCarLabel(car);
    const sub = document.createElement('span'); sub.className='car-row-sub'; sub.textContent = `${typeName(car.type)}  ·  ${car.drivetrain}`;
    const year = document.createElement('span'); year.className='car-row-year'; year.textContent=String(car.year);
    main.append(name,sub); row.append(swatch,main,year);
    row.addEventListener('click', () => { selectCar(index); }); frag.appendChild(row);
  }
  ui.carList.appendChild(frag);
}

function updateCarCard() {
  const car = CAR_CATALOG[selectedCarIndex];
  ui.selectedName.textContent = getCarLabel(car);
  ui.selectedYear.textContent = String(car.year);
  ui.selectedType.textContent = typeName(car.type);
  ui.selectedDrive.textContent = car.drivetrain;
  ui.selectedSpeed.textContent = String(car.topSpeed);
  ui.selectedPower.textContent = String(car.power);
  ui.selectedZero.textContent = car.zeroTo100;
}

function selectCar(index) {
  if (!CAR_CATALOG[index]) return;
  const previous = selectedCarIndex; selectedCarIndex = index;
  const oldPosition = playerRoot ? playerRoot.position.clone() : new THREE.Vector3(0,0,0);
  const oldYaw = playerRoot ? playerRoot.rotation.y : 0;
  if (playerRoot) { scene.remove(playerRoot); disposeObjectTree(playerRoot); }
  activeVehicle = makeCar(CAR_CATALOG[index]); playerRoot = activeVehicle;
  if (previous === index || !worldReady) { playerRoot.position.set(0,0,0); playerRoot.rotation.y = 0; }
  else { playerRoot.position.copy(oldPosition); playerRoot.rotation.y = oldYaw; }
  scene.add(playerRoot);
  velocity = 0; steeringInput = 0; steeringAngle = 0;
  updateCarCard(); renderGarageList();
  updateMissionUi();
  showToast(`${getCarLabel(CAR_CATALOG[index])} loaded into your garage`);
}

function selectTarget(index) {
  targetIndex = index % TARGETS.length;
  targetComplete = false;
  activeTarget = TARGETS[targetIndex];
  makeTargetMarker(activeTarget);
  updateMissionUi();
}

function startParkingTest() {
  mode = 'parking'; paused = false; ui.pausedOverlay.classList.remove('show');
  selectTarget(targetIndex);
  ui.modeTitle.textContent = 'PARKING TEST';
  ui.freeMode.classList.remove('active'); ui.parkingMode.classList.add('active');
  ui.missionState.innerHTML = '<span></span> IN PROGRESS';
  ui.missionState.style.color = 'var(--orange)'; ui.missionState.style.borderColor = 'rgba(255,159,88,.22)';
  ui.missionBtn.innerHTML = '<span>↻</span> RESET PARKING TEST';
  ui.objective.textContent = activeTarget.name.toUpperCase();
  showToast(`Parking test started — line up with ${activeTarget.name}`);
}

function setFreeMode() {
  mode = 'free';
  ui.modeTitle.textContent = 'FREE DRIVE'; ui.freeMode.classList.add('active'); ui.parkingMode.classList.remove('active');
  ui.missionState.innerHTML = '<span></span> READY'; ui.missionState.style.color = 'var(--cyan)'; ui.missionState.style.borderColor = 'rgba(99,234,211,.16)';
  ui.missionBtn.innerHTML = '<span>▶</span> START PARKING TEST';
  updateMissionUi(); showToast('Free roam enabled — enjoy the drive');
}

function updateMissionUi() {
  if (mode === 'parking' && activeTarget) {
    ui.missionName.textContent = `Park in ${activeTarget.name}`;
    ui.missionDesc.textContent = 'Enter the glowing bay, straighten the car and stop fully inside the lines.';
    ui.objective.textContent = activeTarget.name.toUpperCase();
  } else {
    ui.missionName.textContent = 'Explore the training grounds';
    ui.missionDesc.textContent = 'Take your car for a spin. Find your line, test the handling and make yourself at home.';
    ui.objective.textContent = 'OPEN WORLD';
  }
}

function resetCar() {
  if (!playerRoot) return;
  playerRoot.position.set(0,0,0); playerRoot.rotation.set(0,0,0);
  velocity = 0; steeringAngle = 0; steeringInput = 0;
  showToast('Vehicle reset to the start line');
}

function changeCamera() {
  cameraMode = (cameraMode + 1) % 3;
  const names = ['CHASE CAM', 'BONNET CAM', 'HIGH CAM'];
  ui.cameraBtn.title = `Change camera (C) — ${names[cameraMode]}`;
  showToast(`${names[cameraMode]} selected`);
}

function togglePause() {
  paused = !paused;
  ui.pausedOverlay.classList.toggle('show', paused);
  ui.pauseBtn.classList.toggle('active', paused);
  if (paused) { keys.clear(); showToast('Session paused'); }
}

function showToast(message, duration = 2400) {
  ui.toastMessage.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => ui.toast.classList.remove('show'), duration);
}

function getSteerFromKeys() {
  const left = keys.has('ArrowLeft') || keys.has('KeyA');
  const right = keys.has('ArrowRight') || keys.has('KeyD');
  return Number(right) - Number(left);
}

function isColliding(x, z) {
  // Player bumper clearance scales a little with the selected body type.
  const dim = playerRoot?.userData.dims || carDims('hatch');
  const playerRadius = Math.max(dim.length * .32, dim.width * .55);
  for (const c of staticColliders) {
    if (Math.hypot(x - c.x, z - c.z) < playerRadius + c.radius * .42) return c;
  }
  // The larger compound buildings are kept as soft blockers.
  if (Math.abs(x) > 61 || Math.abs(z) > 60) return { kind: 'boundary' };
  return null;
}

function doParkingCheck() {
  if (mode !== 'parking' || !activeTarget || !playerRoot || targetComplete) return;
  const dx = playerRoot.position.x - activeTarget.x, dz = playerRoot.position.z - activeTarget.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1.55 && Math.abs(velocity) < .7) {
    const a = Math.abs(wrapAngle(playerRoot.rotation.y - activeTarget.yaw));
    const angleError = Math.min(a, Math.abs(Math.PI - a));
    if (angleError < .19) {
      targetComplete = true;
      completedParks++;
      const score = Math.max(65, Math.round(100 - dist * 8 - angleError * 30 - Math.abs(velocity) * 14));
      bestPark = Math.max(bestPark || 0, score); ui.bestPark.textContent = `${bestPark}%`;
      ui.missionState.innerHTML = '<span></span> COMPLETE'; ui.missionState.style.color = 'var(--cyan)';
      showToast(`PARKING COMPLETE · ${score}% precision · ${completedParks} cleared`, 3200);
      targetIndex = (targetIndex + 1) % TARGETS.length;
      setTimeout(() => { if (mode === 'parking' && !paused) { selectTarget(targetIndex); ui.missionState.innerHTML = '<span></span> IN PROGRESS'; ui.missionState.style.color = 'var(--orange)'; } }, 2100);
    }
  }
}

function updateDrive(dt) {
  if (!playerRoot || paused) return;
  const car = CAR_CATALOG[selectedCarIndex]; const dim = playerRoot.userData.dims;
  const prevSpeed = velocity;
  steeringInput = getSteerFromKeys();
  const throttle = keys.has('KeyW') || keys.has('ArrowUp');
  const brake = keys.has('Space');
  const reverseOrBrake = keys.has('KeyS') || keys.has('ArrowDown');
  const maxForward = speedLimit(car);
  const maxReverse = 7.2;
  const accelerating = throttle && !reverseOrBrake;

  if (accelerating) velocity = Math.min(maxForward, velocity + (5.8 + car.power / 145) * dt);
  if (reverseOrBrake) {
    if (velocity > .8) velocity = Math.max(0, velocity - 10.5 * dt);
    else velocity = Math.max(-maxReverse, velocity - 3.5 * dt);
  }
  if (brake) velocity = Math.abs(velocity) < 1.1 ? 0 : velocity * Math.exp(-7.8 * dt);
  if (!accelerating && !reverseOrBrake && !brake) velocity *= Math.exp(-.55 * dt);
  if (Math.abs(velocity) < .035) velocity = 0;

  const speedFactor = clamp(Math.abs(velocity) / 2.6, .12, 1.0);
  const targetSteer = steeringInput * .55;
  steeringAngle = lerp(steeringAngle, targetSteer, 1 - Math.exp(-6.5 * dt));
  const steerAuthority = clamp(Math.abs(velocity) / 6, .16, 1.0);
  const yawRate = (Math.sin(steeringAngle) * Math.abs(velocity) / Math.max(2.2, dim.wheelbase)) * (velocity >= 0 ? 1 : -1);
  playerRoot.rotation.y += yawRate * dt * steerAuthority;

  const yaw = playerRoot.rotation.y;
  const nx = playerRoot.position.x + Math.sin(yaw) * velocity * dt;
  const nz = playerRoot.position.z + Math.cos(yaw) * velocity * dt;
  const collision = isColliding(nx, nz);
  if (collision) {
    velocity *= -.10;
    collisionFlash = .4;
    if (Math.abs(prevSpeed) > 1.3) showToast(collision.kind === 'boundary' ? 'Stay inside the training area' : 'Careful — obstacle detected', 1250);
  } else {
    playerRoot.position.x = nx; playerRoot.position.z = nz;
  }
  // Keep a sensible driving envelope while leaving the outer roads open to explore.
  playerRoot.position.x = clamp(playerRoot.position.x, -60, 60);
  playerRoot.position.z = clamp(playerRoot.position.z, -58, 58);
  // Physical wheel spin and front-wheel steering animation.
  const spin = velocity * dt / Math.max(.2, dim.wheelRadius);
  for (const wheel of playerRoot.userData.wheels || []) {
    wheel.rotation.x += spin;
    if (wheel.userData.isFront) wheel.rotation.y = -steeringAngle * .55;
  }
  const targetRpm = velocity === 0 ? 850 : 1050 + Math.min(6400, Math.abs(velocity) * 320 + Math.abs(steeringInput) * 150);
  engineRpm = lerp(engineRpm, clamp(targetRpm, 800, 6900), 1 - Math.exp(-4 * dt));
  elapsedSession += dt;
  updateCamera(dt);
  doParkingCheck();
}

function updateCamera(dt) {
  if (!playerRoot) return;
  const d = playerRoot.userData.dims;
  if (cameraMode === 1) {
    playerRoot.localToWorld(cameraDesired.set(0, d.roofY * .79, d.length * .23));
    const forward = new THREE.Vector3(Math.sin(playerRoot.rotation.y), 0, Math.cos(playerRoot.rotation.y));
    camera.position.lerp(cameraDesired, 1 - Math.exp(-9 * dt));
    camera.rotation.order = 'YXZ';
    const look = cameraDesired.clone().addScaledVector(forward, 17); look.y -= .08;
    camera.lookAt(look); camera.fov = lerp(camera.fov, 75, 1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix();
  } else if (cameraMode === 2) {
    playerRoot.localToWorld(cameraDesired.set(0, 15.5, -13));
    camera.position.lerp(cameraDesired, 1 - Math.exp(-4 * dt));
    camera.lookAt(playerRoot.position.x, .3, playerRoot.position.z + 2);
    camera.fov = lerp(camera.fov, 58, 1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix();
  } else {
    playerRoot.localToWorld(cameraDesired.set(0, 4.7 + Math.min(2, Math.abs(velocity) * .025), -8.7 - Math.min(3, Math.abs(velocity) * .08)));
    camera.position.lerp(cameraDesired, 1 - Math.exp(-4.7 * dt));
    cameraTarget.set(playerRoot.position.x, .9, playerRoot.position.z).add(new THREE.Vector3(Math.sin(playerRoot.rotation.y) * 3.1, 0, Math.cos(playerRoot.rotation.y) * 3.1));
    camera.lookAt(cameraTarget);
    camera.fov = lerp(camera.fov, 62, 1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix();
  }
}

function updateHud(dt) {
  const kmh = Math.round(Math.abs(velocity) * 3.6);
  ui.speed.textContent = String(kmh);
  ui.gear.textContent = velocity > .4 ? (kmh > 95 ? '5' : kmh > 56 ? '4' : kmh > 31 ? '3' : kmh > 12 ? '2' : '1') : velocity < -.2 ? 'R' : 'N';
  ui.gearLabel.textContent = velocity < -.2 ? 'REVERSE' : velocity > .5 ? 'DRIVE' : keys.has('Space') ? 'BRAKING' : 'IDLE';
  ui.rpm.textContent = Math.round(engineRpm).toLocaleString('en-ZA');
  ui.rpmBar.style.width = `${clamp(engineRpm / 7200 * 100, 7, 100)}%`;
  ui.steer.textContent = `${Math.round(steeringAngle * 57.2958)}°`;
  const mins = Math.floor(elapsedSession / 60).toString().padStart(2, '0');
  const secs = Math.floor(elapsedSession % 60).toString().padStart(2, '0');
  ui.session.textContent = `${mins}:${secs}`;
  if (mode === 'parking' && activeTarget && playerRoot) ui.distance.textContent = `${Math.hypot(playerRoot.position.x-activeTarget.x, playerRoot.position.z-activeTarget.z).toFixed(1)} M`;
  else ui.distance.textContent = '—';
  ui.driveStatus.textContent = paused ? 'PAUSED' : 'ENGINE ON';
  if (targetMarker?.userData.ring) targetMarker.userData.ring.rotation.z += dt * 0.7;
  collisionFlash = Math.max(0, collisionFlash - dt);
}

function animate(now) {
  if (!worldReady) return;
  const dt = Math.min(.04, Math.max(.001, (now - lastFrame) / 1000 || .016)); lastFrame = now;
  updateDrive(dt);
  updateHud(dt);
  renderer.render(scene, camera);
}

function resize() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight, false); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.35 : 1.7));
}

function bindUi() {
  ui.carSearch.addEventListener('input', renderGarageList);
  ui.brandFilter.addEventListener('change', renderGarageList);
  ui.garageCollapse.addEventListener('click', () => { ui.garage.classList.add('collapsed'); ui.garageOpen.style.display = 'block'; });
  ui.garageOpen.addEventListener('click', () => { ui.garage.classList.remove('collapsed'); ui.garageOpen.style.display = 'none'; });
  ui.freeMode.addEventListener('click', setFreeMode);
  ui.parkingMode.addEventListener('click', () => { if (mode !== 'parking') startParkingTest(); else { targetIndex = (targetIndex + 1) % TARGETS.length; selectTarget(targetIndex); ui.missionState.innerHTML = '<span></span> IN PROGRESS'; ui.missionState.style.color = 'var(--orange)'; showToast(`New target selected — ${activeTarget.name}`); } });
  ui.missionBtn.addEventListener('click', () => { if (mode !== 'parking') startParkingTest(); else { selectTarget(targetIndex); resetCar(); showToast(`Test reset — park in ${activeTarget.name}`); } });
  ui.cameraBtn.addEventListener('click', changeCamera);
  ui.pauseBtn.addEventListener('click', togglePause);
  ui.resumeBtn.addEventListener('click', togglePause);
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', (event) => {
    const key = event.code;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(key)) event.preventDefault();
    if (key === 'KeyC' && !event.repeat) { changeCamera(); return; }
    if (key === 'KeyR' && !event.repeat) { resetCar(); return; }
    if (key === 'KeyP' && !event.repeat) { togglePause(); return; }
    if (key === 'Escape' && !event.repeat) { if (!ui.garage.classList.contains('collapsed')) { ui.garage.classList.add('collapsed'); ui.garageOpen.style.display='block'; } else if (paused) togglePause(); return; }
    keys.add(key);
  }, { passive: false });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());
  document.querySelectorAll('[data-hold]').forEach(button => {
    const key = button.dataset.hold;
    const down = (event) => { event.preventDefault(); keys.add(key); try { button.setPointerCapture(event.pointerId); } catch {} };
    const up = (event) => { event.preventDefault(); keys.delete(key); };
    button.addEventListener('pointerdown', down); button.addEventListener('pointerup', up); button.addEventListener('pointercancel', up); button.addEventListener('lostpointercapture', up); button.addEventListener('contextmenu', e=>e.preventDefault());
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });
}

async function boot() {
  try {
    ui.loadingProgress.style.width = '13%'; ui.loadingLabel.textContent = 'LOADING VEHICLE DATABASE...';
    if (CAR_CATALOG.length !== 100) console.warn(`Expected 100 cars, found ${CAR_CATALOG.length}`);
    ui.loadingProgress.style.width = '31%'; ui.loadingLabel.textContent = 'BUILDING THE TRAINING GROUNDS...';
    await new Promise(resolve => requestAnimationFrame(resolve));
    createWorld();
    ui.loadingProgress.style.width = '70%'; ui.loadingLabel.textContent = 'PREPARING YOUR VEHICLE...';
    await new Promise(resolve => requestAnimationFrame(resolve));
    activeVehicle = makeCar(CAR_CATALOG[selectedCarIndex]); playerRoot = activeVehicle; playerRoot.position.set(0, 0, 0); playerRoot.rotation.y = 0; scene.add(playerRoot);
    buildGarageFilters(); updateCarCard(); updateMissionUi();
    ui.loadingProgress.style.width = '94%'; ui.loadingLabel.textContent = 'STARTING ENGINE...';
    await new Promise(resolve => setTimeout(resolve, 250));
    worldReady = true; lastFrame = performance.now();
    renderer.setAnimationLoop(animate);
    ui.loadingProgress.style.width = '100%'; ui.worldStatus.textContent = 'WORLD ONLINE';
    requestAnimationFrame(() => ui.loading.classList.add('done'));
    showToast('Welcome to Apex Drive SA — W/A/S/D or arrows to drive', 3500);
  } catch (err) {
    console.error(err);
    ui.loadingLabel.textContent = 'COULD NOT START 3D WORLD';
    ui.loadingProgress.style.width = '100%';
    const detail = document.createElement('div'); detail.style.cssText='max-width:360px;color:#ffc0b0;font:11px/1.6 sans-serif;text-align:center;padding:0 15px'; detail.textContent='Your browser may not support WebGL. Try a recent version of Chrome, Safari or Edge, then refresh.'; ui.loading.appendChild(detail);
  }
}

bindUi();
boot();
