import { Activity, ChartCandlestick, FileText, IdCard, Landmark, LayoutDashboard, Link2, LogOut, Map, Search, Shield, ShieldCheck } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import MusicPlayer from './MusicPlayer.jsx';

const links = [
  ['/', LayoutDashboard, 'Dispatch'], ['/lookup', Search, 'Records'], ['/map', Map, 'Live map'],
  ['/reports', FileText, 'Reports'], ['/civilian', Landmark, 'Civilian hub'], ['/market', ChartCandlestick, 'Exchange'], ['/personas', IdCard, 'Personas'], ['/linking', Link2, 'Account link']
];

export default function Shell({ user, onLogout }) {
  const cadUser = ['LEO','EMS','DISPATCH','ADMIN'].includes(user.role);
  const visibleLinks = cadUser ? [...links, ...(user.role === 'ADMIN' ? [['/admin', ShieldCheck, 'Admin center']] : [])] : links.filter(([to]) => ['/civilian','/market','/personas','/linking'].includes(to));
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="brand-logo" src={`${import.meta.env.BASE_URL}shadow-rp-logo.gif`} alt="Shadow RP"/><div><strong>SHADOW RP</strong><span>CAD · MDT · EXCHANGE</span></div></div>
      <nav>{visibleLinks.map(([to, Icon, label]) => <NavLink key={to} to={to} end={to === '/'} className={({isActive}) => isActive ? 'active' : ''}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="connection"><Activity size={14}/><span>Systems operational</span></div><button className="nav-button" onClick={onLogout}><LogOut size={18}/> Sign out</button></div>
    </aside>
    <div className="main-column">
      <header className="topbar"><div><span className="eyebrow">SHADOW RP PUBLIC SAFETY</span><strong>Computer Aided Dispatch</strong></div><div className="user-chip"><Shield size={16}/><span>{user.discord_username}</span><b>{user.role}</b></div></header>
      {!user.reforger_uid&&<div className="global-link-banner"><Link2/><div><strong>Finish your one-time Shadow RP account link</strong><span>Secure your persistent bank, money, investments, property, and in-game identity.</span></div><Link to="/linking">Enter link code</Link></div>}
      <main className="content"><Outlet /></main>
    </div>
    <MusicPlayer />
  </div>;
}
