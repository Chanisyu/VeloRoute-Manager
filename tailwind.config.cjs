/**
 * 扫描 Angular 内联模板与入口 HTML，构建本地样式而不依赖运行时 CDN。
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./index.html', './src/**/*.{html,ts}'],
  theme: { extend: {} },
  plugins: []
};
