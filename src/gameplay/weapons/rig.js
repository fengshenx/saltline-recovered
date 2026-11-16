// gameplay/weapons/rig.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import {
  RingMeshBuilder,
  SHEET_SAMPLES,
  buildGridSurface,
  mergeGeometryParts,
  mirrorGeometryX,
  sheetEdgeWeight,
} from '../../assets/procedural/geometry.js';

import {
  MARK_ATLAS_HEIGHT,
  MARK_ATLAS_WIDTH,
  PAC9_MARK_REGIONS,
} from '../../assets/procedural/textures.js';

import { SKY_COLORS, SUN } from '../../core/config.js';

import { signedPow, smoothRange } from '../../core/math.js';

import { hash1 } from '../../core/random.js';

import { Mat4, Quat, Vec3 } from '../../core/three-types.js';

import {
  FINGER_SEGMENTS,
  GLOVE_TONE_BAR,
  GLOVE_TONE_CUFF,
  GLOVE_TONE_GUARD,
  GLOVE_TONE_PULLTAB,
  GLOVE_TONE_SEAM,
  GLOVE_TONE_SLEEVE,
  GLOVE_TONE_SOFT,
  GLOVE_TONE_STRAP,
  GLOVE_TONE_WATCH,
  PAC9_RAIN_UNIFORM,
  buildFingerFromSpec,
  buildPalm,
  buildThumb,
  buildThumbWeb,
  palmBottomY,
  palmProfileZ,
  palmTopY,
} from './weapon.js';

/**
 * 贴合曲面的圆角薄片：在矩形采样上按 heightFn 计算贴合高度（可再叠加投影变换），逐点算顶点色，手套的指节条、缝线、魔术贴片都由它生成
 */
function buildDrapedSlab(
  originX,
  originY,
  width,
  height,
  thickness,
  tint,
  heightFn,
  transformFn = null,
  flipV = !1,
  sampleCountU = SHEET_SAMPLES,
  sampleCountV = SHEET_SAMPLES,
) {
  return buildGridSurface(sampleCountU, sampleCountV, (uFrac, vFrac, outVec) => {
    let worldX = originX + uFrac * width,
      worldY = originY + (flipV ? vFrac : -vFrac) * height,
      edgeWeight = Math.min(sheetEdgeWeight(uFrac), sheetEdgeWeight(vFrac)),
      surfHeight = heightFn(worldX, worldY) + (edgeWeight < 0 ? -0.0022 : thickness * edgeWeight);
    (outVec.set(worldX, flipV ? -surfHeight : surfHeight, worldY),
      transformFn && transformFn(outVec));
    let tintColor = typeof tint == 'function' ? tint(uFrac, vFrac) : tint,
      shadeMul = edgeWeight < 0 ? 0.5 : edgeWeight < 1 ? 0.8 : 1;
    return [tintColor[0] * shadeMul, tintColor[1] * shadeMul, tintColor[2] * shadeMul];
  });
}

/**
 * 整只战术手套装配：掌、护板、三道指节条、缝线、掌根垫、四指（可给多个索引指姿态用于弯曲）、拇指、虎口、袖口与袖管，输出 fabric/rubber 两组几何加索引姿态
 */
