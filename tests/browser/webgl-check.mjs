// Preflight: fails fast (and says why) when a browser cannot create the WebGL2 context the game
// needs, instead of letting every test time out on a blank page.
//   node webgl-check.mjs chromium|firefox|webkit [--headed]
import { chromium, firefox, webkit } from '@playwright/test';
import { chromiumArgs, firefoxUserPrefs } from './launch-options.mjs';

const name = process.argv[2] ?? 'chromium';
const headless = !process.argv.includes('--headed');
const type = { chromium, firefox, webkit }[name];
if (!type) throw new Error(`unknown browser ${name}`);
const browser = await type.launch({
  headless,
  ...(name === 'chromium' ? { args: chromiumArgs, executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  ...(name === 'firefox' ? { firefoxUserPrefs } : {}),
});
const page = await browser.newPage();
const info = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return null;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
    version: String(gl.getParameter(gl.VERSION)),
  };
});
await browser.close();
if (!info) {
  console.error(`${name} (${headless ? 'headless' : 'headed'}): no WebGL2 context`);
  process.exit(1);
}
console.log(`${name} (${headless ? 'headless' : 'headed'}): WebGL2 OK — ${info.renderer} / ${info.version}`);
