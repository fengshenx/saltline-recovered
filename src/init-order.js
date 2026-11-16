// init-order.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import { FX_MODULE, createEffects, showcaseEffects } from './effects/effects.js';

import { AI_TUNE, createEnemies, showcaseEnemies } from './enemies/enemies.js';

import { ex } from './misc.js';

import {
  createMaterials,
  materialsModule,
  patchMaterialShader,
} from './render/materials/materials.js';

import { showcaseMaterials } from './render/materials/showcase.js';

import { SALTLINE_PAINT_BODY, SURFACE_SHADERS } from './render/materials/surface-shaders.js';

import { createRenderer, rendererModule, showcaseRenderer } from './render/renderer.js';

import { createWeapon, showcaseWeapon, weaponModule } from './weapons/weapon.js';

import { backdropModule, createBackdrop, showcaseBackdrop } from './world/backdrop/backdrop.js';

import {
  SEA_WAVE_DETAIL,
  SEA_WAVE_MAIN,
  createGround,
  groundModule,
  showcaseGround,
} from './world/ground/ground.js';

import { createLevel, showcaseLevel } from './world/level/level.js';

import {
  buildBasicContainer,
  buildBollardPost,
  buildCatwalk,
  buildFencePanel,
  buildFloodlightStand,
  buildGateArm,
  buildGuardBooth,
  buildJerseyBarrier,
  buildLightMast,
  buildMetalStairs,
  buildMooringBollard,
  buildReeferUnit,
  buildRelayNode,
  buildShelfRack,
  buildSignPost,
} from './world/props/basic-builders.js';

import { registerCargoProps } from './world/props/cargo-builders.js';

import { registerCharacterProps } from './world/props/character-builders.js';

import { registerDetailedProps } from './world/props/detailed-builders.js';

import { createProps, showcaseProps } from './world/props/props.js';

import {
  PROPS_MODULE_EXPORTS,
  PROP_SIZES,
  propsModule,
  registerPropBuilder,
} from './world/props/registry.js';

Object.defineProperties(rendererModule, {
  create: {
    get: () => createRenderer,
    enumerable: true,
  },
  showcase: {
    get: () => showcaseRenderer,
    enumerable: true,
  },
});

Object.defineProperties(materialsModule, {
  applyPatch: {
    get: () => patchMaterialShader,
    enumerable: true,
  },
  create: {
    get: () => createMaterials,
    enumerable: true,
  },
  showcase: {
    get: () => showcaseMaterials,
    enumerable: true,
  },
});

SURFACE_SHADERS.asphalt = `
void surf(vec2 uv){
  vec4 a = vor(uv * 110.0, vec2(110.0), 1.0);
  vec4 b = vor(uv * 230.0 + 3.0, vec2(230.0), 2.0);
  float big = fbm(uv, vec2(3.0), 4, 5.0), mid = fbm(uv, vec2(24.0), 4, 6.0), fine = fbm(uv, vec2(300.0), 2, 7.0);
  float jag = fbm(uv, vec2(420.0), 2, 8.0) - 0.5;
  float sa = smoothstep(0.46, 0.3, a.x + jag * 0.3 - (a.y - a.x) * 0.2 + (1.0 - a.w) * 0.12) * step(a.z, 0.62);
  float sb = smoothstep(0.46, 0.3, b.x + jag * 0.2 + (1.0 - b.w) * 0.15) * step(b.z, 0.85);
  float h = max(sa * (0.45 + 0.55 * a.w), sb * 0.5 * (0.5 + 0.5 * b.w));
  h = h * 0.6 + fine * 0.3 + mid * 0.1;
  float wearK = smoothstep(0.3, 0.7, big);
  float stone = sat(max(sa, sb * 0.8));
  vec3 stA = mix(L(0.28, 0.28, 0.29), L(0.45, 0.43, 0.41), a.w); stA = mix(stA, L(0.42, 0.35, 0.28), step(0.9, a.z * 0.5 + a.w * 0.6));
  vec3 stB = mix(L(0.26, 0.26, 0.28), L(0.44, 0.43, 0.42), b.w);
  vec3 col = L(0.13, 0.13, 0.135) * (0.8 + 0.4 * mid);
  col = mix(col, stB, sb * 0.7 * (0.45 + 0.55 * wearK));
  col = mix(col, stA, sa * (0.5 + 0.45 * wearK));
  col *= 0.8 + 0.4 * big;
  float cn = fbm(uv + vec2(0.13, 0.4), vec2(2.0), 3, 9.0);
  float band = smoothstep(0.016, 0.009, abs(cn - 0.5) + (fbm(uv, vec2(70.0), 2, 13.0) - 0.5) * 0.008) * smoothstep(0.4, 0.6, fbm(uv, vec2(2.0), 2, 12.0));
  col = mix(col, L(0.075, 0.075, 0.08), band * 0.93);
  h = mix(h, 0.74 + fine * 0.05 + sa * 0.04, band * 0.88);
  float r = mix(0.93, 0.74, stone * (0.4 + 0.6 * wearK)); r = mix(r, 0.36, band);
  float oil = smoothstep(0.72, 0.86, fbm(uv + 0.5, vec2(5.0), 4, 14.0)); col *= 1.0 - oil * 0.45; r = mix(r, 0.5, oil * 0.6);
  emit(col, 1.0, h, mix(0.55, 1.0, smoothstep(0.0, 0.6, h)), r, 0.0);
}`;

