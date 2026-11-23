import { useState } from 'react';
import type { AppInfo } from '../../data/types';
import s from './AppIcon.module.css';

/** App icon image, falling back to a colored letter mark when there is no URL or it fails to load. */
export function AppIcon({ app, size = 34 }: { app: AppInfo; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.28) };
  if (app.iconUrl && !failed) {
    return <img className={s.img} src={app.iconUrl} alt="" width={size} height={size} style={style} loading="lazy" onError={() => setFailed(true)} />;
  }
  return (
    <span className={s.mark} style={{ ...style, background: app.iconColor, fontSize: Math.round(size * 0.42) }} aria-hidden>
      {app.name[0]}
    </span>
  );
}
