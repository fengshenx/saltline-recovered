// platform/input.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import { noop } from '../core/fallbacks.js';

/**
 * 键盘 KeyCode 到动作名的映射表（27 项）：WASD/空格/Shift/Ctrl、R/E/F/V/Esc/P/Q/Enter 与方向键、IJKL，所有输入源最终都归一到同一套动作名
 */
var KEY_BINDINGS = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyC: 'crouch',
  ControlLeft: 'crouch',
  ControlRight: 'crouch',
  KeyR: 'reload',
  KeyE: 'interact',
  KeyF: 'melee',
  KeyV: 'melee',
  Escape: 'pause',
  KeyP: 'pause',
  KeyQ: 'alt',
  Enter: 'fire',
  NumpadEnter: 'fire',
  ArrowLeft: 'turnL',
  ArrowRight: 'turnR',
  ArrowUp: 'turnU',
  ArrowDown: 'turnD',
  KeyJ: 'turnL',
  KeyL: 'turnR',
  KeyI: 'turnU',
  KeyK: 'turnD',
};

/**
 * 鼠标每像素转弧度系数，乘用户灵敏度后累加进 look.dx/dy
 */
var MOUSE_LOOK_SENSITIVITY = 0.0021;

/**
 * 触屏拖动每像素转弧度系数，比鼠标更大，因为手指位移粗
 */
var TOUCH_LOOK_SENSITIVITY = 0.0052;

/**
 * 方向键/IJKL 的无鼠标转向角速度（弧度/秒），保证没有指针锁也能玩
 */
var ARROW_TURN_RATE = 2.1;

/**
 * 手柄右摇杆转视角的基础角速度，实际值乘摇杆位移的平方做细调
 */
var PAD_LOOK_RATE = 3;

/**
 * 虚拟摇杆的最大拖拽半径（像素），超出后位移被夹到圆周上，摇杆输出归一化到 -1..1
 */
var TOUCH_STICK_RADIUS = 58;

/**
 * 不需要 gameplay 状态就能响应的动作白名单（只有 pause），用于标题/暂停界面仍能收 Esc
 */
var UNGATED_ACTIONS = {
  pause: 1,
};

/**
 * 输入聚合器：把键鼠、Pointer Lock、拖拽回退模式、触屏摇杆与手柄统一成 move/look/fire/ads/sprint/crouch 状态，并对外暴露 down/pressed 边沿查询与模式切换回调
 */