export function buildGloveHand(handSpec) {
  let parts = [],
    debugParts = handSpec.debugParts || null,
    addPart = (d, v) => (parts.push(v), debugParts && debugParts.push([d, v]), v);
  addPart('palm', buildPalm());
  {
    let pointVec = [];
    for (let partGeometry = 0; partGeometry <= 30; partGeometry++)
      pointVec.push(-1 + partGeometry / 15);
    addPart(
      'guard',
      buildGridSurface(
        pointVec,
        [-1, -0.9, -0.5, 0, 0.5, 0.9, 1],
        (partGeometry, acrossCoord, outPoint) => {
          let alongAxis = -5e-4 + partGeometry * 0.0405,
            palmProfileDepth = palmProfileZ(alongAxis) + 0.0045 - acrossCoord * 0.011,
            edgeWeightMin = Math.min(sheetEdgeWeight(partGeometry), sheetEdgeWeight(acrossCoord)),
            knuckleSum = 0;
          for (let fingerSlotIndex = 0; fingerSlotIndex < 4; fingerSlotIndex++) {
            let bandDistance = (alongAxis - FINGER_SEGMENTS[fingerSlotIndex].base[0]) / 0.0058;
            knuckleSum +=
              (fingerSlotIndex === 3 ? 0.8 : 1) * Math.exp(-bandDistance * bandDistance);
          }
          ((knuckleSum = Math.min(1, knuckleSum) * (1 - 0.55 * acrossCoord * acrossCoord)),
            outPoint.set(
              alongAxis,
              palmTopY(alongAxis, palmProfileDepth) +
                (edgeWeightMin < 0
                  ? acrossCoord > 0.95
                    ? -0.008
                    : -0.003
                  : (0.0016 + 0.006 * knuckleSum) * edgeWeightMin),
              palmProfileDepth,
            ));
          let toneMultiplier = edgeWeightMin < 0 ? 0.6 : 0.85 + 1.3 * knuckleSum;
          return [
            GLOVE_TONE_GUARD[0] * toneMultiplier,
            GLOVE_TONE_GUARD[1] * toneMultiplier,
            GLOVE_TONE_GUARD[2] * toneMultiplier,
          ];
        },
      ),
    );
  }
  for (let pointVec = 0; pointVec < 3; pointVec++)
    addPart(
      'bar',
      buildDrapedSlab(
        0.001,
        -0.034 - pointVec * 0.015,
        0.023 + pointVec * 0.0025,
        0.0052,
        0.0019,
        GLOVE_TONE_BAR,
        palmTopY,
      ),
    );
  (addPart(
    'seam',
    buildDrapedSlab(
      0,
      -0.0225,
      0.027,
      0.0013,
      9e-4,
      GLOVE_TONE_SEAM.map((pointVec) => pointVec * 0.8),
      palmTopY,
      null,
      !1,
      SHEET_SAMPLES,
      [-1, 0, 1].map((pointVec) => pointVec * 0.9),
    ),
  ),
    addPart(
      'heelPad',
      buildDrapedSlab(0.013, -0.03, 0.0135, 0.017, 0.0017, GLOVE_TONE_BAR, palmBottomY, null, !0),
    ));
  let indexGeoms = [];
  for (let pointVec = 0; pointVec < 4; pointVec++) {
    if (pointVec === 0 && handSpec.indexPoses) {
      for (let partGeometry of handSpec.indexPoses)
        indexGeoms.push(buildFingerFromSpec(FINGER_SEGMENTS[0], partGeometry));
      continue;
    }
    addPart(
      'finger' + pointVec,
      buildFingerFromSpec(FINGER_SEGMENTS[pointVec], handSpec.fingers[pointVec]),
    );
  }
  (addPart('thumb', buildThumb(handSpec.thumb)),
    addPart(
      'web',
      buildThumbWeb(
        new Vec3(handSpec.thumb[0][0], handSpec.thumb[0][1], handSpec.thumb[0][2]).normalize(),
      ),
    ));
  let forearmDir = new Vec3(
      handSpec.forearm[0],
      handSpec.forearm[1],
      handSpec.forearm[2],
    ).normalize(),
    sleeveLength = handSpec.sleeve || 0.36,
    sleeveInset = 0.022,
    sleeveQuat = new Quat().setFromUnitVectors(new Vec3(0, 0, 1), forearmDir),
    identityQuat = new Quat(),
    bendQuat = new Quat(),
    bendInto = (d) => (
      bendQuat.slerpQuaternions(identityQuat, sleeveQuat, smoothRange(0.002, 0.042, d.z)),
      (d.z -= sleeveInset),
      d.applyQuaternion(bendQuat),
      (d.z += sleeveInset),
      d
    );
  {
    let partGeometry = new RingMeshBuilder(24),
      acrossCoord = new Vec3(),
      outPoint = [
        [-0.0085, -0.0015, GLOVE_TONE_CUFF, 0.6],
        [-0.009, 0.0022, GLOVE_TONE_CUFF, 1.3],
        [-0.006, 0.0026, GLOVE_TONE_CUFF, 1.3],
        [-0.0052, 0.002, GLOVE_TONE_SOFT, 0.75],
        [0.004, 0.0014, GLOVE_TONE_SOFT, 1],
        [0.011, 0.0016, GLOVE_TONE_SOFT, 0.7],
        [0.0122, 0.003, GLOVE_TONE_CUFF, 1.2],
        [0.0305, 0.0032, GLOVE_TONE_CUFF, 1.2],
        [0.0317, 0.0018, GLOVE_TONE_SOFT, 0.7],
        [0.04, 0.002, GLOVE_TONE_SOFT, 1],
        [0.054, 0.0024, GLOVE_TONE_SOFT, 1],
        [0.058, 0.0026, GLOVE_TONE_SEAM, 0.7],
        [0.058, -0.004, GLOVE_TONE_SOFT, 0.4],
      ];
    for (let [alongAxis, palmProfileDepth, edgeWeightMin, knuckleSum] of outPoint)
      for (let toneMultiplier = 0; toneMultiplier < 24; toneMultiplier++) {
        let fingerSlotIndex = ((toneMultiplier + 0.5) / 24) * Math.PI * 2,
          bandDistance = Math.sin(fingerSlotIndex);
        partGeometry.v(
          bendInto(
            acrossCoord.set(
              (0.0296 + palmProfileDepth) * signedPow(Math.cos(fingerSlotIndex), 0.8),
              (bandDistance >= 0 ? 0.0185 + palmProfileDepth : 0.0204 + palmProfileDepth) *
                signedPow(bandDistance, 0.8),
              alongAxis,
            ),
          ),
          edgeWeightMin,
          knuckleSum,
        );
      }
    addPart('cuff', partGeometry.geo(!0));
  }
  (addPart(
    'strapTab',
    buildDrapedSlab(
      0.009,
      0.0215,
      0.0135,
      0.0076,
      0.0017,
      (pointVec) =>
        pointVec > 0.55 ? GLOVE_TONE_SEAM.map((partGeometry) => partGeometry * 0.75) : [9, 9, 9.6],
      (pointVec) =>
        0.0217 * Math.pow(1 - Math.pow(Math.min(0.999, Math.abs(pointVec / 0.0328)), 2.5), 0.4),
      bendInto,
    ),
  ),
    addPart(
      'pullTab',
      buildDrapedSlab(
        0.003,
        0.004,
        0.0065,
        0.0115,
        0.0022,
        GLOVE_TONE_PULLTAB,
        () => 0.022,
        bendInto,
        !0,
      ),
    ));
  {
    let pointVec = [];
    for (let arcZ = 0; arcZ < 24; arcZ++)
      (pointVec.push(arcZ * 15),
        (arcZ === 4 || arcZ === 16) && pointVec.push(arcZ * 15 + 11.5),
        (arcZ === 5 || arcZ === 17) && pointVec.push(arcZ * 15 + 3.5));
    pointVec.sort((arcZ, bandId) => arcZ - bandId);
    let partGeometry = pointVec.length,
      acrossCoord = pointVec.indexOf(75),
      outPoint = pointVec.indexOf(255),
      alongAxis = new RingMeshBuilder(partGeometry),
      palmProfileDepth = new Vec3(),
      edgeWeightMin = 0.04 + sleeveLength,
      knuckleSum = [
        [0.0415, 0],
        [0.04, 1],
        [0.044, 2],
        [0.049, 3],
        [0.055, 3],
        [0.061, 3],
        [0.0655, 4],
        [0.0685, 5],
      ],
      toneMultiplier = [0.1415, 0.143, 0.157, 0.1582, 0.1662, 0.1674, 0.181, 0.1825],
      fingerSlotIndex = toneMultiplier.slice(),
      bandDistance = Math.ceil((edgeWeightMin - 0.074) / 0.0052);
    for (let arcZ = 0; arcZ <= bandDistance; arcZ++) {
      let bandId = 0.074 + ((edgeWeightMin - 0.074) * arcZ) / bandDistance;
      toneMultiplier.some((ringIndex) => Math.abs(ringIndex - bandId) < 0.0016) ||
        fingerSlotIndex.push(bandId);
    }
    fingerSlotIndex.sort((arcZ, bandId) => arcZ - bandId);
    for (let arcZ of fingerSlotIndex) knuckleSum.push([arcZ, 6]);
    let stripeIndex = 0;
    for (let [arcZ, bandId] of knuckleSum)
      for (let ringIndex = 0; ringIndex < partGeometry; ringIndex++) {
        let ringAngle = (pointVec[ringIndex] * Math.PI) / 180,
          ringRadius,
          toneMul = 1,
          ringTone = GLOVE_TONE_SLEEVE;
        if (bandId === 0) ((ringRadius = 0.0292), (toneMul = 0.4));
        else if (bandId === 1) ((ringRadius = 0.0372), (toneMul = 1.15));
        else if (bandId === 2) ((ringRadius = 0.0377), (toneMul = 1.1));
        else if (bandId === 3) {
          let bandCos = Math.cos(ringAngle * 12);
          ((ringRadius = 0.0368 + 0.0012 * bandCos), (toneMul = 0.62 + 0.26 * bandCos));
        } else if (bandId === 4) ((ringRadius = 0.0356), (toneMul = 0.55));
        else if (bandId === 5) ((ringRadius = 0.038), (toneMul = 0.9));
        else {
          let bandCos = (arcZ - 0.0685) / (edgeWeightMin - 0.0685),
            knotAmp = 0.0048 * Math.exp(-Math.pow((bandCos - 0.13) / 0.11, 2)),
            strapAmp = 0.0048 * smoothRange(0.62, 0.85, bandCos),
            bandNoiseA =
              Math.pow(
                Math.abs(
                  Math.sin(
                    (Math.PI * arcZ) / 0.027 +
                      1.7 * Math.sin(ringAngle + 0.5) +
                      0.8 * Math.sin(2 * ringAngle + 1.3),
                  ),
                ),
                0.6,
              ) *
                2 -
              1.25,
            bandNoiseB =
              Math.pow(
                Math.abs(
                  Math.sin(
                    (Math.PI * arcZ) / 0.034 +
                      1.9 * Math.sin(ringAngle - 0.8) +
                      0.7 * Math.sin(2 * ringAngle),
                  ),
                ),
                0.6,
              ) *
                2 -
              1.25,
            wrinkleNoise =
              Math.sin(arcZ * 40 + 2 * Math.sin(ringAngle * 2 + 1)) +
              0.6 * Math.sin(3 * ringAngle + arcZ * 25);
          ((ringRadius =
            0.0405 +
            0.012 * Math.pow(bandCos, 0.85) +
            0.0025 * Math.exp(-Math.pow((arcZ - 0.082) / 0.012, 2)) +
            knotAmp * bandNoiseA +
            strapAmp * bandNoiseB +
            0.0016 * wrinkleNoise),
            (toneMul =
              0.78 +
              0.26 *
                smoothRange(
                  -1.1,
                  0.5,
                  (knotAmp * bandNoiseA + strapAmp * bandNoiseB) / (knotAmp + strapAmp + 8e-4),
                ) +
              0.04 * wrinkleNoise));
          let stripeJitter = hash1(stripeIndex);
          arcZ > 0.1575 && arcZ < 0.167
            ? ((ringTone = GLOVE_TONE_WATCH), (toneMul *= 0.85 + 0.25 * stripeJitter))
            : arcZ > 0.1425 &&
              arcZ < 0.1815 &&
              ((ringTone = GLOVE_TONE_STRAP), (toneMul *= 0.78 + 0.3 * stripeJitter));
        }
        (bandId > 0 &&
          (ringIndex === acrossCoord || ringIndex === outPoint
            ? ((ringRadius += 0.0019), (toneMul *= 1.3))
            : (Math.abs(ringIndex - acrossCoord) === 1 || Math.abs(ringIndex - outPoint) === 1) &&
              (toneMul *= 0.52)),
          palmProfileDepth.set(
            Math.cos(ringAngle) * ringRadius,
            Math.sin(ringAngle) * ringRadius * 0.84,
            arcZ,
          ),
          alongAxis.v(palmProfileDepth, ringTone, toneMul),
          stripeIndex++);
      }
    for (let arcZ = 0; arcZ < partGeometry; arcZ++)
      alongAxis.v(palmProfileDepth.set(0, 0, edgeWeightMin + 0.006), GLOVE_TONE_SLEEVE, 0.3);
    alongAxis.collapse();
    let sleeveGeo = alongAxis.geo(!0);
    (sleeveGeo.applyMatrix4(
      new Mat4()
        .makeTranslation(0, 0, sleeveInset)
        .multiply(new Mat4().makeRotationFromQuaternion(sleeveQuat))
        .multiply(new Mat4().makeTranslation(0, 0, -sleeveInset)),
    ),
      addPart('sleeve', sleeveGeo));
  }
  let result = {
    fabric: mergeGeometryParts(parts),
    rubber: null,
    index: indexGeoms.length ? indexGeoms : null,
    knuckle: FINGER_SEGMENTS[0].base.slice(),
  };
  return (
    handSpec.mirror &&
      (mirrorGeometryX(result.fabric),
      result.index && result.index.forEach(mirrorGeometryX),
      (result.knuckle[0] *= -1)),
    result
  );
}

