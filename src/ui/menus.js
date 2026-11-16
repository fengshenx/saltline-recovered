// ui/menus.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import { PLAYER_SPEC, QUALITY_PRESETS } from '../core/config.js';

/**
 * 设置持久化的 localStorage 键名，带版本后缀以便日后迁移
 */
var SETTINGS_STORAGE_KEY = 'saltline.settings.v1';

/**
 * 设置默认值（画质 auto、灵敏度 1、不反转 Y、音量 0.8、FOV 取配置常量），也是读档时的兜底与字段白名单来源
 */
var DEFAULT_SETTINGS = {
  quality: 'auto',
  sens: 1,
  invertY: !1,
  volume: 0.8,
  fov: PLAYER_SPEC.fov,
};

/**
 * 可选画质档位名（low/medium/high/ultra），既是校验白名单也是设置面板分段按钮的生成源
 */
var QUALITY_NAMES = ['low', 'medium', 'high', 'ultra'];

/**
 * 从 localStorage 读设置并逐字段校验限幅（灵敏度 0.2–3、音量 0–1、FOV 60–95），任何解析失败或越界都静默回退默认值
 */
function loadSettings() {
  let settings = {
    ...DEFAULT_SETTINGS,
  };
  try {
    let stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || 'null');
    stored &&
      typeof stored == 'object' &&
      ((stored.quality === 'auto' || QUALITY_NAMES.includes(stored.quality)) &&
        (settings.quality = stored.quality),
      Number.isFinite(stored.sens) && (settings.sens = Math.min(3, Math.max(0.2, stored.sens))),
      (settings.invertY = !!stored.invertY),
      Number.isFinite(stored.volume) && (settings.volume = Math.min(1, Math.max(0, stored.volume))),
      Number.isFinite(stored.fov) && (settings.fov = Math.min(95, Math.max(60, stored.fov))));
  } catch {}
  return settings;
}

/**
 * 把设置写回 localStorage，配额/隐私模式下的写入异常直接吞掉，不让设置失败拖垮游戏
 */
function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

/**
 * 键鼠操作说明的静态 HTML 片段（移动/开火/换弹/切断中继/蹲伏等），直接嵌进设置面板的 Controls 页
 */
var KEYBOARD_HELP_HTML = `
  <dl class="keys">
    <div><dt>Move</dt><dd><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></dd></div>
    <div><dt>Look</dt><dd>Mouse</dd></div>
    <div><dt>Fire</dt><dd>Left button</dd></div>
    <div><dt>Aim</dt><dd>Right button</dd></div>
    <div><dt>Reload</dt><dd><kbd>R</kbd></dd></div>
    <div><dt>Cut relay</dt><dd>Hold <kbd>E</kbd></dd></div>
    <div><dt>Jump</dt><dd><kbd>Space</kbd></dd></div>
    <div><dt>Sprint</dt><dd><kbd>Shift</kbd></dd></div>
    <div><dt>Crouch</dt><dd><kbd>C</kbd> or <kbd>Ctrl</kbd></dd></div>
    <div><dt>Melee</dt><dd><kbd>F</kbd></dd></div>
    <div><dt>Pause</dt><dd><kbd>Esc</kbd> or <kbd>P</kbd></dd></div>
  </dl>`;

/**
 * 触屏操作说明的静态 HTML 片段，列出手柄与拖拽视角约定
 */
var TOUCH_HELP_HTML = `
  <dl class="keys">
    <div><dt>Move</dt><dd>Left thumb, anywhere</dd></div>
    <div><dt>Look</dt><dd>Drag the right side</dd></div>
    <div><dt>Fire</dt><dd>Hold FIRE, drag to track</dd></div>
    <div><dt>Aim</dt><dd>AIM toggles</dd></div>
    <div><dt>Reload</dt><dd>RLD</dd></div>
    <div><dt>Jump</dt><dd>JUMP</dd></div>
    <div><dt>Cut relay</dt><dd>Hold USE at a relay</dd></div>
    <div><dt>Sprint</dt><dd>Push the stick fully forward</dd></div>
  </dl>`;