SURFACE_SHADERS.concrete = `
void surf(vec2 uv){
  float big = fbm(uv, vec2(2.0), 5, 1.0), mid = fbm(uv, vec2(12.0), 5, 2.0), fine = fbm(uv, vec2(180.0), 3, 3.0);
  float form = fbm(uv, vec2(2.0, 7.0), 5, 4.0);
  vec4 po = vor(uv * 70.0, vec2(70.0), 5.0); float pore = step(po.z, 0.35) * smoothstep(0.16 * po.w + 0.03, 0.02, po.x);
  vec4 po2 = vor(uv * 260.0, vec2(260.0), 6.0); float pore2 = step(po2.z, 0.5) * smoothstep(0.3 * po2.w, 0.05, po2.x);
  vec2 wu = uv + (vec2(fbm(uv, vec2(6.0), 3, 7.0), fbm(uv, vec2(6.0), 3, 8.0)) - 0.5) * 0.12 + (vec2(fbm(uv, vec2(48.0), 3, 17.0), fbm(uv, vec2(48.0), 3, 18.0)) - 0.5) * 0.022;
  vec4 cr = vor(wu * 3.0, vec2(3.0), 9.0);
  float crack = smoothstep(0.0045, 0.0012, cr.y - cr.x) * smoothstep(0.45, 0.6, fbm(uv, vec2(3.0), 2, 10.0));
  float chip = smoothstep(0.83, 0.87, fbm(uv, vec2(7.0), 4, 11.0) + (fine - 0.5) * 0.08 + (mid - 0.5) * 0.06);
  vec4 ag = vor(uv * 140.0, vec2(140.0), 12.0); float stone = smoothstep(0.5, 0.3, ag.x) * step(ag.z, 0.6);
  vec2 dj = min(uv, 1.0 - uv); float jd = min(dj.x, dj.y);
  float joint = smoothstep(0.0022, 0.0012, jd), jstain = smoothstep(0.07, 0.0, jd + (mid - 0.5) * 0.04);
  float h = 0.6 + (mid - 0.5) * 0.25 + (fine - 0.5) * 0.12 + (form - 0.5) * 0.06;
  h -= pore * 0.35 + pore2 * 0.08 + crack * 0.2; h = mix(h, 0.42 + stone * 0.12 + fine * 0.08, chip); h = mix(h, 0.05, joint);
  vec3 col = L(0.53, 0.52, 0.49) * (0.72 + 0.4 * big + 0.22 * (mid - 0.5) + 0.08 * (form - 0.5));
  col *= mix(vec3(1.04, 1.0, 0.94), vec3(0.95, 1.0, 1.05), fbm(uv, vec2(3.0), 3, 13.0));
  float st = smoothstep(0.55, 0.8, fbm(uv, vec2(4.0), 5, 14.0)); col *= 1.0 - st * 0.3;
  float ef = smoothstep(0.66, 0.85, fbm(uv, vec2(5.0), 4, 15.0)) * sat(fine * 1.6 - 0.2); col = mix(col, L(0.68, 0.67, 0.64), ef * 0.22);
  col *= 1.0 - pore * 0.5 - pore2 * 0.2 - crack * 0.6;
  vec3 agc = mix(L(0.38, 0.37, 0.35), L(0.54, 0.52, 0.47), ag.w); agc = mix(agc, L(0.46, 0.41, 0.34), step(0.45, ag.z));
  col = mix(col, mix(L(0.4, 0.39, 0.37) * (0.8 + 0.4 * fine), agc, stone * 0.8), chip);
  col *= 1.0 - jstain * 0.25; col = mix(col, L(0.1, 0.1, 0.1), joint);
  float r = 0.82 + (mid - 0.5) * 0.2 - (form - 0.5) * 0.15; r = mix(r, 0.95, chip); r = mix(r, 0.62, st * 0.3);
  float ao = 1.0 - pore * 0.5 - crack * 0.5 - joint * 0.6 - chip * 0.15;
  float pa = smoothstep(0.40, 0.47, fbm(uv, vec2(9.0), 5, 16.0) + (mid - 0.5) * 0.2) * (1.0 - chip) * (1.0 - crack) * (1.0 - pore);
  emit(col, pa, h, ao, r, 0.0);
}`;

SURFACE_SHADERS.brick = `
void surf(vec2 uv){
  float rows = 24.0, cols = 8.0; float y = uv.y * rows; float row = floor(y); float x = uv.x * cols + 0.5 * mod(row, 2.0); float cl = floor(x);
  vec2 f = vec2(fract(x), fract(y)); vec3 id = h3(vec2(cl, row), vec2(cols, rows), 1.0);
  float ed = fbm(uv, vec2(60.0), 3, 2.0);
  vec2 d = min(f, 1.0 - f) * vec2(225.0, 75.0);
  float mort = 5.0 + (ed - 0.5) * 5.0; float dm = min(d.x, d.y); float brick = smoothstep(mort, mort + 3.0, dm);
  float fine = fbm(uv, vec2(200.0), 3, 3.0), mid = fbm(uv, vec2(30.0), 4, 4.0);
  vec3 c = mix(L(0.52, 0.27, 0.2), L(0.42, 0.2, 0.15), id.x); c = mix(c, L(0.3, 0.17, 0.15), smoothstep(0.75, 1.0, id.y)); c = mix(c, L(0.58, 0.38, 0.26), smoothstep(0.85, 1.0, id.z));
  c *= (0.8 + 0.4 * mid) * (0.9 + 0.2 * fine);
  float pit = smoothstep(0.7, 0.8, fbm(uv, vec2(90.0), 3, 5.0)); c *= 1.0 - pit * 0.35;
  vec3 mc = L(0.5, 0.48, 0.44) * (0.75 + 0.5 * fine);
  float soot = smoothstep(0.5, 0.8, fbm(uv, vec2(3.0), 4, 6.0));
  vec3 col = mix(mc, c, brick) * (1.0 - soot * 0.35);
  float ef = smoothstep(0.7, 0.85, fbm(uv, vec2(5.0), 4, 7.0)) * brick; col = mix(col, L(0.7, 0.68, 0.64), ef * 0.3);
  float h = mix(0.25 + fine * 0.1, 0.7 + (mid - 0.5) * 0.15 + (fine - 0.5) * 0.1 - pit * 0.2 + (id.x - 0.5) * 0.12, brick);
  emit(col, 1.0, h, mix(0.6, 1.0, brick) * (1.0 - pit * 0.3), mix(0.95, 0.86 + (mid - 0.5) * 0.15, brick), 0.0);
}`;

SURFACE_SHADERS.epoxy = `
void surf(vec2 uv){
  float big = fbm(uv, vec2(3.0), 5, 1.0), mid = fbm(uv, vec2(20.0), 4, 2.0), fine = fbm(uv, vec2(250.0), 2, 3.0), mott = fbm(uv, vec2(9.0), 5, 11.0);
  vec3 col = L(0.41, 0.445, 0.435) * (0.78 + 0.3 * big + 0.22 * (mott - 0.5));
  col *= mix(vec3(1.03, 1.0, 0.97), vec3(0.95, 1.0, 1.03), fbm(uv, vec2(2.0), 3, 19.0));
  vec4 ag = vor(uv * 180.0, vec2(180.0), 12.0); col *= 1.0 + (ag.w - 0.5) * 0.14 * smoothstep(0.5, 0.2, ag.x);
  float gloss = smoothstep(0.35, 0.62, fbm(uv, vec2(5.0), 5, 4.0));          // sealer still intact
  float lane = smoothstep(0.35, 0.65, fbm(uv, vec2(1.0, 3.0), 3, 13.0));     // traffic lanes worn matt
  float worn = sat(1.0 - gloss * 0.85 + lane * 0.45 - 0.15);
  float sc1 = scr(uv, 14.0, 5.0, 0.012, 0.5, 6.3, 0.7), sc2 = scr(uv, 40.0, 6.0, 0.02, 0.0, 6.3, 0.5);
  float t1 = abs(uv.y - 0.31 - 0.06 * sin(uv.x * TAU)), t2 = abs(uv.x - 0.62 - 0.09 * sin(uv.y * TAU + 1.0));
  float t3 = abs(uv.y - 0.74 - 0.1 * sin(uv.x * TAU * 2.0 + 2.0)), t4 = abs(uv.x - 0.2 - 0.05 * sin(uv.y * TAU + 4.0));
  float tread = 0.6 + 0.4 * sin((uv.x + uv.y) * TAU * 90.0);
  float tm = smoothstep(0.022, 0.016, t1) * smoothstep(0.35, 0.6, fbm(uv, vec2(8.0), 3, 7.0)) + smoothstep(0.02, 0.014, t2) * smoothstep(0.4, 0.65, fbm(uv, vec2(6.0), 3, 8.0))
           + smoothstep(0.026, 0.018, t3) * smoothstep(0.45, 0.7, fbm(uv, vec2(5.0), 3, 14.0)) + smoothstep(0.018, 0.012, t4) * smoothstep(0.4, 0.65, fbm(uv, vec2(7.0), 3, 15.0));
  tm = sat(tm * tread);
  col = mix(col, L(0.1, 0.1, 0.105), tm * 0.75);
  col *= 1.0 - worn * 0.1; col = mix(col, col * 1.25, sc1 * 0.4);
  float dirt = smoothstep(0.55, 0.85, fbm(uv, vec2(2.0), 4, 9.0)); col = mix(col, L(0.3, 0.29, 0.26), dirt * 0.3);
  float r = mix(0.1, 0.52, worn) + sc1 * 0.2 + sc2 * 0.15 + tm * 0.3 + dirt * 0.2 + (mid - 0.5) * 0.12 + (mott - 0.5) * 0.1;
  float h = 0.5 + (fine - 0.5) * 0.05 + (mid - 0.5) * 0.06 - sc1 * 0.2 - sc2 * 0.08 + tm * 0.05 + (gloss - 0.5) * 0.03;
  float chip = smoothstep(0.87, 0.9, fbm(uv, vec2(14.0), 5, 10.0) + (fine - 0.5) * 0.06); col = mix(col, L(0.44, 0.44, 0.43) * (0.75 + 0.5 * fine), chip); h -= chip * 0.3; r = mix(r, 0.85, chip);
  emit(col, 1.0, h, 1.0 - chip * 0.2, r, 0.0);
}`;

