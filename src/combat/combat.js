// combat/combat.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

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
      playerShot(n, s, { damage: o = 28, range: r = 300, impulse: a = 1 } = {}) {
        stats.shots++;
        let l = ctx.physics.raycast(n, s, r),
          c = ctx.enemies.raycast(n, s, l ? l.dist : r);
        if (c) {
          stats.hits++;
          let u = c.part === 'weak' ? 2.2 : 1,
            h = c.enemy.damage(o * u, c.point, s, c.part) === !0,
            f = {
              point: c.point,
              normal: c.normal || s.clone().negate(),
              dist: c.dist,
              surface: 'enemy',
              enemy: c.enemy,
              part: c.part,
              dir: s,
              from: 'player',
              killed: h,
            };
          return (
            ctx.events.emit('impact', f),
            ctx.events.emit('player:hitEnemy', {
              enemy: c.enemy,
              part: c.part,
              killed: h,
              weak: c.part === 'weak',
            }),
            f
          );
        }
        if (l) {
          let u = {
            point: l.point,
            normal: l.normal,
            dist: l.dist,
            surface: l.surface,
            enemy: null,
            dir: s,
            from: 'player',
          };
          return (ctx.events.emit('impact', u), u);
        }
        return null;
      },
      enemyShot(n, s, { damage: o = 6, range: r = 200 } = {}) {
        let a = ctx.physics.raycast(n, s, r),
          l = a ? a.dist : r,
          c = ctx.player;
        if (c && c.alive) {
          let u = COMBAT_SCRATCH_POINT.copy(c.pos);
          u.y += 1;
          let h = u.sub(n).dot(s);
          if (h > 0 && h < l) {
            COMBAT_SCRATCH_DIR.copy(n).addScaledVector(s, h);
            let f = Math.abs(COMBAT_SCRATCH_DIR.y - (c.pos.y + 0.95));
            if (
              Math.hypot(COMBAT_SCRATCH_DIR.x - c.pos.x, COMBAT_SCRATCH_DIR.z - c.pos.z) < 0.38 &&
              f < 0.95
            )
              return (c.damage(o, n), !0);
          }
        }
        return (
          a &&
            ctx.events.emit('impact', {
              point: a.point,
              normal: a.normal,
              dist: a.dist,
              surface: a.surface,
              enemy: null,
              dir: s,
              from: 'enemy',
            }),
          !1
        );
      },
      explode(n, s = 5, o = 80, r = 'player') {
        for (let l of ctx.enemies.list) {
          if (!l.alive) continue;
          let c = l.pos.distanceTo(n);
          c < s &&
            ctx.physics.lineOfSight(n, COMBAT_SCRATCH_POINT.copy(l.pos).setY(l.pos.y + 0.5)) &&
            l.damage(
              o * (1 - c / s),
              l.pos,
              COMBAT_SCRATCH_DIR.copy(l.pos).sub(n).normalize(),
              'body',
            );
        }
        let a = ctx.player;
        if (a && a.alive) {
          let l = COMBAT_SCRATCH_POINT.copy(a.pos)
            .setY(a.pos.y + 1)
            .distanceTo(n);
          l < s &&
            ctx.physics.lineOfSight(n, COMBAT_SCRATCH_POINT.copy(a.pos).setY(a.pos.y + 1)) &&
            a.damage(o * 0.5 * (1 - l / s), n);
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
