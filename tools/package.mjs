// Builds the Windows desktop app into dist/ToshkentGTA-win32-x64/ToshkentGTA.exe
//   node tools/package.mjs
import { packager } from '@electron/packager';

const paths = await packager({
  dir: '.',
  name: 'ToshkentGTA',
  executableName: 'ToshkentGTA',
  platform: 'win32',
  arch: 'x64',
  out: 'dist',
  overwrite: true,
  asar: false,
  prune: false,
  icon: 'assets/icon.ico',
  appVersion: '1.0.0',
  appCopyright: 'Fan-made game. Map data (c) OpenStreetMap contributors (ODbL).',
  win32metadata: {
    CompanyName: 'Toshkent fan project',
    FileDescription: 'Grand Theft Avto: Toshkent',
    ProductName: 'Grand Theft Avto: Toshkent',
    InternalName: 'ToshkentGTA',
  },
  ignore: [/^\/node_modules($|\/)/, /^\/tools($|\/)/, /^\/dist($|\/)/, /^\/docs($|\/)/, /^\/\.claude($|\/)/, /^\/\.git($|\/)/, /^\/package-lock\.json$/, /\.bat$/],
});
console.log('Packaged to', paths.join(', '));