SURFACE_SHADERS.paint = `
void surf(vec2 uv){
  float chip, stain, run; paintDmg(uv, uP.x, chip, stain, run);
  float shade = 0.8, baseR = 0.40;
  ${SALTLINE_PAINT_BODY}
  emit(nt, ta, h, ao, r, m);
}`;

SURFACE_SHADERS.hazard = `
void surf(vec2 uv){
  float chip, stain, run; paintDmg(uv, 1.4, chip, stain, run);
  float shade = 1.0, baseR = 0.5;
  ${SALTLINE_PAINT_BODY}
  float s = fract((uv.x + uv.y) * 5.0);
  float yel = smoothstep(0.244, 0.256, abs(s - 0.5) + (fbm(uv, vec2(80.0), 2, 41.0) - 0.5) * 0.02);
  vec3 pc = mix(L(0.1, 0.1, 0.11), L(0.86, 0.66, 0.1), yel);
  emit(nt + pc * ta, 1.0, h, ao, r, m);
}`;

SURFACE_SHADERS.hull = `
void surf(vec2 uv){
  float ry = uv.y * 2.0; float row = floor(ry); float fy = fract(ry); float sx = fract(uv.x + 0.5 * mod(row, 2.0));
  float dh = min(fy, 1.0 - fy) * 2.0, dv = min(sx, 1.0 - sx) * 4.0; float dseam = min(dh, dv);
  float wn = fbm(uv, vec2(200.0), 2, 1.0);
  float bead = smoothstep(0.012, 0.004, dseam + (wn - 0.5) * 0.004);
  float ripple = 0.75 + 0.25 * sin((uv.x + uv.y) * TAU * 400.0);
  float dish = cos(uv.x * TAU * 8.0) * 0.5 + 0.5;
  float big = fbm(uv, vec2(2.0), 4, 2.0), mid = fbm(uv, vec2(14.0), 4, 3.0), fine = fbm(uv, vec2(220.0), 2, 4.0);
  float roller = fbm(uv, vec2(120.0, 30.0), 3, 5.0);
  float seamK = smoothstep(0.12, 0.0, dseam);
  float pit = fbm(uv, vec2(70.0), 4, 7.0);
  float rust = smoothstep(0.72, 0.79, fbm(uv, vec2(10.0), 5, 6.0) + seamK * 0.2);
  rust *= smoothstep(0.3, 0.5, pit + rust * 0.3);
  float streak = fbm(uv, vec2(110.0, 1.0), 3, 8.0);
  float wp = 0.0;
  for (int i = 1; i <= 4; i++){
    vec2 q = uv + vec2(0.0, float(i) * 0.03); float qy = fract(q.y * 2.0);
    float qs = smoothstep(0.02, 0.0, min(qy, 1.0 - qy) * 2.0); float qr = smoothstep(0.72, 0.79, fbm(q, vec2(10.0), 5, 6.0));
    wp = max(wp, max(qs * 0.7, qr) * (1.0 - float(i) / 5.0));
  }
  float weep = wp * smoothstep(0.4, 0.75, streak);
  float salt = smoothstep(0.6, 0.85, fbm(uv, vec2(3.0, 9.0), 4, 9.0));
  vec3 nt = vec3(0.0); float ta = 0.82 * (0.88 + 0.2 * (big - 0.5) + 0.14 * (mid - 0.5) + 0.08 * (roller - 0.5));
  OV(vec3(0.6), salt * 0.025 * (0.5 + roller));
  OV(L(0.45, 0.27, 0.14), weep * 0.7);
  OV(mix(L(0.25, 0.16, 0.11), L(0.5, 0.31, 0.17), pit), rust);
  float h = 0.5 + (roller - 0.5) * 0.05 + (fine - 0.5) * 0.03 + bead * 0.35 * ripple + (dish - 0.5) * 0.1 - rust * 0.08 * (1.0 - pit);
  float r = 0.5 + (mid - 0.5) * 0.15 + salt * 0.2; r = mix(r, 0.9, rust); r = mix(r, 0.7, weep * 0.5);
  emit(nt, ta, h, 1.0 - rust * 0.2 - smoothstep(0.03, 0.012, dseam) * (1.0 - bead) * 0.3, r, rust * 0.1);
}`;

SURFACE_SHADERS.galv = `
void surf(vec2 uv){
  vec2 wu = uv + (vec2(fbm(uv, vec2(8.0), 2, 1.0), fbm(uv, vec2(8.0), 2, 2.0)) - 0.5) * 0.03;
  vec4 a = vor(wu * 22.0, vec2(22.0), 3.0); vec4 b = vor(wu * 50.0 + 1.5, vec2(50.0), 4.0);
  float sp = mix(a.w, b.w, 0.35);
  float edge = smoothstep(0.0, 0.08, a.y - a.x);
  float big = fbm(uv, vec2(2.0), 4, 5.0), fine = fbm(uv, vec2(200.0), 2, 6.0), mid = fbm(uv, vec2(20.0), 4, 7.0);
  vec3 col = vec3(0.56, 0.58, 0.6) * (0.72 + 0.4 * sp) * (0.92 + 0.16 * big);
  float wr = smoothstep(0.55, 0.85, fbm(uv, vec2(6.0), 5, 8.0)) * (0.4 + 0.6 * fbm(uv, vec2(90.0), 3, 10.0));
  col = mix(col, L(0.74, 0.74, 0.72), wr * 0.4);
  float rs = rustMask(uv, vec2(9.0), 0.8, 9.0);
  col = mix(col, L(0.42, 0.27, 0.16) * (0.7 + 0.6 * fine), rs);
  float r = 0.3 + 0.28 * sp + (mid - 0.5) * 0.15 + wr * 0.3; r = mix(r, 0.9, rs);
  float h = 0.5 + (sp - 0.5) * 0.08 * edge + (fine - 0.5) * 0.04 + wr * 0.05 * fine - (1.0 - edge) * 0.03;
  emit(col, 1.0, h, 1.0, r, 1.0 - wr * 0.45 - rs * 0.9);
}`;

