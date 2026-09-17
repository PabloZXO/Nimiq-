import type { Visual } from './types';
export function Flag({ visual, label }: { visual: Visual; label: string }) {
  if (visual.type === 'image' && /^\/flags\/[a-f0-9]{20}\.svg$/.test(visual.src ?? '')) {
    return <img className="flag flag-image" src={visual.src} alt={label} draggable={false} />;
  }
  // Rooms persisted before the full flag catalogue still use geometric visuals.
  const { type, colors = [], weights = [] } = visual;
  const width = type === 'swiss' ? 120 : 180;
  const bands = weights.length ? weights : colors.map(() => 1);
  const total = bands.reduce((a, b) => a + b, 0);
  let position = 0;
  return <svg className="flag" viewBox={`0 0 ${width} 120`} role="img" aria-label={label}>
    <rect width={width} height="120" fill={colors[0]} />
    {(type === 'h' || type === 'v') && colors.map((color, i) => {
      const size = bands[i] / total * (type === 'h' ? 120 : width);
      const start = position; position += size;
      return <rect key={i} x={type === 'v' ? start : 0} y={type === 'h' ? start : 0} width={type === 'v' ? size : width} height={type === 'h' ? size : 120} fill={color} />;
    })}
    {type === 'circle' && <circle cx={colors[0] === '#006a4e' ? 81 : 90} cy="60" r="36" fill={colors[1]} />}
    {type === 'cross' && <g fill={colors[1]}><rect x="52" width="20" height="120" /><rect y="50" width="180" height="20" /></g>}
    {type === 'swiss' && <path d="M48 24h24v24h24v24H72v24H48V72H24V48h24z" fill={colors[1]} />}
    {type === 'triangle' && <><rect y="60" width="180" height="60" fill={colors[1]} /><path d="M0 0L90 60L0 120Z" fill={colors[2]} /></>}
  </svg>;
}
