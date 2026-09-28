import { NOISE_GLSL } from './noise.glsl.js';

export const MAX_ATMO_PLANETS = 4;

// Full screen pass that composites oceans, cloud layers and single scattering
// atmospheres over the scene using the depth buffer. Runs on layer 1 and writes
// the scene depth back out so later transparent effects still depth test.

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
#define VIEW_STEPS 14
#define LIGHT_STEPS 6

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
  vec3 ambient;
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
  float ds = tExit / float(LIGHT_STEPS);
  for (int i = 0; i < LIGHT_STEPS; i++) {
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
  for (int i = 0; i < VIEW_STEPS; i++) {
    if (i >= n) break;
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

float cloudDensity(Planet P, vec3 dir) {
  float a = uTime * P.cloudSpeed;
  float ca = cos(a), sa = sin(a);
  vec3 d = dir;
  d.xz = mat2(ca, -sa, sa, ca) * d.xz;
  vec3 q = d * P.cloudScale + P.cloudSeed;
  // swirl the lookup so clouds form bands and eddies instead of blobs
  q += 0.7 * vec3(snoise(q * 0.35), snoise(q * 0.35 + 17.0), snoise(q * 0.35 - 9.0));
  float n = snoise(q) * 0.55 + snoise(q * 2.1 + 3.7) * 0.27 + snoise(q * 4.3 - 1.3) * 0.13 + snoise(q * 9.1) * 0.05;
  // looser bands of weather by latitude
  float band = 0.5 + 0.5 * sin(dir.y * 6.0 + P.cloudSeed);
  float cov = P.cloudCov * mix(0.7, 1.3, band);
  float th = mix(0.45, -0.25, cov);
  return smoothstep(th, th + 0.38, n);
}

float waveH(vec3 q, float t, float fine) {
  float h = snoise(q + vec3(t * 0.25, 0.0, t * 0.18)) * 0.55;
  h += snoise(q * 2.3 + vec3(0.0, -t * 0.4, t * 0.33)) * 0.3;
  if (fine > 0.0) h += snoise(q * 5.7 + vec3(t * 0.7, t * 0.2, 0.0)) * 0.18 * fine;
  return h;
}

// p and n are world oriented, noise is sampled in the planet's rotating frame
vec3 waveNormal(mat3 rot, vec3 p, vec3 n, float dist) {
  float fade = 1.0 - smoothstep(150.0, 2200.0, dist);
  if (fade <= 0.0) return n;
  vec3 ta = normalize(cross(n, abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 tb = cross(n, ta);
  float t = uTime;
  vec3 q = (rot * p) * 0.18;
  vec3 taL = rot * ta;
  vec3 tbL = rot * tb;
  float e = 0.12;
  float fine = 1.0 - smoothstep(20.0, 160.0, dist);
  float h0 = waveH(q, t, fine);
  float hx = waveH(q + taL * e, t, fine);
  float hy = waveH(q + tbL * e, t, fine);
  vec3 g = (ta * (hx - h0) + tb * (hy - h0)) / e;
  return normalize(n - g * 0.16 * fade);
}

vec3 shadeOcean(Planet P, vec3 under, vec3 hitW, vec3 rd, float tHit, float waterPath) {
  vec3 n = normalize(hitW);
  vec3 hitL = P.rot * hitW;
  float sunUp = dot(n, P.sunDir);
  vec3 sunT = sunTransmittance(P, hitW + n * 2.0);
  vec3 sunLight = uSunColor * sunT * smoothstep(-0.03, 0.08, sunUp);
  vec3 amb = P.ambient * smoothstep(-0.25, 0.3, sunUp) + uNightAmbient;
  float depthV = waterPath * max(0.08, -dot(rd, n));

  if (P.ocean > 1.5 && P.ocean < 2.5) {
    // lava
    vec3 q = hitL * 0.018;
    float n1 = fbm3(q + vec3(uTime * 0.01, 0.0, -uTime * 0.008));
    float n2 = snoise(hitL * 0.09 + vec3(0.0, uTime * 0.05, 0.0));
    float crust = smoothstep(-0.05, 0.35, n1 + n2 * 0.25);
    float pulse = 0.8 + 0.2 * sin(uTime * 1.3 + n1 * 8.0);
    vec3 hot = P.oceanShallow * 5.0 * pulse;
    vec3 cool = P.oceanDeep * 0.25 * (sunLight * max(sunUp, 0.0) + amb) + P.oceanDeep * 0.35;
    vec3 c = mix(hot, cool, crust);
    // glowing edge where lava meets rock
    c += P.oceanShallow * 3.0 * (1.0 - smoothstep(0.0, 1.5, depthV));
    return c;
  }
  if (P.ocean > 2.5 && P.ocean < 3.5) {
    // ice sheet
    vec3 q = hitL * 0.03;
    float cr = abs(snoise(q)) + 0.5 * abs(snoise(q * 3.1));
    float crack = 1.0 - smoothstep(0.0, 0.08, cr);
    vec3 ice = mix(P.oceanShallow, P.oceanDeep, crack * 0.8 + 0.2 * snoise(q * 0.3));
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
  c += sunLight * (pow(nh, 600.0) * 60.0 + pow(nh, 80.0) * 0.6) * fres * 4.0;
  float foamN = snoise(hitL * 0.45 + vec3(uTime * 0.3, 0.0, 0.0)) * 0.5 + 0.5;
  float foam = (1.0 - smoothstep(0.0, 0.9 + foamN, depthV)) * smoothstep(0.35, 0.7, foamN + 0.3);
  c = mix(c, vec3(0.92) * (sunLight * max(sunUp, 0.0) * 0.8 + amb), foam * 0.75);
  return c;
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
    if (tc.y > 0.0 && tHit < sceneDist) {
      vec3 cp = oc + rd * tHit;
      vec3 up = normalize(cp);
      float d = cloudDensity(P, P.rot * up);
      if (d > 0.001) {
        // the layer is a flat shell, so hide it when seen edge-on from nearby
        float camH = length(oc) - P.radius;
        float near = 1.0 - smoothstep(60.0, 400.0, abs(camH - P.cloudAlt));
        float graze = smoothstep(0.02, 0.25, abs(dot(rd, up)));
        d *= mix(1.0, graze, near) * smoothstep(8.0, 60.0, abs(camH - P.cloudAlt));
        float mu = dot(up, P.sunDir);
        float lit = smoothstep(-0.15, 0.2, mu);
        float ds = cloudDensity(P, P.rot * normalize(cp + P.sunDir * rc * 0.03));
        float shade = 1.0 - ds * 0.5;
        vec3 sunT = sunTransmittance(P, cp);
        // seen from below, thick clouds are darker
        float below = step(0.0, dot(rd, up)) * d;
        float fwd = pow(max(dot(rd, P.sunDir), 0.0), 8.0) * (1.0 - d) * 1.5;
        vec3 sunC = mix(uSunColor, vec3(1.0), 0.35);
        cloudCol = P.cloudColor * (sunC * sunT * lit * (shade * 1.25 + fwd) * (1.0 - below * 0.45) + P.ambient * 0.9 * lit + uNightAmbient * 2.0);
        alpha = d * 0.94;
        tCloud = tHit;
      }
    }
    // cloud shadows on the ground below the layer
    if (!isSky && sceneDist < 1e11) {
      vec3 gp = oc + rd * sceneDist;
      float gl = length(gp);
      if (gl < rc) {
        vec2 ts = raySphere(gp, P.sunDir, rc);
        if (ts.y > 0.0) {
          vec3 sp = gp + P.sunDir * ts.y;
          float sd = cloudDensity(P, P.rot * normalize(sp));
          col *= 1.0 - sd * 0.5 * smoothstep(-0.1, 0.15, dot(normalize(gp), P.sunDir));
        }
      }
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
  if (alpha > 0.0 && tCloud > t0 && tCloud < t1) {
    int n1 = int(clamp(float(VIEW_STEPS) * (tCloud - t0) / (t1 - t0), 3.0, float(VIEW_STEPS - 3)));
    integrate(P, oc, rd, t0, tCloud, n1, odR, odM, sumR, sumM);
    Tb = exp(-(P.betaR * odR + P.betaM * 1.1 * odM));
    integrate(P, oc, rd, tCloud, t1, VIEW_STEPS - n1, odR, odM, sumR2, sumM2);
  } else {
    integrate(P, oc, rd, t0, t1, VIEW_STEPS, odR, odM, sumR, sumM);
    if (alpha > 0.0) Tb = tCloud <= t0 ? vec3(1.0) : exp(-(P.betaR * odR + P.betaM * 1.1 * odM));
  }
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
  }
  for (int i = 0; i < MAXP; i++) {
    if (i >= uCount) break;
    applyPlanet(planets[i], rd, isSky, sceneDist, col);
  }
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