SURFACE_SHADERS.metal = `
void surf(vec2 uv){
  float big = fbm(uv, vec2(2.0), 5, 1.0), mid = fbm(uv, vec2(18.0), 4, 2.0), fine = fbm(uv, vec2(240.0), 2, 3.0);
  float smudge = fbm(uv, vec2(5.0, 7.0), 5, 4.0);
  float s1 = scr(uv, 9.0, 5.0, 0.006, 0.2, 6.3, 0.6), s2 = scr(uv, 30.0, 6.0, 0.012, 1.0, 6.3, 0.5), s3 = scr(uv, 70.0, 7.0, 0.03, 2.0, 6.3, 0.4);
  float sc = sat(max(s1, max(s2 * 0.8, s3 * 0.5)));
  float rust = rustMask(uv, vec2(12.0), 0.74, 8.0) * uP.x;
  float scale_ = smoothstep(0.4, 0.7, fbm(uv, vec2(7.0), 4, 10.0));
  vec3 nt = vec3(0.0); float ta = 0.95 * (0.85 + 0.2 * (big - 0.5) + 0.16 * (mid - 0.5)) * (1.0 - scale_ * 0.18);
  OV(vec3(0.55, 0.56, 0.58), sc * 0.3);
  OV(mix(L(0.27, 0.17, 0.12), L(0.5, 0.31, 0.17), fbm(uv, vec2(90.0), 3, 11.0)), rust);
  float r = 0.42 + (smudge - 0.5) * 0.3 + (mid - 0.5) * 0.1 - sc * 0.15 + scale_ * 0.08; r = mix(r, 0.9, rust);
  float h = 0.5 + (fine - 0.5) * 0.04 + (mid - 0.5) * 0.04 - sc * 0.12 + rust * 0.08 * fine;
  emit(nt, ta, h, 1.0 - rust * 0.2, r, 1.0 - rust * 0.85);
}`;

SURFACE_SHADERS.brushed = `
void surf(vec2 uv){
  float l1 = fbm(uv, vec2(2.0, 300.0), 3, 1.0), l2 = fbm(uv, vec2(6.0, 120.0), 3, 2.0), l3 = fbm(uv, vec2(1.0, 500.0), 2, 12.0);
  float big = fbm(uv, vec2(3.0), 4, 3.0), smudge = fbm(uv, vec2(6.0), 5, 4.0);
  float sc = scr(uv, 12.0, 5.0, 0.008, 0.6, 6.3, 0.4);
  float tar = smoothstep(0.45, 0.9, fbm(uv, vec2(5.0), 5, 6.0));
  vec3 nt = vec3(0.0); float ta = 0.95 * (0.82 + 0.16 * (l1 - 0.5) + 0.14 * (l2 - 0.5) + 0.1 * (big - 0.5)) * (1.0 - tar * 0.13);
  OV(vec3(0.7), sc * 0.2);
  float r = 0.3 + (l1 - 0.5) * 0.2 + (smudge - 0.5) * 0.2 + tar * 0.18 - sc * 0.08;
  float h = 0.5 + (l1 - 0.5) * 0.2 + (l3 - 0.5) * 0.2 + (l2 - 0.5) * 0.1 - sc * 0.2;
  emit(nt, ta, h, 1.0, r, 1.0);
}`;

SURFACE_SHADERS.rust = `
void surf(vec2 uv){
  vec2 wu = uv + (vec2(fbm(uv, vec2(5.0), 3, 1.0), fbm(uv, vec2(5.0), 3, 2.0)) - 0.5) * 0.08;
  float n = fbm(wu, vec2(6.0), 7, 3.0);
  float fl = fbm(wu, vec2(11.0), 6, 4.0);
  float tf = fract(fl * 4.0); float layer = floor(fl * 4.0) / 4.0 + smoothstep(0.0, 0.45, tf) * 0.25;
  float flakeEdge = smoothstep(0.1, 0.0, tf) * smoothstep(0.4, 0.6, fbm(uv, vec2(9.0), 3, 14.0));
  vec4 pv = vor(uv * 70.0, vec2(70.0), 5.0); float pit = step(pv.z, 0.5) * smoothstep(0.35 * pv.w + 0.05, 0.03, pv.x);
  vec4 pv2 = vor(uv * 190.0, vec2(190.0), 15.0); float speck = smoothstep(0.35, 0.1, pv2.x) * step(pv2.z, 0.4);
  float grain = fbm(uv, vec2(220.0), 3, 6.0);
  float scaleI = smoothstep(0.75, 0.8, fbm(wu, vec2(4.0), 5, 7.0) + (grain - 0.5) * 0.1);
  float h = 0.25 + layer * 0.4 + (n - 0.5) * 0.3 + (grain - 0.5) * 0.14 - pit * 0.2 + speck * 0.04;
  h = mix(h, 0.8 + (grain - 0.5) * 0.04, scaleI);
  float t = sat(layer * 0.5 + n * 0.55 + (grain - 0.5) * 0.35);
  vec3 c = mix(L(0.26, 0.17, 0.13), L(0.4, 0.25, 0.16), smoothstep(0.25, 0.6, t));
  float bloom = smoothstep(0.55, 0.85, fbm(uv, vec2(7.0), 5, 8.0));
  c = mix(c, L(0.55, 0.34, 0.17), bloom * (0.35 + 0.65 * smoothstep(0.4, 0.7, t)));
  c = mix(c, L(0.62, 0.45, 0.25), smoothstep(0.7, 0.95, fbm(uv, vec2(34.0), 4, 18.0)) * 0.4);
  c = mix(c, L(0.2, 0.14, 0.12), sat(flakeEdge * 0.6 + pit * 0.7));
  c *= (0.8 + 0.4 * grain) * (0.9 + 0.2 * speck);
  float streak = fbm(uv, vec2(60.0, 2.0), 3, 9.0); c = mix(c, L(0.5, 0.31, 0.17), smoothstep(0.55, 0.8, streak) * 0.2);
  c = mix(c, L(0.3, 0.3, 0.33) * (0.8 + 0.4 * grain), scaleI);
  float r = 0.9 + (grain - 0.5) * 0.15 - bloom * 0.06; r = mix(r, 0.55, scaleI);
  emit(c, 1.0, h, 1.0 - pit * 0.4 - flakeEdge * 0.25, r, scaleI * 0.35);
}`;

SURFACE_SHADERS.diamond = `
void surf(vec2 uv){
  vec2 p = uv * 12.0; vec2 i = floor(p); vec2 q = fract(p) - 0.5; float par = mod(i.x + i.y, 2.0);
  vec2 d = (par < 0.5 ? vec2(q.x + q.y, q.x - q.y) : vec2(q.x - q.y, q.x + q.y)) * 0.7071;
  float e = length(d * vec2(1.0 / 0.46, 1.0 / 0.13));
  float loz = smoothstep(1.0, 0.55, e), top = smoothstep(0.75, 0.4, e);
  float big = fbm(uv, vec2(2.0), 4, 1.0), mid = fbm(uv, vec2(16.0), 4, 2.0), fine = fbm(uv, vec2(200.0), 2, 3.0);
  float wear = smoothstep(0.3, 0.7, big);
  float grime = (1.0 - loz) * smoothstep(0.3, 0.65, fbm(uv, vec2(8.0), 4, 4.0));
  float sc = scr(uv, 20.0, 5.0, 0.02, 0.0, 6.3, 0.5);
  vec3 col = vec3(0.42, 0.43, 0.45) * (0.85 + 0.3 * (mid - 0.5));
  col = mix(col, vec3(0.68, 0.69, 0.7), top * (0.4 + 0.6 * wear));
  col = mix(col, L(0.22, 0.19, 0.16), grime * 0.8);
  float rust = smoothstep(0.7, 0.86, fbm(uv, vec2(10.0), 5, 6.0) + (fine - 0.5) * 0.12) * (1.0 - top) * (0.6 + 0.4 * fine); col = mix(col, L(0.42, 0.27, 0.16) * (0.7 + 0.6 * fine), rust);
  float r = 0.5 + (mid - 0.5) * 0.15; r = mix(r, 0.22, top * (0.4 + 0.6 * wear)); r = mix(r, 0.85, grime); r = mix(r, 0.9, rust); r -= sc * 0.1;
  float h = 0.2 + loz * 0.7 + (fine - 0.5) * 0.03 - sc * 0.03 * top;
  emit(col, 1.0, h, mix(1.0, 0.6, smoothstep(1.5, 1.0, e) * (1.0 - loz)), r, 1.0 - grime * 0.8 - rust * 0.9);
}`;

