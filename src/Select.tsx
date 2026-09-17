import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Option = { value: string; label: string; disabled?: boolean };
export function Select({ label, value, options, onChange, compact = false }: {
  label: string; value: string; options: Option[]; onChange: (value: string) => void; compact?: boolean;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  function close(focus = false) { setOpen(false); if (focus) trigger.current?.focus(); }
  function show() { setActive(Math.max(0, options.findIndex(o => o.value === value && !o.disabled))); setOpen(true); }
  function choose(index: number) { if (!options[index]?.disabled) { onChange(options[index].value); close(true); } }
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    function place() {
      const rect = trigger.current!.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) { setOpen(false); return; }
      const below = innerHeight - rect.bottom - 16, above = rect.top - 16;
      const height = Math.min(options.length * 46 + 12, 280, Math.max(below, above));
      const width = Math.min(Math.max(rect.width, 180), innerWidth - 24);
      setPosition({ left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)),
        top: below >= height ? rect.bottom + 6 : Math.max(12, rect.top - height - 6), width, maxHeight: height });
    }
    place();
    list.current?.focus({ preventScroll: true });
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!trigger.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('pointerdown', outside); };
  }, [open]);
  useEffect(() => {
    const menu = list.current, option = document.getElementById(`${id}-${active}`);
    if (!open || !menu || !option) return;
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
  }, [active, open, id]);
  function step(direction: number) {
    for (let i = 1; i <= options.length; i++) {
      const index = (active + i * direction + options.length) % options.length;
      if (!options[index].disabled) { setActive(index); break; }
    }
  }
  return <div className={`field select-field ${compact ? 'compact' : ''}`}>
    <span id={`${id}-label`}>{label}</span>
    <button ref={trigger} type="button" className="select-trigger" aria-labelledby={`${id}-label ${id}-value`}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
      onClick={() => open ? close() : show()} onKeyDown={e => { if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); show(); } }}>
      <span id={`${id}-value`}>{options.find(o => o.value === value)?.label}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && createPortal(<div ref={list} id={`${id}-list`} className="select-menu" style={position} role="listbox" tabIndex={-1}
      aria-labelledby={`${id}-label`} aria-activedescendant={`${id}-${active}`} onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); close(true); }
        else if (e.key === 'Tab') close(true);
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); step(e.key === 'ArrowDown' ? 1 : -1); }
        else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); const enabled = options.map((o, i) => o.disabled ? -1 : i).filter(i => i >= 0); setActive(e.key === 'Home' ? enabled[0] : enabled.at(-1)!); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
        else if (e.key.length === 1) { const index = options.findIndex(o => !o.disabled && o.label.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase())); if (index >= 0) setActive(index); }
      }}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={option.value === value}
        aria-disabled={option.disabled || undefined} className={`select-option ${index === active ? 'highlighted' : ''}`}
        onPointerMove={() => !option.disabled && setActive(index)} onClick={() => choose(index)}>
        <span>{option.label}</span><span aria-hidden="true">{option.value === value ? '✓' : ''}</span>
      </div>)}
    </div>, document.body)}
  </div>;
}
