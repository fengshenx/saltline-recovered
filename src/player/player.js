// player/player.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

import { PLAYER_SPEC, PLAYER_TUNING, WORLD_BOUNDS } from '../core/config.js';

import { clamp, damp, lerp, saturate, smoothstep } from '../core/math.js';

/**
 * 由重力与期望跳跃顶点高度反解出的起跳初速度，改 gravity/jumpApex 时自动跟着变
 */
var JUMP_SPEED = Math.sqrt(2 * PLAYER_TUNING.gravity * PLAYER_TUNING.jumpApex);

/**
 * 第一人称玩家控制器：胶囊体移动与土狼时间/跳跃缓冲、蹲伏限高、落水救援、脚步事件、镜头 bob/侧倾/后坐力弹簧/受击抖动，并把 ADS 与低血量化成后处理参数写回 render.post
 */
export function createPlayer(ctx) {
  let camera = ctx.camera,
    getPost = () => (ctx.render && ctx.render.post) || nullPost,
    nullPost = {},
    eyeHeight = PLAYER_SPEC.eye,
    bodyHeight = PLAYER_TUNING.standHeight,
    coyote = 0,
    jumpBuffer = 0,
    wasGround = !0,
    airTime = 0,
    fallPeak = 0,
    stride = 0,
    bobAmount = 0,
    bobX = 0,
    bobY = 0,
    roll = 0,
    landDip = {
      x: 0,
      v: 0,
    },
    recoilPitch = 0,
    recoilYaw = 0,
    recoilPitchVis = 0,
    recoilYawVis = 0,
    recoilHold = 0,
    shake = 0,
    shakeClock = 0,
    sinceHit = 99,
    hurtPulse = 0,
    lowHealth = 0,
    deathTime = 0,
    fov = PLAYER_SPEC.fov,
    adsSpring = 0,
    surface = 'concrete',
    wishVel = new THREE.Vector3(),
    lookEuler = new THREE.Euler(0, 0, 0, 'YXZ'),
    lastSafe = new THREE.Vector3(),
    player = {
      pos: new THREE.Vector3(),
      eye: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      forward: new THREE.Vector3(0, 0, -1),
      yaw: 0,
      pitch: 0,
      health: 100,
      maxHealth: 100,
      alive: !0,
      onGround: !0,
      sprinting: !1,
      crouching: !1,
      ads: 0,
      speed: 0,
      enabled: !0,
      invulnerable: !1,
      baseFov: PLAYER_SPEC.fov,
      hurtPulse: 0,
      lookScale: 1,
      lastSafe: lastSafe,
      tuning: PLAYER_TUNING,
      reset(F) {
        let X = F ||
          (ctx.level && ctx.level.playerStart) || {
            pos: new THREE.Vector3(),
            yaw: 0,
          };
        (player.pos.copy(X.pos),
          (player.yaw = X.yaw || 0),
          (player.pitch = 0),
          player.vel.set(0, 0, 0),
          (player.health = player.maxHealth),
          (player.alive = !0),
          (player.onGround = !0),
          (player.sprinting = !1),
          (player.crouching = !1),
          (player.invulnerable = !1),
          (player.speed = 0),
          (eyeHeight = PLAYER_SPEC.eye),
          (bodyHeight = PLAYER_TUNING.standHeight),
          (coyote = 0),
          (jumpBuffer = 0),
          (wasGround = !0),
          (airTime = 0),
          (fallPeak = 0),
          (stride = 0),
          (bobAmount = 0),
          (bobX = bobY = 0),
          (roll = 0),
          (landDip.x = landDip.v = 0),
          (recoilPitch = recoilYaw = recoilPitchVis = recoilYawVis = 0),
          (recoilHold = 0),
          (shake = 0),
          (sinceHit = 99),
          (hurtPulse = 0),
          (lowHealth = 0),
          (deathTime = 0),
          (player.hurtPulse = 0),
          lastSafe.copy(player.pos));
        let ne = getPost();
        ((ne.damage = 0), (ne.lowHealth = 0), (ne.ads = 0), updateView(0));
      },
      damage(F, X) {
        !player.alive ||
          player.invulnerable ||
          !(F > 0) ||
          ((player.health = Math.max(0, player.health - F)),
          (sinceHit = 0),
          (hurtPulse = Math.min(1, hurtPulse + 0.35 + F / 40)),
          player.addShake(0.22 + F / 70),
          ctx.events.emit('player:hit', {
            amount: F,
            fromPos: X,
          }),
          player.health <= 0 &&
            ((player.alive = !1),
            (deathTime = 0),
            (player.sprinting = !1),
            ctx.events.emit('player:dead', {})));
      },
      heal(F) {
        player.alive && (player.health = Math.min(player.maxHealth, player.health + F));
      },
      addRecoil(F = 0, X = 0) {
        let ne = PLAYER_TUNING.recoilKeep;
        ((player.pitch = clamp(
          player.pitch + F * ne,
          -PLAYER_TUNING.pitchLimit,
          PLAYER_TUNING.pitchLimit,
        )),
          (player.yaw += X * ne),
          (recoilPitch += F * (1 - ne)),
          (recoilYaw += X * (1 - ne)),
          (recoilPitch = clamp(recoilPitch, -0.3, 0.3)),
          (recoilYaw = clamp(recoilYaw, -0.2, 0.2)),
          (recoilHold = PLAYER_TUNING.recoilHold));
      },
      addShake(F = 0.3) {
        shake = Math.min(1, shake + F);
      },
      setFov(F) {
        player.baseFov = clamp(+F || PLAYER_SPEC.fov, 55, 100);
      },
      update: update,
    };
  ctx.events.on('explosion', (F) => {
    if (!F || !F.pos) return;
    let X = player.eye.distanceTo(F.pos),
      ne = F.size || 1,
      re = saturate(1 - X / (14 + ne * 10)) * (0.35 + 0.35 * ne);
    re > 0.01 && player.addShake(re);
  });
  function canStand() {
    let cost = ctx.physics && ctx.physics.boxes;
    if (!cost) return !0;
    let dirX = PLAYER_SPEC.radius * 0.9,
      dirZ = player.pos.y + PLAYER_TUNING.crouchHeight - 0.05,
      ally = player.pos.y + PLAYER_TUNING.standHeight;
    for (let allyPos = 0; allyPos < cost.length; allyPos++) {
      let allyDx = cost[allyPos];
      if (
        !allyDx.bulletOnly &&
        !(
          player.pos.x + dirX < allyDx.min.x ||
          player.pos.x - dirX > allyDx.max.x ||
          player.pos.z + dirX < allyDx.min.z ||
          player.pos.z - dirX > allyDx.max.z
        ) &&
        allyDx.min.y < ally &&
        allyDx.max.y > dirZ
      )
        return !1;
    }
    return !0;
  }
  function groundSurface() {
    let F = player.pos.x,
      X = player.pos.z;
    try {
      if (ctx.ground && ctx.ground.isPuddle && player.pos.y < 0.05 && ctx.ground.isPuddle(F, X))
        return 'water';
    } catch {}
    if (surface && surface !== 'concrete') return surface;
    try {
      return (
        (ctx.level && ctx.level.groundSurfaceAt && ctx.level.groundSurfaceAt(F, X)) ||
        surface ||
        'concrete'
      );
    } catch {
      return surface || 'concrete';
    }
  }
  function update(F) {
    let X = ctx.input,
      ne = ctx.weapon || {};
    if (
      (ne.stub || typeof ne.ads != 'number'
        ? ((adsSpring = damp(adsSpring, player.enabled && X.ads ? 1 : 0, 14, F)),
          (player.ads = adsSpring))
        : (player.ads = saturate(ne.ads)),
      !player.alive)
    ) {
      ((deathTime += F), updateDead(F), updateView(F), updatePost(F));
      return;
    }
    let re = player.enabled;
    ((player.lookScale = lerp(1, PLAYER_TUNING.adsLook, player.ads)),
      re &&
        ((player.yaw -= X.look.dx * player.lookScale),
        (player.pitch = clamp(
          player.pitch - X.look.dy * player.lookScale,
          -PLAYER_TUNING.pitchLimit,
          PLAYER_TUNING.pitchLimit,
        )),
        (player.yaw > Math.PI * 4 || player.yaw < -Math.PI * 4) &&
          (player.yaw = player.yaw % (Math.PI * 2))),
      re && X.crouch
        ? (player.crouching = !0)
        : player.crouching && canStand() && (player.crouching = !1),
      (bodyHeight = player.crouching ? PLAYER_TUNING.crouchHeight : PLAYER_TUNING.standHeight));
    let ue = re ? X.move.x : 0,
      me = re ? X.move.y : 0,
      ee = ue * ue + me * me > 0.01,
      B =
        re &&
        X.sprint &&
        me > 0.55 &&
        Math.abs(ue) < 0.6 &&
        !player.crouching &&
        player.ads < 0.35 &&
        !X.fire;
    player.sprinting =
      (B && player.onGround && player.speed > PLAYER_TUNING.walk * 0.6) ||
      (B && !player.onGround && player.sprinting);
    let P = PLAYER_TUNING.walk;
    (player.crouching ? (P = PLAYER_TUNING.crouch) : B && (P = PLAYER_TUNING.sprint),
      (P = lerp(P, Math.min(P, PLAYER_TUNING.ads), player.ads)),
      me < 0 && (P *= lerp(1, 0.82, -me)));
    let V = Math.sin(player.yaw),
      Y = Math.cos(player.yaw);
    wishVel.set(ue * Y - me * V, 0, -ue * V - me * Y).multiplyScalar(P);
    let L = player.onGround
        ? ee
          ? PLAYER_TUNING.accelGround
          : PLAYER_TUNING.decelGround
        : ee
          ? PLAYER_TUNING.accelAir
          : 0.6,
      Z = wishVel.x - player.vel.x,
      J = wishVel.z - player.vel.z;
    !player.onGround && !ee && ((Z = -player.vel.x), (J = -player.vel.z));
    let oe = Math.hypot(Z, J),
      fe = L * F;
    (oe <= fe || oe < 1e-6
      ? (player.onGround || ee) && ((player.vel.x = wishVel.x), (player.vel.z = wishVel.z))
      : ((player.vel.x += (Z / oe) * fe), (player.vel.z += (J / oe) * fe)),
      (coyote = player.onGround ? PLAYER_TUNING.coyote : Math.max(0, coyote - F)),
      (jumpBuffer =
        re && X.pressed('jump') ? PLAYER_TUNING.jumpBuffer : Math.max(0, jumpBuffer - F)),
      jumpBuffer > 0 &&
        coyote > 0 &&
        (!player.crouching || canStand()) &&
        ((player.vel.y = JUMP_SPEED),
        (jumpBuffer = 0),
        (coyote = 0),
        (player.onGround = !1),
        (player.crouching = !1),
        (bodyHeight = PLAYER_TUNING.standHeight),
        ctx.events.emit('player:jump', {
          pos: player.pos,
        })),
      (player.vel.y -= PLAYER_TUNING.gravity * F * 0.5),
      player.vel.y < -40 && (player.vel.y = -40));
    let le = player.vel.y,
      R =
        ctx.physics.moveCapsule(
          player.pos,
          player.vel,
          F,
          PLAYER_SPEC.radius,
          bodyHeight,
          wasGround,
        ) || {};
    R.onGround || (player.vel.y -= PLAYER_TUNING.gravity * F * 0.5);
    let I = ctx.physics.bounds;
    if (
      (I &&
        ((player.pos.x = clamp(player.pos.x, I.min.x + 0.4, I.max.x - 0.4)),
        (player.pos.z = clamp(player.pos.z, I.min.z + 0.4, I.max.z - 0.4))),
      (player.onGround = !!R.onGround),
      R.surface && (surface = R.surface),
      player.onGround)
    ) {
      if (!wasGround && airTime > 0.12) {
        let ce = Math.max(0, -le, fallPeak);
        ((landDip.v -= Math.min(ce * PLAYER_TUNING.landDip, 3.2)),
          ce > 7.5 && player.addShake(Math.min(0.5, (ce - 7.5) * 0.06)),
          ctx.events.emit('player:land', {
            speed: ce,
            surface: groundSurface(),
            pos: player.pos,
          }),
          ce > 13 && player.damage((ce - 13) * 7, null),
          (stride = 0.35));
      }
      ((airTime = 0),
        (fallPeak = 0),
        player.pos.x <= WORLD_BOUNDS.quayX - 1.2 &&
          player.pos.y > -0.5 &&
          lastSafe.copy(player.pos));
    } else ((airTime += F), (fallPeak = Math.max(fallPeak, -player.vel.y)));
    ((wasGround = player.onGround),
      player.pos.y < WORLD_BOUNDS.seaY - 2.2 &&
        (player.pos.copy(lastSafe),
        player.vel.set(0, 0, 0),
        (player.onGround = !0),
        (wasGround = !0),
        (shake = 0.6),
        (player.yaw += Math.PI),
        player.damage(12, null),
        ctx.events.emit('player:rescued', {})),
      (player.speed = Math.hypot(player.vel.x, player.vel.z)));
    let se = player.crouching
      ? PLAYER_TUNING.stride.crouch
      : player.sprinting
        ? PLAYER_TUNING.stride.sprint
        : PLAYER_TUNING.stride.walk;
    if (player.onGround && player.speed > 0.5) {
      let ce = stride;
      ((stride += (player.speed * F) / se),
        Math.floor(stride) > Math.floor(ce) &&
          ctx.events.emit('player:step', {
            surface: groundSurface(),
            sprint: player.sprinting,
            pos: player.pos,
          }));
    } else player.onGround && (stride = damp(stride, Math.round(stride), 8, F));
    let ae = player.onGround
      ? saturate(player.speed / PLAYER_TUNING.walk) *
        (player.sprinting ? PLAYER_TUNING.bobSprint : 1) *
        lerp(1, PLAYER_TUNING.bobAds, player.ads) *
        (player.crouching ? 0.7 : 1)
      : 0;
    ((bobAmount = damp(bobAmount, ae, 9, F)),
      (bobY = -Math.cos(stride * Math.PI * 2) * PLAYER_TUNING.bobY * bobAmount),
      (bobX = Math.sin(stride * Math.PI) * PLAYER_TUNING.bobX * bobAmount));
    let k = player.vel.x * Y - player.vel.z * V;
    ((roll = damp(
      roll,
      (-k / PLAYER_TUNING.sprint) * PLAYER_TUNING.rollStrafe * lerp(1, 0.4, player.ads),
      8,
      F,
    )),
      (sinceHit += F),
      sinceHit > PLAYER_TUNING.regenDelay &&
        player.health < player.maxHealth &&
        (player.health = Math.min(player.maxHealth, player.health + PLAYER_TUNING.regenRate * F)),
      updateView(F),
      updatePost(F));
  }
  function updateDead(F) {
    ((player.vel.x = damp(player.vel.x, 0, 5, F)),
      (player.vel.z = damp(player.vel.z, 0, 5, F)),
      (player.vel.y -= PLAYER_TUNING.gravity * F));
    try {
      let X = ctx.physics.moveCapsule(
        player.pos,
        player.vel,
        F,
        PLAYER_SPEC.radius,
        0.6,
        wasGround,
      );
      wasGround = !!(X && X.onGround);
    } catch {}
    (player.pos.y < WORLD_BOUNDS.seaY - 1 &&
      ((player.pos.y = WORLD_BOUNDS.seaY - 1), (player.vel.y = 0)),
      (player.speed = 0),
      (player.sprinting = !1),
      (bobAmount = damp(bobAmount, 0, 10, F)),
      (bobX *= 0.9),
      (bobY *= 0.9));
  }
  function updateView(F) {
    let X = player.crouching ? PLAYER_SPEC.crouchEye : PLAYER_SPEC.eye,
      ne = 0,
      re = 0;
    if (player.alive)
      F > 0 ? (eyeHeight = damp(eyeHeight, X, PLAYER_TUNING.eyeRate, F)) : (eyeHeight = X);
    else {
      let Z = smoothstep(0, 0.85, deathTime),
        J = Z * Z;
      ((X = lerp(PLAYER_SPEC.eye, 0.22, J)),
        (eyeHeight = damp(eyeHeight, X, 18, F)),
        (ne = 1.15 * J),
        (re = -0.25 * Z + 0.12 * Math.sin(Z * Math.PI)));
    }
    if (F > 0) {
      let Z = -landDip.x * 150 - landDip.v * 17;
      ((landDip.v += Z * F),
        (landDip.x += landDip.v * F),
        (landDip.x = clamp(landDip.x, -PLAYER_TUNING.landDipMax, 0.05)),
        (recoilHold -= F),
        recoilHold <= 0 &&
          ((recoilPitch = damp(recoilPitch, 0, PLAYER_TUNING.recoilRecover, F)),
          (recoilYaw = damp(recoilYaw, 0, PLAYER_TUNING.recoilRecover, F))),
        (recoilPitchVis = damp(recoilPitchVis, recoilPitch, PLAYER_TUNING.recoilApply, F)),
        (recoilYawVis = damp(recoilYawVis, recoilYaw, PLAYER_TUNING.recoilApply, F)),
        (shake = Math.max(0, shake - PLAYER_TUNING.shakeDecay * F)),
        (shakeClock += F));
    }
    let $ = Math.sin(player.yaw),
      ue = Math.cos(player.yaw);
    player.eye.set(
      player.pos.x + bobX * ue,
      player.pos.y + eyeHeight + bobY + landDip.x,
      player.pos.z - bobX * $,
    );
    let me = clamp(player.pitch + recoilPitchVis, -1.55, 1.55),
      ee = player.yaw + recoilYawVis;
    (lookEuler.set(me, ee, 0, 'YXZ'), player.forward.set(0, 0, -1).applyEuler(lookEuler));
    let B = shake * shake,
      P = shakeClock,
      V = B * PLAYER_TUNING.shakePitch * (Math.sin(P * 43.1) + 0.6 * Math.sin(P * 71.7 + 1.3)),
      Y = B * PLAYER_TUNING.shakeYaw * (Math.sin(P * 37.3 + 2.1) + 0.6 * Math.sin(P * 83.9)),
      L = B * PLAYER_TUNING.shakeRoll * (Math.sin(P * 29.7 + 0.7) + 0.5 * Math.sin(P * 61.3 + 4));
    if (
      (camera.position.copy(player.eye),
      camera.rotation.set(
        me + V + re + landDip.x * 0.12,
        ee + Y,
        roll + L + ne + bobX * 0.35,
        'YXZ',
      ),
      !ctx.params || !ctx.params.fov)
    ) {
      let Z = lerp(
        player.baseFov + (player.sprinting ? PLAYER_TUNING.fovSprint : 0),
        PLAYER_TUNING.fovAds,
        player.ads,
      );
      ((fov = F > 0 ? damp(fov, Z, player.ads > 0.02 && player.ads < 0.98 ? 30 : 7, F) : Z),
        Math.abs(camera.fov - fov) > 0.01 && ((camera.fov = fov), camera.updateProjectionMatrix()));
    }
  }
  function updatePost(F) {
    ((hurtPulse = Math.max(0, hurtPulse - F * 1.9)), (player.hurtPulse = hurtPulse));
    let X = player.alive ? smoothstep(0.55, 0.12, player.health / player.maxHealth) : 1;
    lowHealth = damp(lowHealth, X, 4, F);
    let ne = getPost();
    ((ne.damage = hurtPulse), (ne.lowHealth = lowHealth), (ne.ads = player.ads));
  }
  return player;
}

/**
 * 空玩家桩：展示模式没有真实玩家控制器时顶替，提供位置/朝向/血量等只读字段与空实现方法，让武器、HUD、敌人系统仍能正常运行
 */
export function createStubPlayer(ctx) {
  return {
    pos: new THREE.Vector3(0, 0, 4),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    health: 100,
    maxHealth: 100,
    alive: !0,
    onGround: !0,
    sprinting: !1,
    crouching: !1,
    ads: 0,
    speed: 0,
    eye: new THREE.Vector3(0, PLAYER_SPEC.eye, 4),
    forward: new THREE.Vector3(0, 0, -1),
    enabled: !1,
    reset() {},
    damage() {},
    heal() {},
    addRecoil() {},
    addShake() {},
    update() {},
  };
}
