// core/events.js — 反混淆还原自 saltline.original.html（esbuild 产物），命名与注释为还原产物。

/**
 * 基于 Map 的事件总线：on 返回退订闭包，emit 对每个 handler 单独 try/catch 以免一个订阅者抛错断掉武器/敌人等整条广播链
 */
export function createEventBus() {
  let handlersByEvent = new Map();
  return {
    on(eventName, handler) {
      return (
        handlersByEvent.has(eventName) || handlersByEvent.set(eventName, []),
        handlersByEvent.get(eventName).push(handler),
        () => this.off(eventName, handler)
      );
    },
    off(eventName, handler) {
      let handlerList = handlersByEvent.get(eventName);
      if (handlerList) {
        let handlerIdx = handlerList.indexOf(handler);
        handlerIdx >= 0 && handlerList.splice(handlerIdx, 1);
      }
    },
    emit(eventName, handler) {
      let handlerList = handlersByEvent.get(eventName);
      if (handlerList)
        for (let handlerIdx = 0; handlerIdx < handlerList.length; handlerIdx++)
          try {
            handlerList[handlerIdx](handler);
          } catch (err) {
            console.error(`[events] handler for "${eventName}" threw`, err);
          }
    },
  };
}
