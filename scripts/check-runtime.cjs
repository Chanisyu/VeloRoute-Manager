/**
 * 检查实际执行脚本的 Node 版本，避免 npm run 在不兼容环境中继续构建。
 * npm 的 engines 主要约束依赖安装，因此开发与构建入口需要额外检查。
 * @returns {void} 版本不兼容时输出处理方式并以非零状态结束。
 */
function checkRuntime() {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  if (major !== 22 || minor < 22 || (minor === 22 && patch < 3)) {
    console.error('请使用 Node.js 22.22.3（见 .nvmrc）运行本项目。当前版本：' + process.version);
    process.exitCode = 1;
  }
}

checkRuntime();
