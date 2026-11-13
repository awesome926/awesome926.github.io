/* Flower field — thousands of small white five-petal flowers (with dark leaves between them)
   growing on a dark rolling hill. Each flower is a quad whose shape is drawn in the fragment
   shader, so edges stay crisp at any resolution and there are no model files to load.
   Reads window.FIELD = { scroll, cta, active } written by the page:
   scroll 0..1 — flowers lift off and scatter upwards (hero scrolled away)
   cta    0..1 — camera eases into the final-screen view
   active bool — render loop runs only while the field is on screen */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const F = window.FIELD = Object.assign({ scroll: 0, cta: 0, active: true }, window.FIELD || {});
const canvas = document.getElementById('field');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = matchMedia('(pointer: coarse)').matches;
const WEAK = COARSE || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory && navigator.deviceMemory <= 4);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  document.documentElement.classList.add('no-gl');
  throw e;
}
renderer.setClearColor(0x000000, 0);
let dpr = Math.min(devicePixelRatio || 1, WEAK ? 1.5 : 2);
renderer.setPixelRatio(dpr);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(44, innerWidth / innerHeight, 0.1, 90);

/* ---------- shared terrain: a rolling hill that rises to the right and breathes slowly ---------- */
const TERRAIN = /* glsl */`
  float hill(vec2 p, float t){
    return .55 * sin(p.x * .14 - p.y * .05 + .6) + p.x * .075
         + .32 * sin(p.y * .21 + p.x * .06 + t * .35)
         + .12 * sin(p.x * .5 + p.y * .37 - t * .6);
  }`;

/* ---------- instances ---------- */
const quad = new THREE.PlaneGeometry(1, 1);
const geo = new THREE.InstancedBufferGeometry();
geo.index = quad.index;
geo.setAttribute('position', quad.getAttribute('position'));
geo.setAttribute('uv', quad.getAttribute('uv'));

const PASTEL = [[1, .80, .90], [.82, .80, 1], [.78, .95, 1], [1, .90, .80], [.85, 1, .92]];
let FLOWERS = WEAK ? 6500 : 14000, LEAVES = WEAK ? 700 : 1600;
let total = FLOWERS + LEAVES;

function seed(aspect) {
  const off = new Float32Array(total * 3), rnd = new Float32Array(total * 4), col = new Float32Array(total * 3);
  const tanH = Math.tan(THREE.MathUtils.degToRad(44 / 2)) * Math.max(aspect, .6) * 1.2;
  const zNear = 8, zFar = -46;
  for (let i = 0; i < total; i++) {
    const leaf = i >= FLOWERS;
    const u = Math.random();
    const z = zNear + (zFar - zNear) * Math.pow(u, leaf ? 1.6 : .9);
    const half = (10 - z) * tanH + 2;
    off[i * 3] = (Math.random() * 2 - 1) * half;
    off[i * 3 + 1] = z;
    off[i * 3 + 2] = leaf ? 1 : 0;
    rnd[i * 4] = Math.random() * Math.PI * 2;                     // in-plane rotation
    rnd[i * 4 + 1] = leaf ? .2 + Math.random() * .22 : .1 + Math.pow(Math.random(), 1.9) * .22; // size
    rnd[i * 4 + 2] = Math.random();                               // tilt (how much it lies down)
    rnd[i * 4 + 3] = Math.random();                               // misc random
    const tint = Math.random() < .35 ? PASTEL[Math.floor(Math.random() * PASTEL.length)] : [1, 1, 1];
    col[i * 3] = tint[0]; col[i * 3 + 1] = tint[1]; col[i * 3 + 2] = tint[2];
  }
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
  geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4));
  geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
  geo.instanceCount = total;
}

const uniforms = {
  uT: { value: 0 }, uGrow: { value: REDUCED ? 1 : 0 }, uScroll: { value: 0 }, uDim: { value: 0 }, uBeat: { value: 0 },
  uMouse: { value: new THREE.Vector2(0, 99) }, uMouseOn: { value: 0 },
  uBg: { value: new THREE.Vector3(5 / 255, 5 / 255, 6 / 255) }, uPx: { value: 1 }
};

