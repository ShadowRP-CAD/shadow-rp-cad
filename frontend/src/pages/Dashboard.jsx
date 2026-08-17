import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Radio, RefreshCw, Users } from 'lucide-react';
import { api, socketUrl } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';

export default function Dashboard() {
  const [data, setData] = useState({ calls: [], units: [] });
  const [error, setError] = useState('');
  const load = useCallback(() => api('/cad/dashboard').then(setData).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const ws = new WebSocket(socketUrl());
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.type.startsWith('call.')) setData(current => ({ ...current, calls: upsert(current.calls, message.data).filter(c => c.status !== 'CLOSED') }));
      if (message.type === 'unit.updated') setData(current => ({ ...current, units: upsert(current.units, message.data, 'reforger_uid') }));
    };
    return () => ws.close();
  }, []);
  const available = useMemo(() => data.units.filter(u => u.duty_status === '10-8').length, [data.units]);

  async function updateCall(call, status, callsign) {
    const assignedUnits = callsign ? [...new Set([...call.assigned_units, callsign])] : call.assigned_units;
    const updated = await api(`/cad/calls/${call.id}`, { method: 'PATCH', body: JSON.stringify({ status, assignedUnits }) });
    setData(current => ({ ...current, calls: upsert(current.calls, updated).filter(c => c.status !== 'CLOSED') }));
  }

  return <div>
    <div className="page-heading"><div><p className="eyebrow">OPERATIONS OVERVIEW</p><h1>Dispatch board</h1><p>Live field status and emergency call coordination.</p></div><button className="icon-button" onClick={load}><RefreshCw size={17}/> Refresh</button></div>
    {error && <div className="alert">{error}</div>}
    <div className="metric-grid">
      <article><span>Active calls</span><strong>{data.calls.length}</strong><AlertTriangle/></article>
      <article><span>Units online</span><strong>{data.units.length}</strong><Users/></article>
      <article><span>10-8 available</span><strong>{available}</strong><Radio/></article>
      <article><span>Last sync</span><strong className="metric-time">Now</strong><Clock3/></article>
    </div>
    <div className="dashboard-grid">
      <section className="panel"><div className="panel-heading"><div><span className="live-dot"/> Active 911 calls</div><small>{data.calls.length} open</small></div>
        <div className="call-list">{data.calls.length === 0 ? <Empty text="No active calls"/> : data.calls.map(call => <article className="call-card" key={call.id}>
          <div className="call-top"><span className="call-number">#{String(call.id).padStart(4,'0')}</span><StatusBadge value={call.status}/></div>
          <h3>{call.call_title}</h3><p>{call.description}</p>
          <div className="call-meta"><span>{call.location_grid}</span><span>{call.caller_name}</span><span>{new Date(call.created_at + 'Z').toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span></div>
          <div className="assign-row"><select defaultValue=""><option value="" disabled>Assign unit…</option>{data.units.map(unit => <option key={unit.reforger_uid}>{unit.callsign}</option>)}</select>
            <button onClick={e => { const select=e.currentTarget.previousElementSibling; if(select.value) updateCall(call,'DISPATCHED',select.value); }}>Dispatch</button>
            <button className="subtle" onClick={() => updateCall(call,'CLOSED')}>Close</button></div>
          {call.assigned_units.length > 0 && <div className="assigned">Assigned: {call.assigned_units.join(', ')}</div>}
        </article>)}</div>
      </section>
      <section className="panel"><div className="panel-heading"><div>Active units</div><small>30 min window</small></div>
        <div className="unit-list">{data.units.length === 0 ? <Empty text="No units reporting"/> : data.units.map(unit => <article className="unit-row" key={unit.reforger_uid}>
          <div className="unit-avatar">{unit.callsign.slice(0,2)}</div><div className="grow"><strong>{unit.callsign}</strong><span>{unit.player_name} · {unit.rank}</span></div><div className="unit-status"><StatusBadge value={unit.duty_status}/><small>{unit.location_grid || 'No grid'}</small></div>
        </article>)}</div>
      </section>
    </div>
  </div>;
}

function upsert(items, item, key='id') { return [item, ...items.filter(existing => existing[key] !== item[key])]; }
function Empty({text}) { return <div className="empty"><Radio size={28}/><span>{text}</span></div>; }