/**
 * 用 canvas 2D 画出 PAC-9 全部铭文与符号，再用 destination-out 点 2600 个噪点做掉漆磨损，产出 sRGB CanvasTexture（带各向异性与 mipmap）
 */
export function buildMarkingsAtlas() {
  let atlasCanvas = document.createElement('canvas');
  ((atlasCanvas.width = MARK_ATLAS_WIDTH), (atlasCanvas.height = MARK_ATLAS_HEIGHT));
  let g2d = atlasCanvas.getContext('2d');
  (g2d.clearRect(0, 0, MARK_ATLAS_WIDTH, MARK_ATLAS_HEIGHT), (g2d.textBaseline = 'middle'));
  let drawStamp = (u, h, f, p, d = 'left') => {
      let [v, g, x, y] = PAC9_MARK_REGIONS[u];
      ((g2d.font = f),
        (g2d.fillStyle = p),
        (g2d.textAlign = d),
        g2d.fillText(h, d === 'left' ? v + 2 : v + x / 2, g + y / 2 + 1, x - 4));
    },
    sansFont = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif',
    monoFont = '"IBM Plex Mono", "Courier New", monospace',
    displayFont = '"Big Shoulders Display", "Barlow Condensed", Impact, sans-serif',
    inkColor = 'rgba(196,198,194,0.92)';
  (drawStamp('model', 'PAC-9', `700 78px ${displayFont}`, inkColor),
    drawStamp('maker', 'LONGSHORE ARMS WORKS  \xB7  SALTLINE', `600 30px ${sansFont}`, inkColor),
    drawStamp('cal', 'CAL 5.8\xD740   SN PA-004217', `500 27px ${monoFont}`, inkColor),
    drawStamp(
      'prop',
      'PROPERTY OF PORT AUTHORITY \u2014 BERTH 4 ARMOURY',
      `600 28px ${sansFont}`,
      inkColor,
    ),
    drawStamp('safe', 'S', `700 30px ${sansFont}`, inkColor, 'center'),
    drawStamp('semi', '1', `700 30px ${sansFont}`, inkColor, 'center'),
    drawStamp('auto', 'A', `700 30px ${sansFont}`, 'rgba(205,60,40,0.95)', 'center'),
    drawStamp('rack', 'B4-07', `800 104px ${displayFont}`, 'rgba(214,206,170,0.9)', 'center'));
  for (let regionKeyName of [2, 4, 6, 8, 10, 12])
    drawStamp(
      'r' + regionKeyName,
      'T' + regionKeyName,
      `600 30px ${monoFont}`,
      'rgba(190,192,188,0.85)',
      'center',
    );
  (drawStamp('optic', 'HX-2 REFLEX', `700 44px ${sansFont}`, inkColor, 'center'),
    drawStamp('light', '900 LM  IPX8', `600 40px ${sansFont}`, inkColor, 'center'));
  {
    let [regionKeyName, stampText] = PAC9_MARK_REGIONS.warn;
    ((g2d.fillStyle = inkColor),
      (g2d.textAlign = 'left'),
      (g2d.font = `600 24px ${sansFont}`),
      [
        'WARNING \u2014 CLEAR CHAMBER BEFORE',
        'STOWAGE. AUTHORISED BREACH',
        'PERSONNEL ONLY. PA-REG 44/7',
      ].forEach((stampFont, stampInk) =>
        g2d.fillText(stampFont, regionKeyName + 2, stampText + 20 + stampInk * 34),
      ));
  }
  {
    let [regionKeyName, stampText, stampFont, stampInk] = PAC9_MARK_REGIONS.dots;
    ((g2d.fillStyle = inkColor),
      g2d.beginPath(),
      g2d.arc(regionKeyName + 12, stampText + stampInk / 2, 7, 0, 7),
      g2d.fill(),
      (g2d.fillStyle = 'rgba(205,60,40,0.95)'),
      g2d.beginPath(),
      g2d.arc(regionKeyName + 40, stampText + stampInk / 2, 7, 0, 7),
      g2d.fill());
  }
  g2d.globalCompositeOperation = 'destination-out';
  let rngState = 7,
    rng = () => ((rngState = (rngState * 16807) % 2147483647), rngState / 2147483647);
  for (let regionKeyName = 0; regionKeyName < 2600; regionKeyName++) {
    g2d.fillStyle = `rgba(0,0,0,${0.25 + rng() * 0.6})`;
    let stampText = rng() < 0.9 ? 1 + rng() * 1.5 : 2 + rng() * 5;
    g2d.fillRect(
      rng() * MARK_ATLAS_WIDTH,
      rng() * MARK_ATLAS_HEIGHT,
      stampText,
      stampText * (0.4 + rng()),
    );
  }
  let atlasTexture = new THREE.CanvasTexture(atlasCanvas);
  return (
    (atlasTexture.colorSpace = THREE.SRGBColorSpace),
    (atlasTexture.anisotropy = 8),
    (atlasTexture.generateMipmaps = !0),
    (atlasTexture.minFilter = THREE.LinearMipmapLinearFilter),
    atlasTexture
  );
}

