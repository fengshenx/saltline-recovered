// core/events.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

/**
 * 基于 Map 的事件总线：on 返回退订闭包，emit 对每个 handler 单独 try/catch 以免一个订阅者抛错断掉武器/敌人等整条广播链
 */
export function createEventBus() {
  let handlersByEvent = new Map();
  return {
    on(e, t) {
      return (
        handlersByEvent.has(e) || handlersByEvent.set(e, []),
        handlersByEvent.get(e).push(t),
        () => this.off(e, t)
      );
    },
    off(e, t) {
      let n = handlersByEvent.get(e);
      if (n) {
        let s = n.indexOf(t);
        s >= 0 && n.splice(s, 1);
      }
    },
    emit(e, t) {
      let n = handlersByEvent.get(e);
      if (n)
        for (let s = 0; s < n.length; s++)
          try {
            n[s](t);
          } catch (o) {
            console.error(`[events] handler for "${e}" threw`, o);
          }
    },
  };
}