/**
 * 构建全部菜单层（标题/暂停/死亡/结算四个屏、设置与操作说明面板、地点卡），负责设置项双向同步、画质切换、全屏切换、键盘焦点圈闭与按钮动作分发，返回 menus 对象给主流程驱动
 */
export function createMenus(ctx, actions) {
  let uiRoot = document.getElementById('ui'),
    settings = loadSettings(),
    root = document.createElement('div');
  ((root.className = 'menu'),
    (root.dataset.screen = 'none'),
    (root.innerHTML = `
    <div class="m-veil"></div>
    <div class="m-bars"><i></i><i></i></div>

    <section class="m-screen m-title" data-s="title" aria-label="Saltline">
      <div class="m-title-main">
        <div class="m-eyebrow"><span class="m-tag">B4</span><span>Port Authority Breach Unit</span><span class="m-dim">Saltline Terminal \xB7 05:42</span></div>
        <h1 class="m-word">SALTLINE</h1>
        <p class="m-premise">The port\u2019s security net has gone feral. Cut its three uplinks. Reach the boat.</p>
        <div class="m-actions">
          <button class="btn primary" data-act="deploy">Deploy</button>
          <button class="btn" data-act="settings">Settings</button>
          <button class="btn m-only-narrow" data-act="controls">Controls</button>
          <a class="btn" href="./" download="saltline.html">Code</a>
        </div>
        <p class="m-note">Every surface, machine and sound is generated in your browser. Nothing is downloaded.</p>
      </div>
      <aside class="m-legend" aria-label="Controls at a glance">
        <div><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</span><span><kbd>Mouse</kbd> Look</span><span><kbd>LMB</kbd> Fire</span><span><kbd>RMB</kbd> Aim</span><span><kbd>R</kbd> Reload</span></div>
        <div><span><kbd>E</kbd> Cut relay</span><span><kbd>Space</kbd> Jump</span><span><kbd>Shift</kbd> Sprint</span><span><kbd>C</kbd> Crouch</span><span><kbd>Esc</kbd> Pause</span></div>
        <div class="lg-touch"><em>Touch</em><span>Left thumb moves</span><span>Right thumb looks</span><span>Fire \xB7 Aim \xB7 Reload \xB7 Jump on screen</span></div>
      </aside>
    </section>

    <section class="m-screen m-card" data-s="paused" aria-label="Paused">
      <div class="m-k">Operation on hold</div>
      <h2 class="m-h">Paused</h2>
      <p class="m-line" data-f="lookmode"></p>
      <div class="m-actions col">
        <button class="btn primary" data-act="resume">Resume</button>
        <button class="btn" data-act="settings">Settings</button>
        <button class="btn" data-act="controls">Controls</button>
        <button class="btn" data-act="restart">Restart mission</button>
      </div>
    </section>

    <section class="m-screen m-card m-dead" data-s="dead" aria-label="Signal lost">
      <div class="m-k">Breacher down</div>
      <h2 class="m-h">Signal lost</h2>
      <dl class="m-stats"><div><dt>Time survived</dt><dd data-f="dead-time">00:00</dd></div><div><dt>Relays cut</dt><dd data-f="dead-relays">0/3</dd></div></dl>
      <div class="m-actions col"><button class="btn primary" data-act="retry">Retry</button></div>
    </section>

    <section class="m-screen m-card m-debrief" data-s="complete" aria-label="Debrief">
      <div class="m-k">Berth 4 \xB7 Debrief</div>
      <h2 class="m-h">Saltline is dark</h2>
      <div class="m-rating"><span>Rating</span><b data-f="rating">Clean</b></div>
      <dl class="m-stats">
        <div><dt>Time</dt><dd data-f="time">00:00</dd></div>
        <div><dt>Accuracy</dt><dd data-f="acc">0%</dd></div>
        <div><dt>Machines destroyed</dt><dd data-f="kills">0</dd></div>
        <div><dt>Retries</dt><dd data-f="retries">0</dd></div>
      </dl>
      <div class="m-actions col"><button class="btn primary" data-act="redeploy">Redeploy</button></div>
    </section>

    <div class="panel" role="dialog" aria-modal="true" aria-label="Settings and controls" tabindex="-1" hidden>
      <header class="panel-h">
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" data-tab="settings" aria-selected="true">Settings</button>
          <button class="tab" role="tab" data-tab="controls" aria-selected="false">Controls</button>
        </div>
        <button class="btn small" data-act="close-panel">Close</button>
      </header>
      <div class="panel-b" data-pane="settings">
        <div class="row"><label id="l-q">Graphics quality</label>
          <div class="seg" role="group" aria-labelledby="l-q">${QUALITY_NAMES.map((uiInput) => `<button data-q="${uiInput}" aria-pressed="false">${uiInput}</button>`).join('')}</div></div>
        <div class="row"><label for="s-sens">Mouse sensitivity</label><div class="slider"><input id="s-sens" type="range" min="0.2" max="3" step="0.05"><output data-o="sens"></output></div></div>
        <div class="row"><label id="l-inv">Invert Y</label><button class="toggle" data-act="invert" aria-labelledby="l-inv" aria-pressed="false"><i></i><span>Off</span></button></div>
        <div class="row"><label for="s-vol">Master volume</label><div class="slider"><input id="s-vol" type="range" min="0" max="100" step="1"><output data-o="vol"></output></div></div>
        <div class="row"><label for="s-fov">Field of view</label><div class="slider"><input id="s-fov" type="range" min="60" max="95" step="1"><output data-o="fov"></output></div></div>
        <div class="row" data-row="fs"><label id="l-fs">Display</label><button class="btn small" data-act="fullscreen" aria-labelledby="l-fs fs-t"><span id="fs-t">Enter fullscreen</span></button></div>
        <p class="panel-note" data-f="qnote"></p>
      </div>
      <div class="panel-b" data-pane="controls" hidden>
        <h3>Keyboard \xB7 Mouse</h3>${KEYBOARD_HELP_HTML}
        <p class="panel-note">If the browser will not capture the mouse, hold a mouse button and drag to look (left also fires, right also aims). Arrow keys or <kbd>I</kbd><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd> turn, <kbd>Enter</kbd> fires.</p>
        <h3>Touch</h3>${TOUCH_HELP_HTML}
        <h3>Gamepad</h3>
        <p class="panel-note">Sticks move and look \xB7 RT fire \xB7 LT aim \xB7 A jump \xB7 B crouch \xB7 X reload \xB7 Y cut relay \xB7 L3 sprint \xB7 Start pause.</p>
      </div>
    </div>

    <div class="loc-card" aria-hidden="true"><i></i><b>Saltline Terminal \xB7 Berth 4 \xB7 05:42</b><span>Port Authority Breach Unit \u2014 one breacher, no backup</span></div>
  `),
    uiRoot.appendChild(root));
  let qs = (U) => root.querySelector(U),
    qsa = (U) => [...root.querySelectorAll(U)],
    panel = qs('.panel'),
    locationCard = qs('.loc-card'),
    field = (U) => root.querySelector(`[data-f="${U}"]`),
    sensInput = qs('#s-sens'),
    volumeInput = qs('#s-vol'),
    fovInput = qs('#s-fov'),
    screen = 'none',
    lastFocus = null;
  function applySettings(U) {
    if (
      ((!U || U === 'sens') && (ctx.input.sensitivity = settings.sens),
      (!U || U === 'invertY') && (ctx.input.invertY = settings.invertY),
      !U || U === 'volume')
    )
      try {
        ctx.audio && ctx.audio.setVolume && ctx.audio.setVolume(settings.volume);
      } catch (T) {
        console.error(T);
      }
    if (
      ((!U || U === 'fov') && ctx.player && ctx.player.setFov && ctx.player.setFov(settings.fov),
      U === 'quality' ||
        (!U &&
          settings.quality !== 'auto' &&
          !ctx.params.shot &&
          !ctx.params.q &&
          settings.quality !== (ctx.quality && ctx.quality.name)))
    ) {
      let T = QUALITY_PRESETS[settings.quality];
      if (T)
        try {
          ctx.render && ctx.render.setQuality
            ? ctx.render.setQuality({
                ...T,
              })
            : (ctx.quality = {
                ...T,
              });
        } catch (D) {
          console.error('[game] setQuality failed', D);
        }
    }
  }
  function syncUi() {
    let U = settings.quality === 'auto' ? ctx.quality && ctx.quality.name : settings.quality;
    for (let D of qsa('.seg button')) D.setAttribute('aria-pressed', String(D.dataset.q === U));
    ((sensInput.value = settings.sens),
      (volumeInput.value = Math.round(settings.volume * 100)),
      (fovInput.value = settings.fov),
      (qs('[data-o="sens"]').textContent = settings.sens.toFixed(2) + '\xD7'),
      (qs('[data-o="vol"]').textContent = Math.round(settings.volume * 100) + '%'),
      (qs('[data-o="fov"]').textContent = Math.round(settings.fov) + '\xB0'));
    let T = qs('[data-act="invert"]');
    (T.setAttribute('aria-pressed', String(settings.invertY)),
      (T.querySelector('span').textContent = settings.invertY ? 'On' : 'Off'),
      (field('qnote').textContent =
        settings.quality === 'auto'
          ? `Quality was picked for this device (${U || 'default'}). Lower it if the frame rate struggles.`
          : 'Quality changes apply at once; shadows and reflections may take a moment to rebuild.'));
  }
  (sensInput.addEventListener('input', () => {
    ((settings.sens = +sensInput.value), applySettings('sens'), syncUi(), saveSettings(settings));
  }),
    volumeInput.addEventListener('input', () => {
      ((settings.volume = +volumeInput.value / 100),
        applySettings('volume'),
        syncUi(),
        saveSettings(settings));
    }),
    fovInput.addEventListener('input', () => {
      ((settings.fov = +fovInput.value), applySettings('fov'), syncUi(), saveSettings(settings));
    }));
  let fsRow = qs('[data-row="fs"]'),
    fsLabel = qs('#fs-t'),
    fullscreenEl = () => document.fullscreenElement || document.webkitFullscreenElement || null,
    fsTarget = document.getElementById('app') || document.documentElement;
  (fsTarget &&
    (fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen) &&
    document.fullscreenEnabled !== !1 &&
    document.webkitFullscreenEnabled !== !1) ||
    (fsRow.hidden = !0);
  function reportFsUnavailable() {
    fsLabel.textContent = 'Fullscreen is not available here';
  }
  function toggleFullscreen() {
    try {
      if (fullscreenEl()) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        return;
      }
      let U = (fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen).call(fsTarget);
      U && U.catch && U.catch(reportFsUnavailable);
    } catch {
      reportFsUnavailable();
    }
  }
  let onFullscreenChange = () => {
    fsLabel.textContent = fullscreenEl() ? 'Exit fullscreen' : 'Enter fullscreen';
  };
  (document.addEventListener('fullscreenchange', onFullscreenChange),
    document.addEventListener('webkitfullscreenchange', onFullscreenChange));
  function openPanel(U) {
    ((lastFocus = document.activeElement),
      (panel.hidden = !1),
      root.classList.add('panel-open'),
      selectTab(U || 'settings'));
    try {
      panel.focus({
        preventScroll: !0,
      });
    } catch {}
  }
  function closePanel() {
    return panel.hidden
      ? !1
      : ((panel.hidden = !0),
        root.classList.remove('panel-open'),
        lastFocus && lastFocus.focus && root.contains(lastFocus)
          ? lastFocus.focus()
          : focusPrimary(),
        !0);
  }
  function selectTab(U) {
    for (let T of qsa('.tab')) T.setAttribute('aria-selected', String(T.dataset.tab === U));
    for (let T of qsa('.panel-b')) T.hidden = T.dataset.pane !== U;
  }
  function focusPrimary() {
    let U = root.querySelector(`.m-screen[data-s="${screen}"] .btn.primary`);
    if (U)
      try {
        U.focus({
          preventScroll: !0,
        });
      } catch {}
  }
  (root.addEventListener('click', (uiInput) => {
    let elementRef = uiInput.target.closest('button');
    if (!elementRef || !root.contains(elementRef)) return;
    if ((ctx.events.emit('ui:click', {}), elementRef.dataset.q)) {
      ((settings.quality = elementRef.dataset.q),
        applySettings('quality'),
        syncUi(),
        saveSettings(settings));
      return;
    }
    if (elementRef.dataset.tab) {
      selectTab(elementRef.dataset.tab);
      return;
    }
    let actionKey = elementRef.dataset.act;
    actionKey === 'settings'
      ? openPanel('settings')
      : actionKey === 'controls'
        ? openPanel('controls')
        : actionKey === 'close-panel'
          ? closePanel()
          : actionKey === 'invert'
            ? ((settings.invertY = !settings.invertY),
              applySettings('invertY'),
              syncUi(),
              saveSettings(settings))
            : actionKey === 'fullscreen'
              ? toggleFullscreen()
              : actionKey && actions[actionKey] && actions[actionKey](uiInput);
  }),
    root.addEventListener('mouseover', (uiInput) => {
      let elementRef = uiInput.target.closest('button');
      elementRef &&
        uiInput.relatedTarget &&
        !elementRef.contains(uiInput.relatedTarget) &&
        ctx.events.emit('ui:hover', {});
    }),
    root.addEventListener('keydown', (uiInput) => {
      if (
        (uiInput.code === 'Escape' &&
          !panel.hidden &&
          (closePanel(), uiInput.stopPropagation(), uiInput.preventDefault()),
        uiInput.code === 'Tab' && !panel.hidden)
      ) {
        let elementRef = [...panel.querySelectorAll('button, input')].filter(
          (focusableNode) => focusableNode.offsetParent !== null,
        );
        if (!elementRef.length) return;
        let actionKey = elementRef[0],
          lastTabStop = elementRef[elementRef.length - 1];
        uiInput.shiftKey && document.activeElement === actionKey
          ? (lastTabStop.focus(), uiInput.preventDefault())
          : !uiInput.shiftKey &&
            document.activeElement === lastTabStop &&
            (actionKey.focus(), uiInput.preventDefault());
      }
    }));
  let fmtTime = (U) => (
      (U = Math.max(0, Math.floor(U))),
      String(Math.floor(U / 60)).padStart(2, '0') + ':' + String(U % 60).padStart(2, '0')
    ),
    menus = {
      root: root,
      settings: settings,
      fmtTime: fmtTime,
      get screen() {
        return screen;
      },
      get panelOpen() {
        return !panel.hidden;
      },
      closePanel: closePanel,
      show(uiInput) {
        uiInput !== screen &&
          ((screen = uiInput),
          (root.dataset.screen = uiInput),
          closePanel(),
          root.classList.toggle('open', uiInput !== 'none'),
          uiInput !== 'none'
            ? (syncUi(), setTimeout(focusPrimary, 30))
            : document.activeElement &&
              root.contains(document.activeElement) &&
              document.activeElement.blur());
      },
      locationCard(uiInput) {
        locationCard.classList.toggle('on', !!uiInput);
      },
      setLookMode(uiInput) {
        field('lookmode').textContent = uiInput || '';
      },
      setDead({ time: uiInput, relays: elementRef, total: actionKey }) {
        ((field('dead-time').textContent = fmtTime(uiInput)),
          (field('dead-relays').textContent = `${elementRef}/${actionKey}`));
      },
      setDebrief({
        time: uiInput,
        accuracy: elementRef,
        kills: actionKey,
        retries: lastTabStop,
        rating: focusableNode,
      }) {
        ((field('time').textContent = fmtTime(uiInput)),
          (field('acc').textContent =
            elementRef == null ? '\u2014' : Math.round(elementRef * 100) + '%'),
          (field('kills').textContent = String(actionKey)),
          (field('retries').textContent = String(lastTabStop)),
          (field('rating').textContent = focusableNode));
      },
      applySettings: applySettings,
    };
  return (syncUi(), menus);
}
