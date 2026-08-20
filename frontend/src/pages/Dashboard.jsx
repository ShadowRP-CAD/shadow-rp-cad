import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertOctagon, BellRing, Bot, Clock3, Filter, MapPin, MessageSquarePlus, Plus, Radio, RefreshCw, Search, ShieldAlert, Siren, Users, Volume2, VolumeX, X } from 'lucide-react';
import { api, API_URL, authHeaders, socketUrl } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const priorities = ['ALL','P0','P1','P2','P3'];
const callTypes = ['GENERAL','911','TRAFFIC','WEAPONS','MEDICAL','FIRE','DISTURBANCE','PURSUIT','MISSING PERSON','SUSPICIOUS'];
const dutyStatuses = ['10-8','10-7','10-6','10-23','10-99'];

export default function Dashboard() {
  const [data, setData] = useState({ calls: [], units: [], bolos: [], serverTime: null });
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState('ALL');
  const [selectedCallId, setSelectedCallId] = useState(null);
  const [modal, setModal] = useState(null);
  const [voiceArmed, setVoiceArmed] = useState(() => localStorage.getItem('srp-ai-dispatch-voice') === 'on');
  const [latestDispatch, setLatestDispatch] = useState(null);
  const voiceArmedRef = useRef(voiceArmed);
  const load = useCallback(() => api('/cad/dashboard').then(result => { setData(result); setError(''); }).catch(e => setError(e.message)), []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { voiceArmedRef.current = voiceArmed; localStorage.setItem('srp-ai-dispatch-voice', voiceArmed ? 'on' : 'off'); }, [voiceArmed]);
  useEffect(() => {
    const ws = new WebSocket(socketUrl());
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.type.startsWith('call.')) setData(current => ({ ...current, calls: upsert(current.calls, message.data).filter(call => call.status !== 'CLOSED') }));
      if (message.type === 'unit.updated') setData(current => ({ ...current, units: upsert(current.units, message.data, 'reforger_uid') }));
      if (message.type === 'bolo.created') setData(current => ({ ...current, bolos: upsert(current.bolos, message.data) }));
      if (message.type === 'bolo.updated') setData(current => ({ ...current, bolos: upsert(current.bolos, message.data).filter(bolo => bolo.status === 'ACTIVE') }));
      if (message.type === 'dispatch.created') {
        setLatestDispatch(message.data);
        if (voiceArmedRef.current) playDispatchVoice(message.data);
      }
    };
    return () => ws.close();
  }, []);

  async function playDispatchVoice(call) {
    window.dispatchEvent(new CustomEvent('srp:ai-dispatch', { detail: call }));
    try {
      const response = await fetch(`${API_URL}${call.dispatch_audio_url}`, { credentials: 'include', headers: authHeaders() });
      if (!response.ok) throw new Error('cloud voice unavailable');
      const audio = new Audio(URL.createObjectURL(await response.blob()));
      audio.volume = 0.72;
      await audio.play();
      audio.onended = () => URL.revokeObjectURL(audio.src);
    } catch {
      if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(call.dispatch_text);
        utterance.rate = 0.93; utterance.pitch = 0.82; utterance.volume = 0.72;
        speechSynthesis.speak(utterance);
      }
    }
  }

  function toggleVoice() {
    const next = !voiceArmed;
    setVoiceArmed(next);
    if (next && 'speechSynthesis' in window) {
      const test = new SpeechSynthesisUtterance('Shadow AI dispatch radio armed.');
      test.volume = 0.55; test.rate = 0.95; speechSynthesis.speak(test);
    }
  }

  const available = useMemo(() => data.units.filter(unit => unit.duty_status === '10-8').length, [data.units]);
  const panic = useMemo(() => data.units.filter(unit => unit.duty_status === '10-99').length, [data.units]);
  const critical = useMemo(() => data.calls.filter(call => ['P0','P1'].includes(call.priority)).length, [data.calls]);
  const filteredCalls = useMemo(() => data.calls.filter(call => {
    const matchesPriority = priority === 'ALL' || call.priority === priority;
    const term = query.toLowerCase();
    const matchesQuery = !term || [call.call_title, call.description, call.location_grid, call.call_type, ...(call.assigned_units || [])].join(' ').toLowerCase().includes(term);
    return matchesPriority && matchesQuery;
  }), [data.calls, priority, query]);
  const selectedCall = data.calls.find(call => call.id === selectedCallId) || null;

  async function updateCall(call, patch) {
    const updated = await api(`/cad/calls/${call.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    setData(current => ({ ...current, calls: upsert(current.calls, updated).filter(item => item.status !== 'CLOSED') }));
    if (updated.status === 'CLOSED') setSelectedCallId(null);
    return updated;
  }

  async function assignUnit(call, callsign) {
    if (!callsign) return;
    await updateCall(call, { status: 'DISPATCHED', assignedUnits: [...new Set([...(call.assigned_units || []), callsign])] });
  }

  async function addNote(call, note) {
    if (!note.trim()) return;
    const updated = await api(`/cad/calls/${call.id}/notes`, { method: 'POST', body: JSON.stringify({ note }) });
    setData(current => ({ ...current, calls: upsert(current.calls, updated) }));
  }

  async function updateUnit(unit, dutyStatus) {
    const updated = await api(`/cad/units/${encodeURIComponent(unit.reforger_uid)}`, { method: 'PATCH', body: JSON.stringify({ dutyStatus }) });
    setData(current => ({ ...current, units: upsert(current.units, updated, 'reforger_uid') }));
  }

  async function createIncident(form) {
    const created = await api('/cad/calls', { method: 'POST', body: JSON.stringify(form) });
    setData(current => ({ ...current, calls: upsert(current.calls, created) }));
    setModal(null); setSelectedCallId(created.id);
  }

  async function createBolo(form) {
    const created = await api('/cad/bolos', { method: 'POST', body: JSON.stringify(form) });
    setData(current => ({ ...current, bolos: upsert(current.bolos, created) }));
    setModal(null);
  }

  async function clearBolo(bolo, status='LOCATED') {
    const updated = await api(`/cad/bolos/${bolo.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    setData(current => ({ ...current, bolos: current.bolos.filter(item => item.id !== updated.id) }));
  }

  return <div>
    <div className="page-heading advanced-heading"><div><p className="eyebrow">REAL-TIME INCIDENT COMMAND</p><h1>Shadow Operations Center</h1><p>Priority dispatch, field intelligence, alerts, and unit command in one live workspace.</p></div><div className="heading-actions"><button className="icon-button" onClick={load}><RefreshCw/> Sync</button><button className="button bolo-button" onClick={() => setModal('bolo')}><BellRing/> New BOLO</button><button className="button primary" onClick={() => setModal('incident')}><Plus/> New incident</button></div></div>
    {error && <div className="alert">{error}</div>}
    {panic > 0 && <div className="panic-banner"><AlertOctagon/><div><strong>{panic} UNIT PANIC SIGNAL{panic > 1 ? 'S' : ''}</strong><span>Immediate assistance required. Locate and dispatch all available units.</span></div></div>}

    <section className={`ai-dispatch-console ${voiceArmed ? 'armed' : ''}`}><div className="ai-orb"><Bot/></div><div className="grow"><span>SHADOW AI DISPATCH · {voiceArmed ? 'VOICE ARMED' : 'VOICE MUTED'}</span><strong>{latestDispatch ? `${latestDispatch.ten_code} · ${latestDispatch.call_title}` : 'Monitoring RPPhone emergency channels'}</strong><small>{latestDispatch?.dispatch_text || 'Every 911 and medical call is classified, prioritized, assigned, and broadcast in real time.'}</small></div>{latestDispatch && <button onClick={() => playDispatchVoice(latestDispatch)}><Volume2/> Replay</button>}<button className="voice-arm" onClick={toggleVoice}>{voiceArmed ? <Volume2/> : <VolumeX/>}{voiceArmed ? 'Armed' : 'Enable voice'}</button></section>

    <div className="metric-grid ops-metrics">
      <article><span>Active incidents</span><strong>{data.calls.length}</strong><Siren/></article>
      <article className={critical ? 'critical-metric' : ''}><span>Priority P0 / P1</span><strong>{critical}</strong><ShieldAlert/></article>
      <article><span>Units reporting</span><strong>{data.units.length}</strong><Users/></article>
      <article><span>Available 10-8</span><strong>{available}</strong><Radio/></article>
    </div>

    <section className="command-ribbon"><div><span className="signal-bars"><i/><i/><i/><i/></span><p><b>CAD NETWORK ONLINE</b><small>Encrypted WebSocket telemetry</small></p></div><div><strong>{data.calls.filter(call => call.status === 'DISPATCHED').length}</strong><p><b>INCIDENTS ASSIGNED</b><small>{data.calls.filter(call => call.status === 'OPEN').length} awaiting dispatch</small></p></div><div className={panic ? 'command-alert' : ''}><strong>{panic}</strong><p><b>PANIC SIGNALS</b><small>{panic ? 'Emergency response active' : 'No emergency activations'}</small></p></div><div><strong>{data.bolos.length}</strong><p><b>ACTIVE BOLOS</b><small>Field intelligence network</small></p></div></section>

    <section className="ops-toolbar">
      <div className="ops-search"><Search/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter incidents, grids, units, or types…"/></div>
      <div className="priority-filter"><Filter/>{priorities.map(value => <button key={value} className={priority === value ? `active priority-${value.toLowerCase()}` : ''} onClick={() => setPriority(value)}>{value}</button>)}</div>
    </section>

    <div className="ops-workspace">
      <section className="panel incident-board"><div className="panel-heading"><div><span className="live-dot"/> Incident queue</div><small>{filteredCalls.length} visible · priority sorted</small></div>
        <div className="advanced-call-list">{filteredCalls.length === 0 ? <Empty text="No incidents match this view"/> : filteredCalls.map(call => <IncidentCard key={call.id} call={call} units={data.units} onOpen={() => setSelectedCallId(call.id)} onAssign={callsign => assignUnit(call, callsign)} onClose={() => updateCall(call, { status: 'CLOSED', disposition: 'Closed by dispatch' })}/>)}</div>
      </section>
      <section className="panel unit-command"><div className="panel-heading"><div>Field unit command</div><small>Live status control</small></div>
        <div className="unit-list">{data.units.length === 0 ? <Empty text="No units reporting"/> : data.units.map(unit => <article className={unit.duty_status === '10-99' ? 'unit-row unit-panic' : 'unit-row'} key={unit.reforger_uid}>
          <div className="unit-avatar">{unit.callsign.slice(0,2)}</div><div className="grow"><strong>{unit.callsign}</strong><span>{unit.player_name} · {unit.agency} · {unit.rank}</span><small><MapPin/> {unit.location_grid || 'No grid telemetry'}</small></div><select className="unit-status-select" value={unit.duty_status} onChange={event => updateUnit(unit, event.target.value)}>{dutyStatuses.map(status => <option key={status}>{status}</option>)}</select>
        </article>)}</div>
      </section>
    </div>

    <section className="panel bolo-board"><div className="panel-heading"><div><BellRing/> Active BOLO intelligence</div><small>{data.bolos.length} alerts</small></div><div className="bolo-grid">{data.bolos.length ? data.bolos.map(bolo => <article className={`bolo-card priority-${bolo.priority.toLowerCase()}`} key={bolo.id}><div className="bolo-top"><span>{bolo.bolo_type}</span><Priority value={bolo.priority}/></div><h3>{bolo.subject}</h3><p>{bolo.description}</p><div className="bolo-meta"><span><MapPin/> {bolo.location_grid || 'Island-wide'}</span><span>Issued by {bolo.created_by_name || 'System'}</span></div><div className="bolo-actions"><button onClick={() => clearBolo(bolo)}>Mark located</button><button onClick={() => clearBolo(bolo, 'CANCELLED')}>Cancel</button></div></article>) : <Empty text="No active BOLO alerts"/>}</div></section>

    {selectedCall && <IncidentDrawer call={selectedCall} units={data.units} onClose={() => setSelectedCallId(null)} onUpdate={patch => updateCall(selectedCall, patch)} onAssign={callsign => assignUnit(selectedCall, callsign)} onNote={note => addNote(selectedCall, note)}/>}
    {modal === 'incident' && <IncidentModal onClose={() => setModal(null)} onSubmit={createIncident}/>}
    {modal === 'bolo' && <BoloModal onClose={() => setModal(null)} onSubmit={createBolo}/>}
  </div>;
}

function IncidentCard({ call, units, onOpen, onAssign, onClose }) {
  return <article className={`advanced-call-card priority-${call.priority.toLowerCase()}`}>
    <button className="call-open-area" onClick={onOpen}><div className="call-top"><div><Priority value={call.priority}/><span className="call-type">{call.call_type}</span>{call.ten_code && <span className="call-type ai-code"><Bot/> {call.ten_code}</span>}</div><StatusBadge value={call.status}/></div><div className="call-id">INC-{String(call.id).padStart(5,'0')} · {timeAgo(call.created_at)}{call.ai_mode && ` · ${call.ai_mode === 'OPENAI' ? 'AI CLASSIFIED' : 'SAFE AUTO-DISPATCH'}`}</div><h3>{call.call_title}</h3><p>{call.dispatch_text || call.description}</p><div className="call-meta"><span><MapPin/> {call.location_grid}</span><span>{call.caller_name}</span><span><Clock3/> {new Date(`${call.created_at}Z`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div></button>
    <div className="advanced-assign"><select defaultValue="" onChange={event => { if (event.target.value) onAssign(event.target.value); event.target.value=''; }}><option value="" disabled>Assign responding unit…</option>{units.map(unit => <option key={unit.reforger_uid} value={unit.callsign}>{unit.callsign} · {unit.duty_status} · {unit.location_grid || 'No grid'}</option>)}</select><button onClick={onOpen}>Open command</button><button className="subtle" onClick={onClose}>Close</button></div>
    {call.assigned_units?.length > 0 && <div className="assigned-unit-chips">{call.assigned_units.map(callsign => <span key={callsign}><Radio/> {callsign}</span>)}</div>}
  </article>;
}

function IncidentDrawer({ call, units, onClose, onUpdate, onAssign, onNote }) {
  const [note, setNote] = useState('');
  return <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><aside className="incident-drawer"><header><div><span className="eyebrow">INCIDENT COMMAND · INC-{String(call.id).padStart(5,'0')}</span><h2>{call.call_title}</h2></div><button onClick={onClose}><X/></button></header><div className="drawer-summary"><Priority value={call.priority}/><StatusBadge value={call.status}/><span>{call.call_type}</span><span><MapPin/> {call.location_grid}</span></div><p className="drawer-description">{call.description}</p>
    <section className="drawer-controls"><label>Priority<select value={call.priority} onChange={event => onUpdate({ priority: event.target.value })}>{priorities.slice(1).map(value => <option key={value}>{value}</option>)}</select></label><label>Status<select value={call.status} onChange={event => onUpdate({ status: event.target.value })}><option>OPEN</option><option>DISPATCHED</option><option>CLOSED</option></select></label><label>Assign unit<select defaultValue="" onChange={event => { onAssign(event.target.value); event.target.value=''; }}><option value="" disabled>Select unit…</option>{units.map(unit => <option key={unit.reforger_uid}>{unit.callsign}</option>)}</select></label></section>
    <section className="incident-note"><h3><MessageSquarePlus/> Add dispatch note</h3><form onSubmit={event => { event.preventDefault(); onNote(note); setNote(''); }}><textarea rows="3" value={note} onChange={event => setNote(event.target.value)} placeholder="Record updates, observations, commands, or scene details…"/><button className="button primary">Add to timeline</button></form></section>
    <section className="incident-timeline"><h3>Incident timeline</h3>{call.events?.length ? call.events.map(event => <article key={event.id}><i className={`event-${event.event_type.toLowerCase()}`}/><div><strong>{event.message}</strong><span>{event.actor_name} · {new Date(`${event.created_at}Z`).toLocaleString()}</span></div></article>) : <Empty text="No timeline events"/>}</section>
  </aside></div>;
}

function IncidentModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({ callTitle:'', callerName:'Dispatch initiated', locationGrid:'', description:'', priority:'P2', callType:'GENERAL' });
  return <Modal title="Create priority incident" icon={<Siren/>} onClose={onClose}><form className="modal-form" onSubmit={event => { event.preventDefault(); onSubmit(form); }}><div className="two-col"><label>Priority<select value={form.priority} onChange={event => setForm({...form,priority:event.target.value})}>{priorities.slice(1).map(value => <option key={value}>{value}</option>)}</select></label><label>Incident type<select value={form.callType} onChange={event => setForm({...form,callType:event.target.value})}>{callTypes.map(value => <option key={value}>{value}</option>)}</select></label></div><label>Incident title<input value={form.callTitle} onChange={event => setForm({...form,callTitle:event.target.value})} placeholder="Armed disturbance" required/></label><div className="two-col"><label>Caller / source<input value={form.callerName} onChange={event => setForm({...form,callerName:event.target.value})}/></label><label>Map grid<input value={form.locationGrid} onChange={event => setForm({...form,locationGrid:event.target.value})} placeholder="042 067" required/></label></div><label>Initial call narrative<textarea rows="5" value={form.description} onChange={event => setForm({...form,description:event.target.value})} required/></label><button className="button primary">Create and open incident</button></form></Modal>;
}

function BoloModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({ boloType:'PERSON', subject:'', description:'', priority:'P2', locationGrid:'', expiresAt:'' });
  return <Modal title="Publish BOLO intelligence" icon={<BellRing/>} onClose={onClose}><form className="modal-form" onSubmit={event => { event.preventDefault(); onSubmit(form); }}><div className="two-col"><label>BOLO type<select value={form.boloType} onChange={event => setForm({...form,boloType:event.target.value})}><option>PERSON</option><option>VEHICLE</option><option>PROPERTY</option><option>GENERAL</option></select></label><label>Priority<select value={form.priority} onChange={event => setForm({...form,priority:event.target.value})}>{priorities.slice(1).map(value => <option key={value}>{value}</option>)}</select></label></div><label>Subject<input value={form.subject} onChange={event => setForm({...form,subject:event.target.value})} placeholder="Name, plate, vehicle, or alert subject" required/></label><label>Intelligence details<textarea rows="5" value={form.description} onChange={event => setForm({...form,description:event.target.value})} required/></label><div className="two-col"><label>Last-known grid<input value={form.locationGrid} onChange={event => setForm({...form,locationGrid:event.target.value})} placeholder="Island-wide if blank"/></label><label>Optional expiration<input type="datetime-local" value={form.expiresAt} onChange={event => setForm({...form,expiresAt:event.target.value})}/></label></div><button className="button primary">Broadcast BOLO</button></form></Modal>;
}

function Modal({ title, icon, onClose, children }) { return <div className="modal-backdrop"><section className="command-modal"><header><div>{icon}<h2>{title}</h2></div><button onClick={onClose}><X/></button></header>{children}</section></div>; }
function Priority({ value='P2' }) { return <span className={`priority-badge priority-${value.toLowerCase()}`}>{value}</span>; }
function upsert(items, item, key='id') { return [item, ...items.filter(existing => existing[key] !== item[key])]; }
function Empty({ text }) { return <div className="empty"><Radio/><span>{text}</span></div>; }
function timeAgo(value) { const seconds=Math.max(1,Math.floor((Date.now()-new Date(`${value}Z`).getTime())/1000)); if(seconds<60)return `${seconds}s ago`; if(seconds<3600)return `${Math.floor(seconds/60)}m ago`; return `${Math.floor(seconds/3600)}h ago`; }