export function createInput(ctx) {
  let viewEl = (ctx.renderer && ctx.renderer.domElement) || document.getElementById('view'),
    uiEl = document.getElementById('ui'),
    held = new Set(),
    pressedSet = new Set(),
    sources = {
      key: new Set(),
      mouse: new Set(),
      touch: new Set(),
      pad: new Set(),
    },
    gameplay = !1,
    everLocked = !1,
    lockRequestAt = 0,
    lockFailCount = 0,
    mouseButtons = 0,
    modeListeners = [],
    state = {
      move: {
        x: 0,
        y: 0,
      },
      look: {
        dx: 0,
        dy: 0,
      },
      fire: !1,
      ads: !1,
      sprint: !1,
      crouch: !1,
      locked: !1,
      touch: !1,
      gamepad: !1,
      sensitivity: 1,
      invertY: !1,
      mode: 'lock',
      down(P) {
        return held.has(P) && (gameplay || UNGATED_ACTIONS[P] === 1);
      },
      pressed(P) {
        return pressedSet.has(P) && (gameplay || UNGATED_ACTIONS[P] === 1);
      },
      update: update,
      endFrame: endFrame,
      requestLock: requestLock,
      exitLock: exitLock,
      setGameplay(P) {
        ((P = !!P),
          P !== gameplay &&
            ((gameplay = P),
            P || clearAll(),
            touchUI && touchUI.root.classList.toggle('on', P && state.touch)));
      },
      setPrompt(P) {
        touchUI && touchUI.btn.interact.classList.toggle('on', !!P);
      },
      onModeChange(P) {
        modeListeners.push(P);
      },
      describeMode() {
        return state.mode === 'touch'
          ? 'Touch controls active'
          : state.mode === 'drag'
            ? 'Mouse capture unavailable \u2014 move the mouse to look, rest it at a screen edge to keep turning \xB7 click fires \xB7 arrows or IJKL also turn'
            : state.locked
              ? 'Mouse captured \u2014 Esc releases it'
              : 'Click the view to capture the mouse';
      },
    };
  function setMode(P) {
    if (state.mode !== P) {
      state.mode = P;
      for (let V of modeListeners)
        try {
          V(P);
        } catch (Y) {
          console.error(Y);
        }
    }
  }
  function setSourceAction(P, V, Y) {
    if (!V) return;
    let L = sources[P];
    if (Y) {
      if (L.has(V)) return;
      (L.add(V), held.has(V) || (held.add(V), pressedSet.add(V)));
    } else {
      if (!L.delete(V)) return;
      !sources.key.has(V) &&
        !sources.mouse.has(V) &&
        !sources.touch.has(V) &&
        !sources.pad.has(V) &&
        held.delete(V);
    }
  }
  function clearAll() {
    for (let P in sources) sources[P].clear();
    (held.clear(),
      (mouseButtons = 0),
      (touchAds = !1),
      touchUI &&
        (touchUI.btn.ads.classList.remove('active'),
        resetStick(),
        (lookTouchId = -1),
        (fireTouchId = -1)));
  }
  (addEventListener('keydown', (P) => {
    let V = KEY_BINDINGS[P.code];
    if (!V) return;
    let Y = P.target;
    (Y && (Y.tagName === 'INPUT' || Y.tagName === 'SELECT' || Y.tagName === 'TEXTAREA')) ||
      (Y &&
        Y.tagName === 'BUTTON' &&
        (P.code === 'Space' || P.code === 'Enter' || P.code === 'NumpadEnter')) ||
      (gameplay &&
        (P.code === 'Space' || P.code.startsWith('Arrow') || P.code === 'ControlLeft') &&
        P.preventDefault(),
      !P.repeat && setSourceAction('key', V, !0));
  }),
    addEventListener('keyup', (P) => {
      setSourceAction('key', KEY_BINDINGS[P.code], !1);
    }),
    addEventListener('blur', () => {
      clearAll();
    }));
  let mouseAction = (P) => (P === 0 ? 'fire' : P === 2 ? 'ads' : P === 1 ? 'melee' : null);
  (viewEl.addEventListener('mousedown', (P) => {
    if (!(state.touch && performance.now() - lastTouchAt < 800) && gameplay) {
      if (!state.locked && state.mode === 'lock') {
        (requestLock(), P.preventDefault());
        return;
      }
      ((mouseButtons |= 1 << P.button),
        setSourceAction('mouse', mouseAction(P.button), !0),
        P.preventDefault());
    }
  }),
    addEventListener('mouseup', (P) => {
      ((mouseButtons &= ~(1 << P.button)), setSourceAction('mouse', mouseAction(P.button), !1));
    }),
    addEventListener('contextmenu', (P) => {
      (P.target === viewEl || gameplay) && P.preventDefault();
    }),
    addEventListener('mousemove', (P) => {
      if (
        gameplay &&
        (state.mode === 'drag' &&
          ((cursorX = P.clientX / Math.max(1, innerWidth)),
          (cursorY = P.clientY / Math.max(1, innerHeight)),
          (cursorInside = !0)),
        state.locked || state.mode === 'drag')
      ) {
        let V = P.movementX || 0,
          Y = P.movementY || 0;
        if (Math.abs(V) > 400 || Math.abs(Y) > 400) return;
        ((state.look.dx += V * MOUSE_LOOK_SENSITIVITY * state.sensitivity),
          (state.look.dy +=
            Y * MOUSE_LOOK_SENSITIVITY * state.sensitivity * (state.invertY ? -1 : 1)));
      }
    }),
    document.addEventListener('pointerlockchange', () => {
      if (((state.locked = document.pointerLockElement === viewEl), state.locked))
        ((everLocked = !0),
          (lockRequestAt = 0),
          (lockFailCount = 0),
          state.touch || setMode('lock'));
      else {
        (sources.mouse.clear(), held.delete('fire'), held.delete('ads'));
        for (let P of sources.key) held.add(P);
        mouseButtons = 0;
      }
      ctx.events.emit('input:lock', {
        locked: state.locked,
      });
    }),
    document.addEventListener('pointerlockerror', () => onLockFail()));
  let cursorX = 0.5,
    cursorY = 0.5,
    cursorInside = !1;
  document.addEventListener('mouseleave', () => {
    cursorInside = !1;
  });
  function onLockFail() {
    ((lockRequestAt = 0),
      !(state.locked || state.touch) && (lockFailCount++, everLocked || setMode('drag')));
  }
  function requestLock() {
    if (!(state.touch || state.locked)) {
      if (!viewEl.requestPointerLock) {
        onLockFail();
        return;
      }
      try {
        lockRequestAt = performance.now();
        let P = viewEl.requestPointerLock();
        P && P.catch && P.catch(() => onLockFail());
      } catch {
        onLockFail();
      }
      try {
        viewEl.focus({
          preventScroll: !0,
        });
      } catch {}
    }
  }
  function exitLock() {
    try {
      document.pointerLockElement && document.exitPointerLock();
    } catch {}
  }
  let touchUI = null,
    lastTouchAt = 0,
    stickId = -1,
    stickOriginX = 0,
    stickOriginY = 0,
    stickX = 0,
    stickY = 0,
    lookTouchId = -1,
    lookTouchX = 0,
    lookTouchY = 0,
    fireTouchId = -1,
    fireTouchX = 0,
    fireTouchY = 0,
    touchAds = !1;
  function buildTouchUI() {
    let P = document.createElement('div');
    ((P.className = 'touch'),
      (P.innerHTML =
        '<div class="t-stick"><i class="t-ring"></i><i class="t-nub"></i></div><button class="t-btn t-fire" data-a="fire" aria-label="Fire"><span>FIRE</span></button><button class="t-btn t-ads" data-a="ads" aria-label="Aim"><span>AIM</span></button><button class="t-btn t-reload" data-a="reload" aria-label="Reload"><span>RLD</span></button><button class="t-btn t-jump" data-a="jump" aria-label="Jump"><span>JUMP</span></button><button class="t-btn t-interact" data-a="interact" aria-label="Interact"><span>USE</span></button><button class="t-btn t-pause" data-a="pause" aria-label="Pause"><span>II</span></button>'),
      uiEl.appendChild(P));
    let V = (L) => P.querySelector(L),
      Y = {
        root: P,
        stick: V('.t-stick'),
        nub: V('.t-nub'),
        btn: {
          fire: V('.t-fire'),
          ads: V('.t-ads'),
          reload: V('.t-reload'),
          jump: V('.t-jump'),
          interact: V('.t-interact'),
          pause: V('.t-pause'),
        },
      };
    for (let L in Y.btn) {
      let Z = Y.btn[L];
      Z.addEventListener(
        'touchstart',
        (oe) => {
          (oe.preventDefault(), oe.stopPropagation(), (lastTouchAt = performance.now()));
          let fe = oe.changedTouches[0];
          if (L === 'ads') {
            ((touchAds = !touchAds), Z.classList.toggle('active', touchAds));
            return;
          }
          (L === 'fire' &&
            ((fireTouchId = fe.identifier), (fireTouchX = fe.clientX), (fireTouchY = fe.clientY)),
            Z.classList.add('active'),
            setSourceAction('touch', L, !0));
        },
        {
          passive: !1,
        },
      );
      let J = (oe) => {
        if ((oe.preventDefault(), oe.stopPropagation(), L !== 'ads')) {
          if (L === 'fire') {
            let fe = !1;
            for (let le of oe.changedTouches) le.identifier === fireTouchId && (fe = !0);
            if (!fe) return;
            fireTouchId = -1;
          }
          (Z.classList.remove('active'), setSourceAction('touch', L, !1));
        }
      };
      (Z.addEventListener('touchend', J, {
        passive: !1,
      }),
        Z.addEventListener('touchcancel', J, {
          passive: !1,
        }),
        Z.addEventListener(
          'touchmove',
          (oe) => {
            if ((oe.preventDefault(), L === 'fire'))
              for (let fe of oe.changedTouches)
                fe.identifier === fireTouchId &&
                  (applyTouchLook(fe.clientX - fireTouchX, fe.clientY - fireTouchY),
                  (fireTouchX = fe.clientX),
                  (fireTouchY = fe.clientY));
          },
          {
            passive: !1,
          },
        ),
        Z.addEventListener('contextmenu', (oe) => oe.preventDefault()));
    }
    return Y;
  }
  function applyTouchLook(P, V) {
    ((state.look.dx += P * TOUCH_LOOK_SENSITIVITY * state.sensitivity),
      (state.look.dy += V * TOUCH_LOOK_SENSITIVITY * state.sensitivity * (state.invertY ? -1 : 1)));
  }
  function enableTouch() {
    state.touch ||
      ((state.touch = !0),
      exitLock(),
      touchUI || (touchUI = buildTouchUI()),
      touchUI.root.classList.toggle('on', gameplay),
      document.documentElement.classList.add('is-touch'),
      setMode('touch'));
  }
  function resetStick() {
    ((stickId = -1), (stickX = stickY = 0), touchUI && touchUI.stick.classList.remove('on'));
  }
  (addEventListener(
    'touchstart',
    () => {
      ((lastTouchAt = performance.now()), enableTouch());
    },
    {
      passive: !0,
      capture: !0,
    },
  ),
    viewEl.addEventListener(
      'touchstart',
      (P) => {
        if ((P.preventDefault(), !!gameplay))
          for (let V of P.changedTouches)
            V.clientX < innerWidth * 0.45 && stickId < 0
              ? ((stickId = V.identifier),
                (stickOriginX = V.clientX),
                (stickOriginY = V.clientY),
                (stickX = stickY = 0),
                touchUI &&
                  ((touchUI.stick.style.transform = `translate3d(${stickOriginX}px,${stickOriginY}px,0)`),
                  (touchUI.nub.style.transform = 'translate3d(0,0,0)'),
                  touchUI.stick.classList.add('on')))
              : lookTouchId < 0 &&
                ((lookTouchId = V.identifier), (lookTouchX = V.clientX), (lookTouchY = V.clientY));
      },
      {
        passive: !1,
      },
    ),
    viewEl.addEventListener(
      'touchmove',
      (P) => {
        if ((P.preventDefault(), !!gameplay))
          for (let V of P.changedTouches)
            if (V.identifier === stickId) {
              let Y = V.clientX - stickOriginX,
                L = V.clientY - stickOriginY,
                Z = Math.hypot(Y, L);
              (Z > TOUCH_STICK_RADIUS &&
                ((Y *= TOUCH_STICK_RADIUS / Z), (L *= TOUCH_STICK_RADIUS / Z)),
                (stickX = Y / TOUCH_STICK_RADIUS),
                (stickY = -L / TOUCH_STICK_RADIUS),
                touchUI &&
                  (touchUI.nub.style.transform = `translate3d(${Y.toFixed(1)}px,${L.toFixed(1)}px,0)`));
            } else
              V.identifier === lookTouchId &&
                (applyTouchLook(V.clientX - lookTouchX, V.clientY - lookTouchY),
                (lookTouchX = V.clientX),
                (lookTouchY = V.clientY));
      },
      {
        passive: !1,
      },
    ));
  let onTouchEnd = (P) => {
    for (let V of P.changedTouches)
      V.identifier === stickId ? resetStick() : V.identifier === lookTouchId && (lookTouchId = -1);
  };
  (viewEl.addEventListener('touchend', onTouchEnd, {
    passive: !1,
  }),
    viewEl.addEventListener('touchcancel', onTouchEnd, {
      passive: !1,
    }));
  let gamepadActions = {
      0: 'jump',
      1: 'crouch',
      2: 'reload',
      3: 'interact',
      5: 'melee',
      6: 'ads',
      7: 'fire',
      9: 'pause',
      10: 'sprint',
      11: 'melee',
    },
    hasPads = typeof navigator < 'u' && !!navigator.getGamepads,
    padX = 0,
    padY = 0,
    deadzone = (P) => {
      let V = Math.abs(P);
      return V < 0.16 ? 0 : (Math.sign(P) * (V - 0.16)) / 0.84;
    };
  function pollGamepad(P) {
    if (((padX = padY = 0), !hasPads)) return;
    let V;
    try {
      V = navigator.getGamepads();
    } catch {
      hasPads = !1;
      return;
    }
    let Y = null;
    for (let J = 0; V && J < V.length; J++)
      if (V[J] && V[J].connected && V[J].mapping === 'standard') {
        Y = V[J];
        break;
      }
    if (!Y) {
      state.gamepad && ((state.gamepad = !1), sources.pad.clear());
      return;
    }
    ((state.gamepad = !0), (padX = deadzone(Y.axes[0] || 0)), (padY = -deadzone(Y.axes[1] || 0)));
    let L = deadzone(Y.axes[2] || 0),
      Z = deadzone(Y.axes[3] || 0);
    gameplay &&
      ((state.look.dx += L * Math.abs(L) * PAD_LOOK_RATE * P * state.sensitivity),
      (state.look.dy +=
        Z * Math.abs(Z) * PAD_LOOK_RATE * 0.7 * P * state.sensitivity * (state.invertY ? -1 : 1)));
    for (let J in gamepadActions) {
      let oe = Y.buttons[J];
      setSourceAction('pad', gamepadActions[J], !!oe && (oe.pressed || oe.value > 0.4));
    }
  }
  function update(P) {
    if (
      (pollGamepad(P),
      lockRequestAt && performance.now() - lockRequestAt > 1200 && !state.locked && onLockFail(),
      state.mode === 'drag' && gameplay && cursorInside && !state.locked)
    ) {
      let Z =
          cursorX < 0.12 ? -(0.12 - cursorX) / 0.12 : cursorX > 0.88 ? (cursorX - 0.88) / 0.12 : 0,
        J = cursorY < 0.1 ? -(0.1 - cursorY) / 0.1 : cursorY > 0.9 ? (cursorY - 0.9) / 0.1 : 0;
      ((state.look.dx += Z * 2.4 * P * state.sensitivity),
        (state.look.dy += J * 1.2 * P * state.sensitivity * (state.invertY ? -1 : 1)));
    }
    let V = 0,
      Y = 0,
      L = !1;
    if (gameplay) {
      ((V = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0)),
        (Y = (held.has('forward') ? 1 : 0) - (held.has('back') ? 1 : 0)),
        (L = held.has('sprint')),
        stickId >= 0 &&
          ((V += stickX),
          (Y += stickY),
          Math.hypot(stickX, stickY) > 0.93 && stickY > 0.8 && (L = !0)),
        (V += padX),
        (Y += padY));
      let Z = Math.hypot(V, Y);
      Z > 1 && ((V /= Z), (Y /= Z));
      let J = (held.has('turnR') ? 1 : 0) - (held.has('turnL') ? 1 : 0),
        oe = (held.has('turnD') ? 1 : 0) - (held.has('turnU') ? 1 : 0);
      (J && (state.look.dx += J * ARROW_TURN_RATE * P),
        oe && (state.look.dy += oe * ARROW_TURN_RATE * 0.6 * P));
    }
    ((state.move.x = V),
      (state.move.y = Y),
      (state.fire = gameplay && held.has('fire')),
      (state.ads = gameplay && (held.has('ads') || touchAds)),
      (state.sprint = gameplay && L),
      (state.crouch = gameplay && held.has('crouch')));
  }
  function endFrame() {
    (pressedSet.clear(), (state.look.dx = 0), (state.look.dy = 0));
  }
  return state;
}

/**
 * 空输入桩：展示模式下没有真实输入系统时顶替，保持字段形状一致，所有按键查询恒为 false
 */
export function createStubInput() {
  let noop = () => {};
  return {
    move: {
      x: 0,
      y: 0,
    },
    look: {
      dx: 0,
      dy: 0,
    },
    fire: !1,
    ads: !1,
    sprint: !1,
    crouch: !1,
    locked: !1,
    touch: !1,
    sensitivity: 1,
    down: () => !1,
    pressed: () => !1,
    update: noop,
    endFrame: noop,
    requestLock: noop,
    exitLock: noop,
  };
}
