import { useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Command, FileText, Search, Shield, UserRound, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ people: [], vehicles: [], reports: [], bolos: [] });
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const keyHandler = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(value => !value); }
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', keyHandler);
    return () => document.removeEventListener('keydown', keyHandler);
  }, []);

  useEffect(() => { if (open) requestAnimationFrame(() => inputRef.current?.focus()); }, [open]);
  useEffect(() => {
    if (query.trim().length < 2) { setResults({ people: [], vehicles: [], reports: [], bolos: [] }); return; }
    setLoading(true);
    const timer = setTimeout(() => api(`/cad/global-search?q=${encodeURIComponent(query)}`)
      .then(setResults)
      .catch(() => setResults({ people: [], vehicles: [], reports: [], bolos: [] }))
      .finally(() => setLoading(false)), 220);
    return () => clearTimeout(timer);
  }, [query]);

  const total = useMemo(() => Object.values(results).reduce((sum, values) => sum + values.length, 0), [results]);
  const go = path => { setOpen(false); setQuery(''); navigate(path); };

  return <>
    <button className="command-trigger" onClick={() => setOpen(true)}><Search/><span>Search CAD intelligence</span><kbd>Ctrl K</kbd></button>
    {open && <div className="command-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}><section className="command-palette"><header><Search/><input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search people, plates, reports, or BOLO intelligence…"/><button onClick={() => setOpen(false)}><X/></button></header>
      {query.length < 2 ? <div className="command-empty"><Command/><strong>Shadow Intelligence Search</strong><span>Type at least two characters to search every connected records system.</span><div className="quick-command-grid"><button onClick={() => go('/')}><Shield/> Incident command</button><button onClick={() => go('/lookup')}><UserRound/> Records lookup</button><button onClick={() => go('/reports')}><FileText/> File report</button><button onClick={() => go('/map')}><BellRing/> Live operations map</button></div></div> : loading ? <div className="command-loading">Searching encrypted records…</div> : total === 0 ? <div className="command-loading">No connected records matched “{query}”.</div> : <div className="command-results">
        <ResultGroup title="People" icon={<UserRound/>} items={results.people} render={item => <><strong>{item.alias}</strong><span>DL {item.driver_license} · Firearms {item.firearm_license} · {item.warrants.length} warrants</span></>} onClick={() => go('/lookup')}/>
        <ResultGroup title="Vehicles" icon={<Shield/>} items={results.vehicles} render={item => <><strong>{item.plate} · {item.model}</strong><span>{item.color} · {item.owner_name}{item.is_stolen ? ' · STOLEN' : ''}</span></>} onClick={() => go('/lookup')}/>
        <ResultGroup title="Reports" icon={<FileText/>} items={results.reports} render={item => <><strong>{item.report_type} #{item.id} · {item.title}</strong><span>Filed by {item.discord_username}</span></>} onClick={() => go('/reports')}/>
        <ResultGroup title="BOLO intelligence" icon={<BellRing/>} items={results.bolos} render={item => <><strong>{item.priority} · {item.subject}</strong><span>{item.bolo_type} · {item.status} · {item.description}</span></>} onClick={() => go('/')}/>
      </div>}
      <footer><span><kbd>Ctrl</kbd><kbd>K</kbd> toggle</span><span>Unified CAD intelligence network</span></footer>
    </section></div>}
  </>;
}

function ResultGroup({ title, icon, items, render, onClick }) {
  if (!items.length) return null;
  return <section><h3>{icon}{title}<span>{items.length}</span></h3>{items.map(item => <button key={`${title}-${item.id}`} onClick={() => onClick(item)}>{render(item)}</button>)}</section>;
}
