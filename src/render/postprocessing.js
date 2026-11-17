// render/postprocessing.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。着色器常量已拆到 render/shaders/post/。

import { SALTLINE_POST_VERT } from './shaders/post/common.js';
import { SALTLINE_AO_FRAG, SALTLINE_COMPOSITE_FRAG, SALTLINE_DEPTHCOPY_FRAG, SALTLINE_DEPTHHALF_FRAG, SALTLINE_VOLUMETRIC_FRAG } from './shaders/post/depth.js';
import { SALTLINE_BLUR_FRAG, SALTLINE_DOWN_FRAG, SALTLINE_STREAK_FRAG, SALTLINE_UP_FRAG } from './shaders/post/bloom.js';
import { SALTLINE_ADAPT_FRAG, SALTLINE_FINAL_FRAG, SALTLINE_GRADE_FRAG, SALTLINE_LENS_DIRT_FRAG, SALTLINE_MOTIONBLUR_FRAG } from './shaders/post/output.js';
import * as THREE from 'three';
import { SKY_COLORS, SUN } from '../core/config.js';
import { clamp01 } from '../core/math.js';

/**
 * 所有后处理片元着色器共用的首行注释标记：既让 shader 报错能归类为 post pass 并解析出 pass 名，也是后处理链的识别特征
 */
export var SALTLINE_POST_MARKER = '// SALTLINE_POST';

/**
 * 后处理链编排器：自建全屏几何与正交相机，按画质预建全部 RenderTarget 与 pass 材质（深度复制/线性深度/AO/体积光/合成/运动模糊/bloom 金字塔/光条/自适应/dirt/grade/final），并暴露 run/resize/copyDepth/readAdapt/dispose 与 TUNE 调参表；初始化失败由调用方整体回退到 forward 渲染
 */
