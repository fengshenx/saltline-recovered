// ui/hud.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import * as THREE from 'three';

/**
 * 罗盘刻度带的每度像素密度，决定刻度位置换算与目标标记的横向投影
 */
var COMPASS_PX_PER_DEG = 4;

/**
 * 罗盘刻度带起始角度（-90°），刻度带只生成这段区间以控制 DOM 数量
 */
var COMPASS_MIN_DEG = -90;

/**
 * 罗盘刻度带结束角度（450°），覆盖完整一圈加左右余量
 */
var COMPASS_MAX_DEG = 450;

/**
 * 每 45° 的基本方位字母表，生成罗盘主刻度文字用
 */
var COMPASS_CARDINALS = {
  0: 'N',
  45: 'NE',
  90: 'E',
  135: 'SE',
  180: 'S',
  225: 'SW',
  270: 'W',
  315: 'NW',
};

/**
 * 交互提示圆环的周长（半径 19 的 SVG 圆周），用 stroke-dashoffset 直接表达按住进度
 */
var PROMPT_RING_LENGTH = 2 * Math.PI * 19;

/**
 * 最小 DOM 构造助手：一行建元素并设 class 与 innerHTML，UI 代码里所有节点的统一出口
 */
function createEl(tag, className, html) {
  let el = document.createElement(tag);
  return (className && (el.className = className), html != null && (el.innerHTML = html), el);
}

/**
 * 搭出整块 HUD（罗盘刻度带、任务/中继进度、准星、命中反馈、爆炸方向弧、交互提示、击杀播报、无线电字幕、血条、弹药与武器名），并返回增量更新的 hud 对象——所有变动先与缓存值比对，避免每帧写 DOM
 */
