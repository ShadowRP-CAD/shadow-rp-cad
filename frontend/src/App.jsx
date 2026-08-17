import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api, API_URL } from './api.js';
import Shell from './components/Shell.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Lookup from './pages/Lookup.jsx';
import Linking from './pages/Linking.jsx';
import LiveMap from './pages/LiveMap.jsx';
import Market from './pages/Market.jsx';
import Personas from './pages/Personas.jsx';
import Reports from './pages/Reports.jsx';

function Login() {
  return <main className="login-shell">
    <section className="login-card">
      <img className="login-logo" src={`${import.meta.env.BASE_URL}shadow-rp-logo.gif`} alt="Shadow RP"/>
      <p className="eyebrow">SHADOW ROLEPLAY NETWORK</p>
      <h1>Public safety,<br/><em>connected.</em></h1>
      <p className="muted">Secure CAD, dispatch, records, and in-game identity linking for Shadow RP.</p>
      <a className="button primary wide" href={`${API_URL}/auth/discord`}>Continue with Discord</a>
      {import.meta.env.DEV && <a className="button ghost wide" href={`${API_URL}/auth/dev`}>Developer demo login</a>}
      <p className="fine-print">Authorized Shadow RP personnel and residents only.</p>
    </section>
  </main>;
}

export default function App() {
  const [state, setState] = useState({ loading: true, user: null });
  useEffect(() => { api('/me').then(({ user }) => setState({ loading: false, user })).catch(() => setState({ loading: false, user: null })); }, []);
  if (state.loading) return <div className="boot"><div className="brand-mark">SR</div><span>Opening secure terminal…</span></div>;
  if (!state.user) return <Login />;
  const cadUser = ['LEO','EMS','DISPATCH','ADMIN'].includes(state.user.role);
  return <HashRouter><Routes>
    <Route element={<Shell user={state.user} onLogout={() => fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).finally(() => location.reload())} />}>
      <Route index element={cadUser ? <Dashboard /> : <Personas />} />
      <Route path="lookup" element={<Lookup />} />
      <Route path="map" element={<LiveMap />} />
      <Route path="linking" element={<Linking user={state.user} />} />
      <Route path="personas" element={<Personas />} />
      <Route path="market" element={<Market />} />
      <Route path="reports" element={cadUser ? <Reports /> : <Navigate to="/personas" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes></HashRouter>;
}