export function createPostprocessing(renderer, ctx, { noiseTex: noiseTexture }) {
  let quadGeometry = new THREE.BufferGeometry();
  (quadGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  ),
    quadGeometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2),
    ));
  let quadMesh = new THREE.Mesh(quadGeometry, null);
  quadMesh.frustumCulled = !1;
  let fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    materials = [],
    makePassMaterial = (oe, fe, le, R = {}) => {
      let I = new THREE.ShaderMaterial({
        name: 'post-' + oe,
        vertexShader: SALTLINE_POST_VERT,
        fragmentShader: `${SALTLINE_POST_MARKER} ${oe}
${fe}`,
        uniforms: le,
        depthTest: !1,
        depthWrite: !1,
        blending: THREE.NoBlending,
        toneMapped: !1,
        ...R,
      });
      return (materials.push(I), I);
    };
  function renderPass(oe, fe) {
    ((quadMesh.material = oe), renderer.setRenderTarget(fe), renderer.render(quadMesh, fsCamera));
  }
  let HALF_FLOAT_TYPE = THREE.HalfFloatType,
    UNSIGNED_BYTE_TYPE = THREE.UnsignedByteType,
    LINEAR_FILTER = THREE.LinearFilter,
    NEAREST_FILTER = THREE.NearestFilter,
    createTarget = (oe = HALF_FLOAT_TYPE, fe = LINEAR_FILTER, le = {}) => {
      let R = new THREE.WebGLRenderTarget(4, 4, {
        type: oe,
        format: THREE.RGBAFormat,
        minFilter: fe,
        magFilter: fe,
        depthBuffer: !1,
        stencilBuffer: !1,
        generateMipmaps: !1,
        ...le,
      });
      return ((R.texture.generateMipmaps = !1), R);
    },
    getQuality = () => ctx.quality,
    skyUniforms = () => ({
      uSunDir: {
        value: SUN.dir.clone(),
      },
      uZen: {
        value: SKY_COLORS.zenith.clone(),
      },
      uHor: {
        value: SKY_COLORS.horizon.clone(),
      },
      uHorAway: {
        value: SKY_COLORS.horizonAway.clone(),
      },
      uSunCol: {
        value: SUN.color.clone(),
      },
    }),
    TUNE = {
      volSunScale: 0.85,
      volAmbient: 0.2,
      volSigma: 0.0034,
      volMaxDist: 170,
      volFarHaze: 0.42,
      volInteriorDust: 6,
      aoRadius: 0.9,
      aoIntensity: 1.6,
      aoStrength: 0.95,
      bloom: 0.065,
      bloomMix: 0.62,
      dirt: 0.1,
      streak: 0.03,
      streakThreshold: 2.2,
      flare: 0.16,
      key: 0.12,
      minExposure: 0.6,
      maxExposure: 2,
      adaptTau: 1.5,
      agxMix: 0.25,
      ca: 0.0013,
      vignette: 0.3,
      grain: 0.02,
      sharpen: 0.3,
      lookPower: 1.18,
      lookSat: 1.22,
    },
    supportsFloatColor = !1;
  try {
    supportsFloatColor = !!renderer.extensions.has('EXT_color_buffer_float');
  } catch {
    supportsFloatColor = !1;
  }
  let renderTargets = {
      scene: createTarget(HALF_FLOAT_TYPE, LINEAR_FILTER),
      motion: createTarget(HALF_FLOAT_TYPE, LINEAR_FILTER),
      ldr: createTarget(UNSIGNED_BYTE_TYPE, LINEAR_FILTER),
      depthHalf: supportsFloatColor
        ? createTarget(THREE.FloatType, NEAREST_FILTER, {
            format: THREE.RedFormat,
          })
        : createTarget(HALF_FLOAT_TYPE, NEAREST_FILTER),
      aoA: createTarget(UNSIGNED_BYTE_TYPE, NEAREST_FILTER),
      aoB: createTarget(UNSIGNED_BYTE_TYPE, NEAREST_FILTER),
      volA: createTarget(HALF_FLOAT_TYPE, NEAREST_FILTER),
      volB: createTarget(HALF_FLOAT_TYPE, NEAREST_FILTER),
      down: [],
      up: [],
      streakA: createTarget(HALF_FLOAT_TYPE, LINEAR_FILTER),
      streakB: createTarget(HALF_FLOAT_TYPE, LINEAR_FILTER),
      adapt: [
        createTarget(HALF_FLOAT_TYPE, NEAREST_FILTER),
        createTarget(HALF_FLOAT_TYPE, NEAREST_FILTER),
      ],
      dirt: createTarget(UNSIGNED_BYTE_TYPE, LINEAR_FILTER),
      depthCopy: null,
    },
    BLOOM_LEVELS = 6;
  for (let stageValue = 0; stageValue < BLOOM_LEVELS; stageValue++)
    renderTargets.down.push(createTarget(HALF_FLOAT_TYPE, LINEAR_FILTER));
  for (let stageValue = 0; stageValue < BLOOM_LEVELS - 1; stageValue++)
    renderTargets.up.push(createTarget(HALF_FLOAT_TYPE, LINEAR_FILTER));
  (renderTargets.adapt[0].setSize(1, 1),
    renderTargets.adapt[1].setSize(1, 1),
    renderTargets.dirt.setSize(512, 288));
  let adaptIndex = 0,
    frameCount = 0,
    dirtBaked = !1,
    size = {
      w: 4,
      h: 4,
      hw: 2,
      hh: 2,
    },
    exposureUniforms = {
      tAdapt: {
        value: null,
      },
      uExposure: {
        value: 1,
      },
      uKey: {
        value: TUNE.key,
      },
      uMinE: {
        value: TUNE.minExposure,
      },
      uMaxE: {
        value: TUNE.maxExposure,
      },
      uAuto: {
        value: 1,
      },
    },
    depthCopyMat = makePassMaterial(
      'depthcopy',
      SALTLINE_DEPTHCOPY_FRAG,
      {
        tDepth: {
          value: null,
        },
      },
      {
        depthTest: !0,
        depthWrite: !0,
        depthFunc: THREE.AlwaysDepth,
        colorWrite: !1,
      },
    ),
    depthHalfMat = makePassMaterial('depthhalf', SALTLINE_DEPTHHALF_FRAG, {
      tDepth: {
        value: null,
      },
      uNear: {
        value: 0.08,
      },
      uFar: {
        value: 900,
      },
    }),
    aoMat = makePassMaterial(
      'ao',
      SALTLINE_AO_FRAG,
      {
        tDepthHalf: {
          value: renderTargets.depthHalf.texture,
        },
        uTanHalf: {
          value: new THREE.Vector2(),
        },
        uTexel: {
          value: new THREE.Vector2(),
        },
        uRadius: {
          value: TUNE.aoRadius,
        },
        uIntensity: {
          value: TUNE.aoIntensity,
        },
        uAspect: {
          value: 1,
        },
      },
      {
        defines: {
          AO_TAPS: 12,
        },
      },
    ),
    volMat = makePassMaterial(
      'vol',
      SALTLINE_VOLUMETRIC_FRAG,
      {
        tDepthHalf: {
          value: renderTargets.depthHalf.texture,
        },
        tShadow: {
          value: null,
        },
        uShadowMatrix: {
          value: new THREE.Matrix4(),
        },
        uCamWorld: {
          value: new THREE.Matrix4(),
        },
        uCamPos: {
          value: new THREE.Vector3(),
        },
        uSunRad: {
          value: new THREE.Vector3(),
        },
        uAmb: {
          value: new THREE.Vector3(),
        },
        uTanHalf: {
          value: new THREE.Vector2(),
        },
        uHasShadow: {
          value: 0,
        },
        uMaxDist: {
          value: TUNE.volMaxDist,
        },
        uSigma: {
          value: TUNE.volSigma,
        },
        uFarZ: {
          value: 900,
        },
        uFarHaze: {
          value: TUNE.volFarHaze,
        },
        uFlicker: {
          value: 0,
        },
        uBoxDust: {
          value: 0,
        },
        uBoxMin: {
          value: new THREE.Vector3(1e6, 1e6, 1e6),
        },
        uBoxMax: {
          value: new THREE.Vector3(-1e6, -1e6, -1e6),
        },
        ...skyUniforms(),
      },
      {
        defines: {
          VOL_STEPS: 16,
        },
      },
    ),
    blurAoMat = makePassMaterial(
      'blur-ao',
      SALTLINE_BLUR_FRAG,
      {
        tSrc: {
          value: null,
        },
        tDepthHalf: {
          value: renderTargets.depthHalf.texture,
        },
        uDir: {
          value: new THREE.Vector2(),
        },
      },
      {
        defines: {
          BLUR_TOL: '0.04',
        },
      },
    ),
    blurVolMat = makePassMaterial(
      'blur-vol',
      SALTLINE_BLUR_FRAG,
      {
        tSrc: {
          value: null,
        },
        tDepthHalf: {
          value: renderTargets.depthHalf.texture,
        },
        uDir: {
          value: new THREE.Vector2(),
        },
      },
      {
        defines: {
          BLUR_TOL: '0.30',
        },
      },
    ),
    compositeMat = makePassMaterial('composite', SALTLINE_COMPOSITE_FRAG, {
      tColor: {
        value: null,
      },
      tDepth: {
        value: null,
      },
      tDepthHalf: {
        value: renderTargets.depthHalf.texture,
      },
      tAO: {
        value: renderTargets.aoA.texture,
      },
      tVol: {
        value: renderTargets.volA.texture,
      },
      uHalfRes: {
        value: new THREE.Vector2(),
      },
      uNear: {
        value: 0.08,
      },
      uFar: {
        value: 900,
      },
      uAoOn: {
        value: 1,
      },
      uVolOn: {
        value: 1,
      },
      uAoStrength: {
        value: TUNE.aoStrength,
      },
      ...exposureUniforms,
    }),
    motionMat = makePassMaterial('motion', SALTLINE_MOTIONBLUR_FRAG, {
      tColor: {
        value: renderTargets.scene.texture,
      },
      tDepth: {
        value: null,
      },
      uInvViewProj: {
        value: new THREE.Matrix4(),
      },
      uPrevViewProj: {
        value: new THREE.Matrix4(),
      },
      uShutter: {
        value: 0.5,
      },
      uRes: {
        value: new THREE.Vector2(),
      },
    }),
    downMat = makePassMaterial('down', SALTLINE_DOWN_FRAG, {
      tSrc: {
        value: null,
      },
      uTexel: {
        value: new THREE.Vector2(),
      },
      uFirst: {
        value: 0,
      },
    }),
    upMat = makePassMaterial('up', SALTLINE_UP_FRAG, {
      tLow: {
        value: null,
      },
      tHigh: {
        value: null,
      },
      uTexel: {
        value: new THREE.Vector2(),
      },
      uMix: {
        value: TUNE.bloomMix,
      },
    }),
    streakMat = makePassMaterial('streak', SALTLINE_STREAK_FRAG, {
      tSrc: {
        value: null,
      },
      uDir: {
        value: new THREE.Vector2(),
      },
      uThreshold: {
        value: 0,
      },
      ...exposureUniforms,
    }),
    adaptMat = makePassMaterial('adapt', SALTLINE_ADAPT_FRAG, {
      tPrev: {
        value: null,
      },
      tLum: {
        value: null,
      },
      tDepth: {
        value: null,
      },
      uSunUv: {
        value: new THREE.Vector2(0.5, 0.5),
      },
      uSunOn: {
        value: 0,
      },
      uRate: {
        value: 1,
      },
      uVisRate: {
        value: 1,
      },
      uAspect: {
        value: 1,
      },
    }),
    dirtMat = makePassMaterial('dirt', SALTLINE_LENS_DIRT_FRAG, {
      tNoise: {
        value: noiseTexture,
      },
      uAspect: {
        value: 16 / 9,
      },
    }),
    gradeMat = makePassMaterial(
      'grade',
      SALTLINE_GRADE_FRAG,
      {
        tScene: {
          value: null,
        },
        tBloom: {
          value: renderTargets.up[0].texture,
        },
        tBlur: {
          value: renderTargets.down[1].texture,
        },
        tStreak: {
          value: renderTargets.streakB.texture,
        },
        tDirt: {
          value: renderTargets.dirt.texture,
        },
        ...exposureUniforms,
        uSunCol: {
          value: SUN.color.clone(),
        },
        uSunUv: {
          value: new THREE.Vector2(0.5, 0.5),
        },
        uTime: {
          value: 0,
        },
        uAspect: {
          value: 1,
        },
        uBloom: {
          value: TUNE.bloom,
        },
        uDirt: {
          value: TUNE.dirt,
        },
        uStreak: {
          value: TUNE.streak,
        },
        uFlare: {
          value: TUNE.flare,
        },
        uCA: {
          value: TUNE.ca,
        },
        uVignette: {
          value: TUNE.vignette,
        },
        uDamage: {
          value: 0,
        },
        uLowHealth: {
          value: 0,
        },
        uAds: {
          value: 0,
        },
        uFlash: {
          value: 0,
        },
        uFade: {
          value: 0,
        },
        uSaturation: {
          value: 1,
        },
        uSunOn: {
          value: 0,
        },
        uThunder: {
          value: 0,
        },
        uAgxMix: {
          value: TUNE.agxMix,
        },
      },
      {
        defines: {
          LOOK_POWER: TUNE.lookPower.toFixed(3),
          LOOK_SAT: TUNE.lookSat.toFixed(3),
        },
      },
    ),
    finalMat = makePassMaterial('final', SALTLINE_FINAL_FRAG, {
      tSrc: {
        value: renderTargets.ldr.texture,
      },
      uTexel: {
        value: new THREE.Vector2(),
      },
      uTime: {
        value: 0,
      },
      uGrain: {
        value: TUNE.grain,
      },
      uSharpen: {
        value: TUNE.sharpen,
      },
      uFxaa: {
        value: 1,
      },
    }),
    viewProj = new THREE.Matrix4(),
    prevViewProj = new THREE.Matrix4(),
    invViewProjScratch = new THREE.Matrix4(),
    sunClipPos = new THREE.Vector3(),
    scratchVec = new THREE.Vector3(),
    hasPrevFrame = !1;
  function syncQualityDefines() {
    let oe = Math.max(6, getQuality().volSteps | 0),
      fe =
        getQuality().name === 'test' || getQuality().name === 'low'
          ? 8
          : getQuality().name === 'ultra'
            ? 16
            : 12;
    (volMat.defines.VOL_STEPS !== oe &&
      ((volMat.defines.VOL_STEPS = oe), (volMat.needsUpdate = !0)),
      aoMat.defines.AO_TAPS !== fe && ((aoMat.defines.AO_TAPS = fe), (aoMat.needsUpdate = !0)));
  }
  function resize(oe, fe) {
    if (
      ((oe = Math.max(8, oe | 0)),
      (fe = Math.max(8, fe | 0)),
      (size.w = oe),
      (size.h = fe),
      (size.hw = Math.max(4, Math.ceil(oe / 2))),
      (size.hh = Math.max(4, Math.ceil(fe / 2))),
      renderTargets.scene.setSize(oe, fe),
      renderTargets.motion.setSize(oe, fe),
      renderTargets.ldr.setSize(oe, fe),
      renderTargets.depthCopy)
    ) {
      renderTargets.depthCopy.setSize(oe, fe);
      let I = renderTargets.depthCopy.depthTexture.image;
      (I.width !== oe || I.height !== fe) &&
        ((I.width = oe), (I.height = fe), (renderTargets.depthCopy.depthTexture.needsUpdate = !0));
    }
    for (let I of [
      renderTargets.depthHalf,
      renderTargets.aoA,
      renderTargets.aoB,
      renderTargets.volA,
      renderTargets.volB,
    ])
      I.setSize(size.hw, size.hh);
    let le = size.hw,
      R = size.hh;
    for (let I = 0; I < BLOOM_LEVELS; I++)
      (renderTargets.down[I].setSize(le, R),
        I < BLOOM_LEVELS - 1 && renderTargets.up[I].setSize(le, R),
        (le = Math.max(2, le >> 1)),
        (R = Math.max(2, R >> 1)));
    (renderTargets.streakA.setSize(renderTargets.down[2].width, renderTargets.down[2].height),
      renderTargets.streakB.setSize(renderTargets.down[2].width, renderTargets.down[2].height),
      (hasPrevFrame = !1),
      syncQualityDefines());
  }
  function ensureDepthCopy() {
    if (!renderTargets.depthCopy) {
      let oe = new THREE.DepthTexture(size.w, size.h);
      ((oe.type = THREE.UnsignedIntType),
        (oe.minFilter = oe.magFilter = NEAREST_FILTER),
        (renderTargets.depthCopy = new THREE.WebGLRenderTarget(size.w, size.h, {
          type: UNSIGNED_BYTE_TYPE,
          format: THREE.RGBAFormat,
          minFilter: NEAREST_FILTER,
          magFilter: NEAREST_FILTER,
          depthBuffer: !0,
          stencilBuffer: !1,
          depthTexture: oe,
          generateMipmaps: !1,
        })),
        renderer.setRenderTarget(renderTargets.depthCopy),
        renderer.setClearColor(0, 1),
        renderer.clear(!0, !0, !1),
        renderer.setRenderTarget(null));
    }
    return renderTargets.depthCopy.depthTexture;
  }
  function copyDepth(oe) {
    renderTargets.depthCopy &&
      ((depthCopyMat.uniforms.tDepth.value = oe),
      renderPass(depthCopyMat, renderTargets.depthCopy));
  }
  function run({
    hdr: oe,
    camera: fe,
    sun: le,
    dt: R,
    post: I,
    exposure: se,
    time: ae,
    fast: k,
    thunder: ce,
  }) {
    let ve = getQuality(),
      _e = fe.projectionMatrix.elements,
      Te = 1 / _e[0],
      Pe = 1 / _e[5],
      Re = Te / Pe,
      Fe = oe.depthTexture;
    ((exposureUniforms.tAdapt.value = renderTargets.adapt[adaptIndex].texture),
      (exposureUniforms.uExposure.value = se),
      (exposureUniforms.uAuto.value = pipeline.autoExposure ? 1 : 0),
      (exposureUniforms.uKey.value = TUNE.key),
      (exposureUniforms.uMinE.value = TUNE.minExposure),
      (exposureUniforms.uMaxE.value = TUNE.maxExposure),
      dirtBaked ||
        ((dirtMat.uniforms.uAspect.value = 16 / 9),
        renderPass(dirtMat, renderTargets.dirt),
        (dirtBaked = !0)),
      (depthHalfMat.uniforms.tDepth.value = Fe),
      (depthHalfMat.uniforms.uNear.value = fe.near),
      (depthHalfMat.uniforms.uFar.value = fe.far),
      renderPass(depthHalfMat, renderTargets.depthHalf));
    let ze = 1 / size.hw,
      We = 1 / size.hh,
      Ne = !!ve.ao;
    Ne &&
      (aoMat.uniforms.uTanHalf.value.set(Te, Pe),
      aoMat.uniforms.uTexel.value.set(ze, We),
      (aoMat.uniforms.uAspect.value = Re),
      renderPass(aoMat, renderTargets.aoA),
      (blurAoMat.uniforms.tSrc.value = renderTargets.aoA.texture),
      blurAoMat.uniforms.uDir.value.set(ze, 0),
      renderPass(blurAoMat, renderTargets.aoB),
      (blurAoMat.uniforms.tSrc.value = renderTargets.aoB.texture),
      blurAoMat.uniforms.uDir.value.set(0, We),
      renderPass(blurAoMat, renderTargets.aoA));
    let dt = (ve.volSteps | 0) > 0;
    if (dt) {
      let be = volMat.uniforms,
        Oe = ctx.level && ctx.level.interiorBoxes && ctx.level.interiorBoxes[0];
      Oe
        ? (be.uBoxMin.value.copy(Oe.min),
          be.uBoxMax.value.copy(Oe.max),
          (be.uBoxDust.value = TUNE.volInteriorDust))
        : (be.uBoxDust.value = 0);
      let pt = le.shadow && le.shadow.map ? le.shadow.map.texture : null;
      ((be.tShadow.value = pt),
        (be.uHasShadow.value = pt ? 1 : 0),
        pt && be.uShadowMatrix.value.copy(le.shadow.matrix),
        be.uCamWorld.value.copy(fe.matrixWorld),
        be.uCamPos.value.setFromMatrixPosition(fe.matrixWorld),
        be.uTanHalf.value.set(Te, Pe),
        (be.uFarZ.value = fe.far));
      let ut = le.intensity * TUNE.volSunScale;
      be.uSunRad.value.set(le.color.r * ut, le.color.g * ut, le.color.b * ut);
      let nn = TUNE.volAmbient * (1 + ce * 1.5);
      (be.uAmb.value.set(SKY_COLORS.fog.r * nn, SKY_COLORS.fog.g * nn, SKY_COLORS.fog.b * nn),
        renderPass(volMat, renderTargets.volA),
        (blurVolMat.uniforms.tSrc.value = renderTargets.volA.texture),
        blurVolMat.uniforms.uDir.value.set(ze, 0),
        renderPass(blurVolMat, renderTargets.volB),
        (blurVolMat.uniforms.tSrc.value = renderTargets.volB.texture),
        blurVolMat.uniforms.uDir.value.set(0, We),
        renderPass(blurVolMat, renderTargets.volA));
    }
    {
      let be = compositeMat.uniforms;
      ((be.tColor.value = oe.texture),
        (be.tDepth.value = Fe),
        be.uHalfRes.value.set(size.hw, size.hh),
        (be.uNear.value = fe.near),
        (be.uFar.value = fe.far),
        (be.uAoOn.value = Ne ? 1 : 0),
        (be.uVolOn.value = dt ? 1 : 0),
        renderPass(compositeMat, renderTargets.scene));
    }
    let xe = renderTargets.scene.texture;
    if (
      (viewProj.multiplyMatrices(fe.projectionMatrix, fe.matrixWorldInverse),
      ve.motionBlur && hasPrevFrame && R > 0)
    ) {
      let be = motionMat.uniforms;
      ((be.tDepth.value = Fe),
        be.uInvViewProj.value.copy(invViewProjScratch.copy(viewProj).invert()),
        be.uPrevViewProj.value.copy(prevViewProj),
        (be.uShutter.value = Math.min(0.5, 1 / 190 / Math.max(R, 0.001))),
        be.uRes.value.set(size.w, size.h),
        renderPass(motionMat, renderTargets.motion),
        (xe = renderTargets.motion.texture));
    }
    if ((prevViewProj.copy(viewProj), (hasPrevFrame = !0), ve.bloom)) {
      let be = xe,
        Oe = size.w,
        pt = size.h;
      for (let bt = 0; bt < BLOOM_LEVELS; bt++)
        ((downMat.uniforms.tSrc.value = be),
          downMat.uniforms.uTexel.value.set(1 / Oe, 1 / pt),
          (downMat.uniforms.uFirst.value = bt === 0 ? 1 : 0),
          renderPass(downMat, renderTargets.down[bt]),
          (be = renderTargets.down[bt].texture),
          (Oe = renderTargets.down[bt].width),
          (pt = renderTargets.down[bt].height));
      let ut = renderTargets.down[BLOOM_LEVELS - 1];
      for (let bt = BLOOM_LEVELS - 2; bt >= 0; bt--)
        ((upMat.uniforms.tLow.value = ut.texture),
          (upMat.uniforms.tHigh.value = renderTargets.down[bt].texture),
          upMat.uniforms.uTexel.value.set(1 / ut.width, 1 / ut.height),
          renderPass(upMat, renderTargets.up[bt]),
          (ut = renderTargets.up[bt]));
      let nn = 1 / renderTargets.streakA.width;
      ((streakMat.uniforms.tSrc.value = renderTargets.down[2].texture),
        streakMat.uniforms.uDir.value.set(nn * 1.5, 0),
        (streakMat.uniforms.uThreshold.value = TUNE.streakThreshold),
        renderPass(streakMat, renderTargets.streakA),
        (streakMat.uniforms.tSrc.value = renderTargets.streakA.texture),
        streakMat.uniforms.uDir.value.set(nn * 5, 0),
        (streakMat.uniforms.uThreshold.value = 0),
        renderPass(streakMat, renderTargets.streakB));
    }
    (sunClipPos
      .copy(SUN.dir)
      .multiplyScalar(500)
      .add(scratchVec.setFromMatrixPosition(fe.matrixWorld))
      .project(fe),
      fe.getWorldDirection(scratchVec));
    let Ie = scratchVec.dot(SUN.dir) > 0.05,
      Be = Math.max(Math.abs(sunClipPos.x), Math.abs(sunClipPos.y)),
      Xe = Ie ? 1 - Math.min(1, Math.max(0, (Be - 1) / 0.3)) : 0,
      Me = sunClipPos.x * 0.5 + 0.5,
      we = sunClipPos.y * 0.5 + 0.5;
    {
      let be = adaptMat.uniforms,
        Oe = renderTargets.adapt[adaptIndex],
        pt = renderTargets.adapt[1 - adaptIndex];
      ((be.tPrev.value = Oe.texture),
        (be.tLum.value = ve.bloom ? renderTargets.down[BLOOM_LEVELS - 1].texture : xe),
        (be.tDepth.value = Fe),
        be.uSunUv.value.set(Me, we),
        (be.uSunOn.value = Xe),
        (be.uAspect.value = Re));
      let ut = frameCount < 2 || k;
      ((be.uRate.value = ut ? (frameCount < 2 ? 1 : 0.6) : 1 - Math.exp(-R / TUNE.adaptTau)),
        (be.uVisRate.value = ut ? 1 : 1 - Math.exp(-R / 0.12)),
        renderPass(adaptMat, pt),
        (adaptIndex = 1 - adaptIndex),
        frameCount++);
    }
    {
      let be = gradeMat.uniforms;
      ((be.tScene.value = xe),
        (exposureUniforms.tAdapt.value = renderTargets.adapt[adaptIndex].texture),
        be.uSunUv.value.set(Me, we),
        (be.uSunOn.value = Xe),
        (be.uAspect.value = Re),
        (be.uTime.value = ae),
        (be.uBloom.value = ve.bloom ? TUNE.bloom : 0),
        (be.uDirt.value = ve.bloom ? TUNE.dirt : 0),
        (be.uStreak.value = ve.bloom ? TUNE.streak : 0),
        (be.uFlare.value = TUNE.flare),
        (be.uAgxMix.value = TUNE.agxMix),
        (be.uCA.value = TUNE.ca),
        (be.uVignette.value = TUNE.vignette),
        (be.uDamage.value = clamp01(I.damage)),
        (be.uLowHealth.value = clamp01(I.lowHealth)),
        (be.uAds.value = clamp01(I.ads)),
        (be.uFlash.value = clamp01(I.flash)),
        (be.uFade.value = clamp01(I.fade)),
        (be.uSaturation.value = Number.isFinite(I.saturation) ? I.saturation : 1),
        renderPass(gradeMat, renderTargets.ldr));
    }
    {
      let be = finalMat.uniforms;
      (be.uTexel.value.set(1 / size.w, 1 / size.h),
        (be.uTime.value = ae),
        (be.uGrain.value = TUNE.grain),
        (be.uSharpen.value = TUNE.sharpen),
        renderPass(finalMat, null));
    }
  }
  let clamp01 = (oe) => (oe > 0 ? (oe < 1 ? oe : 1) : 0);
  function dispose() {
    for (let fe of materials) fe.dispose();
    let oe = [
      renderTargets.scene,
      renderTargets.motion,
      renderTargets.ldr,
      renderTargets.depthHalf,
      renderTargets.aoA,
      renderTargets.aoB,
      renderTargets.volA,
      renderTargets.volB,
      renderTargets.streakA,
      renderTargets.streakB,
      renderTargets.dirt,
      ...renderTargets.down,
      ...renderTargets.up,
      ...renderTargets.adapt,
    ];
    renderTargets.depthCopy && oe.push(renderTargets.depthCopy);
    for (let fe of oe) fe.dispose();
  }
  let readbackPixel = new Uint16Array(4);
  function readAdaptation() {
    try {
      renderer.readRenderTargetPixels(renderTargets.adapt[adaptIndex], 0, 0, 1, 1, readbackPixel);
      let oe = THREE.DataUtils.fromHalfFloat(readbackPixel[0]),
        fe = Math.min(
          TUNE.maxExposure,
          Math.max(TUNE.minExposure, Math.pow(TUNE.key / Math.max(oe, 1e-4), 0.85)),
        );
      return {
        lum: +oe.toFixed(4),
        auto: +fe.toFixed(3),
        sunVis: +THREE.DataUtils.fromHalfFloat(readbackPixel[1]).toFixed(2),
      };
    } catch {
      return null;
    }
  }
  let pipeline = {
    readAdapt: readAdaptation,
    run: run,
    resize: resize,
    copyDepth: copyDepth,
    ensureDepthCopy: ensureDepthCopy,
    applyQuality: syncQualityDefines,
    dispose: dispose,
    materials: materials,
    rt: renderTargets,
    size: size,
    TUNE: TUNE,
    autoExposure: !0,
    pass: renderPass,
    quad: quadMesh,
    fsCam: fsCamera,
  };
  return pipeline;
}
