import { adb } from './device.mjs';
import { qlog } from './log.mjs';

export function applyMatrixState(state) {
  qlog(`[MATRIX] Durum uygulanıyor: ${state}`);
  switch (state) {
    case 'dark':
      adb('shell', 'cmd', 'uimode', 'night', 'yes');
      return () => {
        qlog('[MATRIX] Durum geri alınıyor: dark -> light');
        adb('shell', 'cmd', 'uimode', 'night', 'no');
      };
    case 'large-font':
      adb('shell', 'settings', 'put', 'system', 'font_scale', '1.3');
      return () => {
        qlog('[MATRIX] Durum geri alınıyor: large-font -> 1.0');
        adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0');
      };
    case 'landscape':
      adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
      adb('shell', 'settings', 'put', 'system', 'user_rotation', '1');
      return () => {
        qlog('[MATRIX] Durum geri alınıyor: landscape -> portrait');
        adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
        adb('shell', 'settings', 'put', 'system', 'user_rotation', '0');
      };
    case 'offline':
      adb('shell', 'svc', 'wifi', 'disable');
      adb('shell', 'svc', 'data', 'disable');
      return () => {
        qlog('[MATRIX] Durum geri alınıyor: offline -> online');
        adb('shell', 'svc', 'wifi', 'enable');
        adb('shell', 'svc', 'data', 'enable');
      };
    default:
      return () => {};
  }
}