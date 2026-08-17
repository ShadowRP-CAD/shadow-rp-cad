import { useState } from 'react';
import { CheckCircle2, Gamepad2, Link2 } from 'lucide-react';
import { api } from '../api.js';

export default function Linking({user}) {
  const [token,setToken]=useState(''), [steamId,setSteamId]=useState(user.steam_id||''), [result,setResult]=useState(null), [error,setError]=useState('');
  async function submit(e){e.preventDefault();setError('');try{setResult(await api('/link/verify',{method:'POST',body:JSON.stringify({token,steamId})}))}catch(err){setError(err.message)}}
  return <div><div className="page-heading"><div><p className="eyebrow">IDENTITY BRIDGE</p><h1>Account linking</h1><p>Connect this Discord account to your in-game Shadow RP identity.</p></div></div>
    <div className="link-grid"><section className="panel instructions"><h2><Gamepad2/> In-game steps</h2><ol><li>Join the Shadow RP Reforger server.</li><li>Use the account-link interaction on the linking terminal.</li><li>Copy the six-character code shown in game.</li><li>Enter it here within ten minutes.</li></ol><div className="linked-state"><span>Current Reforger UID</span><strong>{user.reforger_uid||'Not linked'}</strong></div></section>
      <section className="panel link-form"><div className="record-icon"><Link2/></div><h2>Enter your code</h2><p className="muted">Codes are single-use and expire after 10 minutes.</p>{result?<div className="success"><CheckCircle2/><h3>Account linked</h3><p>{result.playerName}</p><code>{result.reforgerUid}</code></div>:<form onSubmit={submit}><label>Linking code<input className="token-input" value={token} onChange={e=>setToken(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6))} placeholder="A1B2C3" minLength="6" required/></label><label>Steam ID64 <span>(optional)</span><input value={steamId} onChange={e=>setSteamId(e.target.value.replace(/\D/g,'').slice(0,20))} placeholder="7656119…"/></label>{error&&<div className="alert">{error}</div>}<button className="button primary wide">Link account</button></form>}</section></div>
  </div>;
}
