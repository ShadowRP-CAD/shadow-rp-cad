import { useState } from 'react';
import { Car, Search, UserRound } from 'lucide-react';
import { api } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';

export default function Lookup() {
  const [tab, setTab] = useState('name'), [query, setQuery] = useState(''), [results, setResults] = useState([]), [error, setError] = useState('');
  async function search(event) {
    event.preventDefault(); setError('');
    try { const data = await api(tab === 'name' ? `/cad/civilian/lookup?name=${encodeURIComponent(query)}` : `/cad/vehicle/lookup?plate=${encodeURIComponent(query)}`); setResults(data.results); }
    catch(e) { setError(e.message); }
  }
  return <div><div className="page-heading"><div><p className="eyebrow">RECORDS MANAGEMENT</p><h1>Name & vehicle lookup</h1><p>Search linked civilian and motor vehicle records.</p></div></div>
    <section className="panel lookup-panel"><div className="tabs"><button className={tab==='name'?'active':''} onClick={()=>{setTab('name');setResults([])}}><UserRound size={16}/> Name</button><button className={tab==='plate'?'active':''} onClick={()=>{setTab('plate');setResults([])}}><Car size={16}/> Vehicle</button></div>
      <form className="searchbar" onSubmit={search}><Search size={19}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={tab==='name'?'First or last name':'Plate number'} autoFocus/><button>Search records</button></form>
    </section>{error&&<div className="alert">{error}</div>}
    <div className="results-grid">{results.map(row => tab==='name'?<PersonCard key={row.id} row={row}/>:<VehicleCard key={row.id} row={row}/>)}</div>
  </div>;
}
function PersonCard({row}) { return <article className="record-card"><div className="record-icon"><UserRound/></div><div><span className="eyebrow">CIVILIAN #{row.id}</span><h2>{row.first_name} {row.last_name}</h2><p>DOB {row.dob} · {row.gender}</p></div><dl><div><dt>Driver license</dt><dd><StatusBadge value={row.driver_license}/></dd></div><div><dt>Firearm license</dt><dd>{row.firearm_license}</dd></div><div><dt>Active warrants</dt><dd className={row.warrants.length?'danger-text':''}>{row.warrants.length ? row.warrants.join('; ') : 'None'}</dd></div><div><dt>Prior record</dt><dd>{row.priors.length ? row.priors.join('; ') : 'None found'}</dd></div></dl></article>; }
function VehicleCard({row}) { return <article className="record-card"><div className="record-icon"><Car/></div><div><span className="eyebrow">VEHICLE #{row.id}</span><h2>{row.plate}</h2><p>{row.color} · {row.model}</p></div><dl><div><dt>Registered owner</dt><dd>{row.owner_name}</dd></div><div><dt>Stolen status</dt><dd><StatusBadge value={row.is_stolen?'STOLEN':'CLEAR'}/></dd></div></dl></article>; }