/**
 * 红点镜片：按镜片多边形建面片，用自定义着色器在同一张面上同时画红点/刻线准星与镀膜反射（含天空与太阳、蓝到琥珀渐变与边缘暗边），越肩视角下也能看到发光点
 */
export function createOpticLens(windowOutline, lensOffset) {
  let lensShape = new THREE.Shape();
  (windowOutline.forEach((outlineVertex, vertexIndex) =>
    vertexIndex
      ? lensShape.lineTo(outlineVertex[0], outlineVertex[1])
      : lensShape.moveTo(outlineVertex[0], outlineVertex[1]),
  ),
    lensShape.closePath());
  let lensGeo = new THREE.ShapeGeometry(lensShape);
  lensGeo.translate(0, 0, -lensOffset);
  {
    let outlineVertex = 1e9,
      vertexIndex = -1e9,
      minY = 1e9,
      maxY = -1e9;
    for (let vertIdx of windowOutline)
      ((outlineVertex = Math.min(outlineVertex, vertIdx[0])),
        (vertexIndex = Math.max(vertexIndex, vertIdx[0])),
        (minY = Math.min(minY, vertIdx[1])),
        (maxY = Math.max(maxY, vertIdx[1])));
    let posAttr = lensGeo.attributes.position,
      uvAttr = lensGeo.attributes.uv;
    for (let vertIdx = 0; vertIdx < posAttr.count; vertIdx++)
      uvAttr.setXY(
        vertIdx,
        (posAttr.getX(vertIdx) - outlineVertex) / (vertexIndex - outlineVertex),
        (posAttr.getY(vertIdx) - minY) / (maxY - minY),
      );
  }
  let lensMat = new THREE.ShaderMaterial({
      transparent: !0,
      premultipliedAlpha: !0,
      depthWrite: !1,
      side: THREE.DoubleSide,
      uniforms: {
        uBright: {
          value: 7,
        },
        uSun: {
          value: SUN.dir.clone(),
        },
        uSunCol: {
          value: SUN.color.clone(),
        },
        uZen: {
          value: SKY_COLORS.zenith.clone(),
        },
        uHor: {
          value: SKY_COLORS.horizonAway.clone(),
        },
        uTilt: {
          value: 0.1,
        },
      },
      vertexShader: `
      varying vec3 vView, vFwd, vRight, vUp, vWPos, vWN; varying vec2 vUv;
      uniform float uTilt;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = mv.xyz;
        vFwd = (modelViewMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xyz; vRight = (modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz; vUp = (modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * normalize(vec3(0.0, -uTilt, 1.0)));   // real sights tilt the glass a few degrees
        gl_Position = projectionMatrix * mv;
      }`,
      fragmentShader: `
      varying vec3 vView, vFwd, vRight, vUp, vWPos, vWN; varying vec2 vUv;
      uniform float uBright; uniform vec3 uSun, uSunCol, uZen, uHor;
      void main(){
        vec3 d = normalize(vView), fw = normalize(vFwd);
        float k = max(dot(d, fw), 1e-3);
        vec2 a = vec2(dot(d, normalize(vRight)), dot(d, normalize(vUp))) / k;      // tangent of the angle off the bore axis
        float r = length(a), px = max(fwidth(r), 1e-5);
        float dotR = max(0.0011, px * 0.9), ringW = max(0.00045, px * 0.6);
        float dotI = 1.0 - smoothstep(dotR - px, dotR + px, r);
        float ring = 1.0 - smoothstep(ringW - px * 0.5, ringW + px, abs(r - 0.0128));
        float ang = atan(a.y, a.x);
        float tick = (1.0 - smoothstep(0.0, px * 1.2 + 0.0004, min(abs(a.x), abs(a.y)))) * step(0.0128, r) * (1.0 - smoothstep(0.0165, 0.0175, r));
        float ret = clamp(dotI + ring * 0.8 + tick * 0.8, 0.0, 1.0);
        // faint halo so the bloom has something to hold on to
        ret += 0.05 * exp(-r * r / 0.00002);
        vec3 retCol = vec3(1.0, 0.11, 0.045) * ret * uBright;
        // coated glass: sky/sun reflection through a ruby-teal dichroic coating, stronger at grazing angles
        vec3 wv = normalize(vWPos - cameraPosition); vec3 n = normalize(vWN); if (dot(n, wv) > 0.0) n = -n;
        vec3 rf = reflect(wv, n);
        float fres = pow(1.0 - abs(dot(wv, n)), 3.0);
        vec3 sky = mix(uHor, uZen, clamp(rf.y * 1.4 + 0.2, 0.0, 1.0));
        float sd = max(dot(rf, uSun), 0.0);
        sky += uSunCol * (pow(sd, 6.0) * 0.6 + pow(sd, 90.0) * 6.0);
        // blue -> amber dichroic coating across the glass, a soft diagonal sheen band, and a thin dark edge
        float band = smoothstep(0.25, 0.5, vUv.x * 0.6 + vUv.y) * (1.0 - smoothstep(0.62, 0.95, vUv.x * 0.6 + vUv.y));
        vec3 coat = mix(vec3(0.30, 0.50, 0.95), vec3(1.0, 0.62, 0.28), clamp(fres * 2.2 + vUv.y * 0.75 - 0.15, 0.0, 1.0));
        vec2 e = abs(vUv - 0.5) * 2.0; float edge = smoothstep(0.90, 1.0, max(e.x, e.y));
        float refl = 0.12 + 0.60 * fres + 0.07 * band;
        // faint emitter glow that stays visible off-axis (what you see of a powered sight from the hip)
        vec2 eg = (vUv - vec2(0.5, 0.16)) * vec2(1.0, 1.6); retCol += vec3(1.0, 0.10, 0.04) * 0.20 * exp(-dot(eg, eg) * 60.0) * (1.0 - smoothstep(0.985, 0.9995, k));
        vec3 col = (sky * 1.5 + vec3(0.03, 0.035, 0.045)) * coat * refl * (1.0 - edge) + retCol;
        float alpha = clamp(0.20 + 0.32 * fres + 0.05 * band + 0.6 * edge, 0.0, 0.94);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    }),
    lensMesh = new THREE.Mesh(lensGeo, lensMat);
  return ((lensMesh.renderOrder = 5), lensMesh);
}

/**
 * 枪口火焰：把花瓣、射流、星芒、光晕、余热五类面片塞进一个几何，用 aType 属性在着色器里分支出不同形状，靠 uSeed/uInt/uHeat/uJet 做每发随机
 */
export function createMuzzleFlash() {
  let positions = [],
    uvs = [],
    types = [],
    indices = [],
    pushQuad = (d, v, g, x, y) => {
      let b = positions.length / 3;
      for (let m of [d, v, g, x]) positions.push(m[0], m[1], m[2]);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      for (let m = 0; m < 4; m++) types.push(y);
      indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
  (pushQuad(
    [-0.13, -0.13, -0.03],
    [0.13, -0.13, -0.03],
    [0.13, 0.13, -0.03],
    [-0.13, 0.13, -0.03],
    0,
  ),
    pushQuad(
      [-0.13 * 0.7, -0.13 * 0.7, -0.09],
      [0.13 * 0.7, -0.13 * 0.7, -0.09],
      [0.13 * 0.7, 0.13 * 0.7, -0.09],
      [-0.13 * 0.7, 0.13 * 0.7, -0.09],
      0,
    ));
  let jetHalfW = 0.065,
    jetLen = 0.34;
  (pushQuad(
    [-jetHalfW, 0, 0.01],
    [jetHalfW, 0, 0.01],
    [jetHalfW, 0, -jetLen],
    [-jetHalfW, 0, -jetLen],
    1,
  ),
    pushQuad(
      [0, -jetHalfW, 0.01],
      [0, jetHalfW, 0.01],
      [0, jetHalfW, -jetLen],
      [0, -jetHalfW, -jetLen],
      1,
    ));
  let starHalfW = 0.17,
    starHalfH = 0.05,
    starZ = 0.035;
  (pushQuad(
    [-starHalfW, -starHalfH, starZ],
    [starHalfW, -starHalfH, starZ],
    [starHalfW, starHalfH, starZ],
    [-starHalfW, starHalfH, starZ],
    2,
  ),
    pushQuad(
      [-starHalfW, 0, starZ + starHalfH],
      [starHalfW, 0, starZ + starHalfH],
      [starHalfW, 0, starZ - starHalfH],
      [-starHalfW, 0, starZ - starHalfH],
      2,
    ),
    pushQuad(
      [-0.05, -0.05, -0.01],
      [0.05, -0.05, -0.01],
      [0.05, 0.05, -0.01],
      [-0.05, 0.05, -0.01],
      3,
    ),
    pushQuad(
      [-0.03, -0.03, 0.02],
      [0.03, -0.03, 0.02],
      [0.03, 0.03, 0.02],
      [-0.03, 0.03, 0.02],
      4,
    ));
  let flashGeo = new THREE.BufferGeometry();
  (flashGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)),
    flashGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)),
    flashGeo.setAttribute('aType', new THREE.Float32BufferAttribute(types, 1)),
    flashGeo.setIndex(indices));
  let flashMat = new THREE.ShaderMaterial({
      transparent: !0,
      depthWrite: !1,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uSeed: {
          value: 0,
        },
        uInt: {
          value: 0,
        },
        uHeat: {
          value: 0,
        },
        uJet: {
          value: 1,
        },
      },
      vertexShader: `attribute float aType; varying vec2 vUv; varying float vType;
      void main(){ vUv = uv; vType = aType; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; varying float vType; uniform float uSeed, uInt, uHeat, uJet;
      float h1(float n){ return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453); }
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r = length(p), a = atan(p.y, p.x); float I = 0.0; vec3 tintc = vec3(1.0, 0.50, 0.16);
        if (vType < 0.5) {
          float n1 = 3.0 + floor(h1(1.0) * 3.0), n2 = 5.0 + floor(h1(2.0) * 4.0);
          float pet = pow(abs(cos(a * n1 * 0.5 + h1(3.0) * 6.283)), 5.0) * (0.55 + 0.45 * h1(4.0));
          pet += pow(abs(cos(a * n2 * 0.5 + h1(5.0) * 6.283)), 14.0) * 0.55;
          float reach = 0.35 + 0.65 * pet;
          I = (0.25 + pet) * smoothstep(reach, reach * 0.15, r) * (0.75 + 0.25 * sin(r * 26.0 + h1(6.0) * 20.0));
        } else if (vType < 1.5) {
          float y = vUv.y, x = p.x * (1.0 + 0.5 * sin(y * 17.0 + h1(7.0) * 30.0) * y);
          float wdt = mix(0.20, 0.75, smoothstep(0.0, 0.35, y)) * (1.0 - y * 0.75);
          I = exp(-x * x / (wdt * wdt * 0.35)) * pow(1.0 - y, 1.4) * (0.7 + 0.3 * sin(y * 31.0 + h1(8.0) * 9.0)) * 0.9;
        } else if (vType < 2.5) {
          float u = abs(p.x), len = 0.55 + 0.45 * h1(9.0 + step(0.0, p.x));
          float wv = p.y * (1.0 + u * 3.0) + 0.12 * sin(u * 14.0 + h1(10.0) * 20.0) * u;
          I = exp(-wv * wv * 22.0) * smoothstep(len, 0.06, u) * smoothstep(0.02, 0.10, u) * 0.85 * uJet;
        } else if (vType < 3.5) {
          I = exp(-r * r * 5.0) * 2.4 * smoothstep(1.0, 0.6, r); tintc = vec3(1.0, 0.82, 0.58);
        } else {
          gl_FragColor = vec4(vec3(1.0, 0.28, 0.06) * exp(-r * r * 4.0) * smoothstep(1.0, 0.5, r) * uHeat, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          return;
        }
        vec3 col = mix(tintc, vec3(1.0, 0.90, 0.70), clamp(I * I * 0.7, 0.0, 1.0)) * I * uInt;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    }),
    flashMesh = new THREE.Mesh(flashGeo, flashMat);
  return ((flashMesh.renderOrder = 10), (flashMesh.frustumCulled = !1), flashMesh);
}

/**
 * 武器表面细节的公共 GLSL 段：三维 value noise、二维哈希、可平铺水滴函数与屏幕空间凹凸求导，被材质补丁注入到 three 标准材质的 common 之后
 */
var PAC9_DETAIL_COMMON_GLSL = `
varying vec3 vObjP; varying vec3 vWNrm; varying vec3 vONrm; uniform float uKind; uniform float uRain;
float dh3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float dn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dh3(i), dh3(i + vec3(1,0,0)), f.x), mix(dh3(i + vec3(0,1,0)), dh3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(dh3(i + vec3(0,0,1)), dh3(i + vec3(1,0,1)), f.x), mix(dh3(i + vec3(0,1,1)), dh3(i + vec3(1,1,1)), f.x), f.y), f.z); }
vec2 dh2(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
vec2 dDrops(vec2 uv, float cell, float seed){ vec2 g = uv / cell, i = floor(g), f = fract(g); float best = 0.0;
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) { vec2 o = vec2(float(a), float(b)); vec2 r = dh2(i + o + seed);
    float keep = step(0.70, fract(r.x * 7.31 + r.y * 3.17)); vec2 c = o + 0.2 + 0.6 * r; float rad = (0.16 + 0.22 * fract(r.x * 13.7)) * keep;
    float d = length(f - c); best = max(best, sqrt(max(rad * rad - d * d, 0.0))); }
  return vec2(best * cell, step(1e-6, best)); }
vec3 dBump(vec3 N, float h){ vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition); float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpdy, N), r2 = cross(N, dpdx); float det = dot(dpdx, r1); vec3 g = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * N - g); }
`;

/**
 * 按材质种类（阳极氧化/磷化/聚合物）扰动粗糙度，并叠加雨水湿润与水珠压暗，替换 roughnessmap_fragment
 */
var PAC9_DETAIL_ROUGHNESS_GLSL = `
vec3 dP = vObjP; vec3 dAn = abs(vONrm);
vec2 dUV = (dAn.y > dAn.x && dAn.y > dAn.z) ? dP.xz : (dAn.x > dAn.z ? dP.zy : dP.xy);
float dSm = dn3(dP * 36.0), dSm2 = dn3(dP * 150.0 + 7.0), dFine = dn3(dP * 2400.0);
float dHt = 0.0, dR = 0.0;
if (uKind < 0.5) {
  float scuff = smoothstep(0.70, 0.9, dn3(dP * vec3(420.0, 420.0, 26.0) + 3.0));
  float smudge = smoothstep(0.55, 0.8, dn3(dP * 55.0 + 11.0));
  dR = (dSm - 0.5) * 0.20 + (dSm2 - 0.5) * 0.10 + (dFine - 0.5) * 0.08 + scuff * 0.18 - smudge * 0.12;
  dHt = dFine * 0.000010 - scuff * 0.000015;
} else if (uKind < 1.5) {
  float ring = sin(dP.z * 5200.0) * 0.5 + 0.5, streak = dn3(vec3(dP.z * 950.0, 1.0, 2.0));
  dR = (streak - 0.5) * 0.26 + (dSm - 0.5) * 0.14 + (dFine - 0.5) * 0.10;
  dHt = ring * 0.000014 + dFine * 0.000010;
} else {
  float st = dn3(dP * 1500.0) * 0.6 + dn3(dP * 3100.0 + 5.0) * 0.4;
  dR = (dSm - 0.5) * 0.18 + (st - 0.5) * 0.14 - smoothstep(0.6, 0.85, dSm2) * 0.10;
  dHt = st * 0.000075;
}
float dUp = smoothstep(0.30, 0.75, vWNrm.y) * uRain;
vec2 dD1 = dDrops(dUV, 0.0046, 3.0), dD2 = dDrops(dUV + 0.31, 0.0023, 9.0);
float dDrop = max(dD1.y, dD2.y) * dUp, dDropH = max(dD1.x, dD2.x) * dUp;
float dWet = dUp * (0.5 + 0.5 * smoothstep(0.3, 0.7, dSm));
roughnessFactor = clamp(roughnessFactor + dR, 0.10, 1.0);
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.5, dWet);
roughnessFactor = mix(roughnessFactor, 0.10, dDrop);
diffuseColor.rgb *= 1.0 - 0.18 * dWet;
`;

/**
 * 把上面算出的高度差通过 dBump 转成法线扰动，注入 normal_fragment_maps，让划痕与水珠有真实凹凸
 */
var PAC9_DETAIL_NORMAL_GLSL = `
normal = dBump(normal, dHt + dDropH * 0.32);
`;

/**
 * 给武器材质打 onBeforeCompile 补丁：注入 uKind（0 阳极/1 磷化/2 聚合物）与共享淋雨 uniform，并设置 customProgramCacheKey 让三种种类各自编译一份程序
 */
export function patchPac9DetailMaterial(material, detailKind) {
  return (
    (material.onBeforeCompile = (shader) => {
      ((shader.uniforms.uKind = {
        value: detailKind,
      }),
        (shader.uniforms.uRain = PAC9_RAIN_UNIFORM),
        (shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
varying vec3 vObjP; varying vec3 vWNrm; varying vec3 vONrm;`,
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
vObjP = position; vONrm = normal; vWNrm = normalize(mat3(modelMatrix) * normal);`,
          )),
        (shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
` + PAC9_DETAIL_COMMON_GLSL,
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
` + PAC9_DETAIL_ROUGHNESS_GLSL,
          )
          .replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
` + PAC9_DETAIL_NORMAL_GLSL,
          )));
    }),
    (material.customProgramCacheKey = () => 'pac9-detail-' + detailKind),
    material
  );
}

/**
 * 敌人装甲壳的主色顶点色（亮白），hound 与 gull 共用的机体外壳基色
 */
export var RIG_SHELL_WHITE = [1.15, 1.15, 1.15];

/**
 * 偏冷的装甲壳顶点色，用于通风口、次级面板等与主壳区分的小块
 */
export var RIG_SHELL_COOL = [0.95, 0.96, 0.97];

/**
 * 锈橙色装甲顶点色，用在底座、护边等易磨蚀部位，制造港口机械的旧化感
 */
export var RIG_SHELL_RUST = [1, 0.34, 0.08];

/**
 * 深灰黑装甲顶点色，用于凹陷面板、散热格栅等视觉重量集中的暗部
 */
export var RIG_SHELL_DARK = [0.1, 0.11, 0.12];

/**
 * 近黑的软管/缝隙顶点色，给管线与装甲接缝压暗，避免纯黑法线破面
 */
export var RIG_SHELL_SHADOW = [0.035, 0.035, 0.038];

/**
 * 黄黑警示条用的琥珀顶点色，标记危险运动部件（螺旋桨尖、枪口段）
 */
export var RIG_SHELL_HAZARD = [1, 0.7, 0.07];

/**
 * 白色金属顶点色，用于螺栓、法兰等高频小件，保持与暗色机体对比
 */
export var RIG_METAL_WHITE = [1, 1, 1];

/**
 * 过曝级亮金属顶点色，用在液压杆、关节轴等需要高光的传动件上
 */
export var RIG_METAL_BRIGHT = [2.4, 2.5, 2.6];

/**
 * 中灰金属顶点色，是敌人机械结构的默认金属基调
 */
export var RIG_METAL_BASE = [0.45, 0.46, 0.48];

/**
 * 近铬的极亮金属顶点色，只用于细钢索/拉杆等单条高光件
 */
export var RIG_METAL_CHROME = [9, 9, 9.6];

/**
 * 偏暖的亮金属顶点色，涂在枪管内壁模拟被高温烧灼的膛口
 */
export var RIG_METAL_BORE = [5.5, 4, 1.6];
