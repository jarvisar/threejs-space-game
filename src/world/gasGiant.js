import * as THREE from 'three';
import { NOISE_GLSL } from '../render/shaders/noise.glsl.js';
import { env } from '../render/materials.js';
import { fillAtmoCommon } from './planet.js';
import { createRings } from './rings.js';
import { Body } from './body.js';

// Faceted like the rocky planets: every triangle carries its centroid, so
// band color and lighting are one value per face.
const vert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aCenter;
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vLocal = normalize(aCenter);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * vLocal);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const frag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uC0, uC1, uC2, uC3, uC4;
uniform vec3 uSunPos;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uBandScale;
uniform float uTurb;
uniform vec4 uStorm;
uniform float uSeed;
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vN;
${NOISE_GLSL}

// stepped bands with a short blend at each edge, faces pick one side or the other
vec3 bandColor(float t) {
  t = fract(t) * 5.0;
  float f = smoothstep(0.75, 1.0, fract(t));
  if (t < 1.0) return mix(uC0, uC1, f);
  if (t < 2.0) return mix(uC1, uC2, f);
  if (t < 3.0) return mix(uC2, uC3, f);
  if (t < 4.0) return mix(uC3, uC4, f);
  return mix(uC4, uC0, f);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 p = vLocal;
  float lat = p.y;
  // horizontal shear flow, alternating direction per band
  float flow = sin(lat * uBandScale * 1.3) * uTime * 0.004;
  float ca = cos(flow), sa = sin(flow);
  vec3 q = vec3(ca * p.x - sa * p.z, p.y, sa * p.x + ca * p.z);
  float w = fbm5(q * vec3(2.0, 7.0, 2.0) + uSeed) * uTurb;
  float w2 = snoise(q * vec3(6.0, 22.0, 6.0) + uSeed) * 0.15 * uTurb;
  float b = lat * uBandScale * 0.35 + w * 0.35 + w2;

  // storm eye
  vec3 sc = vec3(cos(uStorm.y) * sqrt(1.0 - uStorm.x * uStorm.x), uStorm.x, sin(uStorm.y) * sqrt(1.0 - uStorm.x * uStorm.x));
  float sd = distance(p, sc) / max(uStorm.z, 0.001);
  float storm = uStorm.w * (1.0 - smoothstep(0.4, 1.0, sd));
  b += storm * sin(sd * 12.0 - uTime * 0.05) * 0.2;

  vec3 col = bandColor(b);
  col = mix(col, uC3 * 1.2, storm * (1.0 - smoothstep(0.0, 0.5, sd)) * 0.6);

  vec3 n = normalize(vN);
  vec3 l = normalize(uSunPos - vWorld);
  vec3 v = normalize(-vWorld);
  float ndl = dot(n, l);
  float diff = smoothstep(-0.12, 0.6, ndl);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 c = col * uSunColor * diff * 1.0;
  c += col * 0.02;
  c += uC2 * rim * 0.4 * smoothstep(-0.2, 0.4, ndl);
  gl_FragColor = vec4(c, 1.0);
}
`;

function facetedSphere(radius, detail) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 3) {
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    for (let k = 0; k < 3; k++) c.set([x, y, z], (i + k) * 3);
  }
  g.setAttribute('aCenter', new THREE.BufferAttribute(c, 3));
  return g;
}

export class GasGiant extends Body {
  constructor(def) {
    super();
    this.initBody(def);
    this.maxH = 0;
    this.minH = 0;
    this.atmoRadius = def.radius + def.atmosphere.height;
    this.sunColor = env.uSunColor;
    const c = def.bands.map((h) => new THREE.Color(h));
    this.uniforms = {
      uC0: { value: c[0] }, uC1: { value: c[1] }, uC2: { value: c[2] }, uC3: { value: c[3] }, uC4: { value: c[4] },
      uSunPos: env.uSunPos,
      uSunColor: this.sunColor,
      uTime: env.uTime,
      uBandScale: { value: def.bandScale },
      uTurb: { value: def.turbulence },
      uStorm: { value: def.storm ? new THREE.Vector4(def.storm.lat, def.storm.lon, def.storm.size, 1) : new THREE.Vector4(0, 0, 0.1, 0) },
      uSeed: { value: (def.seed % 1000) * 0.1 },
    };
    const mesh = new THREE.Mesh(
      facetedSphere(this.radius, 44),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag })
    );
    this.group.add(mesh);
    if (def.rings) {
      this.rings = createRings(def.rings, this);
      this.group.add(this.rings);
    }
  }

  get hasAtmoPass() {
    return true;
  }

  update(camWorld) {
    this.toLocal(camWorld, this.camLocal);
    this.camDist = this.camLocal.length();
  }

  fillAtmoSlot(s) {
    fillAtmoCommon(this, s);
    s.solidR = this.radius * 0.99;
    s.ambient.setRGB(0.1, 0.1, 0.12);
  }

  floorRadius() {
    return this.radius + 40;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
