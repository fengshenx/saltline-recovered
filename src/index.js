// index.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

import { showFatalError } from './app/diagnostics.js';

import { startGame } from './app/runtime.js';

import './init-order.js';

startGame().catch((i) => showFatalError((i && i.stack) || i));