SURFACE_SHADERS.corrugated = `
void surf(vec2 uv){
  float w = uv.x * 10.0; float cz = 0.5 + 0.5 * cos(w * TAU);
  float big = fbm(uv, vec2(2.0), 4, 1.0), fine = fbm(uv, vec2(160.0, 480.0), 2, 3.0);
  float streak = fbm(uv, vec2(40.0, 1.0), 3, 6.0), streak2 = fbm(uv, vec2(10.0, 1.0), 3, 16.0);
  float lapV = smoothstep(0.004, 0.0015, abs(uv.y - 0.012) * 2.286);
  float lapZone = smoothstep(0.32, 0.0, (uv.y - 0.012) * 2.286) * step(0.012, uv.y);       // drip end of the upper sheet
  float fi = floor(w + 0.5); float onC = step(mod(fi, 5.0), 0.5);
  float fd = length(vec2((w - fi) / 10.0 * 0.762, (uv.y - 0.5) * 2.286));
  float fast = onC * smoothstep(0.008, 0.006, fd), washer = onC * smoothstep(0.014, 0.011, fd) * (1.0 - fast);
  float rg = fbm(uv, vec2(90.0, 270.0), 3, 15.0);
  float which = smoothstep(0.45, 0.7, fbm(uv, vec2(3.0, 1.0), 3, 5.0));
  float rust = smoothstep(0.5, 0.95, lapZone * which * (0.55 + 0.9 * streak) + (rg - 0.5) * 0.22) * (0.5 + 0.5 * rg);
  vec3 col = vec3(0.43, 0.47, 0.52) * (0.9 + 0.2 * (big - 0.5)) * (0.95 + 0.1 * (streak2 - 0.5));
  col = mix(col, vec3(0.6, 0.62, 0.64), smoothstep(0.6, 0.9, streak) * 0.12);
  float dirtV = (1.0 - cz) * smoothstep(0.4, 0.75, fbm(uv, vec2(3.0, 2.0), 4, 7.0)) * 0.5;
  col = mix(col, L(0.25, 0.24, 0.22), dirtV * 0.6);
  col = mix(col, mix(L(0.24, 0.16, 0.12), L(0.42, 0.28, 0.17), rg), rust);
  col = mix(col, vec3(0.5, 0.52, 0.54), fast); col *= 1.0 - washer * 0.4;
  col *= 1.0 - lapV * 0.5;
  float h = cz * 0.9 + (fine - 0.5) * 0.008 + fast * 0.05 - lapV * 0.03;
  float r = 0.5 + (streak2 - 0.5) * 0.14 + (big - 0.5) * 0.12; r = mix(r, 0.8, dirtV); r = mix(r, 0.92, rust);
  emit(col, 1.0, h, mix(0.72, 1.0, smoothstep(0.0, 0.6, cz)) * (1.0 - lapV * 0.4), r, 0.72 * (1.0 - rust * 0.9) * (1.0 - dirtV * 0.6));
}`;

SURFACE_SHADERS.chainlink = `
void surf(vec2 uv){
  float n = 7.0; float a = (uv.x + uv.y) * n, b = (uv.x - uv.y) * n;
  float da = abs(fract(a) - 0.5), db = abs(fract(b) - 0.5);
  float rw = 0.044;
  float over = mod(floor(a) + floor(b), 2.0) < 0.5 ? 1.0 : -1.0;
  float pa = sqrt(max(0.0, 1.0 - (da / rw) * (da / rw))), pb = sqrt(max(0.0, 1.0 - (db / rw) * (db / rw)));
  float za = over * cos((fract(b) - 0.5) * 3.14159), zb = -over * cos((fract(a) - 0.5) * 3.14159);
  float ha = da < rw ? 0.45 + 0.2 * za + 0.3 * pa : 0.0, hb = db < rw ? 0.45 + 0.2 * zb + 0.3 * pb : 0.0;
  float px = uTexel * n * 1.41421;
  float alpha = max(smoothstep(rw + px * 0.5, rw - px * 0.5, da), smoothstep(rw + px * 0.5, rw - px * 0.5, db));
  float fine = fbm(uv, vec2(120.0), 3, 1.0);
  vec3 col = vec3(0.6, 0.62, 0.64) * (0.8 + 0.3 * fine);
  float rust = smoothstep(0.62, 0.75, fbm(uv, vec2(9.0), 4, 3.0)); col = mix(col, L(0.42, 0.26, 0.15), rust * 0.8);
  emit(col, alpha, max(ha, hb), 1.0, mix(0.4 + 0.2 * fine, 0.9, rust), 1.0 - rust * 0.9);
}`;

SURFACE_SHADERS.gunmetal = `
void surf(vec2 uv){
  float fine = fbm(uv, vec2(160.0), 3, 1.0), mid = fbm(uv, vec2(12.0), 4, 2.0), big = fbm(uv, vec2(2.0), 4, 3.0);
  vec4 g = vor(uv * 200.0, vec2(200.0), 4.0);
  float wear = smoothstep(0.66, 0.92, fbm(uv, vec2(4.0), 5, 5.0) + (fine - 0.5) * 0.1) * uP.x;
  float s1 = scr(uv, 8.0, 6.0, 0.005, 0.3, 6.3, 0.3), s2 = scr(uv, 24.0, 7.0, 0.011, 1.2, 6.3, 0.32), s3 = scr(uv, 60.0, 8.0, 0.03, 0.0, 6.3, 0.3);
  float sc = sat(max(s1 * uP.x, max(s2 * 0.8, s3 * 0.6)));
  float bright = sat(wear * 0.22 + sc * (0.3 + 0.4 * uP.x));
  float oil = smoothstep(0.4, 0.75, fbm(uv, vec2(3.0, 5.0), 4, 9.0));
  vec3 nt = vec3(0.0); float ta = 0.9 * (0.8 + 0.25 * (mid - 0.5) + 0.2 * (g.w - 0.5) + 0.15 * (big - 0.5));
  OV(vec3(0.42, 0.42, 0.44), bright * 0.6);
  float r = 0.58 + (g.w - 0.5) * 0.12 + (mid - 0.5) * 0.1 - oil * 0.14 - wear * 0.14; r = mix(r, 0.3, bright * 0.8);
  float h = 0.5 + (g.x - 0.5) * 0.12 + (fine - 0.5) * 0.1 - sc * 0.25 - wear * 0.05;
  emit(nt, ta, h, 1.0 - sc * 0.1, r, mix(0.75, 1.0, bright));
}`;

