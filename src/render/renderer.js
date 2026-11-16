// render/renderer.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { LAYER_VIEWMODEL, LAYER_WORLD, PLAYER_SPEC, QUALITY_PRESETS, SUN } from '../core/config.js';

import { beveledBoxGeometry, boxGeometry, createShadowMesh } from '../core/geometry.js';

import { SALTLINE_POST_MARKER, createPostprocessing } from './postprocessing.js';

import { SALTLINE_SHADOW_MARKER, installSoftShadows } from './shadows.js';

import { captureSkyEnvironment, createNoiseTexture, createSkyDome } from './sky.js';

/**
 * 渲染模块的惰性导出表（create 取 createRendererApi、showcase 取 showcase 版本），用 getter 延迟绑定，使入口能先按名字拿到渲染模块再真正求值，断开与主启动流程的循环依赖
 */
export var rendererModule = {};

/**
 * 首次修补时缓存的三原生 shadowmap_pars_fragment 源码：必须只备份一次，才能在补丁失效或需要降级时无损还原
 */
export var stockShadowChunk = null;

/**
 * 把平行光阴影相机对到太阳方向并贴合场景：沿光轴 lookAt 区域中点，把两组包围盒的 8 个角投到光空间取 min/max 定正交范围，第二组（更高更远）的角只用来收紧近平面以免楼顶被裁
 */
function fitSunShadowFrustum(sunLight, boundsMin, boundsMax, casterMin, casterMax) {
  let sunDir = SUN.dir.clone().normalize(),
    focusCenter = boundsMin.clone().add(boundsMax).multiplyScalar(0.5);
  (sunLight.target.position.copy(focusCenter),
    sunLight.position.copy(focusCenter).addScaledVector(sunDir, 200),
    sunLight.updateMatrixWorld(!0),
    sunLight.target.updateMatrixWorld(!0));
  let lightMatrix = new THREE.Matrix4().lookAt(
    sunLight.position,
    focusCenter,
    new THREE.Vector3(0, 1, 0),
  );
  (lightMatrix.setPosition(sunLight.position), lightMatrix.invert());
  let cornerPoint = new THREE.Vector3(),
    minX = 1 / 0,
    maxX = -1 / 0,
    minY = 1 / 0,
    maxY = -1 / 0,
    minZ = 1 / 0,
    maxZ = -1 / 0,
    forEachCorner = (y, b, eachCorner) => {
      for (let cornerIndex = 0; cornerIndex < 8; cornerIndex++)
        (cornerPoint
          .set(
            cornerIndex & 1 ? b.x : y.x,
            cornerIndex & 2 ? b.y : y.y,
            cornerIndex & 4 ? b.z : y.z,
          )
          .applyMatrix4(lightMatrix),
          eachCorner(cornerPoint));
    };
  (forEachCorner(boundsMin, boundsMax, (y) => {
    ((minX = Math.min(minX, y.x)),
      (maxX = Math.max(maxX, y.x)),
      (minY = Math.min(minY, y.y)),
      (maxY = Math.max(maxY, y.y)),
      (minZ = Math.min(minZ, -y.z)),
      (maxZ = Math.max(maxZ, -y.z)));
  }),
    forEachCorner(casterMin, casterMax, (y) => {
      minZ = Math.min(minZ, -y.z);
    }));
  let shadowCam = sunLight.shadow.camera,
    frustumPad = 1;
  return (
    (shadowCam.left = minX - frustumPad),
    (shadowCam.right = maxX + frustumPad),
    (shadowCam.bottom = minY - frustumPad),
    (shadowCam.top = maxY + frustumPad),
    (shadowCam.near = Math.max(1, minZ - 4)),
    (shadowCam.far = maxZ + 4),
    shadowCam.updateProjectionMatrix(),
    {
      width: shadowCam.right - shadowCam.left,
      height: shadowCam.top - shadowCam.bottom,
      depth: shadowCam.far - shadowCam.near,
    }
  );
}

/**
 * 把缓存的原始 shadowmap chunk 写回 three，用于软阴影补丁失效或降级时恢复原生 PCF
 */
function restoreStockShadowChunk() {
  stockShadowChunk !== null && (THREE.ShaderChunk.shadowmap_pars_fragment = stockShadowChunk);
}

/**
 * 软阴影标记的别名引用：只在 shader 错误分类里判断「当前材质用的是打过补丁的 chunk」，必须与注入时的字符串保持同一份
 */
