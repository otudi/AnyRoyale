// Browser launch settings shared by playwright.config.ts and webgl-check.mjs.
// CI machines and dev containers have no GPU, so every engine is pointed at software WebGL.

export const chromiumArgs = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
];

// Firefox has no software GL path in headless mode; CI runs it headed under Xvfb with Mesa
// (llvmpipe), and these prefs stop it from refusing WebGL on an unknown/blocklisted driver.
export const firefoxUserPrefs = {
  'webgl.force-enabled': true,
  'webgl.disabled': false,
  'webgl.enable-webgl2': true,
  'gfx.webrender.software': true,
  'media.autoplay.default': 0,
  'media.autoplay.blocking_policy': 0,
};
