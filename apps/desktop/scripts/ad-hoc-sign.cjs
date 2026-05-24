const { execSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adHocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  console.log(`[ad-hoc-sign] resigning ${appPath} with ad-hoc identity`);
  execSync(`/usr/bin/codesign --force --deep --sign - "${appPath}"`, {
    stdio: 'inherit',
  });
  execSync(`/usr/bin/codesign --verify --deep --strict "${appPath}"`, {
    stdio: 'inherit',
  });
};