const material = new THREE.ShaderMaterial({
  uniforms,
  transparent: false,
  alphaToCoverage: true,
  side: THREE.DoubleSide,
  vertexShader: /* glsl */`
    attribute vec3 aOff; attribute vec4 aRnd; attribute vec3 aCol;
    uniform float uT, uGrow, uScroll, uMouseOn, uBeat; uniform vec2 uMouse;
    varying vec2 vUv; varying vec3 vCol; varying float vFog; varying float vLeaf; varying float vRnd; varying float vBright;
    ${TERRAIN}
    void main(){
      vec2 b = aOff.xy; float leaf = aOff.z;
      float r4 = aRnd.w;
      float y = hill(b, uT);
      // cursor: flowers part around it and hop up a little
      vec2 dm = b - uMouse; float d = length(dm);
      float f = uMouseOn * smoothstep(1.7, 0., d);
      b += (dm / max(d, 1e-3)) * f * .7;
      y += f * (.28 + r4 * .2) * (1. - leaf * .6);
      // growing in: nearer flowers first, each with its own delay
      float g = clamp(uGrow * 1.8 - r4 * .55 - clamp((8. - aOff.y) / 54., 0., 1.) * .45, 0., 1.);
      float grow = 1. - pow(1. - g, 3.);
      grow *= 1. + .18 * sin(g * 3.14159);
      // scroll: lift off, drift sideways, fade out by shrinking
      float k = clamp(uScroll * 1.4 - r4 * .4, 0., 1.);
      float e = k * k * (3. - 2. * k);
      y += e * (2. + r4 * 10.) * (1. - leaf * .5);
      b.x += e * (r4 - .5) * 4.;
      float size = aRnd.y * grow * (1. - smoothstep(.55, 1., k));
      // music: every bass hit makes the meadow breathe — flowers swell and hop, each a bit differently
      float bt = uBeat * (.45 + .55 * fract(r4 * 7.31)) * (1. - leaf * .7);
      size *= 1. + bt * .28;
      y += bt * .22;
      // place in view space as a card that faces the camera but lies down by a random amount
      vec4 c = modelViewMatrix * vec4(b.x, y + size * .35, b.y, 1.);
      float spin = aRnd.x + uT * (r4 - .5) * .15 + e * (r4 - .5) * 6. + f * (r4 - .5) * 3.;
      vec2 p = position.xy;
      p = mat2(cos(spin), sin(spin), -sin(spin), cos(spin)) * p;
      float lie = mix(.42, 1., aRnd.z) ;
      if (leaf > .5) { p.x *= .32; p = mat2(cos(aRnd.x), sin(aRnd.x), -sin(aRnd.x), cos(aRnd.x)) * p; lie = mix(.5, 1., aRnd.z); }
      p.y *= lie;
      // gentle sway
      p.x += sin(uT * 1.2 + aRnd.x * 6.) * .03;
      c.xy += p * size;
      gl_Position = projectionMatrix * c;
      vUv = position.xy * 2.;
      vFog = smoothstep(10., 44., -c.z);
      vLeaf = leaf; vRnd = r4;
      vCol = aCol;
      // flowers caught by the cursor glint
      vBright = 1. + f * .35;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uBg; uniform float uDim, uT;
    varying vec2 vUv; varying vec3 vCol; varying float vFog; varying float vLeaf; varying float vRnd; varying float vBright;
    void main(){
      vec2 p = vUv;
      float r = length(p);
      float alpha; vec3 col;
      if (vLeaf > .5) {
        // slim pointed leaf
        float w = (1. - p.y * p.y) * .5;
        float dd = abs(p.x) - w;
        float aa = fwidth(dd) * 1.2;
        alpha = 1. - smoothstep(-aa, aa, dd);
        alpha *= step(abs(p.y), 1.);
        col = mix(vec3(.05, .13, .09), vec3(.09, .22, .15), vRnd) * (.7 + .3 * (1. - abs(p.x) / max(w, .01)));
      } else {
        // five rounded petals with a soft tip
        float a = atan(p.y, p.x);
        float pet = abs(cos(2.5 * a));
        float R = .34 + .64 * pow(pet, 1.35);
        float dd = r - R;
        float aa = fwidth(dd) * 1.1;
        alpha = 1. - smoothstep(-aa, aa, dd);
        // pearly white: tint creeps in from the petal edges, a soft shade near the middle
        float edge = smoothstep(.15, 1., r / R);
        vec3 pearl = mix(vec3(1.), vCol, .55 + .25 * sin(a * 2. + vRnd * 6.28 + uT * .4));
        col = mix(vec3(.96, .96, .98), pearl, edge * .8);
        col *= .82 + .18 * smoothstep(.0, .35, r);
        // tiny centre
        col = mix(col, vec3(1., .93, .78), 1. - smoothstep(.07, .15, r));
        col *= vBright;
      }
      col = mix(col, uBg, clamp(vFog * (vLeaf > .5 ? 1. : .92), 0., 1.));
      col = mix(col, uBg, uDim);
      gl_FragColor = vec4(col, alpha);
    }`
});
const mesh = new THREE.Mesh(geo, material);
mesh.frustumCulled = false;
scene.add(mesh);