SURFACE_SHADERS.polymer = `
void surf(vec2 uv){
  vec4 g = vor(uv * 40.0, vec2(40.0), 1.0); vec4 g2 = vor(uv * 90.0 + 0.5, vec2(90.0), 2.0);
  float fine = fbm(uv, vec2(120.0), 2, 3.0), big = fbm(uv, vec2(3.0), 4, 4.0);
  float stip = smoothstep(0.6, 0.1, g.x) * (0.5 + 0.5 * g.w) * 0.7 + smoothstep(0.6, 0.1, g2.x) * 0.3;
  float scuff = smoothstep(0.62, 0.8, fbm(uv, vec2(4.0), 5, 5.0));
  float sc = scr(uv, 10.0, 6.0, 0.01, 0.5, 6.3, 0.4);
  vec3 nt = vec3(0.0); float ta = 0.92 * (0.9 + 0.12 * (big - 0.5) + 0.08 * (fine - 0.5));
  OV(vec3(0.45), sc * 0.25 + scuff * 0.06);
  float h = 0.3 + stip * 0.6 * (1.0 - scuff * 0.6) + (fine - 0.5) * 0.05 - sc * 0.2;
  float r = 0.62 + (stip - 0.5) * 0.1 + (big - 0.5) * 0.1 - scuff * 0.22 + sc * 0.1;
  emit(nt, ta, h, 0.8 + 0.2 * stip, r, 0.0);
}`;

SURFACE_SHADERS.carbon = `
void surf(vec2 uv){
  vec2 p = uv * 12.0; vec2 i = floor(p), q = fract(p);
  float warpTop = step(mod(i.x - i.y + 400.0, 4.0), 1.5);
  float prof = warpTop > 0.5 ? sin(q.x * 3.14159) : sin(q.y * 3.14159);
  float fib = warpTop > 0.5 ? fbm(uv, vec2(240.0, 12.0), 2, 1.0) : fbm(uv, vec2(12.0, 240.0), 2, 5.0);
  float h = 0.35 + 0.5 * pow(prof, 0.6) + (fib - 0.5) * 0.12;
  vec3 col = vec3(0.035, 0.036, 0.04) * (0.7 + 0.6 * fib) * (warpTop > 0.5 ? 1.0 : 0.8);
  float big = fbm(uv, vec2(2.0), 3, 2.0);
  emit(col, 1.0, h, 0.6 + 0.4 * prof, 0.32 + (fib - 0.5) * 0.2 + (big - 0.5) * 0.1, 0.0);
}`;

SURFACE_SHADERS.fabric = `
void surf(vec2 uv){
  float f = 36.0; vec2 p = uv * f; vec2 i = floor(p), q = fract(p);
  float top = mod(i.x + i.y, 2.0);
  float pw = sin(q.x * 3.14159), pf = sin(q.y * 3.14159);
  float h = top > 0.5 ? pw * (0.6 + 0.4 * pf) : pf * (0.6 + 0.4 * pw) * 0.85;
  float fz = fbm(uv, vec2(150.0), 3, 1.0), big = fbm(uv, vec2(2.0), 4, 2.0);
  float thr = h3(vec2(top > 0.5 ? i.x : i.y, top), vec2(f), 3.0).x;
  float ta = 0.9 * (0.55 + 0.45 * h) * (0.85 + 0.2 * (thr - 0.5) + 0.2 * (fz - 0.5) + 0.2 * (big - 0.5));
  emit(vec3(0.0), ta, 0.2 + h * 0.7 + (fz - 0.5) * 0.15, 0.5 + 0.5 * h, 0.92, 0.0);
}`;

SURFACE_SHADERS.armor = `
void surf(vec2 uv){
  float chip, stain, run; paintDmg(uv, 0.5, chip, stain, run);
  float fine = fbm(uv, vec2(200.0), 2, 1.0), mid = fbm(uv, vec2(14.0), 4, 2.0), big = fbm(uv, vec2(2.0), 4, 3.0);
  float grime = smoothstep(0.45, 0.8, fbm(uv, vec2(3.0, 4.0), 5, 4.0)); float sc = scr(uv, 14.0, 5.0, 0.008, 0.4, 6.3, 0.5);
  float sub = smoothstep(0.5, 0.75, chip), prim = smoothstep(0.15, 0.4, chip) * (1.0 - sub);
  vec3 nt = vec3(0.0); float ta = 0.85 * (0.92 + 0.14 * (mid - 0.5) + 0.1 * (big - 0.5));
  OV(L(0.2, 0.18, 0.15), grime * 0.07 * (0.5 + fine));
  OV(vec3(0.55), sc * 0.3);
  OV(L(0.5, 0.5, 0.47), prim);
  float wv = fbm(uv, vec2(160.0, 8.0), 2, 6.0);
  OV(L(0.4, 0.38, 0.33) * (0.6 + 0.8 * wv), sub);
  float h = 0.6 + (fine - 0.5) * 0.04 + (mid - 0.5) * 0.03 - prim * 0.1 - sub * 0.25 - sc * 0.08;
  float r = 0.36 + (mid - 0.5) * 0.1 + grime * 0.1 + sc * 0.15; r = mix(r, 0.6, prim); r = mix(r, 0.75, sub);
  emit(nt, ta, h, 1.0 - sub * 0.2, r, 0.0);
}`;

SURFACE_SHADERS.wood = `
void surf(vec2 uv){
  vec4 kv = vor(uv * vec2(2.0, 4.0), vec2(2.0, 4.0), 1.0); float isK = step(kv.z, 0.3);
  float knot = isK * smoothstep(0.2, 0.0, length((kv.x) * vec2(1.0))), core = isK * smoothstep(0.05, 0.03, kv.x);
  float wob = fbm(uv, vec2(1.0, 3.0), 3, 2.0);
  float ring = fract(uv.y * 44.0 + (wob - 0.5) * 2.4 + knot * knot * 4.0 + (fbm(uv, vec2(4.0, 30.0), 2, 12.0) - 0.5) * 0.35);
  float late = smoothstep(0.5, 0.92, ring) * (1.0 - smoothstep(0.92, 1.0, ring));
  float fib = fbm(uv, vec2(3.0, 260.0), 3, 3.0), fib2 = fbm(uv, vec2(8.0, 90.0), 3, 4.0);
  float saw = 0.5 + 0.5 * sin((uv.x + 0.02 * sin(uv.y * TAU * 2.0)) * TAU * 240.0);
  float sawK = smoothstep(0.35, 0.7, fbm(uv, vec2(3.0), 3, 5.0));
  float grey = smoothstep(0.2, 0.68, fbm(uv, vec2(2.0, 3.0), 5, 6.0));
  float crack = smoothstep(0.84, 0.87, fbm(uv, vec2(2.0, 110.0), 3, 7.0)) * smoothstep(0.45, 0.65, fbm(uv, vec2(5.0, 3.0), 3, 8.0));
  vec3 early = L(0.58, 0.49, 0.38), lateC = L(0.36, 0.28, 0.2);
  float bigv = fbm(uv, vec2(1.0, 2.0), 3, 21.0);
  vec3 col = mix(early, lateC, late * 0.9) * (0.85 + 0.6 * (fib - 0.5) + 0.4 * (fib2 - 0.5)) * (0.78 + 0.44 * bigv);
  col = mix(col, lateC * 0.8, knot * 0.5); col = mix(col, L(0.28, 0.17, 0.09), core);
  col = mix(col, L(0.47, 0.465, 0.45) * (0.7 + 0.6 * fib) * (1.0 - late * 0.3), grey * 0.82);
  float dirt = smoothstep(0.55, 0.85, fbm(uv, vec2(4.0), 5, 9.0)); col *= 1.0 - dirt * 0.35;
  col *= 1.0 - crack * 0.55;
  float h = 0.5 + (fib - 0.5) * 0.4 + (late - 0.5) * 0.2 - (saw - 0.5) * 0.12 * sawK + (fib2 - 0.5) * 0.15 - crack * 0.3 + core * 0.05;
  emit(col, 1.0, h, 1.0 - crack * 0.5, 0.82 + (fib - 0.5) * 0.15 + grey * 0.08 - core * 0.15, 0.0);
}`;