export function createHUD(ctx) {
  let uiRoot = document.getElementById('ui'),
    root = createEl('div', 'hud');
  root.setAttribute('aria-hidden', 'true');
  let compass = createEl('div', 'h-compass'),
    tape = createEl('div', 'h-tape'),
    tapeHtml = '';
  for (let frameDelta = COMPASS_MIN_DEG; frameDelta <= COMPASS_MAX_DEG; frameDelta += 5) {
    let playerState = (frameDelta - COMPASS_MIN_DEG) * COMPASS_PX_PER_DEG,
      weaponState = ((frameDelta % 360) + 360) % 360,
      viewCamera = weaponState % 45 === 0,
      adsAmount = weaponState % 15 === 0;
    ((tapeHtml += `<i class="${viewCamera ? 'mj' : adsAmount ? 'md' : 'mn'}" style="left:${playerState}px"></i>`),
      viewCamera
        ? (tapeHtml += `<b class="${weaponState % 90 === 0 ? 'card' : 'ic'}" style="left:${playerState}px">${COMPASS_CARDINALS[weaponState]}</b>`)
        : weaponState % 15 === 0 &&
          (tapeHtml += `<b class="num" style="left:${playerState}px">${String(weaponState).padStart(3, '0')}</b>`));
  }
  tape.innerHTML = tapeHtml;
  let tapeWrap = createEl('div', 'h-tape-wrap');
  tapeWrap.appendChild(tape);
  let compassMarks = createEl('div', 'h-cmarks'),
    heading = createEl('div', 'h-heading', '000');
  compass.append(tapeWrap, createEl('i', 'h-needle'), compassMarks, heading);
  let objBlock = createEl(
      'div',
      'h-obj',
      '<div class="h-k">Objective</div><div class="h-obj-t"></div><div class="h-relays"><span>Relays</span><i></i><i></i><i></i><b>0/3</b></div>',
    ),
    objText = objBlock.querySelector('.h-obj-t'),
    relayRow = objBlock.querySelector('.h-relays'),
    relayCount = relayRow.querySelector('b'),
    relayPips = [...relayRow.querySelectorAll('i')],
    warnEl = createEl('div', 'h-warn'),
    crosshair = createEl(
      'div',
      'h-cross',
      '<i class="c-t"></i><i class="c-b"></i><i class="c-l"></i><i class="c-r"></i><i class="c-dot"></i>',
    ),
    crossParts = crosshair.querySelectorAll('i'),
    hitEl = createEl('div', 'h-hit', '<i></i><i></i><i></i><i></i>'),
    arcsWrap = createEl('div', 'h-arcs'),
    arcs = [];
  for (let frameDelta = 0; frameDelta < 4; frameDelta++) {
    let playerState = createEl(
      'div',
      'h-arc',
      '<svg viewBox="-100 -100 200 200"><path d="M -38 -84 A 92 92 0 0 1 38 -84" /><path class="tip" d="M -7 -97 L 0 -106 L 7 -97" /></svg>',
    );
    (arcsWrap.appendChild(playerState),
      arcs.push({
        el: playerState,
        life: 0,
        src: new THREE.Vector3(),
        op: -1,
        rot: 1e9,
      }));
  }
  let promptEl = createEl(
      'div',
      'h-prompt',
      `<svg viewBox="-24 -24 48 48"><circle class="bg" r="19"/><circle class="fg" r="19" stroke-dasharray="${PROMPT_RING_LENGTH.toFixed(2)}" stroke-dashoffset="${PROMPT_RING_LENGTH.toFixed(2)}" transform="rotate(-90)"/></svg><span class="h-key">E</span><span class="h-plabel"></span>`,
    ),
    promptRing = promptEl.querySelector('.fg'),
    promptKey = promptEl.querySelector('.h-key'),
    promptLabel = promptEl.querySelector('.h-plabel'),
    feedEl = createEl('div', 'h-feed'),
    msgEl = createEl('div', 'h-msg'),
    healthEl = createEl(
      'div',
      'h-health',
      '<div class="h-k">Vitals</div><div class="h-hp-row"><b class="h-hp-n">100</b><div class="h-hp-bar">' +
        '<i></i>'.repeat(10) +
        '</div></div>',
    ),
    hpNum = healthEl.querySelector('.h-hp-n'),
    hpSegments = [...healthEl.querySelectorAll('.h-hp-bar i')],
    ammoEl = createEl(
      'div',
      'h-ammo',
      '<div class="h-cue"></div><div class="h-ammo-row"><b class="h-ammo-n">30</b><span class="h-ammo-r">120</span></div><div class="h-pips"></div><div class="h-wname"></div>',
    ),
    ammoNum = ammoEl.querySelector('.h-ammo-n'),
    reserveNum = ammoEl.querySelector('.h-ammo-r'),
    pips = ammoEl.querySelector('.h-pips'),
    weaponName = ammoEl.querySelector('.h-wname'),
    cueEl = ammoEl.querySelector('.h-cue'),
    marksEl = createEl('div', 'h-marks');
  (root.append(
    marksEl,
    compass,
    objBlock,
    warnEl,
    arcsWrap,
    crosshair,
    hitEl,
    promptEl,
    feedEl,
    msgEl,
    healthEl,
    ammoEl,
  ),
    uiRoot.appendChild(root));
  let comms = createEl(
    'div',
    'comms',
    '<span class="comms-who">Control</span><span class="comms-t"></span>',
  );
  (comms.setAttribute('role', 'status'), comms.setAttribute('aria-live', 'polite'));
  let commsText = comms.querySelector('.comms-t');
  uiRoot.appendChild(comms);
  let visible = !1,
    tapeWidth = 420,
    viewW = innerWidth,
    viewH = innerHeight,
    cache = {
      ammo: -1,
      mag: -1,
      reserve: -1,
      name: null,
      cue: null,
      low: null,
      hp: -1,
      hpSeg: -1,
      hurt: null,
      head: -1,
      tapeX: 1e9,
      gap: -1,
      crossOn: null,
      promptOn: null,
      promptText: null,
      promptT: -1,
      promptKey: null,
      marksOn: null,
      done: -1,
      total: -1,
    },
    pipEls = [],
    objectiveText = '',
    objectiveChars = 0,
    objectiveProgress = 0,
    radioQueue = [],
    radioLine = null,
    radioChars = 0,
    radioProgress = 0,
    radioHold = 0,
    warnT = 0,
    messageT = 0,
    feedItems = [],
    markers = [],
    projected = new THREE.Vector3(),
    lastFeedItem = null,
    lastKillFrame = -1;
  function relayout() {
    ((viewW = innerWidth),
      (viewH = innerHeight),
      (tapeWidth = compass.clientWidth || Math.min(420, viewW * 0.6)),
      (cache.tapeX = 1e9),
      (cache.gap = -1));
    for (let k of markers) ((k.lastC = 1e9), (k.lastW = ''));
  }
  (addEventListener('resize', relayout),
    ctx.events.on('player:hitEnemy', (frameDelta) => {
      (hud.hitmarker(
        frameDelta && frameDelta.killed
          ? 'kill'
          : frameDelta && (frameDelta.weak || frameDelta.part === 'weak')
            ? 'weak'
            : 'hit',
      ),
        frameDelta &&
          frameDelta.killed &&
          frameDelta.weak &&
          lastFeedItem &&
          lastKillFrame === ctx.time.frame &&
          !lastFeedItem.weak &&
          ((lastFeedItem.weak = !0), (lastFeedItem.el.innerHTML += '<em>Weak point</em>')));
    }),
    ctx.events.on('enemy:killed', (frameDelta) => {
      let playerState = String(
        (frameDelta && (frameDelta.type || (frameDelta.enemy && frameDelta.enemy.type))) ||
          'machine',
      ).toUpperCase();
      ((lastFeedItem = hud.feed(`<b>${playerState}</b> destroyed`)),
        (lastKillFrame = ctx.time.frame));
    }),
    ctx.events.on('player:hit', (frameDelta) => {
      if (!frameDelta || !frameDelta.fromPos) return;
      let playerState = arcs[0];
      for (let weaponState of arcs) {
        if (weaponState.life <= 0) {
          playerState = weaponState;
          break;
        }
        weaponState.life < playerState.life && (playerState = weaponState);
      }
      (playerState.src.copy(frameDelta.fromPos), (playerState.life = 1.5), (playerState.max = 1.5));
    }));
  let hud = {
    root: root,
    show(frameDelta) {
      ((frameDelta = !!frameDelta),
        frameDelta !== visible &&
          ((visible = frameDelta),
          root.classList.toggle('on', frameDelta),
          frameDelta && relayout()));
    },
    setObjective(frameDelta) {
      ((frameDelta = frameDelta || ''),
        frameDelta !== objectiveText &&
          ((objectiveText = frameDelta),
          (objectiveChars = 0),
          (objectiveProgress = 0),
          (objText.textContent = ''),
          objBlock.classList.toggle('has', !!frameDelta),
          objBlock.classList.remove('flash'),
          objBlock.offsetWidth,
          objBlock.classList.add('flash')));
    },
    setRelays(frameDelta, playerState) {
      if (!(frameDelta === cache.done && playerState === cache.total)) {
        if (playerState !== cache.total) {
          (relayPips.forEach((weaponState) => weaponState.remove()), (relayPips = []));
          for (let weaponState = 0; weaponState < playerState; weaponState++) {
            let viewCamera = document.createElement('i');
            (relayRow.insertBefore(viewCamera, relayCount), relayPips.push(viewCamera));
          }
        }
        ((cache.done = frameDelta),
          (cache.total = playerState),
          relayPips.forEach((weaponState, viewCamera) =>
            weaponState.classList.toggle('cut', viewCamera < frameDelta),
          ),
          (relayCount.textContent = `${frameDelta}/${playerState}`),
          relayRow.classList.toggle('all', frameDelta >= playerState && playerState > 0));
      }
    },
    setMarkers(frameDelta) {
      for (let playerState of markers) (playerState.cEl.remove(), playerState.wEl.remove());
      markers = (frameDelta || []).map((playerState) => {
        let weaponState = createEl(
            'div',
            'h-cm ' + (playerState.kind || 'relay'),
            `<i></i><b>${playerState.short || ''}</b><span></span>`,
          ),
          viewCamera = createEl(
            'div',
            'h-wm ' + (playerState.kind || 'relay'),
            `<i></i><b>${playerState.short || ''}</b><span></span>`,
          );
        return (
          compassMarks.appendChild(weaponState),
          marksEl.appendChild(viewCamera),
          {
            ...playerState,
            cEl: weaponState,
            wEl: viewCamera,
            cDist: weaponState.querySelector('span'),
            wDist: viewCamera.querySelector('span'),
            lastD: -1,
            lastC: 1e9,
            lastW: '',
            vis: null,
          }
        );
      });
    },
    setPrompt(frameDelta, playerState = 0) {
      let weaponState = !!frameDelta;
      if (
        (weaponState !== cache.promptOn &&
          ((cache.promptOn = weaponState),
          promptEl.classList.toggle('on', weaponState),
          ctx.input.setPrompt && ctx.input.setPrompt(weaponState)),
        !weaponState)
      )
        return;
      let viewCamera = ctx.input.touch ? 'USE' : ctx.input.gamepad && !ctx.input.locked ? 'Y' : 'E';
      viewCamera !== cache.promptKey &&
        ((cache.promptKey = viewCamera),
        (promptKey.textContent = viewCamera),
        promptKey.classList.toggle('wide', viewCamera.length > 1));
      let adsAmount = `Hold ${viewCamera} \u2014 ${frameDelta}`;
      adsAmount !== cache.promptText &&
        ((cache.promptText = adsAmount), (promptLabel.textContent = adsAmount));
      let headingDegrees = Math.round(playerState * 200) / 200;
      headingDegrees !== cache.promptT &&
        ((cache.promptT = headingDegrees),
        promptRing.setAttribute(
          'stroke-dashoffset',
          (PROMPT_RING_LENGTH * (1 - headingDegrees)).toFixed(2),
        ),
        promptEl.classList.toggle('busy', headingDegrees > 0));
    },
    radio(frameDelta, playerState = 4.5) {
      frameDelta &&
        radioQueue.push({
          text: frameDelta,
          secs: playerState,
        });
    },
    clearRadio() {
      ((radioQueue.length = 0), (radioLine = null), comms.classList.remove('on'));
    },
    warn(frameDelta, playerState = 3) {
      ((warnEl.textContent = frameDelta),
        (warnT = playerState),
        warnEl.classList.remove('on'),
        warnEl.offsetWidth,
        warnEl.classList.add('on'));
    },
    message(frameDelta, playerState = 3) {
      ((msgEl.textContent = frameDelta || ''),
        (messageT = frameDelta ? playerState : 0),
        msgEl.classList.toggle('on', !!frameDelta));
    },
    feed(frameDelta) {
      let playerState = createEl('div', 'h-fl', frameDelta);
      feedEl.appendChild(playerState);
      let weaponState = {
        el: playerState,
        life: 4.2,
        weak: !1,
      };
      for (feedItems.push(weaponState); feedItems.length > 4;) feedItems.shift().el.remove();
      return weaponState;
    },
    hitmarker(frameDelta = 'hit') {
      hitEl.className = 'h-hit ' + frameDelta;
      let playerState = frameDelta === 'weak' || frameDelta === 'kill' ? 1.5 : 1.15;
      try {
        hitEl.animate(
          [
            {
              opacity: 1,
              transform: `translate(-50%,-50%) scale(${playerState})`,
            },
            {
              opacity: 1,
              transform: 'translate(-50%,-50%) scale(1)',
              offset: 0.35,
            },
            {
              opacity: 0,
              transform: 'translate(-50%,-50%) scale(0.92)',
            },
          ],
          {
            duration: frameDelta === 'kill' ? 420 : 240,
            easing: 'ease-out',
          },
        );
      } catch {}
    },
    reset() {
      ((radioQueue.length = 0), (radioLine = null), comms.classList.remove('on'));
      for (let frameDelta of feedItems) frameDelta.el.remove();
      feedItems.length = 0;
      for (let frameDelta of arcs) frameDelta.life = 0;
      ((warnT = 0),
        warnEl.classList.remove('on'),
        hud.message(''),
        hud.setPrompt(null),
        hud.setObjective(''),
        (cache.hp = -1));
    },
    update: updateHud,
  };
  function updateHud(k) {
    if ((updateRadio(k), !visible)) return;
    let ce = ctx.player,
      ve = ctx.weapon || {},
      _e = ctx.camera,
      Te = ce.ads || 0,
      Pe = ((-ce.yaw * 180) / Math.PI) % 360;
    Pe < 0 && (Pe += 360);
    let Re = Math.round((tapeWidth / 2 - (Pe - COMPASS_MIN_DEG) * COMPASS_PX_PER_DEG) * 2) / 2;
    Re !== cache.tapeX && ((cache.tapeX = Re), (tape.style.transform = `translate3d(${Re}px,0,0)`));
    let Fe = Math.round(Pe) % 360;
    Fe !== cache.head && ((cache.head = Fe), (heading.textContent = String(Fe).padStart(3, '0')));
    let ze = Te < 0.5;
    if (
      (ze !== cache.marksOn && ((cache.marksOn = ze), marksEl.classList.toggle('off', !ze)),
      markers.length)
    ) {
      (_e.updateMatrixWorld(), _e.matrixWorldInverse.copy(_e.matrixWorld).invert());
      let we = tapeWidth / 2 - 14;
      for (let be of markers) {
        let Oe = be.pos.x - ce.pos.x,
          pt = be.pos.z - ce.pos.z,
          ut = Math.round(Math.hypot(Oe, pt));
        if (ut !== be.lastD) {
          be.lastD = ut;
          let Un = ut + 'm';
          ((be.cDist.textContent = Un), (be.wDist.textContent = Un));
        }
        let nn = (Math.atan2(Oe, -pt) * 180) / Math.PI - Pe;
        nn = ((nn + 540) % 360) - 180;
        let bt = Math.round(Math.max(-we, Math.min(we, nn * COMPASS_PX_PER_DEG)));
        (bt !== be.lastC &&
          ((be.lastC = bt),
          (be.cEl.style.transform = `translate3d(${bt}px,0,0)`),
          be.cEl.classList.toggle('edge', Math.abs(bt) >= we)),
          projected
            .set(be.pos.x, be.pos.y + (be.kind === 'extract' ? 1.2 : 1.9), be.pos.z)
            .project(_e));
        let Os,
          pn,
          Ti = !1;
        if (
          (projected.z > 1 &&
            ((Ti = !0), (projected.x = -projected.x), (projected.y = -projected.y)),
          Ti || Math.abs(projected.x) > 0.9 || Math.abs(projected.y) > 0.82)
        ) {
          Ti = !0;
          let Un = Math.max(Math.abs(projected.x) / 0.9, Math.abs(projected.y) / 0.82, 0.001);
          if (((projected.x /= Un), (projected.y /= Un), projected.z > 1)) {
            let zo = Math.max(Math.abs(projected.x) / 0.9, Math.abs(projected.y) / 0.82);
            zo < 0.999 && ((projected.x /= zo), (projected.y /= zo));
          }
        }
        ((Os = Math.round((projected.x * 0.5 + 0.5) * viewW)),
          (pn = Math.round((-projected.y * 0.5 + 0.5) * viewH)));
        let ho = !Ti && Math.hypot(projected.x, projected.y * 0.6) < 0.16,
          Rs = Os + ',' + pn + (Ti ? 'o' : '') + (ut < 3 ? 'n' : '') + (ho ? 'd' : '');
        Rs !== be.lastW &&
          ((be.lastW = Rs),
          (be.wEl.style.transform = `translate3d(${Os}px,${pn}px,0)`),
          be.wEl.classList.toggle('offscreen', Ti),
          be.wEl.classList.toggle('near', ut < 3),
          be.wEl.classList.toggle('dim', ho));
      }
    }
    let We = Te <= 0.6 && ce.alive && ve.state !== 'reloading_hidden';
    if (
      (We !== cache.crossOn && ((cache.crossOn = We), crosshair.classList.toggle('off', !We)), We)
    ) {
      let we = typeof ve.spread == 'number' ? ve.spread : 0.012,
        be = (_e.fov * Math.PI) / 360,
        Oe = (Math.tan(we) / Math.tan(be)) * (viewH / 2) + 4 + (ce.sprinting ? 10 : 0);
      ((Oe = Math.round(Math.max(4, Math.min(70, Oe)) * 2) / 2),
        Oe !== cache.gap &&
          ((cache.gap = Oe),
          (crossParts[0].style.transform = `translate3d(-50%,${-Oe}px,0) translateY(-100%)`),
          (crossParts[1].style.transform = `translate3d(-50%,${Oe}px,0)`),
          (crossParts[2].style.transform = `translate3d(${-Oe}px,-50%,0) translateX(-100%)`),
          (crossParts[3].style.transform = `translate3d(${Oe}px,-50%,0)`)));
    }
    let Ne = Math.max(1, Math.min(60, ve.magSize | 0 || 30)),
      dt = Math.max(0, ve.ammo | 0),
      xe = Math.max(0, ve.reserve | 0);
    if (
      (Ne !== cache.mag &&
        ((cache.mag = Ne),
        (pips.innerHTML = '<i></i>'.repeat(Ne)),
        (pipEls = [...pips.children]),
        (cache.ammo = -1)),
      dt !== cache.ammo)
    ) {
      ((cache.ammo = dt), (ammoNum.textContent = String(dt).padStart(2, '0')));
      for (let we = 0; we < pipEls.length; we++) pipEls[we].className = we < dt ? '' : 'off';
    }
    (xe !== cache.reserve &&
      ((cache.reserve = xe), (reserveNum.textContent = String(xe).padStart(3, '0'))),
      ve.name !== cache.name && ((cache.name = ve.name), (weaponName.textContent = ve.name || '')));
    let Ie = dt <= Math.ceil(Ne * 0.27),
      Be =
        ve.state === 'reloading'
          ? 'Reloading'
          : dt === 0
            ? xe > 0
              ? ctx.input.touch
                ? 'Reload'
                : 'R \u2014 Reload'
              : 'Empty'
            : Ie
              ? 'Low ammo'
              : '';
    (Be !== cache.cue &&
      ((cache.cue = Be),
      (cueEl.textContent = Be),
      (cueEl.className =
        'h-cue' + (Be ? ' on' : '') + (dt === 0 && ve.state !== 'reloading' ? ' urgent' : ''))),
      Ie !== cache.low && ((cache.low = Ie), ammoEl.classList.toggle('low', Ie)));
    let Xe = Math.max(0, Math.ceil(ce.health)),
      Me = ce.health < ce.maxHealth - 0.5;
    if (Xe !== cache.hp) {
      ((cache.hp = Xe), (hpNum.textContent = String(Xe)));
      let we = Math.ceil((Xe / ce.maxHealth) * hpSegments.length);
      if (we !== cache.hpSeg) {
        cache.hpSeg = we;
        for (let be = 0; be < hpSegments.length; be++)
          hpSegments[be].className = be < we ? '' : 'off';
        healthEl.classList.toggle('crit', we <= 3);
      }
    }
    Me !== cache.hurt && ((cache.hurt = Me), healthEl.classList.toggle('on', Me));
    for (let we of arcs) {
      if (we.life <= 0) {
        we.op !== 0 && ((we.op = 0), (we.el.style.opacity = '0'));
        continue;
      }
      we.life -= k;
      let be = Math.atan2(we.src.x - ce.pos.x, -(we.src.z - ce.pos.z)) + ce.yaw,
        Oe = Math.round((be * 180) / Math.PI);
      Oe !== we.rot &&
        ((we.rot = Oe), (we.el.style.transform = `translate(-50%,-50%) rotate(${Oe}deg)`));
      let pt = Math.round(Math.min(1, Math.max(0, we.life / 0.6)) * 20) / 20;
      pt !== we.op && ((we.op = pt), (we.el.style.opacity = String(pt)));
    }
    if (objectiveChars < objectiveText.length) {
      objectiveProgress += k * 46;
      let we = Math.min(objectiveText.length, Math.floor(objectiveProgress));
      we !== objectiveChars &&
        ((objectiveChars = we), (objText.textContent = objectiveText.slice(0, we)));
    }
    (warnT > 0 && ((warnT -= k), warnT <= 0 && warnEl.classList.remove('on')),
      messageT > 0 && ((messageT -= k), messageT <= 0 && msgEl.classList.remove('on')));
    for (let we = feedItems.length - 1; we >= 0; we--) {
      let be = feedItems[we];
      ((be.life -= k),
        be.life <= 0
          ? (be.el.remove(), feedItems.splice(we, 1))
          : be.life < 0.6 && !be.out && ((be.out = !0), be.el.classList.add('out')));
    }
  }
  function updateRadio(k) {
    if (!radioLine) {
      if (!radioQueue.length) return;
      ((radioLine = radioQueue.shift()),
        (radioChars = 0),
        (radioProgress = 0),
        (radioHold = radioLine.secs),
        (commsText.textContent = ''),
        comms.classList.add('on'),
        ctx.events.emit('radio:line', {
          text: radioLine.text,
        }));
    }
    let ce = radioLine.text;
    if (radioChars < ce.length) {
      radioProgress += k * 58;
      let ve = Math.min(ce.length, Math.floor(radioProgress));
      ve !== radioChars && ((radioChars = ve), (commsText.textContent = ce.slice(0, ve)));
    } else
      ((radioHold -= k),
        radioHold <= 0 && ((radioLine = null), radioQueue.length || comms.classList.remove('on')));
  }
  return (relayout(), hud);
}
