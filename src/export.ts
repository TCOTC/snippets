// TODO跟进: https://github.com/siyuan-note/siyuan/issues/15484 实现之后移除该模块，桌面端导出用 window.open(uri) 即可

export const isInAndroid = () => {
  return window.siyuan.config.system.container === "android" && window.JSAndroid;
};

export const isInIOS = () => {
  return window.siyuan.config.system.container === "ios" && window.webkit?.messageHandlers;
};

export const isInHarmony = () => {
  return window.siyuan.config.system.container === "harmony" && window.JSHarmony;
};

export const openByMobile = (uri: string) => {
  if (!uri) {
      return;
  }
  if (isInIOS()) {
      if (uri.startsWith("assets/")) {
          // iOS 16.7 之前的版本，uri 需要 encodeURIComponent
          window.webkit.messageHandlers.openLink.postMessage(location.origin + "/assets/" + encodeURIComponent(uri.replace("assets/", "")));
      } else if (uri.startsWith("/")) {
          // 导出 zip 返回的是已经 encode 过的，因此不能再 encode
          window.webkit.messageHandlers.openLink.postMessage(location.origin + uri);
      } else {
          try {
              new URL(uri);
              window.webkit.messageHandlers.openLink.postMessage(uri);
          } catch (e) {
              window.webkit.messageHandlers.openLink.postMessage("https://" + uri);
          }
      }
  } else if (isInAndroid()) {
      window.JSAndroid.openExternal(uri);
  } else if (isInHarmony()) {
      window.JSHarmony.openExternal(uri);
  } else {
      window.open(uri);
  }
};

export const exportByMobile = (uri: string) => {
  if (!uri) {
      return;
  }
  if (isInIOS()) {
      openByMobile(uri);
  } else if (isInAndroid()) {
      window.JSAndroid.exportByDefault(uri);
  } else if (isInHarmony()) {
      window.JSHarmony.exportByDefault(uri);
  } else {
      window.open(uri);
  }
};