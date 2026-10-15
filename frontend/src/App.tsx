import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Routes, Route, NavLink, Link, useNavigate, useParams } from "react-router-dom";
import { Contract, formatEther, isAddress, parseEther, type JsonRpcSigner } from "ethers";
import {
  BOT_CHAIN, CONTRACT_ADDRESS, DEMO_MARKETS, MARKET_ABI, bot, connectWallet,
  marketStatus, readContract, readProvider, short, writeContract, type Market, type Position,
} from "./chain";

type WalletState = { signer: JsonRpcSigner | null; address: string; balance: string; creator: boolean; resolver: boolean };
type Notice = { kind: "ok" | "error" | "pending"; text: string } | null;
type WalletEventProvider = {
  on?: (event: "accountsChanged" | "chainChanged", listener: (value: unknown) => void) => void;
  removeListener?: (event: "accountsChanged" | "chainChanged", listener: (value: unknown) => void) => void;
};

const EMPTY_WALLET: WalletState = { signer: null, address: "", balance: "", creator: false, resolver: false };

export default function App() {
  const [wallet, setWallet] = useState<WalletState>(EMPTY_WALLET);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    if (!CONTRACT_ADDRESS) {
      setMarkets(DEMO_MARKETS);
      setLoading(false);
      return;
    }
    try {
      const contract = readContract()!;
      const count = Number(await contract.marketCount());
      const live: Market[] = [];
      for (let id = count; id >= 1; id--) {
        const m = await contract.getMarket(id);
        live.push({
          id, totalYes: m.totalYes, totalNo: m.totalNo, minStake: m.minStake, maxStake: m.maxStake,
          openTime: Number(m.openTime), closeTime: Number(m.closeTime), resolvedAt: Number(m.resolvedAt),
          feeBps: Number(m.feeBps), outcome: Number(m.outcome), creator: String(m.creator),
          question: String(m.question), description: String(m.description), source: String(m.resolutionSource),
          evidence: String(m.resolutionEvidence),
        });
      }
      setMarkets(live);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not read markets." });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const connect = useCallback(async () => {
    try {
      setNotice({ kind: "pending", text: "Waiting for your wallet…" });
      const connected = await connectWallet();
      const balance = formatEther(await connected.provider.getBalance(connected.address));
      let creator = false, resolver = false;
      if (CONTRACT_ADDRESS) {
        const contract = new Contract(CONTRACT_ADDRESS, MARKET_ABI, connected.provider);
        [creator, resolver] = await Promise.all([contract.isCreator(connected.address), contract.isResolver(connected.address)]);
      }
      setWallet({ signer: connected.signer, address: connected.address, balance, creator, resolver });
      setNotice({ kind: "ok", text: "Wallet connected to BOT Chain." });
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "Wallet connection failed." }); }
  }, []);

  useEffect(() => {
    const ethereum = (window as Window & { ethereum?: WalletEventProvider }).ethereum;
    if (!ethereum?.on) return;

    const handleAccountsChanged = (value: unknown) => {
      if (Array.isArray(value) && value.length === 0) {
        setWallet(EMPTY_WALLET);
        setNotice({ kind: "error", text: "Wallet disconnected. Connect a wallet to continue." });
        return;
      }
      void connect();
    };
    const handleChainChanged = () => { void connect(); };

    ethereum.on("accountsChanged", handleAccountsChanged);
    ethereum.on("chainChanged", handleChainChanged);
    return () => {
      ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [connect]);

  const stats = useMemo(() => {
    const volume = markets.reduce((sum, m) => sum + m.totalYes + m.totalNo, 0n);
    return { volume, live: markets.filter((m) => marketStatus(m) === "LIVE").length, resolved: markets.filter((m) => m.outcome > 0).length };
  }, [markets]);

  return (
    <div className="shell">
      <Sidebar />
      <div className="workspace">
        <Topbar wallet={wallet} connect={connect} />
        {!CONTRACT_ADDRESS && <div className="preview-ribbon"><b>PREVIEW MODE</b><span>Deploy the contract and set VITE_PULSELINE_ADDRESS to enable real transactions.</span></div>}
        {notice && <div className={`notice ${notice.kind}`} onClick={() => setNotice(null)}>{notice.text}<span>×</span></div>}
        <Routes>
          <Route path="/" element={<Home markets={markets} loading={loading} stats={stats} />} />
          <Route path="/markets" element={<MarketsPage markets={markets} loading={loading} />} />
          <Route path="/markets/:id" element={<MarketPage markets={markets} wallet={wallet} setNotice={setNotice} reload={reload} />} />
          <Route path="/leaderboard" element={<Leaderboard markets={markets} />} />
          <Route path="/admin" element={<Admin markets={markets} wallet={wallet} setNotice={setNotice} reload={reload} />} />
        </Routes>
      </div>
    </div>
  );
}

function Sidebar() {
  return <aside className="sidebar">
    <Link to="/" className="wordmark"><span className="pulse-logo">P</span><span>PULSELINE</span></Link>
    <nav>
      <NavLink to="/" end><span>01</span>Overview</NavLink>
      <NavLink to="/markets"><span>02</span>Markets</NavLink>
      <NavLink to="/leaderboard"><span>03</span>Signals</NavLink>
      <NavLink to="/admin"><span>04</span>Control</NavLink>
    </nav>
    <div className="side-note"><div className="live-dot" />BOT CHAIN<br/><b>NETWORK 677</b></div>
  </aside>;
}

function Topbar({ wallet, connect }: { wallet: WalletState; connect(): void }) {
  return <header className="topbar">
    <div><span className="eyebrow">DECENTRALIZED FORECAST DESK</span><span className="top-date">{new Date().toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" })}</span></div>
    <div className="top-actions"><a href={BOT_CHAIN.explorer} target="_blank" rel="noreferrer">Explorer ↗</a>
      {wallet.address ? <button className="wallet-pill" onClick={connect} title="Refresh wallet connection"><i />{short(wallet.address)} · {Number(wallet.balance).toFixed(2)} BOT</button> : <button className="primary small" onClick={connect}>Connect wallet</button>}
    </div>
  </header>;
}

function Home({ markets, loading, stats }: { markets: Market[]; loading: boolean; stats: { volume: bigint; live: number; resolved: number } }) {
  return <main>
    <section className="hero-grid">
      <div className="hero-copy"><div className="issue-tag">VOL. 01 / BOT CHAIN</div><h1>PRICE<br/><em>THE NEXT</em><br/>MOVE.</h1><p>Binary markets for the signals that matter. Take a side with BOT and settle every outcome on-chain.</p><div className="hero-buttons"><Link className="primary" to="/markets">Enter the floor</Link><a className="text-link" href="#method">How settlement works →</a></div></div>
      <div className="hero-visual"><div className="rings"><span/><span/><span/></div><div className="crosshair">YES<br/><small>OR</small><br/>NO</div><div className="ticker">PULSE / 677 / LIVE / VERIFIABLE /</div></div>
    </section>
    <section className="metric-row"><Metric n={bot(stats.volume)} label="BOT signaled" /><Metric n={String(stats.live).padStart(2,"0")} label="live markets" /><Metric n={String(stats.resolved).padStart(2,"0")} label="settled on-chain" /><Metric n="2%" label="default fee" /></section>
    <section className="section-pad"><SectionTitle no="01" title="Markets in motion" link="/markets" />{loading ? <Loading /> : <div className="market-grid">{markets.slice(0,3).map((m) => <MarketCard key={m.id} market={m} />)}</div>}</section>
    <section id="method" className="method"><div><span className="eyebrow">THE METHOD</span><h2>One question.<br/>Two sides.<br/>One result.</h2></div><ol><li><b>01</b><span>Read the resolution source before committing.</span></li><li><b>02</b><span>Choose YES or NO and stake native BOT.</span></li><li><b>03</b><span>An authorized resolver records evidence after close.</span></li><li><b>04</b><span>Winners claim a proportional share from the contract.</span></li></ol></section>
    <Footer />
  </main>;
}

function MarketsPage({ markets, loading }: { markets: Market[]; loading: boolean }) {
  const [filter, setFilter] = useState("ALL");
  const shown = markets.filter((m) => filter === "ALL" || marketStatus(m).includes(filter));
  return <main className="page"><div className="page-lead"><span className="eyebrow">MARKET INDEX</span><h1>Every signal<br/>on the board.</h1><p>Filter by lifecycle, inspect the source, then take a position.</p></div>
    <div className="filterbar">{["ALL","LIVE","AWAITING","YES WON","NO WON"].map((x) => <button key={x} className={filter===x?"active":""} onClick={()=>setFilter(x)}>{x}</button>)}</div>
    {loading ? <Loading /> : shown.length ? <div className="market-list">{shown.map((m)=><MarketRow key={m.id} market={m}/>)}</div> : <div className="empty">No markets in this view.</div>}
    <Footer />
  </main>;
}

function MarketPage({ markets, wallet, setNotice, reload }: { markets: Market[]; wallet: WalletState; setNotice(v: Notice): void; reload(): Promise<void> }) {
  const { id } = useParams(); const navigate = useNavigate();
  const market = markets.find((m) => m.id === Number(id));
  const [side, setSide] = useState<1|2>(1); const [amount, setAmount] = useState(""); const [position, setPosition] = useState<Position|null>(null);
  useEffect(() => {
    if (market) setAmount(formatEther(market.minStake));
  }, [market?.id, market?.minStake]);
  const loadPosition = useCallback(async () => {
    if (!market || !wallet.address || !CONTRACT_ADDRESS) return;
    const contract = readContract()!; const [p, available] = await Promise.all([contract.getPosition(market.id,wallet.address),contract.claimable(market.id,wallet.address)]);
    setPosition({ side:Number(p.side), claimed:Boolean(p.claimed), amount:p.amount, claimable:available });
  },[market,wallet.address]);
  useEffect(()=>{ void loadPosition(); },[loadPosition]);
  if (!market) return <main className="page"><button className="back" onClick={()=>navigate(-1)}>← Back</button><Loading /></main>;
  const activeMarket = market;
  const total = activeMarket.totalYes + activeMarket.totalNo; const yes = total ? Number(activeMarket.totalYes*10000n/total)/100 : 50; const status=marketStatus(activeMarket);
  async function stake() {
    if (!wallet.signer) return setNotice({kind:"error",text:"Connect your wallet first."});
    if (!CONTRACT_ADDRESS || activeMarket.demo) return setNotice({kind:"error",text:"Preview data cannot accept transactions. Deploy your own contract first."});
    try { setNotice({kind:"pending",text:"Confirm the stake in your wallet…"}); const tx=await writeContract(wallet.signer).stake(activeMarket.id,side,{value:parseEther(amount)}); setNotice({kind:"pending",text:`Transaction ${tx.hash} is pending…`}); await tx.wait(); setNotice({kind:"ok",text:"Position confirmed on BOT Chain."}); await reload(); await loadPosition(); }
    catch(error){setNotice({kind:"error",text:error instanceof Error?error.message:"Stake failed."});}
  }
  async function claim(){if(!wallet.signer)return;try{setNotice({kind:"pending",text:"Confirm claim in your wallet…"});const tx=await writeContract(wallet.signer).claim(activeMarket.id);await tx.wait();setNotice({kind:"ok",text:"Payout claimed."});await loadPosition();}catch(error){setNotice({kind:"error",text:error instanceof Error?error.message:"Claim failed."});}}
  return <main className="page market-detail"><Link className="back" to="/markets">← All markets</Link><div className="detail-head"><div><span className={`status ${status.replaceAll(" ","-").toLowerCase()}`}>{status}</span><span className="market-no">MARKET {String(market.id).padStart(3,"0")}</span><h1>{market.question}</h1><p>{market.description}</p></div><div className="close-card"><span>Closes</span><b>{new Date(market.closeTime*1000).toLocaleString()}</b><small>{market.feeBps/100}% protocol fee on losing pool</small></div></div>
    <div className="detail-grid"><section className="odds-panel"><div className="odds-head"><span>Consensus</span><b>{bot(total)} BOT volume</b></div><div className="giant-odds"><div><span>YES</span><b>{yes.toFixed(1)}%</b></div><div><span>NO</span><b>{(100-yes).toFixed(1)}%</b></div></div><div className="splitbar"><i style={{width:`${yes}%`}}/></div><div className="source"><span>RESOLUTION SOURCE</span><p>{market.source}</p>{market.evidence&&<small>Evidence: {market.evidence}</small>}</div></section>
      <aside className="trade-ticket"><div className="ticket-top"><span>POSITION TICKET</span><b>#{String(market.id).padStart(4,"0")}</b></div><div className="side-switch"><button className={side===1?"yes active":"yes"} onClick={()=>setSide(1)}>YES</button><button className={side===2?"no active":"no"} onClick={()=>setSide(2)}>NO</button></div><label>Stake amount</label><div className="amount"><input value={amount} onChange={(e)=>setAmount(e.target.value)} inputMode="decimal"/><span>BOT</span></div><div className="limits"><span>Min {bot(market.minStake)}</span><span>Max {bot(market.maxStake)}</span></div><button className="primary full" onClick={stake} disabled={status!=="LIVE"}>Take {side===1?"YES":"NO"} position</button>{position&&<div className="your-position"><span>Your position</span><b>{position.side===1?"YES":position.side===2?"NO":"—"} · {bot(position.amount)} BOT</b>{position.claimable>0n&&<button onClick={claim}>Claim {bot(position.claimable)} BOT</button>}</div>}<p className="ticket-note">Transactions use native BOT. Read the source and market terms before staking.</p></aside>
    </div><Footer /></main>;
}

function Leaderboard({ markets }: { markets: Market[] }) {
  const rows = [{name:"0x6A31…90F2",score:"842.60",rate:"71%"},{name:"0x19C0…A771",score:"526.18",rate:"64%"},{name:"0xE04B…11C9",score:"401.02",rate:"59%"}];
  return <main className="page"><div className="page-lead"><span className="eyebrow">SIGNAL BOARD</span><h1>Conviction,<br/>ranked.</h1><p>Illustrative ranking layout. A production indexer should aggregate claims and positions from your deployed contract events.</p></div><div className="leader-table"><div className="leader-head"><span>Rank / Wallet</span><span>Net result</span><span>Hit rate</span></div>{rows.map((r,i)=><div className="leader-row" key={r.name}><b>0{i+1}</b><strong>{r.name}</strong><span>+{r.score} BOT</span><em>{r.rate}</em></div>)}</div><div className="data-note">{markets[0]?.demo?"PREVIEW DATA — not an on-chain claim":"Event indexing activates after contract deployment."}</div><Footer /></main>;
}

function Admin({ markets, wallet, setNotice, reload }: { markets: Market[]; wallet: WalletState; setNotice(v: Notice): void; reload(): Promise<void> }) {
  const [form,setForm]=useState({question:"",description:"",source:"",hours:"6",min:"1",max:"250"});
  async function submit(e:FormEvent){e.preventDefault();if(!wallet.signer||!wallet.creator)return setNotice({kind:"error",text:"Connect an authorized creator wallet."});try{const close=Math.floor(Date.now()/1000)+Number(form.hours)*3600;setNotice({kind:"pending",text:"Confirm market creation…"});const tx=await writeContract(wallet.signer).createMarket(form.question,form.description,form.source,0,close,parseEther(form.min),parseEther(form.max));await tx.wait();setNotice({kind:"ok",text:"Market created on-chain."});setForm({...form,question:"",description:"",source:""});await reload();}catch(error){setNotice({kind:"error",text:error instanceof Error?error.message:"Creation failed."});}}
  async function resolveMarket(marketId:number,outcome:1|2|3){if(!wallet.signer||!wallet.resolver)return setNotice({kind:"error",text:"Connect an authorized resolver wallet."});const evidence=window.prompt("Paste the public evidence or result URL:");if(evidence===null)return;try{setNotice({kind:"pending",text:"Confirm resolution in your wallet…"});const tx=await writeContract(wallet.signer).resolve(marketId,outcome,evidence);await tx.wait();setNotice({kind:"ok",text:`Market #${marketId} resolved.`});await reload();}catch(error){setNotice({kind:"error",text:error instanceof Error?error.message:"Resolution failed."});}}
  const resolvable=markets.filter(m=>!m.demo&&marketStatus(m)==="AWAITING RESULT");
  return <main className="page"><div className="page-lead"><span className="eyebrow">CONTROL ROOM</span><h1>Open a new<br/>signal window.</h1><p>Only addresses approved by the contract owner can create markets. Resolution remains a separate authorized role.</p></div><form className="admin-form" onSubmit={submit}><label>Market question<input required minLength={8} value={form.question} onChange={e=>setForm({...form,question:e.target.value})} placeholder="Will … before …?"/></label><label>Description<textarea required value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label><label>Resolution source<input required value={form.source} onChange={e=>setForm({...form,source:e.target.value})} placeholder="Public URL or deterministic data source"/></label><div className="form-row"><label>Duration (hours)<input type="number" min="1" max="720" value={form.hours} onChange={e=>setForm({...form,hours:e.target.value})}/></label><label>Minimum BOT<input value={form.min} onChange={e=>setForm({...form,min:e.target.value})}/></label><label>Maximum BOT<input value={form.max} onChange={e=>setForm({...form,max:e.target.value})}/></label></div><button className="primary" disabled={!wallet.creator}>Create market</button>{!wallet.address?<small>Connect a wallet to check permissions.</small>:!wallet.creator?<small>This wallet is not an authorized creator.</small>:<small>Authorized creator connected.</small>}</form><section className="resolution-desk"><div className="section-title"><div><span>05</span><h2>Resolution queue</h2></div></div>{resolvable.length?resolvable.map(m=><div className="resolve-row" key={m.id}><div><span>MARKET {String(m.id).padStart(3,"0")}</span><b>{m.question}</b></div><div><button onClick={()=>void resolveMarket(m.id,1)}>Resolve YES</button><button onClick={()=>void resolveMarket(m.id,2)}>Resolve NO</button><button onClick={()=>void resolveMarket(m.id,3)}>Void</button></div></div>):<p className="empty">No markets currently awaiting resolution.</p>}</section><Footer /></main>;
}

function MarketCard({market}:{market:Market}){const total=market.totalYes+market.totalNo;const yes=total?Number(market.totalYes*100n/total):50;return <Link className="market-card" to={`/markets/${market.id}`}><div className="card-top"><span className="market-no">#{String(market.id).padStart(3,"0")}</span><span className="status">{marketStatus(market)}</span></div><h3>{market.question}</h3><div className="micro-odds"><span><b>{yes}%</b> YES</span><span><b>{100-yes}%</b> NO</span></div><div className="splitbar"><i style={{width:`${yes}%`}}/></div><div className="card-foot"><span>{bot(total)} BOT</span><span>{new Date(market.closeTime*1000).toLocaleDateString()}</span></div></Link>}
function MarketRow({market}:{market:Market}){const total=market.totalYes+market.totalNo;const yes=total?Number(market.totalYes*100n/total):50;return <Link className="market-row" to={`/markets/${market.id}`}><span className="market-no">{String(market.id).padStart(3,"0")}</span><div><span className="status">{marketStatus(market)}</span><h3>{market.question}</h3><small>{market.source}</small></div><div className="row-odds"><b>{yes}%</b><span>YES</span></div><div className="row-odds no"><b>{100-yes}%</b><span>NO</span></div><div className="row-volume"><b>{bot(total)}</b><span>BOT</span></div><span className="arrow">↗</span></Link>}
function Metric({n,label}:{n:string;label:string}){return <div><b>{n}</b><span>{label}</span></div>}
function SectionTitle({no,title,link}:{no:string;title:string;link:string}){return <div className="section-title"><div><span>{no}</span><h2>{title}</h2></div><Link to={link}>VIEW INDEX →</Link></div>}
function Loading(){return <div className="loading"><i/><span>Reading BOT Chain…</span></div>}
function Footer(){return <footer><div className="wordmark"><span className="pulse-logo">P</span><span>PULSELINE</span></div><p>Binary prediction markets for BOT Chain.<br/>Transparent rules. On-chain settlement.</p><div><a href={BOT_CHAIN.explorer} target="_blank" rel="noreferrer">Explorer ↗</a><a href="https://dev-docs.botchain.ai/docs/Developers/quick-guide/" target="_blank" rel="noreferrer">BOT Docs ↗</a></div></footer>}
