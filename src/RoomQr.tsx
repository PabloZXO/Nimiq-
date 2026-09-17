import { useMemo } from 'react';
import qrcode from 'qrcode-generator';
import { messages } from './i18n';
import type { Language } from './types';

export function RoomQr({ code, lang }: { code: string; lang: Language }) {
  const t = messages[lang];
  const qr = useMemo(() => {
    try {
      const link = new URL('/', location.origin);
      link.searchParams.set('room', code);
      const matrix = qrcode(0, 'M');
      matrix.addData(link.toString(), 'Byte');
      matrix.make();
      const size = matrix.getModuleCount();
      const cells: string[] = [];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (matrix.isDark(y, x)) cells.push(`M${x + 4},${y + 4}h1v1h-1z`);
      }
      return { size: size + 8, path: cells.join('') };
    } catch { return null; }
  }, [code]);
  return qr ? <figure className="room-qr"><svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={t.roomQr} shapeRendering="crispEdges"><rect width={qr.size} height={qr.size} fill="#fff" /><path d={qr.path} fill="#000" /></svg><figcaption>{t.roomQrNote}</figcaption></figure> : <p className="muted small">{t.roomQrUnavailable}</p>;
}
