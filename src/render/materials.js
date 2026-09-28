import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise.glsl.js';

// Shared lighting environment. All scene positions are camera relative
// (floating origin), so uSunPos is the star position minus the camera.
export const env = {
  uSunPos: { value: new THREE.Vector3(1e6, 0, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uEnvCenter: { value: new THREE.Vector3(0, -1e7, 0) },
  uEnvRadius: { value: 1 },
  uEnvSky: { value: new THREE.Color(0, 0, 0) },
  uEnvGround: { value: new THREE.Color(0, 0, 0) },
  uEnvNight: { value: new THREE.Color(0.045, 0.055, 0.085) },
  uTime: { value: 0 },
  uWind: { value: 0.5 },
};

// Replaces Three's directional light direction with a per-fragment direction
// toward the star. One light then shades every planet correctly, even ones on
// the other side of the system, while its shadow map stays centered on the player.
function patchLightsChunk() {
  return THREE.ShaderChunk.lights_fragment_begin.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight ); directLight.direction = sunDirView; directLight.color *= sunVis;'
  );
}

// Bump from a procedural height in meters (Mikkelsen, unnormalized derivatives).
// Must be called in uniform control flow, derivatives inside a branch come back
// as garbage on D3D.
const BUMP_GLSL = /* glsl */ `
vec3 bumpNormal(vec3 surfPos, vec3 N, float H) {
  vec3 dpdx = dFdx(surfPos);
  vec3 dpdy = dFdy(surfPos);
  vec2 dH = vec2(dFdx(H), dFdy(H));
  vec3 r1 = cross(dpdy, N);
  vec3 r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  vec3 n = abs(det) * N - grad;
  float l = length(n);
  return l > 1e-24 ? n / l : N;
}
`;

// Adds the shared world position varying, star direction and planet ambient
// to a MeshStandardMaterial. opts.center is the uniform holding the planet
// center used for the ambient up vector.
export function patchStandard(material, opts = {}) {
  const center = opts.center || env.uEnvCenter;
  const radius = opts.radius || env.uEnvRadius;
  const extraUniforms = opts.uniforms || {};
  const key = opts.key || 'std';
  material.customProgramCacheKey = () => key;
  const extra = opts.extra;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunPos = env.uSunPos;
    shader.uniforms.uEnvSky = opts.sky || env.uEnvSky;
    shader.uniforms.uEnvGround = opts.ground || env.uEnvGround;
    shader.uniforms.uEnvNight = env.uEnvNight;
    shader.uniforms.uAmbCenter = center;
    shader.uniforms.uAmbRadius = radius;
    shader.uniforms.uTime = env.uTime;
    shader.uniforms.uWind = env.uWind;
    for (const [k, v] of Object.entries(extraUniforms)) shader.uniforms[k] = v;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldPosP;
        uniform float uTime;
        uniform float uWind;
        ${opts.vertexPars || ''}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        ${opts.vertexBegin || ''}`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        {
          vec4 wpP = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          wpP = instanceMatrix * wpP;
          #endif
          vWorldPosP = (modelMatrix * wpP).xyz;
        }
        ${opts.vertexEnd || ''}`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldPosP;
        uniform vec3 uSunPos;
        uniform vec3 uEnvSky;
        uniform vec3 uEnvGround;
        uniform vec3 uEnvNight;
        uniform vec3 uAmbCenter;
        uniform float uAmbRadius;
        uniform float uTime;
        ${opts.noise ? NOISE_GLSL : ''}
        ${BUMP_GLSL}
        ${opts.fragmentPars || ''}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        ${opts.color || ''}`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        ${opts.normal || ''}
        vec3 sunDirView = normalize((viewMatrix * vec4(uSunPos - vWorldPosP, 0.0)).xyz);
        // the planet itself blocks the sun, soft edge at the terminator
        float sunVis = 1.0;
        {
          vec3 oc = vWorldPosP - uAmbCenter;
          vec3 s = normalize(uSunPos - vWorldPosP);
          float tc = -dot(oc, s);
          if (tc > 0.0) sunVis = smoothstep(uAmbRadius * 0.985, uAmbRadius * 1.008, length(oc + s * tc));
        }`
      )
      .replace('#include <lights_fragment_begin>', patchLightsChunk())
      .replace(
        '#include <aomap_fragment>',
        `{
          vec3 upW = normalize(vWorldPosP - uAmbCenter);
          vec3 sunW = normalize(uSunPos - uAmbCenter);
          float day = smoothstep(-0.2, 0.3, dot(upW, sunW));
          vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float hemi = dot(nW, upW) * 0.5 + 0.5;
          vec3 amb = mix(uEnvGround, uEnvSky, hemi) * day + uEnvNight * (0.5 + 0.5 * hemi);
          reflectedLight.indirectDiffuse += amb * diffuseColor.rgb;
          reflectedLight.indirectSpecular += amb * 0.25 * (1.0 - roughnessFactor) ;
        }
        #include <aomap_fragment>
        ${opts.emissive || ''}`
      );
    if (extra) extra(shader);
  };
  return material;
}

