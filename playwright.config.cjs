const { defineConfig } = require('@playwright/test');

/**
 * 在专用端口运行 Web 预览；Electron 测试加载生产构建，覆盖两种资源路径。
 * @type {import('@playwright/test').PlaywrightTestConfig}
 */
module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.cjs',
  workers: 1,
  timeout: 45000,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { channel: 'chromium', baseURL: 'http://127.0.0.1:4201', screenshot: 'only-on-failure' },
  webServer: {
    command: 'node node_modules/@angular/cli/bin/ng.js serve --host 127.0.0.1 --port 4201',
    url: 'http://127.0.0.1:4201',
    reuseExistingServer: false,
    timeout: 120000
  }
});
