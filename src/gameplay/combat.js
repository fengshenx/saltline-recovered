// gameplay/combat.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

/**
 * 命中判定服务：玩家/敌人射击都走同一条射线，先打敌人骨骼盒再落到场景，负责弱点倍率、弹着点事件与爆炸范围伤害，保证敌我两套伤害口径一致
 */
export function createCombat(ctx) {
  let stats = {
    shots: 0,
    hits: 0,
    kills: 0,
  };
  return (
    ctx.events.on('enemy:killed', () => {
      stats.kills++;
    }),
    {
      stats: stats,
      reset() {
        stats.shots = stats.hits = stats.kills = 0;
      },
      playerShot(
        originPoint,
        shotDir,
        { damage: damageAmount = 28, range: maxRange = 300, impulse: impulseScale = 1 } = {},
      ) {
        stats.shots++;
        let sceneHit = ctx.physics.raycast(originPoint, shotDir, maxRange),
          enemyHit = ctx.enemies.raycast(originPoint, shotDir, sceneHit ? sceneHit.dist : maxRange);
        if (enemyHit) {
          stats.hits++;
          let weakMultiplier = enemyHit.part === 'weak' ? 2.2 : 1,
            killFlag =
              enemyHit.enemy.damage(
                damageAmount * weakMultiplier,
                enemyHit.point,
                shotDir,
                enemyHit.part,
              ) === !0,
            impactPayload = {
              point: enemyHit.point,
              normal: enemyHit.normal || shotDir.clone().negate(),
              dist: enemyHit.dist,
              surface: 'enemy',
              enemy: enemyHit.enemy,
              part: enemyHit.part,
              dir: shotDir,
              from: 'player',
              killed: killFlag,
            };
          return (
            ctx.events.emit('impact', impactPayload),
            ctx.events.emit('player:hitEnemy', {
              enemy: enemyHit.enemy,
              part: enemyHit.part,
              killed: killFlag,
              weak: enemyHit.part === 'weak',
            }),
            impactPayload
          );
        }
        if (sceneHit) {
          let weakMultiplier = {
            point: sceneHit.point,
            normal: sceneHit.normal,
            dist: sceneHit.dist,
            surface: sceneHit.surface,
            enemy: null,
            dir: shotDir,
            from: 'player',
          };
          return (ctx.events.emit('impact', weakMultiplier), weakMultiplier);
        }
        return null;
      },
      enemyShot(originPoint, shotDir, { damage: damageAmount = 6, range: maxRange = 200 } = {}) {
        let impulseScale = ctx.physics.raycast(originPoint, shotDir, maxRange),
          sceneHit = impulseScale ? impulseScale.dist : maxRange,
          enemyHit = ctx.player;
        if (enemyHit && enemyHit.alive) {
          let weakMultiplier = COMBAT_SCRATCH_POINT.copy(enemyHit.pos);
          weakMultiplier.y += 1;
          let killFlag = weakMultiplier.sub(originPoint).dot(shotDir);
          if (killFlag > 0 && killFlag < sceneHit) {
            COMBAT_SCRATCH_DIR.copy(originPoint).addScaledVector(shotDir, killFlag);
            let impactPayload = Math.abs(COMBAT_SCRATCH_DIR.y - (enemyHit.pos.y + 0.95));
            if (
              Math.hypot(
                COMBAT_SCRATCH_DIR.x - enemyHit.pos.x,
                COMBAT_SCRATCH_DIR.z - enemyHit.pos.z,
              ) < 0.38 &&
              impactPayload < 0.95
            )
              return (enemyHit.damage(damageAmount, originPoint), !0);
          }
        }
        return (
          impulseScale &&
            ctx.events.emit('impact', {
              point: impulseScale.point,
              normal: impulseScale.normal,
              dist: impulseScale.dist,
              surface: impulseScale.surface,
              enemy: null,
              dir: shotDir,
              from: 'enemy',
            }),
          !1
        );
      },
      explode(originPoint, shotDir = 5, damageAmount = 80, maxRange = 'player') {
        for (let sceneHit of ctx.enemies.list) {
          if (!sceneHit.alive) continue;
          let enemyHit = sceneHit.pos.distanceTo(originPoint);
          enemyHit < shotDir &&
            ctx.physics.lineOfSight(
              originPoint,
              COMBAT_SCRATCH_POINT.copy(sceneHit.pos).setY(sceneHit.pos.y + 0.5),
            ) &&
            sceneHit.damage(
              damageAmount * (1 - enemyHit / shotDir),
              sceneHit.pos,
              COMBAT_SCRATCH_DIR.copy(sceneHit.pos).sub(originPoint).normalize(),
              'body',
            );
        }
        let impulseScale = ctx.player;
        if (impulseScale && impulseScale.alive) {
          let sceneHit = COMBAT_SCRATCH_POINT.copy(impulseScale.pos)
            .setY(impulseScale.pos.y + 1)
            .distanceTo(originPoint);
          sceneHit < shotDir &&
            ctx.physics.lineOfSight(
              originPoint,
              COMBAT_SCRATCH_POINT.copy(impulseScale.pos).setY(impulseScale.pos.y + 1),
            ) &&
            impulseScale.damage(damageAmount * 0.5 * (1 - sceneHit / shotDir), originPoint);
        }
      },
    }
  );
}

/**
 * 命中解算复用的临时向量，避免每发子弹都分配 Vector3
 */
var COMBAT_SCRATCH_POINT = new THREE.Vector3();

/**
 * 爆炸/命中方向计算的临时向量，与 COMBAT_SCRATCH_POINT 成对使用
 */
var COMBAT_SCRATCH_DIR = new THREE.Vector3();
