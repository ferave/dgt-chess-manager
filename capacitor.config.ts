import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dgtchessmanager.android',
  appName: 'DGT Chess Manager',
  webDir: 'dist',
  android: { allowMixedContent: false },
};

export default config;
