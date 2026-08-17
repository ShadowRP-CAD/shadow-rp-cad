import { useEffect, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Popup, Rectangle, Tooltip } from 'react-leaflet';
import { api, socketUrl } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const bounds = [[0,0],[10000,10000]];
const unitIcon = L.divIcon({ className:'map-unit-icon', html:'<span></span>', iconSize:[22,22], iconAnchor:[11,11] });
const callIcon = L.divIcon({ className:'map-call-icon', html:'!', iconSize:[26,26], iconAnchor:[13,13] });

export default function LiveMap(){
  const [data,setData]=useState({calls:[],units:[]});
  useEffect(()=>{api('/cad/dashboard').then(setData)},[]);
  useEffect(()=>{const ws=new WebSocket(socketUrl());ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type.startsWith('call.'))setData(d=>({...d,calls:[m.data,...d.calls.filter(x=>x.id!==m.data.id)].filter(x=>x.status!=='CLOSED')}));if(m.type==='unit.updated')setData(d=>({...d,units:[m.data,...d.units.filter(x=>x.reforger_uid!==m.data.reforger_uid)]}))};return()=>ws.close()},[]);
  return <div><div className="page-heading"><div><p className="eyebrow">COMMON OPERATING PICTURE</p><h1>Live unit map</h1><p>Placeholder 10 km × 10 km map. Replace with your exported Shadow RP map image.</p></div><div className="map-legend"><span><i className="unit-dot"/>Unit</span><span><i className="call-dot"/>Call</span></div></div>
    <section className="map-frame"><MapContainer crs={L.CRS.Simple} bounds={bounds} maxBounds={bounds} minZoom={-3} maxZoom={2} zoomControl attributionControl={false}>
      <Rectangle bounds={bounds} pathOptions={{color:'#476257',fillColor:'#101d18',fillOpacity:1,weight:2}}/>
      {Array.from({length:9},(_,i)=><Rectangle key={i} bounds={[[i*1000,0],[(i+1)*1000,10000]]} pathOptions={{color:'#274137',fillOpacity:0,weight:.4}}/>)}
      {data.units.filter(u=>u.world_x!=null&&u.world_z!=null).map(u=><Marker icon={unitIcon} position={[u.world_z,u.world_x]} key={u.reforger_uid}><Tooltip permanent direction="right">{u.callsign}</Tooltip><Popup><strong>{u.callsign}</strong><br/>{u.player_name}<br/><StatusBadge value={u.duty_status}/></Popup></Marker>)}
      {data.calls.filter(c=>c.world_x!=null&&c.world_z!=null).map(c=><Marker icon={callIcon} position={[c.world_z,c.world_x]} key={c.id}><Tooltip direction="top">#{c.id} {c.call_title}</Tooltip><Popup><strong>{c.call_title}</strong><br/>{c.location_grid}<br/>{c.description}</Popup></Marker>)}
    </MapContainer></section>
  </div>;
}
