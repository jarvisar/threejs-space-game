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
  // bluish night fill, bright enough to find your way without the headlamp
  uEnvNight: { value: new THREE.Color(0.07, 0.085, 0.14) },
  uTime: { value: 0 },
  uWind: { value: 0.5 },
  uAmbK: { value: 1.55 },
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
    shader.uniforms.uAmbK = env.uAmbK;
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
        uniform float uAmbK;
        uniform float uTime;
        ${opts.noise ? NOISE_GLSL : ''}
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
          // bright sky fill so shadows keep the sky's color instead of going gray
          vec3 amb = mix(uEnvGround, uEnvSky, hemi) * day * uAmbK + uEnvNight * (0.5 + 0.5 * hemi);
          reflectedLight.indirectDiffuse += amb * diffuseColor.rgb;
          reflectedLight.indirectSpecular += amb * 0.25 * (1.0 - roughnessFactor);
          // soft sky colored rim, gives shapes a clean outline against the ground
          float rim = pow(1.0 - min(abs(dot(normal, normalize(vViewPosition))), 1.0), 4.0);
          reflectedLight.indirectSpecular += uEnvSky * rim * ${(opts.rim ?? 0.5).toFixed(2)} * day;
        }
        #include <aomap_fragment>
        ${opts.emissive || ''}`
      );
    if (extra) extra(shader);
  };
  return material;
}

// What the terrain's feature mask (third aData channel) means per planet
// type: the color it paints, how much, and how strongly it glows.
function terrainFeature(def) {
  const pal = def.palette;
  const c = (hex) => new THREE.Color(hex);
  switch (def.type) {
    case 'volcanic': return { col: c(pal.oceanShallow), mix: 0.95, glow: 2.4 };
    case 'radioactive': return { col: c(pal.glow), mix: 0.85, glow: 1.3 };
    case 'toxic': return { col: c(pal.oceanShallow), mix: 0.9, glow: 0.45 };
    case 'exotic': return { col: c(pal.glow), mix: 0.85, glow: 1.1 };
    // glassy blue ice sheets
    case 'frozen': return { col: c(pal.peak).lerp(c(pal.oceanDeep), 0.7), mix: 0.85, glow: 0 };
    // bright ejecta around fresh craters
    case 'barren':
    case 'dead': return { col: c(pal.peak).lerp(c('#ffffff'), 0.3), mix: 0.45, glow: 0 };
    default: return { col: c(pal.sand), mix: 0, glow: 0 };
  }
}

// Terrain material. Coloring runs from height, moisture, slope and the
// feature mask so every planet can use the same program with different uniforms.
export function createTerrainMaterial(def, planetUniforms) {
  const pal = def.palette;
  const col = (hex) => ({ value: new THREE.Color(hex) });
  const snowLine = def.type === 'frozen' ? def.maxHeight * 0.3 : def.type === 'lush' || def.type === 'ocean' ? def.maxHeight * 0.62 : def.type === 'barren' || def.type === 'radioactive' ? def.maxHeight * 0.85 : 1e5;
  const polar = def.type === 'frozen' ? 0.35 : def.type === 'lush' || def.type === 'ocean' ? 0.14 : def.type === 'barren' ? 0.08 : 0.0;
  const vegAmount = { lush: 1, ocean: 1, toxic: 0.8, exotic: 0.8, radioactive: 0.45, desert: 0.2, frozen: 0.3, volcanic: 0.25, barren: 0.12, dead: 0 }[def.type] ?? 0.5;
  const feat = terrainFeature(def);
  // arid and airless rock shows its layers more
  const strataK = { desert: 1, barren: 0.85, radioactive: 0.75, exotic: 0.8, volcanic: 0.6, dead: 0.35, frozen: 0.45 }[def.type] ?? 0.6;

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
    // thickness of the rock layers on cliffs, in meters
    uStrata: { value: def.type === 'desert' ? 4 + (def.seed % 4) : 5 + (def.seed % 7) },
    uStrataK: { value: strataK },
    uFeatCol: { value: feat.col },
    uFeatMix: { value: feat.mix },
    uFeatGlow: { value: feat.glow },
    uFeatRough: { value: def.type === 'frozen' ? 0.3 : 0.9 },
    uFacet: { value: 0.6 },
    uScanPos: planetUniforms.scanPos,
    uScanRadius: planetUniforms.scanRadius,
    uRot: planetUniforms.rot,
  };

  // Soft facets: the lighting normal is part smooth, part flat, so triangles
  // read gently, like sculpted clay. Color comes from smooth inputs, only a
  // faint value shift is per face (the flat varying, taken from the
  // triangle's first vertex).
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.0 });
  patchStandard(mat, {
    key: 'terrain',
    rim: 0.15,
    center: planetUniforms.center,
    radius: planetUniforms.radius,
    sky: planetUniforms.sky,
    ground: planetUniforms.ground,
    noise: true,
    uniforms,
    vertexPars: /* glsl */ `
      attribute vec3 aData;
      uniform vec3 uCenter;
      uniform mat3 uRot;
      varying vec3 vData;
      varying vec3 vGeoNormalW;
      flat varying vec3 vFaceP;
    `,
    vertexBegin: `vData = aData;`,
    vertexEnd: `vGeoNormalW = normalize(mat3(modelMatrix) * objectNormal); vFaceP = uRot * (vWorldPosP - uCenter);`,
    fragmentPars: /* glsl */ `
      varying vec3 vData;
      varying vec3 vGeoNormalW;
      flat varying vec3 vFaceP;
      uniform vec3 uCenter;
      uniform vec3 uColSand, uColLow, uColMid, uColHigh, uColCliff, uColPeak, uColVeg, uColVeg2, uColDeep, uFeatCol;
      uniform float uMaxH, uSnowLine, uPolar, uHasOcean, uVegAmount, uSeed, uLava, uStrata, uStrataK, uFacet;
      uniform float uFeatMix, uFeatGlow, uFeatRough;
      uniform vec3 uScanPos;
      uniform float uScanRadius;
      uniform mat3 uRot;
      float gRough;
      float gGlow;
      float gSlope;
      float faceHash(vec3 p) {
        uvec3 q = uvec3(ivec3(floor(p * 3.0)) + 65536);
        uint h = (q.x * 1597334677u) ^ (q.y * 3812015801u) ^ (q.z * 2798796415u);
        h = (h ^ (h >> 16)) * 2246822519u;
        h ^= h >> 13;
        return float(h & 0xffffffu) / 16777215.0;
      }
    `,
    color: /* glsl */ `
      {
        vec3 pw = vWorldPosP - uCenter;
        vec3 p = uRot * pw;
        vec3 up = normalize(p);
        float dist = length(vWorldPosP);
        float h = vData.x;
        float m = vData.y;
        float fm = clamp(vData.z, 0.0, 1.0);
        // negative feature values are dark maria on airless worlds
        float maria = clamp(-vData.z, 0.0, 1.0);
        // slope is 1 - cos(angle): 0.06 is about 20 degrees, 0.13 30, 0.23 40
        float slope = 1.0 - dot(normalize(vGeoNormalW), normalize(pw));
        gSlope = slope;
        // anything smaller than a few hundred meters is faded out with
        // distance, from orbit it would only speckle
        float fine = 1.0 - smoothstep(300.0, 2000.0, dist);
        float n1 = snoise(p * 0.0035 + uSeed);
        float n2 = snoise(p * 0.028 + uSeed * 2.0) * fine;
        float hj = h / uMaxH + n1 * 0.06 + n2 * 0.02;

        // soft pastel altitude bands
        vec3 c = mix(uColLow, uColMid, smoothstep(0.08, 0.28, hj));
        c = mix(c, uColHigh, smoothstep(0.42, 0.64, hj));
        // dry worlds: sand pools in the low flats and basins
        float flats = (1.0 - uHasOcean) * (1.0 - smoothstep(0.03, 0.12, hj)) * (1.0 - smoothstep(0.03, 0.09, slope));
        c = mix(c, uColSand, flats * 0.8);
        c = mix(c, uColDeep, maria * 0.7);

        // grass in patches on the wetter gentle ground, soil between
        float vpatch = snoise(p * 0.012 + uSeed * 3.0) * fine;
        float wet = m + vpatch * 0.12 + n2 * 0.05;
        float veg = smoothstep(0.38, 0.54, wet) * (1.0 - smoothstep(0.4, 0.6, hj)) * uVegAmount;
        vec3 vegCol = mix(uColVeg2, uColVeg, smoothstep(0.48, 0.8, wet + n1 * 0.15));
        // soft lighter patches through the meadows
        vegCol = mix(vegCol, uColVeg2, smoothstep(0.1, 0.7, vpatch * 0.8 + n1 * 0.5) * 0.45);
        c = mix(c, vegCol, veg * (1.0 - smoothstep(0.06, 0.13, slope)));

        float under = uHasOcean * (1.0 - smoothstep(-10.0, -0.5, h));
        c = mix(c, uColDeep, under);
        float beach = (1.0 - smoothstep(0.8, 2.8 + n2 * 0.6, h)) * step(-14.0, h) * uHasOcean * (1.0 - uLava);
        c = mix(c, uColSand, beach * (1.0 - smoothstep(0.3, 0.5, slope)));
        // scorched shoreline next to lava
        c = mix(c, uColCliff * 0.4, uLava * (1.0 - smoothstep(0.5, 4.0, h)));

        // bare ground on medium slopes, layered rock on steep ones. The
        // bands are warped a little so they aren't perfect contour lines.
        c = mix(c, mix(c, uColCliff, 0.45), smoothstep(0.08, 0.2, slope));
        float cliff = smoothstep(0.2, 0.32, slope + n2 * 0.04);
        float band = h / uStrata + snoise(p * 0.008 + uSeed) * 0.45;
        float layer = floor(band);
        float tone = fract(layer * 0.618 + uSeed);
        vec3 rock = mix(uColCliff, uColHigh, 0.2 + 0.55 * tone * uStrataK);
        // pale seams between some of the layers
        float seam = smoothstep(0.8, 0.86, fract(band)) * step(0.5, fract(layer * 0.37)) * uStrataK * fine;
        rock = mix(rock, mix(uColSand, uColPeak, 0.35), seam * 0.3);
        c = mix(c, rock, cliff);

        float lat = abs(up.y);
        float snow = smoothstep(uSnowLine - 20.0, uSnowLine + 20.0, h + n1 * 40.0);
        snow += smoothstep(0.98 - uPolar, 1.02 - uPolar, lat + n1 * 0.04) * step(0.001, uPolar);
        // settles on the flats, cliffs stay bare
        snow = clamp(snow, 0.0, 1.0) * (1.0 - smoothstep(0.2, 0.34, slope));
        c = mix(c, uColPeak, snow);

        // lava, glass, ice sheets, pools, ejecta, depending on the planet type
        float fk = fm * uFeatMix;
        c = mix(c, uFeatCol, fk);
        gGlow = fm * uFeatGlow * (0.85 + 0.15 * sin(uTime * 1.3 + n1 * 9.0 + n2 * 3.0));

        c *= 0.97 + 0.06 * faceHash(vFaceP);
        diffuseColor.rgb = c;
        gRough = mix(mix(0.95, 0.55, snow), uFeatRough, fk);

        // scanner pulse ring, uScanPos is planet-fixed
        if (uScanRadius > 0.0) {
          float sd = length(p - uScanPos);
          float ring = exp(-pow((sd - uScanRadius) / 5.0, 2.0));
          float trail = (1.0 - smoothstep(0.0, uScanRadius, sd)) * 0.04 * step(sd, uScanRadius);
          diffuseColor.rgb += vec3(0.3, 0.9, 1.0) * (ring * 2.0 + trail) * (1.0 - smoothstep(800.0, 2500.0, uScanRadius));
        }
      }
    `,
    normal: /* glsl */ `
      {
        // same flat normal three uses for flatShading
        vec3 fnV = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        if (dot(fnV, normal) < 0.0) fnV = -fnV;
        // less on cliffs, where neighboring triangles tilt very differently
        // and full facets read as a comb of teeth
        normal = normalize(mix(normal, fnV, uFacet * (1.0 - 0.7 * smoothstep(0.12, 0.35, gSlope))));
      }
    `,
    emissive: /* glsl */ `
      {
        vec3 upG = normalize(vWorldPosP - uAmbCenter);
        float nightK = 1.0 - smoothstep(-0.12, 0.18, dot(upG, normalize(uSunPos - uAmbCenter)));
        totalEmissiveRadiance += uFeatCol * gGlow * (0.55 + 0.9 * nightK);
      }
    `,
  });
  // roughness from the snow and feature masks
  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    prevCompile(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = gRough;');
  };
  return mat;
}