SURFACE_SHADERS.plastic = `
void surf(vec2 uv){
  float fine = fbm(uv, vec2(220.0), 3, 1.0), mid = fbm(uv, vec2(14.0), 4, 2.0), big = fbm(uv, vec2(2.0), 4, 3.0);
  float scuff = smoothstep(0.55, 0.75, fbm(uv, vec2(5.0, 8.0), 5, 4.0));
  float s1 = scr(uv, 7.0, 5.0, 0.005, 0.2, 6.3, 0.35), s2 = scr(uv, 22.0, 6.0, 0.012, 1.0, 6.3, 0.3), s3 = scr(uv, 50.0, 7.0, 0.03, 2.0, 6.3, 0.25);
  float sc = sat(max(s1, max(s2 * 0.8, s3 * 0.5)));
  float dirt = smoothstep(0.5, 0.85, fbm(uv, vec2(3.0), 5, 8.0));
  vec3 nt = vec3(0.0); float ta = 0.9 * (0.92 + 0.1 * (mid - 0.5) + 0.1 * (big - 0.5));
  OV(vec3(0.6), sc * 0.22 + scuff * 0.03 * fine);
  OV(L(0.25, 0.22, 0.18), dirt * 0.4);
  float h = 0.5 + (fine - 0.5) * 0.12 + (mid - 0.5) * 0.04 - sc * 0.25;
  emit(nt, ta, h, 1.0, 0.42 + (fine - 0.5) * 0.08 + scuff * 0.2 + sc * 0.2 + dirt * 0.2, 0.0);
}`;

SURFACE_SHADERS.tarp = `
void surf(vec2 uv){
  vec2 wu = uv + (vec2(fbm(uv, vec2(2.0), 3, 1.0), fbm(uv, vec2(2.0), 3, 2.0)) - 0.5) * 0.12;
  float f1 = 1.0 - abs(gn(wu * vec2(2.0, 7.0), vec2(2.0, 7.0), 3.0)) * 2.4;        // long drape folds
  float f2 = 1.0 - abs(gn(wu * vec2(5.0, 13.0) + 2.0, vec2(5.0, 13.0), 4.0)) * 2.4; // finer wrinkles
  f1 = smoothstep(0.0, 1.0, sat(f1)); f2 = smoothstep(0.2, 1.0, sat(f2));
  float bill = fbm(wu, vec2(2.0, 3.0), 3, 5.0);
  float scrim = max(smoothstep(0.42, 0.5, abs(fract(uv.x * 200.0) - 0.5)), smoothstep(0.42, 0.5, abs(fract(uv.y * 200.0) - 0.5)));
  float fine = fbm(uv, vec2(240.0), 2, 6.0), mid = fbm(uv, vec2(14.0), 4, 7.0);
  float h = 0.25 + bill * 0.35 + f1 * 0.22 + f2 * 0.07 + scrim * 0.02 + (fine - 0.5) * 0.012;
  float dirt = smoothstep(0.5, 0.85, fbm(uv, vec2(4.0), 5, 8.0) + (0.5 - f1) * 0.08);
  vec3 nt = vec3(0.0); float ta = 0.9 * (0.88 + 0.14 * (mid - 0.5)) * (1.0 - scrim * 0.06);
  OV(vec3(0.5), smoothstep(0.85, 1.0, f1) * 0.03);
  OV(L(0.3, 0.27, 0.22), dirt * 0.3);
  emit(nt, ta, h, 0.9 + 0.1 * smoothstep(0.1, 0.7, f1), 0.48 + (mid - 0.5) * 0.15 + dirt * 0.25, 0.0);
}`;

SURFACE_SHADERS.cardboard = `
void surf(vec2 uv){
  float fl = 0.5 + 0.5 * cos(uv.y * TAU * 140.0);
  float fib = fbm(uv, vec2(40.0, 160.0), 3, 1.0), fine = fbm(uv, vec2(250.0), 2, 2.0), big = fbm(uv, vec2(2.0), 4, 3.0);
  float sn = fbm(uv, vec2(3.0), 5, 4.0); float damp = smoothstep(0.62, 0.72, sn); float tide = smoothstep(0.61, 0.64, sn) * (1.0 - smoothstep(0.64, 0.7, sn));
  float crease = smoothstep(0.012, 0.004, abs(fbm(uv, vec2(2.0), 2, 5.0) - 0.5)) * smoothstep(0.5, 0.7, fbm(uv, vec2(3.0), 2, 6.0));
  vec3 col = L(0.66, 0.52, 0.36) * (0.85 + 0.2 * (fib - 0.5) + 0.12 * (fine - 0.5) + 0.2 * (big - 0.5)) * (0.97 + 0.06 * fl);
  col *= (1.0 - damp * 0.3) * (1.0 - tide * 0.18); col = mix(col, col * 1.25, crease * 0.5);
  col *= 1.0 - smoothstep(0.8, 0.9, fbm(uv, vec2(120.0), 2, 7.0)) * 0.2;
  float h = 0.5 + (fl - 0.5) * 0.12 + (fib - 0.5) * 0.15 + (fine - 0.5) * 0.08 - crease * 0.3 + damp * 0.2 * (fbm(uv, vec2(20.0), 3, 8.0) - 0.5);
  emit(col, 1.0, h, 1.0 - crease * 0.3, 0.9 - damp * 0.2 + (fib - 0.5) * 0.1, 0.0);
}`;

SURFACE_SHADERS.rope = `
void surf(vec2 uv){
  float a = (uv.x + uv.y) * 4.0; float prof = sin(fract(a) * 3.14159);
  float fib = fbm(uv, vec2(60.0), 3, 1.0);
  float yarn = 0.5 + 0.5 * sin((uv.x - uv.y) * 4.0 * TAU * 5.0 + 2.0 * sin(a * TAU));
  float h = pow(prof, 0.7) * 0.8 + yarn * 0.1 + (fib - 0.5) * 0.15;
  vec3 col = L(0.66, 0.6, 0.46) * (0.6 + 0.4 * prof) * (0.85 + 0.3 * (fib - 0.5)) * (0.92 + 0.16 * yarn);
  float dirt = smoothstep(0.4, 0.8, fbm(uv, vec2(3.0), 4, 2.0)); col = mix(col, L(0.25, 0.22, 0.18), dirt * 0.5 * (1.0 - prof * 0.5));
  emit(col, 1.0, h, 0.45 + 0.55 * prof, 0.95, 0.0);
}`;

