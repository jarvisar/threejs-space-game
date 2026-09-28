import { NOISE_GLSL } from './noise.glsl.js';

export const MAX_ATMO_PLANETS = 4;

// Full screen pass that composites oceans, cloud layers and single scattering
// atmospheres over the scene using the depth buffer. Runs on layer 1 and writes
// the scene depth back out so later transparent effects still depth test.
//
// Compile time: D3D's compiler inlines every call and unrolls loops with
// constant bounds, and its time grows much faster than the code does. This
// shader took 6 to 13 s to compile before, mostly from several inlined copies
// of the noise heavy functions. So each of those has one call site, inside a
// loop whose bound comes from a uniform (uZero is always 0 and only there to
// stop unrolling). Please keep it that way when adding to it.

export const atmosphereVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const atmosphereFragment = /* glsl */ `
precision highp float;
#define MAXP ${MAX_ATMO_PLANETS}

struct Planet {
  vec3 center;
  float radius;
  float atmoRadius;
  float camAlt;
  vec3 betaR;
  float betaM;
  float scaleR;
  float scaleM;
  float mieG;
  float solidR;
  vec3 sunDir;
  mat3 rot;
  float ocean;
  vec3 oceanShallow;
  vec3 oceanDeep;
  float cloudCov;
  float cloudAlt;
  vec3 cloudColor;
  float cloudScale;
  float cloudSeed;
  float cloudSpeed;
  float cloudFar;
  vec3 ambient;
  float auroraK;
  float auroraLat;
  vec3 auroraC1;
  vec3 auroraC2;
};

uniform Planet planets[MAXP];
uniform int uCount;
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform float uLogFar;
uniform float uTime;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uNightAmbient;
uniform float uDebug;
uniform sampler2D tAO;
uniform float uAOStrength;
uniform float uAOPow;
uniform int uViewSteps;
uniform int uLightSteps;
uniform int uAuroraSteps;
uniform int uZero;

varying vec2 vUv;

${NOISE_GLSL}

// returns (near, far), far < 0 means miss
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(1e20, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

float densityR(Planet P, float h) { return exp(-max(h, 0.0) / P.scaleR); }
float densityM(Planet P, float h) { return exp(-max(h, 0.0) / P.scaleM); }

// optical depth from p toward the sun, false when the planet blocks the sun
bool lightDepth(Planet P, vec3 p, out float odR, out float odM) {
  odR = 0.0;
  odM = 0.0;
  vec3 s = P.sunDir;
  float b = dot(p, s);
  float c = dot(p, p);
  if (b < 0.0 && c - b * b < P.solidR * P.solidR) return false;
  float tExit = -b + sqrt(max(b * b - (c - P.atmoRadius * P.atmoRadius), 0.0));
  float ds = tExit / float(uLightSteps);
  for (int i = 0; i < uLightSteps; i++) {
    vec3 q = p + s * (ds * (float(i) + 0.5));
    float h = length(q) - P.radius;
    odR += densityR(P, h) * ds;
    odM += densityM(P, h) * ds;
  }
  return true;
}

vec3 sunTransmittance(Planet P, vec3 p) {
  float lr, lm;
  if (!lightDepth(P, p, lr, lm)) return vec3(0.0);
  return exp(-(P.betaR * lr + P.betaM * 1.1 * lm));
}

void integrate(Planet P, vec3 oc, vec3 rd, float ta, float tb, int n, inout float odR, inout float odM, inout vec3 sumR, inout vec3 sumM) {
  if (tb <= ta) return;
  float ds = (tb - ta) / float(n);
  for (int i = 0; i < n; i++) {
    float t = ta + ds * (float(i) + 0.5);
    vec3 p = oc + rd * t;
    float h = length(p) - P.radius;
    float dR = densityR(P, h) * ds;
    float dM = densityM(P, h) * ds;
    odR += dR;
    odM += dM;
    float lr, lm;
    if (!lightDepth(P, p, lr, lm)) continue;
    vec3 att = exp(-(P.betaR * (odR + lr) + P.betaM * 1.1 * (odM + lm)));
    sumR += dR * att;
    sumM += dM * att;
  }
}

float phaseR(float mu) { return 0.0596831 * (1.0 + mu * mu); }
float phaseM(float mu, float g) {
  float g2 = g * g;
  return 0.0795775 * (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * mu, 1.5);
}

// Same pattern as cloudNoise() in world/clouds.js, which places the low poly
// puffs. Up close the puffs are the clouds and this only draws their shadows,
// from far away this draws the clouds too. Keep the two in sync.
float cloudDensity(Planet P, vec3 dir) {
  float a = uTime * P.cloudSpeed;
  float ca = cos(a), sa = sin(a);
  vec3 d = dir;
  d.xz = mat2(ca, -sa, sa, ca) * d.xz;
  vec3 q = d * P.cloudScale + P.cloudSeed;
  q += 0.9 * vec3(snoise(q * 0.3), snoise(q * 0.3 + 17.0), snoise(q * 0.3 - 9.0));
  float n = snoise(q * 0.55) * 0.5 + snoise(q * 1.2 + 3.7) * 0.33 + snoise(q * 2.6 - 1.3) * 0.17;
  float band = 0.5 + 0.5 * sin(d.y * 6.0 + P.cloudSeed);
  float cov = P.cloudCov * mix(0.7, 1.3, band);
  float th = mix(0.45, -0.25, cov);
  // a little tighter than the puffs' own threshold, which only reach full size
  // well inside a cloud, so the two cover about the same area
  return smoothstep(th + 0.05, th + 0.15, n);
}

float waveH(vec3 q, float t) {
  float h = 0.0;
  for (int o = 0; o < 2 + uZero; o++) {
    float f = o == 0 ? 1.0 : 2.3;
    vec3 drift = o == 0 ? vec3(t * 0.25, 0.0, t * 0.18) : vec3(0.0, -t * 0.4, t * 0.33);
    h += snoise(q * f + drift) * (o == 0 ? 0.55 : 0.3);
  }
  return h;
}

// One lattice level of the faceted water. uv is in meters on the cube face
// plane, s is the triangle size. Returns the triangle's normal in (u, v, up).
vec3 facetLevel(vec2 uv, float face, float s, float t) {
  const float K = 0.8660254;
  // skewed coordinates of an equilateral triangle lattice
  vec2 g = vec2(uv.x - uv.y * 0.5773503, uv.y / K) / s;
  vec2 c = floor(g);
  vec2 f = g - c;
  vec2 a = f.x + f.y < 1.0 ? c : c + 1.0;
  vec2 b = c + vec2(1.0, 0.0);
  vec2 d = c + vec2(0.0, 1.0);
  float k = 1.0 / (s * 2.6);
  float amp = s * 0.16;
  vec3 P3[3];
  for (int i = 0; i < 3 + uZero; i++) {
    vec2 L = i == 0 ? a : i == 1 ? b : d;
    vec2 X = vec2(L.x + L.y * 0.5, L.y * K) * s;
    P3[i] = vec3(X, waveH(vec3(X * k, face * 7.1), t) * amp);
  }
  vec3 nn = normalize(cross(P3[1] - P3[0], P3[2] - P3[0]));
  return nn.z < 0.0 ? -nn : nn;
}

// Low poly water. The surface is cut into triangles on the cube face plane
// and each one gets a single normal from the waves at its corners. Triangles
// grow with distance so they stay about the same size on screen, and blend
// out to the plain sphere normal from high up where they'd just shimmer.
// p and n are world oriented, the lattice lives in the planet's rotating frame.
vec3 waveNormal(mat3 rot, vec3 p, vec3 n, float dist) {
  float s = max(2.0, dist * 0.012);
  if (s > 900.0) return n;
  vec3 pL = rot * p;
  vec3 a = abs(pL);
  vec3 tuL, tvL;
  float face, dom;
  if (a.x >= a.y && a.x >= a.z) {
    face = sign(pL.x); tuL = vec3(0.0, 0.0, 1.0); tvL = vec3(0.0, 1.0, 0.0); dom = a.x;
  } else if (a.y >= a.z) {
    face = 2.0 + sign(pL.y); tuL = vec3(1.0, 0.0, 0.0); tvL = vec3(0.0, 0.0, 1.0); dom = a.y;
  } else {
    face = 4.0 + sign(pL.z); tuL = vec3(1.0, 0.0, 0.0); tvL = vec3(0.0, 1.0, 0.0); dom = a.z;
  }
  vec2 uv = vec2(dot(pL, tuL), dot(pL, tvL)) / dom * length(pL);
  float t = uTime * 0.6;
  float L = log2(s / 2.0);
  float l0 = floor(L);
  float fl = L - l0;
  float s0 = 2.0 * exp2(l0);
  // blend into the next lattice size up as triangles grow with distance
  int levels = fl > 0.02 ? 2 : 1;
  vec3 nn = vec3(0.0);
  for (int lv = 0; lv < levels; lv++) {
    float w = lv == 0 ? (levels == 2 ? 1.0 - fl : 1.0) : fl;
    nn += facetLevel(uv, face, lv == 0 ? s0 : s0 * 2.0, t) * w;
  }
  nn = normalize(mix(normalize(nn), vec3(0.0, 0.0, 1.0), smoothstep(250.0, 900.0, s)));
  // lattice axes into world space, flattened onto the water
  vec3 tu = tuL * rot;
  vec3 tv = tvL * rot;
  tu = normalize(tu - n * dot(tu, n));
  tv = normalize(tv - n * dot(tv, n));
  return normalize(tu * nn.x + tv * nn.y + n * nn.z);
}

vec3 shadeOcean(Planet P, vec3 under, vec3 hitW, vec3 rd, float tHit, float waterPath) {
  vec3 n = normalize(hitW);
  vec3 hitL = P.rot * hitW;
  float sunUp = dot(n, P.sunDir);
  vec3 sunT = sunTransmittance(P, hitW + n * 2.0);
  vec3 sunLight = uSunColor * sunT * smoothstep(-0.03, 0.08, sunUp);
  vec3 amb = P.ambient * smoothstep(-0.25, 0.3, sunUp) + uNightAmbient;
  float depthV = waterPath * max(0.08, -dot(rd, n));
  bool lava = P.ocean > 1.5 && P.ocean < 2.5;
  bool ice = P.ocean > 2.5 && P.ocean < 3.5;

  // every mode's noise lookups in one loop, see the compile time note up top
  vec3 np[4];
  int count = 1;
  if (lava) {
    vec3 q = hitL * 0.018 + vec3(uTime * 0.01, 0.0, -uTime * 0.008);
    np[0] = q;
    np[1] = q * 2.03 + 11.3;
    np[2] = q * 4.07 - 7.1;
    np[3] = hitL * 0.09 + vec3(0.0, uTime * 0.05, 0.0);
    count = 4;
  } else if (ice) {
    vec3 q = hitL * 0.03;
    np[0] = q;
    np[1] = q * 3.1;
    np[2] = q * 0.3;
    count = 3;
  } else {
    np[0] = hitL * 0.45 + vec3(uTime * 0.3, 0.0, 0.0);
  }
  float nv[4];
  for (int i = 0; i < count; i++) nv[i] = snoise(np[i]);

  if (lava) {
    float n1 = nv[0] * 0.57 + nv[1] * 0.28 + nv[2] * 0.15;
    float n2 = nv[3];
    float crust = smoothstep(-0.05, 0.35, n1 + n2 * 0.25);
    float pulse = 0.8 + 0.2 * sin(uTime * 1.3 + n1 * 8.0);
    vec3 hot = P.oceanShallow * 5.0 * pulse;
    vec3 cool = P.oceanDeep * 0.25 * (sunLight * max(sunUp, 0.0) + amb) + P.oceanDeep * 0.35;
    vec3 c = mix(hot, cool, crust);
    // glowing edge where lava meets rock
    c += P.oceanShallow * 3.0 * (1.0 - smoothstep(0.0, 1.5, depthV));
    return c;
  }
  if (ice) {
    float cr = abs(nv[0]) + 0.5 * abs(nv[1]);
    float crack = 1.0 - smoothstep(0.0, 0.08, cr);
    vec3 ice = mix(P.oceanShallow, P.oceanDeep, crack * 0.8 + 0.2 * nv[2]);
    vec3 hv = normalize(P.sunDir - rd);
    float spec = pow(max(dot(n, hv), 0.0), 80.0) * 0.8;
    return ice * (sunLight * max(sunUp, 0.0) * 0.9 + amb * 1.2) + sunLight * spec;
  }

  vec3 wn = waveNormal(P.rot, hitW, n, tHit);
  float cosv = max(dot(-rd, wn), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
  vec3 body = mix(P.oceanShallow, P.oceanDeep, 1.0 - exp(-depthV * 0.06));
  vec3 bodyLit = body * (sunLight * max(sunUp, 0.0) * 0.55 + amb * 0.8);
  float clarity = exp(-depthV * (P.ocean > 3.5 ? 0.6 : 0.28));
  vec3 refr = mix(bodyLit, under * mix(vec3(1.0), P.oceanShallow * 1.4, 0.5), clarity);
  vec3 rdir = reflect(rd, wn);
  float up = max(dot(rdir, n), 0.0);
  vec3 skyRefl = (P.ambient * (1.5 - up * 0.8)) * smoothstep(-0.25, 0.3, sunUp) + uNightAmbient;
  vec3 c = mix(refr, skyRefl, fres);
  vec3 hv = normalize(P.sunDir - rd);
  float nh = max(dot(wn, hv), 0.0);
  // a whole facet lights up at once, so the tight highlight is kept small
  c += sunLight * (pow(nh, 400.0) * 14.0 + pow(nh, 60.0) * 0.6) * fres * 4.0;
  float foamN = nv[0] * 0.5 + 0.5;
  float foam = (1.0 - smoothstep(0.0, 0.9 + foamN, depthV)) * smoothstep(0.35, 0.7, foamN + 0.3);
  c = mix(c, vec3(0.92) * (sunLight * max(sunUp, 0.0) * 0.8 + amb), foam * 0.75);
  return c;
}

// Aurora curtains in a shell high in the atmosphere, in a band around each
// pole, only on the night side. A short march through the near part of the
// shell, which is the only part a player on the ground can see anyway.
vec3 aurora(Planet P, vec3 oc, vec3 rd, float sceneDist) {
  float h = P.atmoRadius - P.radius;
  float r0 = P.radius + h * 0.4;
  float r1 = P.radius + h * 0.95;
  vec2 to = raySphere(oc, rd, r1);
  if (to.y < 0.0) return vec3(0.0);
  vec2 ti = raySphere(oc, rd, r0);
  float camR = length(oc);
  float a, b;
  if (camR < r0) {
    // from below: out through the inner sphere, then the outer one
    a = ti.y;
    b = to.y;
  } else {
    a = max(to.x, 0.0);
    b = ti.y > 0.0 && ti.x > a ? ti.x : to.y;
  }
  b = min(b, sceneDist);
  if (b <= a) return vec3(0.0);
  int N = uAuroraSteps;
  float ds = (b - a) / float(N);
  // per pixel offset so the thin sheets don't band between samples
  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 q = oc + rd * (a + ds * (float(i) + jit));
    float r = length(q);
    vec3 up = q / r;
    float night = smoothstep(0.08, -0.25, dot(up, P.sunDir));
    if (night <= 0.0) continue;
    vec3 d = P.rot * up;
    float lat = abs(d.y);
    if (abs(lat - P.auroraLat) > 0.16) continue;
    float lon = atan(d.z, d.x);
    float hk = clamp((r - r0) / (r1 - r0), 0.0, 1.0);
    // two thin sheets that snake along the band
    float wa = snoise(vec3(lon * 2.5, uTime * 0.03, P.auroraLat * 10.0));
    float wig = wa * 0.06 + snoise(vec3(lon * 9.0, uTime * 0.07, 3.0)) * 0.015;
    float sheet = exp(-pow((lat - P.auroraLat - wig) / 0.03, 2.0)) + 0.6 * exp(-pow((lat - P.auroraLat - 0.06 - wig * 0.7) / 0.035, 2.0));
    // vertical rays along each sheet and slow brightening and fading
    float rays = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(lon * 160.0 + snoise(vec3(lon * 25.0, uTime * 0.3, 1.0)) * 5.0), 2.0);
    float pulse = 0.55 + 0.45 * sin(wa * 7.0 + lon * 3.0 + uTime * 0.25);
    float vert = smoothstep(0.0, 0.1, hk) * pow(1.0 - hk, 1.8);
    sum += mix(P.auroraC1, P.auroraC2, smoothstep(0.3, 0.95, hk)) * sheet * rays * pulse * vert * night;
  }
  return sum * ds * P.auroraK / h;
}

void applyPlanet(Planet P, vec3 rd, bool isSky, inout float sceneDist, inout vec3 col) {
  vec3 oc = -P.center;
  vec2 tA = raySphere(oc, rd, P.atmoRadius);
  if (tA.y < 0.0 || tA.x > sceneDist) return;

  if (P.ocean > 0.5) {
    // stable form of the ray/sphere root for a camera just above the water
    float b = dot(oc, rd);
    float c = P.camAlt * (P.camAlt + 2.0 * P.radius);
    float h = b * b - c;
    if (h >= 0.0 && P.camAlt > 0.0 && b < 0.0) {
      float t = c / (-b + sqrt(h));
      if (t > 0.0 && t < sceneDist) {
        vec3 hitL = oc + rd * t;
        float path = min(sceneDist - t, 2000.0);
        col = shadeOcean(P, col, hitL, rd, t, path);
        sceneDist = t;
        isSky = false;
      }
    }
  }

  float alpha = 0.0;
  float tCloud = 1e20;
  vec3 cloudCol = vec3(0.0);
  if (P.cloudCov > 0.0) {
    float rc = P.radius + P.cloudAlt;
    vec2 tc = raySphere(oc, rd, rc);
    float tHit = tc.x > 0.0 ? tc.x : tc.y;
    bool layer = tc.y > 0.0 && tHit < sceneDist && P.cloudFar > 0.0;
    vec3 cp = oc + rd * tHit;
    // cloud shadow: the point on the layer toward the sun from the ground
    vec3 gp = oc + rd * sceneDist;
    float gl = length(gp);
    bool shadow = false;
    vec3 sp = vec3(0.0);
    if (!isSky && sceneDist < 1e11 && gl < rc) {
      vec2 ts = raySphere(gp, P.sunDir, rc);
      shadow = ts.y > 0.0;
      sp = gp + P.sunDir * max(ts.y, 0.0);
    }
    // both lookups share one cloudDensity call site
    float dens[2];
    dens[0] = 0.0;
    dens[1] = 0.0;
    int first = layer ? 0 : 1;
    int last = shadow ? 2 : 1;
    for (int i = first; i < last; i++) dens[i] = cloudDensity(P, P.rot * normalize(i == 0 ? cp : sp));
    if (layer) {
      vec3 up = normalize(cp);
      float d = dens[0];
      if (d > 0.001) {
        // the layer is a flat shell, so hide it when seen edge-on from nearby
        float camH = length(oc) - P.radius;
        float near = 1.0 - smoothstep(60.0, 400.0, abs(camH - P.cloudAlt));
        float graze = smoothstep(0.02, 0.25, abs(dot(rd, up)));
        d *= mix(1.0, graze, near) * smoothstep(8.0, 60.0, abs(camH - P.cloudAlt));
        float mu = dot(up, P.sunDir);
        float lit = smoothstep(-0.15, 0.2, mu);
        // thicker middles read darker, stands in for self shadowing
        float shade = 1.0 - d * 0.35;
        vec3 sunT = sunTransmittance(P, cp);
        // seen from below, thick clouds are darker
        float below = step(0.0, dot(rd, up)) * d;
        float fwd = pow(max(dot(rd, P.sunDir), 0.0), 8.0) * (1.0 - d) * 1.5;
        vec3 sunC = mix(uSunColor, vec3(1.0), 0.35);
        cloudCol = P.cloudColor * (sunC * sunT * lit * (shade * 1.25 + fwd) * (1.0 - below * 0.45) + P.ambient * 0.9 * lit + uNightAmbient * 2.0);
        alpha = d * 0.94 * P.cloudFar;
        tCloud = tHit;
      }
    }
    // cloud shadows on the ground below the layer, not on the puffs
    // themselves, they sit right at the layer
    if (shadow) {
      float below = 1.0 - smoothstep(rc - 200.0, rc - 90.0, gl);
      col *= 1.0 - dens[1] * 0.5 * below * smoothstep(-0.1, 0.15, dot(normalize(gp), P.sunDir));
    }
  }

  float t0 = max(tA.x, 0.0);
  float t1 = min(tA.y, sceneDist);
  if (t1 <= t0 || P.scaleR <= 0.0) {
    if (alpha > 0.0) col = mix(col, cloudCol, alpha);
    return;
  }

  float odR = 0.0, odM = 0.0;
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  vec3 sumR2 = vec3(0.0), sumM2 = vec3(0.0);
  vec3 Tb = vec3(1.0);
  // split at the cloud layer so what's behind the cloud can be hidden by it
  bool split = alpha > 0.0 && tCloud > t0 && tCloud < t1;
  int n1 = split ? int(clamp(float(uViewSteps) * (tCloud - t0) / (t1 - t0), 3.0, float(uViewSteps - 3))) : uViewSteps;
  int segs = split ? 2 : 1;
  for (int sg = 0; sg < segs; sg++) {
    vec3 sR = vec3(0.0), sM = vec3(0.0);
    integrate(P, oc, rd, sg == 0 ? t0 : tCloud, sg == 0 && split ? tCloud : t1, sg == 0 ? n1 : uViewSteps - n1, odR, odM, sR, sM);
    if (sg == 0) {
      sumR = sR;
      sumM = sM;
      if (split) Tb = exp(-(P.betaR * odR + P.betaM * 1.1 * odM));
    } else {
      sumR2 = sR;
      sumM2 = sM;
    }
  }
  if (!split && alpha > 0.0) Tb = tCloud <= t0 ? vec3(1.0) : exp(-(P.betaR * odR + P.betaM * 1.1 * odM));
  vec3 T = exp(-(P.betaR * odR + P.betaM * 1.1 * odM));
  float mu = dot(rd, P.sunDir);
  vec3 kR = P.betaR * phaseR(mu);
  vec3 kM = vec3(P.betaM * phaseM(mu, P.mieG));
  vec3 Ib = uSunColor * uSunIntensity * (sumR * kR + sumM * kM);
  vec3 Ia = uSunColor * uSunIntensity * (sumR2 * kR + sumM2 * kM);

  // stars fade out behind a bright sky
  float starFade = isSky ? exp(-dot(Ib + Ia, vec3(0.3, 0.5, 0.2)) * 7.0) : 1.0;
  vec3 behind = col * T * starFade + Ia;
  // faint airglow so the night sky and far hills aren't pure black
  vec3 glow = (1.0 - T) * P.ambient * 0.07;
  col = mix(behind, cloudCol * Tb, alpha) + Ib + glow;
  if (P.auroraK > 0.0) col += aurora(P, oc, rd, sceneDist);
}

// isnan() gets optimized out by the D3D compiler, so test the exponent bits instead
bool badF(float x) { return (floatBitsToUint(x) & 0x7F800000u) == 0x7F800000u; }
bool bad(vec3 c) { return badF(c.r) || badF(c.g) || badF(c.b) || max(c.r, max(c.g, c.b)) > 60000.0; }

void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  float d = texture2D(tDepth, vUv).x;
  bool badIn = bad(col);
  // unproject a near plane point. The far plane is degenerate in float32 with near 0.05 and far 1e9
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vec3 rdView = normalize(v.xyz / v.w);
  vec3 rd = normalize((uCamWorld * vec4(rdView, 0.0)).xyz);
  bool isSky = d >= 0.99999;
  float sceneDist = 1e12;
  if (!isSky) {
    float w = exp2(d * uLogFar) - 1.0;
    sceneDist = w / max(1e-5, -rdView.z);
    // N8AO, applied before water and haze. Past a couple hundred meters its
    // 2 m radius is only a few pixels wide, so it fades out.
    if (uAOStrength > 0.0) {
      float ao = pow(texture2D(tAO, vUv).r, uAOPow);
      col *= mix(1.0, ao, uAOStrength * (1.0 - smoothstep(100.0, 250.0, w)));
    }
  }
  for (int i = 0; i < uCount; i++) applyPlanet(planets[i], rd, isSky, sceneDist, col);
  if (uDebug > 2.5) col = badIn ? vec3(1.0, 0.0, 1.0) : bad(col) ? vec3(0.0, 1.0, 1.0) : col * 0.2;
  else if (uDebug > 1.5) col = vec3(sceneDist / 300.0);
  else if (uDebug > 0.5) col = vec3(fract(d * 10.0), fract(sceneDist / 100.0), float(uCount) * 0.25);
  // never let a bad pixel reach the bloom chain, it smears across the screen
  if (bad(col)) col = vec3(0.0);
  col = min(col, vec3(2000.0));
  gl_FragColor = vec4(col, 1.0);
  gl_FragDepth = d;
}
`;