var SALTLINE_SHADOW_TAG = SALTLINE_SHADOW_MARKER;

/**
 * 场景级环境光强度（IBL 加成）基准值：烘出的天空 PMREM 偏暗，靠它把整体环境照明拉到与黄昏实拍相符的水平
 */
var SCENE_ENV_INTENSITY = 2;

/**
 * 单物体 envMapIntensity 基准值：合并后的静态网格统一用它，室内/视图模型的补光按 Ky/Jy 比例换算，保证物体亮度与环境亮度的关系一致
 */
var OBJECT_ENV_INTENSITY = 1;

/**
 * 创建 WebGLRenderer 与整套渲染上下文（世界/视图模型双相机、阴影、闪电灯光池、HDR 目标、后处理链、室内环境探针），并用一个探针立方体真跑一帧做能力自检：post pass / 软阴影 / 天空 shader 任一编译失败就逐级降级到 forward 渲染
 */
export async function createRenderer(ctx) {
  let params = ctx.params || {},
    canvas = document.getElementById('view'),
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: !1,
      powerPreference: 'high-performance',
      alpha: !1,
      depth: !0,
      stencil: !1,
    });
  ((renderer.outputColorSpace = THREE.SRGBColorSpace),
    (renderer.toneMapping = THREE.NoToneMapping),
    (renderer.toneMappingExposure = 1),
    (renderer.shadowMap.enabled = !0),
    (renderer.shadowMap.type = THREE.PCFShadowMap),
    (renderer.shadowMap.autoUpdate = !1),
    (renderer.autoClear = !1),
    (renderer.info.autoReset = !1),
    renderer.setClearColor(0, 1));
  let glContext = renderer.getContext(),
    shaderErrors = {
      post: !1,
      shadow: !1,
      sky: !1,
      other: 0,
    };
  renderer.debug.onShaderError = (ie, F, X, ne) => {
    let re = '',
      $ = '';
    try {
      ((re = ie.getShaderSource(ne) || ''),
        ($ =
          (ie.getShaderInfoLog(ne) || '') +
          ' ' +
          (ie.getShaderInfoLog(X) || '') +
          ' ' +
          (ie.getProgramInfoLog(F) || '')));
    } catch {}
    let ue = 'material';
    (re.includes(SALTLINE_POST_MARKER)
      ? ((shaderErrors.post = !0), (ue = 'post pass ' + (re.match(/SALTLINE_POST (\S+)/) || [])[1]))
      : re.includes('SALTLINE_SKY')
        ? ((shaderErrors.sky = !0), (ue = 'sky'))
        : re.includes(SALTLINE_SHADOW_TAG)
          ? ((shaderErrors.shadow = !0), (ue = 'material (soft shadow chunk active)'))
          : shaderErrors.other++,
      console.error(`[render] shader error in ${ue}: ${$.trim().slice(0, 700)}`));
  };
  let scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(PLAYER_SPEC.fov, 16 / 9, 0.08, 900);
  (camera.layers.set(LAYER_WORLD), (camera.rotation.order = 'YXZ'), scene.add(camera));
  let viewCamera = new THREE.PerspectiveCamera(PLAYER_SPEC.viewFov, 16 / 9, 0.01, 10);
  viewCamera.layers.set(LAYER_VIEWMODEL);
  let noiseTex = createNoiseTexture(),
    sky = createSkyDome(noiseTex);
  scene.add(sky.mesh);
  let sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);
  ((sun.name = 'sun'), (sun.castShadow = !0));
  let shadowConfig = fitSunShadowFrustum(
      sun,
      new THREE.Vector3(-41, -0.2, -33),
      new THREE.Vector3(37, 32, 31),
      new THREE.Vector3(-41, -3, -64),
      new THREE.Vector3(72, 36, 34),
    ),
    getShadowMapSize = () =>
      Math.min(ctx.quality.shadow || 2048, renderer.capabilities.maxTextureSize);
  (sun.shadow.mapSize.set(getShadowMapSize(), getShadowMapSize()),
    (sun.shadow.bias = -12e-5),
    (sun.shadow.normalBias = 0.02),
    (sun.shadow.radius = 1),
    (sun.shadow.autoUpdate = !0),
    scene.add(sun, sun.target));
  let softShadows = !1;
  try {
    softShadows = installSoftShadows(shadowConfig, {
      taps: ctx.quality.name === 'low' ? 10 : 16,
      searchTaps: 8,
    });
  } catch (ie) {
    console.warn('[render] soft shadows unavailable: ' + ie);
  }
  let lightPoolSize = 6,
    flashLights = [];
  for (let ie = 0; ie < lightPoolSize; ie++) {
    let F = new THREE.PointLight(16777215, 0, 12, 2);
    ((F.userData = {
      busy: !1,
      ttl: 0,
      dur: 0,
      peak: 0,
      persistent: !1,
    }),
      scene.add(F),
      flashLights.push(F));
  }
  let lightPool = {
      flash(ie, F = 16763008, X = 30, ne = 10, re = 0.06) {
        let $ =
          flashLights.find((ue) => !ue.userData.busy) ||
          flashLights
            .filter((ue) => !ue.userData.persistent)
            .sort((ue, me) => ue.userData.ttl - me.userData.ttl)[0];
        $ &&
          ($.position.copy(ie),
          $.color.set(F),
          ($.distance = ne),
          ($.intensity = X),
          Object.assign($.userData, {
            busy: !0,
            ttl: re,
            dur: re,
            peak: X,
            persistent: !1,
          }));
      },
      acquire() {
        let ie = flashLights.find((F) => !F.userData.busy);
        return ie
          ? ((ie.userData.busy = !0),
            (ie.userData.persistent = !0),
            (ie.intensity = 0),
            {
              light: ie,
              release() {
                ((ie.userData.busy = !1), (ie.userData.persistent = !1), (ie.intensity = 0));
              },
            })
          : null;
      },
      update(ie) {
        for (let F of flashLights) {
          let X = F.userData;
          X.busy &&
            !X.persistent &&
            ((X.ttl -= ie),
            X.ttl <= 0
              ? ((X.busy = !1), (F.intensity = 0))
              : (F.intensity = X.peak * (X.ttl / X.dur)));
        }
      },
    },
    envCapture = null;
  try {
    ((envCapture = captureSkyEnvironment(renderer, sky)),
      (scene.environment = envCapture.texture),
      (scene.environmentIntensity = SCENE_ENV_INTENSITY));
  } catch (ie) {
    console.error('[render] environment capture failed: ' + ((ie && ie.stack) || ie));
  }
  let depthTexture = new THREE.DepthTexture(4, 4);
  ((depthTexture.type = THREE.UnsignedIntType),
    (depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter));
  let hdrTarget = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: !0,
      stencilBuffer: !1,
      depthTexture: depthTexture,
      samples: ctx.quality.msaa | 0,
      generateMipmaps: !1,
    }),
    post = null,
    advanced = params.post !== '0';
  if (
    (params.ao === '0' && (ctx.quality.ao = !1),
    params.vol === '0' && (ctx.quality.volSteps = 0),
    params.bloom === '0' && (ctx.quality.bloom = !1),
    params.mb === '1' && (ctx.quality.motionBlur = !0),
    advanced)
  )
    try {
      post = createPostprocessing(renderer, ctx, {
        noiseTex: noiseTex,
      });
    } catch (ie) {
      ((advanced = !1),
        console.error(
          '[render] post chain failed to initialise, using forward fallback: ' +
            ((ie && ie.stack) || ie),
        ));
    }
  let fastMode = !!(params.shot || params.show),
    depthCopyRequested = !1,
    thunder = {
      t: 99,
      power: 0,
      value: 0,
    };
  ctx.events &&
    ctx.events.on &&
    ctx.events.on('thunder', (ie) => {
      ((thunder.t = 0), (thunder.power = Math.min(1, (ie && ie.intensity) || 0.6)));
      let F = Math.PI * (0.55 + Math.random() * 0.9);
      sky.material.uniforms.uFlashDir.value
        .set(Math.cos(F), 0.35 + Math.random() * 0.3, Math.sin(F) * (Math.random() < 0.5 ? -1 : 1))
        .normalize();
    });
  let dynamicRes = {
    scale: 1,
    enabled: !(params.shot || params.show || params.dynres === '0'),
    acc: 0,
    n: 0,
    settle: 3.5,
    upWait: 4,
    upDelay: 4,
  };
  function updateDynamicRes(ie) {
    if (!dynamicRes.enabled || !advanced || ie > 1500) return;
    if (((dynamicRes.settle -= ie / 1e3), (dynamicRes.upWait -= ie / 1e3), dynamicRes.settle > 0)) {
      ((dynamicRes.acc = 0), (dynamicRes.n = 0));
      return;
    }
    if (((dynamicRes.acc += ie), dynamicRes.n++, dynamicRes.n < 45 && dynamicRes.acc < 900)) return;
    let F = dynamicRes.acc / dynamicRes.n;
    ((dynamicRes.acc = 0), (dynamicRes.n = 0));
    let X = dynamicRes.scale;
    if (
      (F > 21.5 && X > 0.6
        ? ((X = F > 45 ? 0.6 : Math.max(0.6, X - (F > 30 ? 0.2 : 0.1))),
          (dynamicRes.upDelay = Math.min(60, dynamicRes.upDelay * 2)),
          (dynamicRes.upWait = dynamicRes.upDelay))
        : F < 17.4 && X < 1 && dynamicRes.upWait <= 0
          ? ((X = Math.min(1, X + 0.1)), (dynamicRes.upWait = 2))
          : F < 17.4 && X >= 1 && (dynamicRes.upDelay = 4),
      (X = Math.round(X * 10) / 10),
      X <= 0.6 && F > 26)
    ) {
      dynamicRes.floorHits = (dynamicRes.floorHits || 0) + 1;
      let ne = {
        ultra: 'high',
        high: 'medium',
        medium: 'low',
      }[ctx.quality.name];
      if (dynamicRes.floorHits >= 2 && ne && QUALITY_PRESETS[ne]) {
        ((dynamicRes.floorHits = 0),
          (dynamicRes.scale = 0.8),
          (dynamicRes.settle = 2),
          (dynamicRes.upDelay = 4),
          console.log(
            '[render] frame time ' +
              F.toFixed(0) +
              ' ms at minimum scale: dropping quality to ' +
              ne,
          ));
        try {
          (api.setQuality({
            ...QUALITY_PRESETS[ne],
          }),
            ctx.events.emit('quality:auto', {
              name: ne,
            }));
        } catch {}
        return;
      }
    } else dynamicRes.floorHits = 0;
    X !== dynamicRes.scale && ((dynamicRes.scale = X), (dynamicRes.settle = 1), api.resize());
  }
  let prePasses = [],
    loggedErrors = {},
    warnOnce = (ie, F) => {
      loggedErrors[ie] || ((loggedErrors[ie] = 1), console.error(F));
    },
    frameStats = {
      calls: 0,
      tris: 0,
    },
    frameCount = 0,
    lastFrameTime = 0;
  function syncViewCamera() {
    (camera.updateMatrixWorld(!0),
      (viewCamera.matrixAutoUpdate = !1),
      (viewCamera.matrixWorldAutoUpdate = !1),
      viewCamera.matrixWorld.copy(camera.matrixWorld),
      viewCamera.matrixWorldInverse.copy(viewCamera.matrixWorld).invert());
  }
  function renderForward() {
    (renderer.toneMapping !== THREE.ACESFilmicToneMapping &&
      (renderer.toneMapping = THREE.ACESFilmicToneMapping),
      (renderer.toneMappingExposure =
        0.6 * api.exposure * (1 - Math.min(1, Math.max(0, api.post.fade)))),
      renderer.setRenderTarget(null),
      renderer.clear(),
      (renderer.shadowMap.needsUpdate = !0),
      renderer.render(scene, camera),
      renderer.clearDepth(),
      renderer.render(scene, viewCamera));
  }
  function renderAdvanced(ie) {
    (renderer.toneMapping !== THREE.NoToneMapping && (renderer.toneMapping = THREE.NoToneMapping),
      (renderer.toneMappingExposure = 1),
      renderer.setRenderTarget(hdrTarget),
      renderer.clear(!0, !0, !1),
      (ctx.quality.name === 'ultra' || params.shot || (frameCount & 1) === 0 || !sun.shadow.map) &&
        (renderer.shadowMap.needsUpdate = !0),
      renderer.render(scene, camera),
      depthCopyRequested && (post.copyDepth(depthTexture), renderer.setRenderTarget(hdrTarget)),
      glContext.depthRange(0, 0.05));
    let F = scene.environmentIntensity,
      X = scene.environment,
      ne = api.interiorEnv && ctx.level && ctx.level.interiorBoxes && ctx.level.interiorBoxes[0],
      re = !!(
        ne &&
        ne.min &&
        camera.position.x > ne.min.x &&
        camera.position.x < ne.max.x &&
        camera.position.z > ne.min.z &&
        camera.position.z < ne.max.z &&
        camera.position.y < ne.max.y
      );
    (re && (scene.environment = api.interiorEnv),
      (scene.environmentIntensity =
        F * (re ? OBJECT_ENV_INTENSITY / SCENE_ENV_INTENSITY : 1) * (api.viewFill || 1.35)));
    try {
      renderer.render(scene, viewCamera);
    } finally {
      (glContext.depthRange(0, 1), (scene.environmentIntensity = F), (scene.environment = X));
    }
    if (
      (post.run({
        hdr: hdrTarget,
        camera: camera,
        sun: sun,
        dt: ie,
        post: api.post,
        exposure: api.exposure,
        time: ctx.time ? ctx.time.t : frameCount / 60,
        fast: fastMode,
        thunder: thunder.value,
      }),
      renderer.setRenderTarget(null),
      shaderErrors.post)
    )
      throw new Error('a post shader failed to compile');
  }
  let api = {
      renderer: renderer,
      scene: scene,
      camera: camera,
      viewCamera: viewCamera,
      sun: sun,
      sky: sky.mesh,
      sunDir: SUN.dir.clone(),
      lightPool: lightPool,
      post: {
        damage: 0,
        lowHealth: 0,
        ads: 0,
        flash: 0,
        fade: 0,
        saturation: 1,
        focusDist: 0,
        shake: 0,
        wet: 1,
      },
      exposure: 1,
      env: envCapture ? envCapture.texture : null,
      interiorEnv: null,
      resolution: new THREE.Vector2(4, 4),
      depthTextureIsLive: !1,
      tune: post ? post.TUNE : {},
      get advanced() {
        return advanced;
      },
      get autoExposure() {
        return post ? post.autoExposure : !1;
      },
      set autoExposure(ie) {
        post && (post.autoExposure = !!ie);
      },
      get depthTexture() {
        if (!post) return null;
        depthCopyRequested = !0;
        try {
          return post.ensureDepthCopy();
        } catch {
          return null;
        }
      },
      addPrePass(ie) {
        prePasses.push(ie);
      },
      renderWorld(ie, F) {
        let X = renderer.getRenderTarget(),
          ne = renderer.shadowMap.needsUpdate,
          re = renderer.toneMapping,
          $ = renderer.toneMappingExposure,
          ue = ie.layers.mask;
        (ie.layers.disable(LAYER_VIEWMODEL),
          (renderer.shadowMap.needsUpdate = !1),
          (renderer.toneMapping = THREE.NoToneMapping),
          (renderer.toneMappingExposure = 1));
        try {
          (renderer.setRenderTarget(F), renderer.clear(), renderer.render(scene, ie));
        } finally {
          ((ie.layers.mask = ue),
            renderer.setRenderTarget(X),
            (renderer.shadowMap.needsUpdate = ne),
            (renderer.toneMapping = re),
            (renderer.toneMappingExposure = $));
        }
      },
      async onLevelReady() {
        renderer.shadowMap.needsUpdate = !0;
        try {
          captureInteriorProbe();
        } catch (ie) {
          console.error('[render] interior probe failed: ' + ((ie && ie.stack) || ie));
        }
        try {
          if (
            (advanced && renderer.setRenderTarget(hdrTarget),
            await renderer.compileAsync(scene, camera),
            api.interiorEnv)
          ) {
            let ie = scene.environment;
            scene.environment = api.interiorEnv;
            try {
              renderer.compile(scene, viewCamera);
            } finally {
              scene.environment = ie;
            }
          }
        } catch {}
        (renderer.setRenderTarget(null),
          (dynamicRes.settle = 3.5),
          (dynamicRes.acc = 0),
          (dynamicRes.n = 0));
      },
      setQuality(ie) {
        ctx.quality = ie;
        let F = getShadowMapSize();
        sun.shadow.mapSize.x !== F &&
          (sun.shadow.mapSize.set(F, F),
          sun.shadow.map && (sun.shadow.map.dispose(), (sun.shadow.map = null)));
        let X = ie.msaa | 0;
        (hdrTarget.samples !== X && ((hdrTarget.samples = X), hdrTarget.dispose()),
          post && post.applyQuality(),
          api.resize());
      },
      resize() {
        let ie = Math.max(2, canvas.clientWidth || window.innerWidth),
          F = Math.max(2, canvas.clientHeight || window.innerHeight),
          X = Math.min(window.devicePixelRatio || 1, 2),
          ne = ctx.quality.scale || 1;
        if (advanced) {
          (renderer.setPixelRatio(X), renderer.setSize(ie, F, !1));
          let re = ne * dynamicRes.scale,
            $ =
              {
                low: 1e6,
                medium: 15e5,
                high: 23e5,
                ultra: 37e5,
              }[ctx.quality.name] || 23e5,
            ue = ie * X * F * X * re * re;
          ue > $ && (re *= Math.sqrt($ / ue));
          let me = Math.max(16, Math.round(ie * X * re)),
            ee = Math.max(16, Math.round(F * X * re));
          (hdrTarget.setSize(me, ee),
            (depthTexture.image.width !== me || depthTexture.image.height !== ee) &&
              ((depthTexture.image.width = me),
              (depthTexture.image.height = ee),
              (depthTexture.needsUpdate = !0)),
            post && post.resize(me, ee),
            api.resolution.set(me, ee));
        } else
          (renderer.setPixelRatio(X * ne),
            renderer.setSize(ie, F, !1),
            api.resolution.set(Math.round(ie * X * ne), Math.round(F * X * ne)));
        ((camera.aspect = viewCamera.aspect = ie / F),
          camera.updateProjectionMatrix(),
          viewCamera.updateProjectionMatrix());
      },
      frame(ie) {
        let F = performance.now();
        (lastFrameTime && updateDynamicRes(F - lastFrameTime),
          (lastFrameTime = F),
          frameCount++,
          renderer.info.reset(),
          lightPool.update(ie));
        let X = ctx.time ? ctx.time.t : frameCount / 60;
        ((sky.material.uniforms.uTime.value = X),
          (thunder.t += ie),
          (thunder.value =
            thunder.t < 0.9
              ? thunder.power *
                Math.exp(-thunder.t * 5) *
                (0.55 + 0.45 * Math.sin(thunder.t * 47) * Math.sin(thunder.t * 13 + 1)) *
                0.35
              : 0),
          (sky.material.uniforms.uFlash.value = Math.max(0, thunder.value)),
          syncViewCamera());
        for (let ne of prePasses)
          try {
            ne(renderer, scene, camera);
          } catch (re) {
            warnOnce('pre', '[render] pre-pass threw: ' + ((re && re.stack) || re));
          }
        if (advanced)
          try {
            renderAdvanced(ie);
          } catch (ne) {
            advanced = !1;
            try {
              (glContext.depthRange(0, 1), renderer.setRenderTarget(null));
            } catch {}
            (console.error(
              '[render] advanced pipeline disabled, falling back to forward rendering: ' +
                ((ne && ne.stack) || ne),
            ),
              api.resize());
          }
        (advanced || renderForward(),
          (frameStats = {
            calls: renderer.info.render.calls,
            tris: renderer.info.render.triangles,
          }));
      },
      stats() {
        let ie = renderer.info;
        return {
          calls: frameStats.calls,
          tris: frameStats.tris,
          geos: ie.memory.geometries,
          tex: ie.memory.textures,
          programs: ie.programs ? ie.programs.length : 0,
          res: [api.resolution.x, api.resolution.y],
          scale: dynamicRes.scale,
          advanced: advanced,
          softShadows: softShadows,
          adapt: post && params.shot ? post.readAdapt() : void 0,
        };
      },
    },
    interiorProbe = null;
  function captureInteriorProbe() {
    let ie = ctx.level && ctx.level.interiorBoxes;
    if (!ie || !ie.length) return;
    let F = ie[0],
      X = (F.min.x + F.max.x) / 2,
      ne = (F.min.z + F.max.z) / 2,
      re = F.min.y + Math.min(2.4, (F.max.y - F.min.y) * 0.4);
    if (!interiorProbe) {
      let ee = new THREE.WebGLCubeRenderTarget(128, {
        type: THREE.HalfFloatType,
        generateMipmaps: !1,
      });
      ((interiorProbe = {
        cubeRT: ee,
        cam: new THREE.CubeCamera(0.15, 300, ee),
        pmrem: new THREE.PMREMGenerator(renderer),
        out: null,
      }),
        interiorProbe.cam.layers.set(LAYER_WORLD));
    }
    (interiorProbe.cam.position.set(X, re, ne), interiorProbe.cam.updateMatrixWorld(!0));
    let $ = renderer.toneMapping;
    ((renderer.toneMapping = THREE.NoToneMapping),
      (sky.material.uniforms.uEnv.value = 1),
      (renderer.shadowMap.needsUpdate = !0));
    try {
      interiorProbe.cam.update(renderer, scene);
    } finally {
      ((sky.material.uniforms.uEnv.value = 0),
        (renderer.toneMapping = $),
        renderer.setRenderTarget(null));
    }
    (interiorProbe.out && interiorProbe.out.dispose(),
      (interiorProbe.out = interiorProbe.pmrem.fromCubemap(interiorProbe.cubeRT.texture)),
      (api.interiorEnv = interiorProbe.out.texture));
    let ue = 0,
      me = new Set();
    (scene.traverse((ee) => {
      let B = ee.material ? (Array.isArray(ee.material) ? ee.material : [ee.material]) : null;
      if (B)
        for (let P of B)
          !P ||
            me.has(P) ||
            !P.userData ||
            P.userData.interior !== !0 ||
            !('envMap' in P) ||
            (me.add(P),
            (P.envMap = api.interiorEnv),
            P.userData.keepEnvIntensity || (P.envMapIntensity = OBJECT_ENV_INTENSITY),
            (P.needsUpdate = !0),
            ue++);
    }),
      ue && console.log(`[render] interior probe assigned to ${ue} material(s)`));
  }
  ((api.captureInteriorProbe = captureInteriorProbe),
    api.resize(),
    window.addEventListener('resize', () => api.resize()));
  try {
    let ie = new THREE.MeshStandardMaterial({
        color: 8421504,
      }),
      F = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ie);
    ((F.castShadow = F.receiveShadow = !0), F.position.set(0, 0.5, -3), scene.add(F));
    let X = () => {
      (syncViewCamera(), advanced ? renderAdvanced(0.016) : renderForward());
    };
    try {
      X();
    } catch (ne) {
      advanced &&
        ((advanced = !1),
        console.error(
          '[render] advanced pipeline failed its self test, using forward fallback: ' +
            ((ne && ne.message) || ne),
        ));
    }
    if (shaderErrors.shadow && softShadows) {
      (restoreStockShadowChunk(),
        (softShadows = !1),
        (shaderErrors.shadow = !1),
        (renderer.shadowMap.type = THREE.PCFSoftShadowMap),
        (sun.shadow.radius = 2),
        ie.dispose(),
        (F.material = new THREE.MeshStandardMaterial({
          color: 8421505,
        })),
        console.warn('[render] soft shadow chunk rejected by the driver, using stock PCF'));
      try {
        X();
      } catch {
        advanced = !1;
      }
    }
    if (
      (shaderErrors.sky && console.error('[render] sky shader failed to compile'),
      scene.remove(F),
      F.geometry.dispose(),
      ie.dispose(),
      F.material.dispose(),
      !advanced)
    ) {
      try {
        (glContext.depthRange(0, 1), renderer.setRenderTarget(null));
      } catch {}
      api.resize();
    }
    frameCount = 0;
  } catch (ie) {
    console.error('[render] self test threw: ' + ((ie && ie.stack) || ie));
  }
  return api;
}

