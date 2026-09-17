export function NavIcon({ name }: { name: 'home' | 'history' | 'profile' | 'wallet' }) {
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === 'home' ? <><path d="M8 7h8c2.1 0 3.4 1.7 3.9 3.8l1.2 5.4c.6 2.6-2 4-3.8 2.1L15 16H9l-2.3 2.3c-1.8 1.9-4.4.5-3.8-2.1l1.2-5.4C4.6 8.7 5.9 7 8 7Z" /><path d="M6.5 11.5h4m-2-2v4" /><circle cx="15.5" cy="10.5" r=".8" fill="currentColor" stroke="none" /><circle cx="18" cy="13" r=".8" fill="currentColor" stroke="none" /></>
      : name === 'history' ? <><path d="M3 5v5h5M3.4 10a9 9 0 1 1 .6 6" /><path d="M12 7v5l3 2" /></>
      : name === 'profile' ? <><path d="M4 4v16h16M8 16v-4m5 4V9m5 7V5" /><path d="m7 8 5-4 4 1 4-3" /></>
      : <><path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v10H6a3 3 0 0 1-3-3V7" /><path d="M20 13h-5v4h5" /><path d="M6 7h11" /></>}
  </svg>;
}