SURFACE_SHADERS.tire = `
void surf(vec2 uv){
  float sv = fract(uv.y + 0.5) - 0.5; float v = abs(sv) * 2.0; float u = uv.x;
  float zig = 0.03 * abs(fract(u * 10.0) - 0.5) * 2.0;
  float g1 = smoothstep(0.035, 0.02, abs(v - 0.36 - zig)), g0 = smoothstep(0.03, 0.018, abs(v - zig * 0.5));
  float lat = smoothstep(0.06, 0.03, abs(fract(u * 10.0 + v * 1.2 * sign(sv)) - 0.5)) * step(0.4, v) * step(v, 0.8);
  float sipe = smoothstep(0.012, 0.005, abs(fract(u * 20.0 + v * 0.8) - 0.5)) * step(0.05, v) * step(v, 0.33);
  float groove = sat(max(max(g0, g1), max(lat, sipe * 0.6)));
  float side = smoothstep(0.84, 0.9, v);
  float rib = (0.5 + 0.5 * cos(v * TAU * 14.0)) * side;
  float fine = fbm(uv, vec2(200.0, 120.0), 3, 1.0), mid = fbm(uv, vec2(10.0, 6.0), 4, 2.0);
  float h = (1.0 - groove) * (1.0 - side) * 0.8 + side * (0.35 + rib * 0.1) + (fine - 0.5) * 0.04;
  float dust = smoothstep(0.4, 0.75, fbm(uv, vec2(4.0, 3.0), 5, 3.0));
  vec3 col = vec3(0.022) * (0.8 + 0.5 * (mid - 0.5)); col = mix(col, L(0.22, 0.2, 0.17), dust * 0.25 + groove * (1.0 - side) * 0.2);
  emit(col, 1.0, h, 1.0 - groove * 0.5 * (1.0 - side), 0.85 + (fine - 0.5) * 0.1 - side * 0.1, 0.0);
}`;

SURFACE_SHADERS.glass = `
void surf(vec2 uv){
  float d = uP.x;
  float big = fbm(uv, vec2(2.0), 5, 1.0), mid = fbm(uv, vec2(12.0), 4, 2.0), fine = fbm(uv, vec2(200.0), 2, 3.0);
  float dust = sat(smoothstep(0.75 - 0.45 * d, 0.95 - 0.3 * d, big * 0.7 + mid * 0.3) + fine * 0.15 * d);
  float st2 = fbm(uv, vec2(120.0, 3.0), 2, 5.0);
  float trail = smoothstep(0.62, 0.72, fbm(uv, vec2(50.0, 1.0), 2, 4.0)) * smoothstep(0.3, 0.6, fbm(uv, vec2(50.0, 2.0), 2, 6.0));
  vec4 dv = vor(uv * 60.0, vec2(60.0), 7.0); float drop = step(dv.z, 0.45) * smoothstep(0.32 * dv.w + 0.06, 0.0, dv.x);
  vec4 dv2 = vor(uv * 150.0, vec2(150.0), 8.0); float drop2 = step(dv2.z, 0.5) * smoothstep(0.3 * dv2.w + 0.05, 0.0, dv2.x);
  dust *= 1.0 - trail * 0.7;
  vec3 col = mix(L(0.5, 0.6, 0.62) * 0.25, L(0.5, 0.47, 0.4), dust);
  float alpha = mix(0.16, 0.55 + 0.35 * d, dust) + drop * 0.08 + (st2 - 0.5) * 0.05 * d;
  float h = 0.3 + drop * 0.5 + drop2 * 0.15 + trail * 0.06 * st2;
  float r = mix(0.03, 0.55, dust); r = mix(r, 0.03, sat(drop * 2.0));
  emit(col, alpha, h, 1.0, r, 0.0);
}`;

SURFACE_SHADERS.water = `
void surf(vec2 uv){
  float a = fbm(uv, vec2(6.0, 10.0), 4, 1.0), b = fbm(uv + 0.3, vec2(20.0, 30.0), 3, 2.0);
  emit(L(0.1, 0.16, 0.18) * 0.5, 1.0, 0.5 + (a - 0.5) * 0.6 + (b - 0.5) * 0.2, 1.0, 0.06, 0.0);
}`;

Object.defineProperties(propsModule, {
  PROP_SIZES: {
    get: () => PROP_SIZES,
    enumerable: true,
  },
  create: {
    get: () => createProps,
    enumerable: true,
  },
  register: {
    get: () => registerPropBuilder,
    enumerable: true,
  },
  showcase: {
    get: () => showcaseProps,
    enumerable: true,
  },
});

for (let i of ['container20', 'container40', 'container40hc'])
  registerPropBuilder(i, (e, t) => buildBasicContainer(e, i, t));

registerPropBuilder('jersey_barrier', buildJerseyBarrier);

registerPropBuilder('light_mast', buildLightMast);

registerPropBuilder('fence_panel', buildFencePanel);

registerPropBuilder('guard_booth', buildGuardBooth);

registerPropBuilder('gate_arm', buildGateArm);

registerPropBuilder('bollard_mooring', buildMooringBollard);

registerPropBuilder('bollard_post', buildBollardPost);

registerPropBuilder('sign_post', buildSignPost);

registerPropBuilder('floodlight_stand', buildFloodlightStand);

registerPropBuilder('stairs_metal', buildMetalStairs);

registerPropBuilder('catwalk', buildCatwalk);

registerPropBuilder('shelf_rack', buildShelfRack);

registerPropBuilder('reefer_unit', buildReeferUnit);

registerPropBuilder('relay_node', buildRelayNode);

registerDetailedProps(registerPropBuilder);

registerCharacterProps(registerPropBuilder);

registerCargoProps(registerPropBuilder);

Object.defineProperties(PROPS_MODULE_EXPORTS, {
  create: {
    get: () => createLevel,
    enumerable: true,
  },
  showcase: {
    get: () => showcaseLevel,
    enumerable: true,
  },
});

Object.defineProperties(backdropModule, {
  create: {
    get: () => createBackdrop,
    enumerable: true,
  },
  showcase: {
    get: () => showcaseBackdrop,
    enumerable: true,
  },
});

Object.defineProperties(groundModule, {
  create: {
    get: () => createGround,
    enumerable: true,
  },
  showcase: {
    get: () => showcaseGround,
    enumerable: true,
  },
});

for (let i of SEA_WAVE_MAIN.concat(SEA_WAVE_DETAIL)) {
  let e = Math.hypot(i[0], i[1]);
  ((i[0] /= e), (i[1] /= e), (i[4] = (2 * Math.PI) / i[2]), (i[5] = Math.sqrt(9.81 * i[4])));
}

Object.defineProperties(FX_MODULE, {
  create: {
    get: () => createEffects,
    enumerable: true,
  },
  showcase: {
    get: () => showcaseEffects,
    enumerable: true,
  },
});

Object.defineProperties(weaponModule, {
  create: {
    get: () => createWeapon,
    enumerable: true,
  },
  showcase: {
    get: () => showcaseWeapon,
    enumerable: true,
  },
});

Object.defineProperties(ex, {
  TUNE: {
    get: () => AI_TUNE,
    enumerable: true,
  },
  create: {
    get: () => createEnemies,
    enumerable: true,
  },
  showcase: {
    get: () => showcaseEnemies,
    enumerable: true,
  },
});

window.__frames = 0;

window.__ready = !1;

window.__fatal = null;

window.__errors = [];

window.addEventListener('error', (i) => {
  window.__errors.push(String(i.message));
});

{
  let i = console.error.bind(console);
  console.error = (...e) => {
    try {
      window.__errors.push(
        e
          .map((t) => (t && t.stack) || String(t))
          .join(' ')
          .slice(0, 400),
      );
    } catch {}
    i(...e);
  };
}