/**
 * 构造 render-showcase 调试场景：金属/粗糙度球阵、各向材质板、集装箱波纹地面与 emissive 灯管，并让相机高度循环触发受击/低血/ADS/闪光/淡出五个后处理效果，用于人工核对渲染表现
 */
export function showcaseRenderer(app) {
  let group = new THREE.Group();
  group.name = 'render-showcase';
  let addToGroup = (h) => (group.add(h), h),
    sphereGeo = new THREE.SphereGeometry(0.42, 48, 24);
  for (let loopIdx = 0; loopIdx < 2; loopIdx++)
    for (let colIdx = 0; colIdx < 7; colIdx++) {
      let panelMat = new THREE.MeshStandardMaterial({
          color: loopIdx ? 12170408 : 8006172,
          roughness: 0.06 + colIdx * 0.15,
          metalness: loopIdx ? 1 : 0,
        }),
        panelMesh = new THREE.Mesh(sphereGeo, panelMat);
      (panelMesh.position.set(-3.6 + colIdx * 1.2, 0.42 + loopIdx * 1.05, loopIdx * -1.1),
        (panelMesh.castShadow = panelMesh.receiveShadow = !0),
        addToGroup(panelMesh));
    }
  let panelSpecs = [
    ['paint_orange', -5.2, 1.4, 1.3, 1.2, 2.2],
    ['steel_worn', 4.6, 1, 0.9, 1, 1.6],
    ['paint_teal', 5.6, 0.6, 2.4, 0.9, 3.6],
    ['concrete', -2.2, 0.5, 0.5, 2.6, 3.2],
  ];
  for (let [loopIdx, colIdx, panelMat, panelMesh, panelDepth, panelZ] of panelSpecs) {
    let shadowMesh = createShadowMesh(
      beveledBoxGeometry(panelMat, panelMesh, panelDepth, 0.03, 'bottom'),
      app.mats.get(loopIdx),
    );
    (shadowMesh.position.set(colIdx, 0, panelZ),
      (shadowMesh.rotation.y = colIdx * 0.2),
      addToGroup(shadowMesh));
  }
  for (let loopIdx = 0; loopIdx < 5; loopIdx++) {
    let colIdx = createShadowMesh(
      beveledBoxGeometry(0.5, 0.5, 0.5, 0.02, 'bottom'),
      app.mats.get('wood_pallet'),
    );
    (colIdx.position.set(0.5 + loopIdx * 0.52, 0, 3.4 + (loopIdx % 2) * 0.04), addToGroup(colIdx));
  }
  {
    let loopIdx = createShadowMesh(
      beveledBoxGeometry(0.5, 0.5, 0.5, 0.02, 'bottom'),
      app.mats.get('wood_pallet'),
    );
    (loopIdx.position.set(1.3, 0.5, 3.42), (loopIdx.rotation.y = 0.3), addToGroup(loopIdx));
  }
  let concreteDirtyMat = app.mats.get('concrete_dirty'),
    quadX = 9,
    quadTop = 7.5,
    gaps = [
      [-14, -5.2],
      [-4.7, -1.6],
      [-1.1, 1.9],
      [2.4, 5.6],
      [6.3, 14],
    ];
  for (let [loopIdx, colIdx] of gaps) {
    let panelMat = createShadowMesh(
      boxGeometry(0.4, quadTop, colIdx - loopIdx, 'bottom'),
      concreteDirtyMat,
    );
    (panelMat.position.set(quadX, 0, (loopIdx + colIdx) / 2), addToGroup(panelMat));
  }
  {
    let loopIdx = createShadowMesh(boxGeometry(0.4, 1.2, 28, 'bottom'), concreteDirtyMat);
    (loopIdx.position.set(quadX, quadTop, 0), addToGroup(loopIdx));
  }
  let wallSpecs = [
    [-12, 0, -9, 6, 4, 0.3],
    [-12, 0, -3, 6, 4, 0.3],
    [-15, 0, -6, 0.3, 4, 6.3],
    [-12, 4, -6, 6.6, 0.3, 6.6],
  ];
  for (let [loopIdx, colIdx, panelMat, panelMesh, panelDepth, panelZ] of wallSpecs) {
    let shadowMesh = createShadowMesh(
      boxGeometry(panelMesh, panelDepth, panelZ, 'bottom'),
      app.mats.get('steel_dark'),
    );
    (shadowMesh.position.set(loopIdx, colIdx, panelMat), addToGroup(shadowMesh));
  }
  {
    let loopIdx = new THREE.Mesh(boxGeometry(2.4, 0.06, 0.06), app.mats.emissive(16756832, 14));
    (loopIdx.position.set(-12, 3.6, -6), addToGroup(loopIdx));
  }
  {
    let loopIdx = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 12, 8),
      app.mats.emissive(16726560, 30),
    );
    (loopIdx.position.set(4.6, 1.02, 1.6), addToGroup(loopIdx));
  }
  return (
    app.scene.add(group),
    {
      cam: [-8.5, 1.7, 4.2],
      target: [3, 1.5, 0.4],
      update: () => {
        let postFx = app.render.post,
          heightKey = Math.round(app.camera.position.y * 1e3) % 10;
        ((postFx.damage = heightKey === 1 ? 0.8 : 0),
          (postFx.lowHealth = heightKey === 2 ? 0.85 : 0),
          (postFx.ads = heightKey === 3 ? 1 : 0),
          (postFx.flash = heightKey === 4 ? 0.35 : 0),
          (postFx.fade = heightKey === 5 ? 0.5 : 0));
      },
    }
  );
}
