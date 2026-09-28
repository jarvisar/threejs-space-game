import * as THREE from 'three';
import { env } from '../render/materials.js';

const vert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const frag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uInner;
uniform float uOuter;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uOpacity;
uniform float uSeed;
uniform vec3 uSunPos;
uniform vec3 uPlanetPos;
uniform float uPlanetR;
uniform vec3 uSunColor;
varying vec3 vLocal;
varying vec3 vWorld;

float h1(float x) { return fract(sin(x * 127.1 + uSeed) * 43758.5453); }
float n1(float x) {
  float i = floor(x), f = fract(x);
  return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f));
}

void main() {
  #include <logdepthbuf_fragment>
  float r = length(vLocal.xy);
  float t = (r - uInner) / (uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  float bands = n1(t * 40.0) * 0.5 + n1(t * 110.0) * 0.3 + n1(t * 300.0) * 0.2;
  float gaps = smoothstep(0.25, 0.32, n1(t * 9.0 + 3.0));
  float edge = smoothstep(0.0, 0.04, t) * smoothstep(1.0, 0.9, t);
  float a = uOpacity * (0.25 + 0.75 * bands) * gaps * edge;
  vec3 col = mix(uColor, uColor2, n1(t * 23.0));

  // shadow of the planet on the ring
  vec3 l = normalize(uSunPos - vWorld);
  vec3 oc = vWorld - uPlanetPos;
  float b = dot(oc, l);
  float c = dot(oc, oc) - uPlanetR * uPlanetR;
  float shadow = (b < 0.0 && b * b - c > 0.0) ? 0.08 : 1.0;

  // rings look brighter back-lit because of forward scattering
  vec3 v = normalize(-vWorld);
  float fwd = pow(max(dot(-v, l), 0.0), 6.0);
  vec3 c2 = col * uSunColor * shadow * (0.55 + fwd * 1.8) + col * 0.02;
  gl_FragColor = vec4(c2, a);
}
`;

export function createRings(def, body) {
  const geo = new THREE.RingGeometry(def.inner, def.outer, 256, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uInner: { value: def.inner },
      uOuter: { value: def.outer },
      uColor: { value: new THREE.Color(def.color) },
      uColor2: { value: new THREE.Color(def.color2) },
      uOpacity: { value: def.opacity },
      uSeed: { value: def.seed },
      uSunPos: env.uSunPos,
      uPlanetPos: { value: body.group.position },
      uPlanetR: { value: body.radius },
      uSunColor: env.uSunColor,
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  // ring plane sits on the body's equator so the spin doesn't make it wobble,
  // the body's axial tilt gives the ring its angle
  mesh.rotation.set(Math.PI / 2, 0, 0);
  mesh.renderOrder = 1;
  return mesh;
}