/* ---------- faint stars above the horizon ---------- */
{
  const n = WEAK ? 220 : 420, pos = new Float32Array(n * 3), tw = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() * 2 - 1) * 70; pos[i * 3 + 1] = 4 + Math.random() * 26; pos[i * 3 + 2] = -50 - Math.random() * 10; tw[i] = Math.random() * 6.28; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aTw', new THREE.BufferAttribute(tw, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uT: uniforms.uT, uPx: uniforms.uPx, uDim: uniforms.uDim, uScroll: uniforms.uScroll }, transparent: true, depthWrite: false,
    vertexShader: `attribute float aTw; uniform float uT, uPx; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; vA = .35 + .65 * (.5 + .5 * sin(uT * 1.3 + aTw * 7.)); gl_PointSize = (1.2 + fract(aTw * 3.) * 1.6) * uPx; }`,
    fragmentShader: `uniform float uDim; varying float vA; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .0, d) * vA * .55 * (1. - uDim); gl_FragColor = vec4(vec3(1.), a); }`
  });
  scene.add(new THREE.Points(g, m));
}

/* ---------- camera rig ---------- */
const look = new THREE.Vector3();
function placeCamera(cta) {
  const portrait = camera.aspect < .85;
  camera.position.set(0, THREE.MathUtils.lerp(portrait ? 3.0 : 2.7, 3.6, cta), THREE.MathUtils.lerp(9.5, 9.5, cta));
  look.set(0, THREE.MathUtils.lerp(portrait ? 1.3 : 1.05, 0.2, cta), -10);
  camera.lookAt(look);
}

let lastAspect = 0;
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  uniforms.uPx.value = renderer.getPixelRatio();
  if (Math.abs(camera.aspect - lastAspect) > .25) { lastAspect = camera.aspect; seed(camera.aspect); }
}
resize();
let rT; addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(resize, 120); });

/* ---------- pointer → point on the hill (plane approximation) ---------- */
const ndc = new THREE.Vector2(), ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.3), hit = new THREE.Vector3();
const mouseTarget = new THREE.Vector2(0, 99); let lastMove = 0, hasPointer = false;
function pointer(e) { ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); hasPointer = true; lastMove = performance.now(); }
addEventListener('pointermove', pointer, { passive: true });
addEventListener('pointerdown', pointer, { passive: true });
document.addEventListener('pointerleave', () => { hasPointer = false; });

/* ---------- loop + FPS governor ---------- */
let t0 = performance.now(), simT = 0, slow = 0, frames = 0, acc = 0, scrollS = F.scroll, ctaS = F.cta, mouseOn = 0, growT = 0, beatS = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - t0) / 1000, .05); t0 = now;
  if (!F.active || document.hidden) return;
  if (!REDUCED) { simT += dt; growT = Math.min(1, growT + dt / 3.2); uniforms.uGrow.value = growT; }
  scrollS += (F.scroll - scrollS) * Math.min(1, dt * 8);
  ctaS += (F.cta - ctaS) * Math.min(1, dt * 6);
  placeCamera(ctaS);
  camera.updateMatrixWorld();
  if (hasPointer && ray) { ray.setFromCamera(ndc, camera); if (ray.ray.intersectPlane(ground, hit)) mouseTarget.set(hit.x, hit.z); }
  const want = hasPointer && now - lastMove < 2600 && !REDUCED ? 1 : 0;
  mouseOn += (want - mouseOn) * Math.min(1, dt * (want ? 6 : 1.5));
  uniforms.uMouse.value.lerp(mouseTarget, Math.min(1, dt * 9));
  uniforms.uMouseOn.value = mouseOn;
  uniforms.uT.value = simT;
  uniforms.uScroll.value = scrollS;
  beatS += ((F.beat || 0) - beatS) * Math.min(1, dt * ((F.beat || 0) > beatS ? 30 : 7));
  uniforms.uBeat.value = REDUCED ? 0 : beatS;
  uniforms.uDim.value = ctaS * .5;
  renderer.render(scene, camera);
  acc += dt; frames++;
  if (acc > 2) {
    const fps = frames / acc; acc = 0; frames = 0;
    if (fps < 40 && ++slow >= 2) {
      slow = 0;
      if (dpr > 1.25) { dpr = Math.max(1, dpr - .5); renderer.setPixelRatio(dpr); resize(); }
      else if (geo.instanceCount > total * .5) { geo.instanceCount = Math.floor(geo.instanceCount * .7); }
    } else if (fps >= 40) slow = 0;
  }
}
requestAnimationFrame(frame);
document.documentElement.classList.add('gl-ready');
