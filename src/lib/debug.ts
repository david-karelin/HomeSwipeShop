const hasAdminDebug =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("admin");

const isDebugDiscovery = import.meta.env.DEV || hasAdminDebug;
const isDebugRoomScan = import.meta.env.DEV || hasAdminDebug;

const logDiscoveryDebug = (...args: unknown[]) => {
  if (!isDebugDiscovery) return;
  console.log(...args);
};

const logDiscoveryStage = (...args: unknown[]) => {
  if (!isDebugDiscovery) return;
  console.log("[Discovery]", ...args);
};

const warnDiscoveryStage = (...args: unknown[]) => {
  if (!isDebugDiscovery) return;
  console.warn("[Discovery]", ...args);
};

const logRoomScanDebug = (...args: unknown[]) => {
  if (!isDebugRoomScan) return;
  console.log(...args);
};

export {
  hasAdminDebug,
  isDebugDiscovery,
  isDebugRoomScan,
  logDiscoveryDebug,
  logDiscoveryStage,
  warnDiscoveryStage,
  logRoomScanDebug,
};