import { defineConfig, devices } from '@playwright/test';

// Browser tests drive the real production build (apps/web/dist) served by the real Java server.
//   npm test                         -> all projects available on this machine
//   npx playwright test --project=chromium-mobile
// Set BASE_URL to test an already running/deployed server instead of starting one.
// Set PW_CHROMIUM_PATH to reuse a preinstalled Chromium (CI/dev containers).

const PORT = Number(process.env.TEST_PORT ?? 8099);
const BASE_URL = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;
const chromiumPath = process.env.PW_CHROMIUM_PATH;
const gl = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];

export default defineConfig({
  testDir: './specs',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: '../../server/app/build/install/anyroyale-server/bin/anyroyale-server',
        url: `${BASE_URL}/healthz`,
        timeout: 90_000,
        reuseExistingServer: false,
        env: {
          PORT: String(PORT),
          HOST: '127.0.0.1',
          STATIC_DIR: '../../apps/web/dist',
          SESSION_SECRET: 'browser-test-secret',
          RECONNECT_GRACE_SECONDS: '20',
        },
      },
  projects: [
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 7'],
        launchOptions: { executablePath: chromiumPath, args: gl },
      },
    },
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath: chromiumPath, args: gl },
      },
    },
    {
      name: 'webkit-iphone',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'webkit-desktop',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'firefox-desktop',
      use: {
        ...devices['Desktop Firefox'],
        // Headless Firefox on GPU-less CI machines blocks WebGL; force software WebGL.
        launchOptions: {
          firefoxUserPrefs: {
            'webgl.force-enabled': true,
            'webgl.disabled': false,
            'webgl.enable-webgl2': true,
            'gfx.webrender.software': true,
            'media.autoplay.default': 0,
            'media.autoplay.blocking_policy': 0,
          },
        },
      },
    },
  ],
});