// Terrain material. Coloring runs per fragment from height, moisture and slope
// so every planet can use the same program with different uniforms.
export function createTerrainMaterial(def, planetUniforms) {
  const pal = def.palette;
  const col = (hex) => ({ value: new THREE.Color(hex) });
  const snowLine = def.type === 'frozen' ? -40 : def.type === 'lush' || def.type === 'ocean' ? def.maxHeight * 0.62 : def.type === 'barren' || def.type === 'radioactive' ? def.maxHeight * 0.85 : 1e5;
  const polar = def.type === 'frozen' ? 0.0 : def.type === 'lush' || def.type === 'ocean' ? 0.14 : def.type === 'barren' ? 0.08 : 0.0;
  const vegAmount = { lush: 1, ocean: 1, toxic: 0.8, exotic: 0.8, radioactive: 0.45, desert: 0.2, frozen: 0.3, volcanic: 0.25, barren: 0.12, dead: 0 }[def.type] ?? 0.5;

  const uniforms = {
    uCenter: planetUniforms.center,
    uColSand: col(pal.sand),
    uColLow: col(pal.low),
    uColMid: col(pal.mid),
    uColHigh: col(pal.high),
    uColCliff: col(pal.cliff),
    uColPeak: col(pal.peak),
    uColVeg: col(pal.veg),
    uColVeg2: col(pal.veg2),
    uColDeep: col(pal.deep),
    uMaxH: { value: Math.max(60, def.maxHeight * 0.7) },
    uSnowLine: { value: snowLine },
    uPolar: { value: polar },
    uHasOcean: { value: def.ocean ? 1 : 0 },
    uVegAmount: { value: vegAmount },
    uSeed: { value: (def.seed % 1000) * 0.137 },
    uLava: { value: def.ocean && def.ocean.mode === 'lava' ? 1 : 0 },
    uScanPos: planetUniforms.scanPos,
    uScanRadius: planetUniforms.scanRadius,
    uRot: planetUniforms.rot,
  };

  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.0 });
  patchStandard(mat, {
    key: 'terrain',
    center: planetUniforms.center,
    radius: planetUniforms.radius,
    sky: planetUniforms.sky,
    ground: planetUniforms.ground,
    noise: true,
    uniforms,
    vertexPars: `attribute vec2 aData; varying vec2 vData; varying vec3 vGeoNormalW;`,
    vertexBegin: `vData = aData;`,
    vertexEnd: `vGeoNormalW = normalize(mat3(modelMatrix) * objectNormal);`,
    fragmentPars: /* glsl */ `
      varying vec2 vData;
      varying vec3 vGeoNormalW;
      uniform vec3 uCenter;
      uniform vec3 uColSand, uColLow, uColMid, uColHigh, uColCliff, uColPeak, uColVeg, uColVeg2, uColDeep;
      uniform float uMaxH, uSnowLine, uPolar, uHasOcean, uVegAmount, uSeed, uLava;
      uniform vec3 uScanPos;
      uniform float uScanRadius;
      uniform mat3 uRot;
      float gTerrainH;
      float gRough;
    `,
    color: /* glsl */ `
      {
        vec3 pw = vWorldPosP - uCenter;
        vec3 p = uRot * pw;
        vec3 up = normalize(p);
        float dist = length(vWorldPosP);
        float h = vData.x;
        float m = vData.y;
        float hn = h / uMaxH;
        float slope = 1.0 - dot(normalize(vGeoNormalW), normalize(pw));
        float n1 = snoise(p * 0.0035 + uSeed);
        float n2 = snoise(p * 0.028 + uSeed * 2.0);
        float nearF = 1.0 - smoothstep(25.0, 90.0, dist);
        float n3 = nearF > 0.0 ? fbm3(p * 0.3) * nearF : 0.0;
        float hj = hn + n1 * 0.07 + n2 * 0.03;

        vec3 c = mix(uColLow, uColMid, smoothstep(0.06, 0.34, hj));
        c = mix(c, uColHigh, smoothstep(0.38, 0.75, hj));

        // patchy vegetation so meadows aren't one flat color
        float midF = 1.0 - smoothstep(150.0, 900.0, dist);
        float vpatch = midF > 0.0 ? (snoise(p * 0.06 + uSeed * 3.0) * 0.6 + snoise(p * 0.21 - uSeed) * 0.4) * midF : 0.0;
        float veg = smoothstep(0.32, 0.72, m + n2 * 0.18 + vpatch * 0.15) * (1.0 - smoothstep(0.3, 0.62, hj)) * uVegAmount;
        vec3 vegCol = mix(uColVeg2, uColVeg, smoothstep(0.35, 0.85, m + n1 * 0.25));
        vegCol = mix(vegCol, uColVeg2, smoothstep(0.15, 0.7, vpatch) * 0.55);
        vegCol *= 0.82 + 0.3 * (vpatch * 0.5 + 0.5);
        veg *= 1.0 - (1.0 - smoothstep(-0.6, -0.25, vpatch)) * 0.7;
        c = mix(c, vegCol, veg * (1.0 - smoothstep(0.18, 0.32, slope)));

        float under = uHasOcean * (1.0 - smoothstep(-10.0, -0.5, h));
        c = mix(c, uColDeep, under);
        float beach = (1.0 - smoothstep(0.6, 2.6 + n2 * 1.6, h)) * step(-14.0, h) * uHasOcean * (1.0 - uLava);
        c = mix(c, uColSand, beach * (1.0 - smoothstep(0.35, 0.55, slope)));
        // scorched shoreline next to lava
        c = mix(c, uColCliff * 0.4, uLava * (1.0 - smoothstep(0.5, 4.0, h)));

        float cliff = smoothstep(0.26, 0.48, slope + n2 * 0.08);
        vec3 cliffCol = uColCliff * (0.8 + 0.4 * smoothstep(-0.6, 0.6, snoise(vec3(p.x, p.y * 6.0, p.z) * 0.05)));
        c = mix(c, cliffCol, cliff);

        float lat = abs(up.y);
        float snow = smoothstep(uSnowLine - 25.0, uSnowLine + 25.0, h + n1 * 40.0);
        snow += smoothstep(0.98 - uPolar, 1.03 - uPolar, lat + n1 * 0.04) * step(0.001, uPolar);
        snow = clamp(snow, 0.0, 1.0) * (1.0 - smoothstep(0.35, 0.6, slope));
        c = mix(c, uColPeak, snow);

        // close up: bare patches between the vegetation and a fine speckle
        float n4 = nearF > 0.0 ? snoise(p * 1.9) : 0.0;
        float bare = smoothstep(0.35, 0.75, n3 * 0.6 + n4 * 0.4) * veg * nearF;
        c = mix(c, uColLow * 0.8 + uColSand * 0.2, bare * 0.45);
        c *= 0.84 + 0.28 * (n3 * 0.5 + 0.5) * nearF + 0.09 * n4 * nearF + 0.16 * (1.0 - nearF);
        diffuseColor.rgb = c;
        gTerrainH = n3;
        gRough = mix(0.95, 0.55, snow);

        // scanner pulse ring, uScanPos is planet-fixed
        if (uScanRadius > 0.0) {
          float d = length(p - uScanPos);
          float ring = exp(-pow((d - uScanRadius) / 5.0, 2.0));
          float trail = (1.0 - smoothstep(0.0, uScanRadius, d)) * 0.04 * step(d, uScanRadius);
          diffuseColor.rgb += vec3(0.3, 0.9, 1.0) * (ring * 2.0 + trail) * (1.0 - smoothstep(800.0, 2500.0, uScanRadius));
        }
      }
    `,
    normal: /* glsl */ `
      {
        float dist = length(vWorldPosP);
        float fade = 1.0 - smoothstep(25.0, 90.0, dist);
        vec3 p = uRot * (vWorldPosP - uCenter);
        float sn = fade > 0.0 ? snoise(p * 1.7) : 0.0;
        float H = (gTerrainH * 0.12 + sn * 0.025) * fade;
        normal = bumpNormal(-vViewPosition, normal, H);
      }
    `,
  });
  // roughness from the snow mask
  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    prevCompile(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = gRough;');
  };
  return mat;
}
