import { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, BarChart3, Coins, Landmark, RefreshCw, WalletCards } from 'lucide-react';
import { api } from '../api.js';

const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);

export default function Market() {
  const [data, setData] = useState({ assets: [], holdings: [], orders: [], account: {} });
  const [selected, setSelected] = useState('SHDW');
  const [trade, setTrade] = useState({ side: 'BUY', quantity: 1 });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const load = () => api('/market').then(setData).catch(error => setMessage(error.message)).finally(() => setLoading(false));
  useEffect(() => { load(); const timer = setInterval(load, 60000); return () => clearInterval(timer); }, []);
  const asset = useMemo(() => data.assets.find(item => item.symbol === selected) || data.assets[0], [data.assets, selected]);
  const holding = data.holdings.find(item => item.symbol === selected);

  async function submitTrade(event) {
    event.preventDefault(); setMessage('');
    try {
      const updated = await api('/market/trade', { method: 'POST', body: JSON.stringify({ symbol: selected, side: trade.side, quantity: Number(trade.quantity) }) });
      setData(updated); setMessage(`${trade.side === 'BUY' ? 'Purchased' : 'Sold'} ${trade.quantity} ${selected} share${Number(trade.quantity) === 1 ? '' : 's'}.`);
    } catch (error) { setMessage(error.message); }
  }

  if (loading) return <div className="market-loading"><BarChart3/><span>Opening Shadow Exchange…</span></div>;
  return <div>
    <div className="page-heading"><div><p className="eyebrow">SHADOW EXCHANGE · VIRTUAL ECONOMY</p><h1>Market terminal</h1><p>Persistent, fictional server economy. Prices and portfolios survive restarts.</p></div><button className="icon-button" onClick={load}><RefreshCw size={17}/> Market sync</button></div>
    {data.linkRequired && <div className="civilian-lock"><Landmark/><div><strong>Trading is locked until your one-time game link is complete</strong><p>You can browse live prices now. Link your Reforger identity to access persistent cash, holdings, and orders.</p></div><a className="button primary" href="#/linking">Link account</a></div>}
    {message && <div className="notice market-notice">{message}</div>}
    <section className="market-hero">
      <div><span>NET WORTH</span><strong>{data.account?money(data.account.netWorth):'LINK TO OPEN'}</strong><small>Virtual currency · no real-world value</small></div>
      <div><WalletCards/><span>LIQUID CASH</span><strong>{data.account?money(data.account.cash):'LOCKED'}</strong></div>
      <div><Landmark/><span>INVESTED</span><strong>{data.account?money(data.account.holdingsValue):'LOCKED'}</strong></div>
      <div><Coins/><span>OPEN POSITIONS</span><strong>{data.holdings.length}</strong></div>
    </section>
    <div className="market-layout">
      <section className="panel market-board"><div className="panel-heading"><div><span className="live-dot cyan"/> Shadow Composite</div><small>{data.assets.length} listed companies</small></div>
        <div className="ticker-grid">{data.assets.map(item => <button key={item.symbol} className={`ticker-card ${selected === item.symbol ? 'selected' : ''}`} onClick={() => setSelected(item.symbol)} style={{ '--ticker': item.accent }}>
          <div className="ticker-top"><b>{item.symbol}</b><span className={item.change >= 0 ? 'gain' : 'loss'}>{item.change >= 0 ? <ArrowUpRight/> : <ArrowDownRight/>}{Math.abs(item.change).toFixed(2)}%</span></div>
          <strong>{money(item.price)}</strong><small>{item.company_name}</small><Sparkline values={item.history.map(point => point.price)} color={item.accent}/>
        </button>)}</div>
      </section>
      {asset && <aside className="panel trade-panel" style={{ '--ticker': asset.accent }}><div className="trade-company"><div className="stock-logo">{asset.symbol.slice(0,2)}</div><div><span>{asset.sector}</span><h2>{asset.company_name}</h2></div></div>
        <p>{asset.description}</p><div className="quote"><div><span>LAST PRICE</span><strong>{money(asset.price)}</strong></div><div><span>24H VOLUME</span><strong>{Number(asset.day_volume || 0).toLocaleString()}</strong></div></div>
        <form onSubmit={submitTrade}><div className="trade-toggle"><button type="button" className={trade.side === 'BUY' ? 'active buy' : ''} onClick={() => setTrade({...trade,side:'BUY'})}>Buy</button><button type="button" className={trade.side === 'SELL' ? 'active sell' : ''} onClick={() => setTrade({...trade,side:'SELL'})}>Sell</button></div>
          <label>Shares <span>Owned: {holding?.quantity || 0}</span><input type="number" min="1" max="500" value={trade.quantity} onChange={event => setTrade({...trade,quantity:event.target.value})}/></label>
          <div className="trade-total"><span>Estimated total</span><strong>{money(asset.price * Number(trade.quantity || 0))}</strong></div><button disabled={data.linkRequired} className={`button wide ${trade.side === 'BUY' ? 'market-buy' : 'market-sell'}`}>{data.linkRequired?'Link account to trade':`Place ${trade.side.toLowerCase()} order`}</button>
        </form></aside>}
    </div>
    <div className="portfolio-grid"><section className="panel"><div className="panel-heading"><div>Your portfolio</div><small>LIVE VALUATION</small></div><div className="data-table"><div className="data-row header"><span>Asset</span><span>Shares</span><span>Avg. cost</span><span>Market value</span><span>P/L</span></div>{data.holdings.length ? data.holdings.map(item => { const pnl=(item.price-item.average_cost)*item.quantity; return <div className="data-row" key={item.symbol}><b>{item.symbol}</b><span>{item.quantity}</span><span>{money(item.average_cost)}</span><span>{money(item.price*item.quantity)}</span><span className={pnl >= 0 ? 'gain' : 'loss'}>{pnl >= 0 ? '+' : ''}{money(pnl)}</span></div> }) : <div className="empty"><BarChart3/><span>No positions yet</span></div>}</div></section>
      <section className="panel"><div className="panel-heading"><div>Order ledger</div><small>PERSISTENT HISTORY</small></div><div className="order-list">{data.orders.length ? data.orders.slice(0,8).map(order => <div key={order.id}><b className={order.side === 'BUY' ? 'gain' : 'loss'}>{order.side}</b><strong>{order.quantity} {order.symbol}</strong><span>{money(order.total)}</span><small>{new Date(order.created_at + 'Z').toLocaleString()}</small></div>) : <div className="empty"><Coins/><span>No orders recorded</span></div>}</div></section></div>
  </div>;
}

function Sparkline({ values, color }) {
  if (!values.length) return null;
  const min=Math.min(...values), max=Math.max(...values), range=max-min || 1;
  const points=values.map((value,index)=>`${(index/(values.length-1))*100},${34-((value-min)/range)*30}`).join(' ');
  return <svg className="sparkline" viewBox="0 0 100 38" preserveAspectRatio="none"><defs><linearGradient id={`fill-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".35"/><stop offset="1" stopColor={color} stopOpacity="0"/></linearGradient></defs><polygon points={`0,38 ${points} 100,38`} fill={`url(#fill-${color.replace('#','')})`}/><polyline points={points} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke"/></svg>;
}
