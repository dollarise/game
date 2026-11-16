import { useEffect, useMemo, useState } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  Activity, ArrowUpRight, BookmarkPlus, Check, ChevronDown, Clock3,
  ExternalLink, Globe2, HardDrive, LoaderCircle, Maximize2, Menu,
  MonitorPlay, MoreHorizontal, Plus, RefreshCw, Search, Settings2,
  ShieldCheck, Trash2, X
} from 'lucide-react';

type Section = 'record' | 'data';
type SavedRecord = { id: string; title: string; url: string; recorded_at: string };

const DEFAULT_URL = 'https://1xlite-6487.com/';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const db: SupabaseClient | null = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

function validUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch { return false; }
}

export default function App() {
  const [section, setSection] = useState<Section>('record');
  const [targetUrl, setTargetUrl] = useState(DEFAULT_URL);
  const [urlDraft, setUrlDraft] = useState(DEFAULT_URL);
  const [records, setRecords] = useState<SavedRecord[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      const localUrl = localStorage.getItem('game.targetUrl');
      if (localUrl && validUrl(localUrl) && active) {
        setTargetUrl(localUrl); setUrlDraft(localUrl);
      }
      if (db) {
        const [{ data: setting }, { data: rows }] = await Promise.all([
          db.from('game_settings').select('target_url').eq('id', 1).maybeSingle(),
          db.from('game_records').select('id,title,url,recorded_at').order('recorded_at', { ascending: false }).limit(250),
        ]);
        if (!active) return;
        if (setting?.target_url && validUrl(setting.target_url)) {
          setTargetUrl(setting.target_url); setUrlDraft(setting.target_url);
          localStorage.setItem('game.targetUrl', setting.target_url);
        }
        if (rows) setRecords(rows as SavedRecord[]);
        else setRecords(readLocalRecords());
      } else if (active) setRecords(readLocalRecords());
      if (active) setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, []);

  const filteredRecords = useMemo(() => records.filter((item) =>
    (item.title + ' ' + item.url).toLowerCase().includes(search.toLowerCase())
  ), [records, search]);

  function readLocalRecords(): SavedRecord[] {
    try { return JSON.parse(localStorage.getItem('game.records') || '[]') as SavedRecord[]; }
    catch { return []; }
  }

  function ping(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2800);
  }

  async function saveSettings() {
    if (!validUrl(urlDraft.trim())) { ping('Masukkan alamat website yang valid (http/https).'); return; }
    setSaving(true);
    const next = new URL(urlDraft.trim()).toString();
    localStorage.setItem('game.targetUrl', next);
    if (db) {
      const { error } = await db.from('game_settings').upsert({ id: 1, target_url: next, updated_at: new Date().toISOString() });
      if (error) { setSaving(false); ping('Gagal menyimpan ke database: ' + error.message); return; }
    }
    setTargetUrl(next); setUrlDraft(next); setSaving(false); setSettingsOpen(false);
    ping('Alamat website berhasil disimpan.');
  }

  async function saveRecord() {
    const record = { title: new URL(targetUrl).hostname, url: targetUrl, recorded_at: new Date().toISOString() };
    if (db) {
      const { data, error } = await db.from('game_records').insert(record).select('id,title,url,recorded_at').single();
      if (error) { ping('Gagal menyimpan data: ' + error.message); return; }
      setRecords((old) => [data as SavedRecord, ...old]);
    } else {
      const local: SavedRecord = { ...record, id: crypto.randomUUID() };
      const next = [local, ...readLocalRecords()];
      localStorage.setItem('game.records', JSON.stringify(next)); setRecords(next);
    }
    ping('Alamat website berhasil direkam ke Buka Data.');
  }

  async function deleteRecord(id: string) {
    if (db) {
      const { error } = await db.from('game_records').delete().eq('id', id);
      if (error) { ping('Gagal menghapus: ' + error.message); return; }
    }
    const next = records.filter((item) => item.id !== id);
    setRecords(next);
    if (!db) localStorage.setItem('game.records', JSON.stringify(next));
  }

  function openTarget() { window.open(targetUrl, '_blank', 'noopener,noreferrer'); }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand"><div className="brand-mark"><Globe2 size={21} /></div><div><b>GAME</b><span>WEB WORKSPACE</span></div><button className="mobile-close icon-button" onClick={() => setMobileNav(false)} aria-label="Tutup menu"><X size={18}/></button></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav">
          <button className={section === 'record' ? 'nav-item active' : 'nav-item'} onClick={() => { setSection('record'); setMobileNav(false); }}><MonitorPlay size={18}/><span>Rekam</span>{section === 'record' && <span className="nav-dot"/>}</button>
          <button className={section === 'data' ? 'nav-item active' : 'nav-item'} onClick={() => { setSection('data'); setMobileNav(false); }}><HardDrive size={18}/><span>Buka Data</span>{records.length > 0 && <small>{records.length}</small>}</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="secure-card"><div className="secure-icon"><ShieldCheck size={17}/></div><div><b>Workspace pribadi</b><span>Pengaturan website terpusat</span></div></div>
          <button className="settings-link" onClick={() => { setUrlDraft(targetUrl); setSettingsOpen(true); }}><Settings2 size={17}/> Pengaturan <ChevronDown size={15}/></button>
          <div className="sidebar-foot"><span className="status-dot"/>{db ? 'Supabase terhubung' : 'Mode penyimpanan lokal'}<span className="version">v1.0.0</span></div>
        </div>
      </aside>
      {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Tutup navigasi"/>}
      <main className="main-area">
        <header className="topbar">
          <div className="top-left"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Buka menu"><Menu size={20}/></button><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><b>{section === 'record' ? 'Rekam' : 'Buka Data'}</b></div></div>
          <div className="top-actions"><div className="connection"><span className="status-dot"/>{db ? 'Database aktif' : 'Lokal'}</div><button className="icon-button" onClick={() => { setUrlDraft(targetUrl); setSettingsOpen(true); }} aria-label="Pengaturan"><Settings2 size={18}/></button><div className="avatar">G</div></div>
        </header>
        <div className="content">
          {section === 'record' ? (
            <>
              <div className="page-heading"><div><div className="eyebrow"><Activity size={14}/> BROWSER SESSION</div><h1>Rekam Website</h1><p>Buka website tujuan dan simpan alamatnya ke daftar data.</p></div><button className="button button-secondary" onClick={() => { setUrlDraft(targetUrl); setSettingsOpen(true); }}><Settings2 size={16}/> Pengaturan Website</button></div>
              <div className="site-toolbar"><div className="site-identity"><div className="site-icon"><Globe2 size={18}/></div><div><b>{new URL(targetUrl).hostname}</b><span>{targetUrl}</span></div></div><div className="toolbar-actions"><button className="icon-button" title="Muat ulang" onClick={() => window.dispatchEvent(new Event('game-reload-frame'))}><RefreshCw size={17}/></button><button className="button button-secondary" onClick={openTarget}><ExternalLink size={15}/> Buka Tab Baru</button><button className="button button-primary" onClick={saveRecord}><BookmarkPlus size={16}/> Rekam Alamat</button></div></div>
              <BrowserFrame url={targetUrl} onOpen={openTarget}/>
              <div className="under-browser"><span><span className="status-dot"/> Alamat aktif</span><span>Website tertentu mungkin membatasi tampilan di dalam aplikasi.</span></div>
            </>
          ) : (
            <>
              <div className="page-heading"><div><div className="eyebrow"><HardDrive size={14}/> DATA CENTER</div><h1>Buka Data</h1><p>Daftar alamat website yang pernah Anda rekam.</p></div><button className="button button-primary" onClick={() => setSection('record')}><Plus size={16}/> Rekam Baru</button></div>
              <div className="data-summary"><div className="summary-icon"><BookmarkPlus size={19}/></div><div><span>Total data tersimpan</span><b>{records.length} <small>alamat</small></b></div><div className="summary-divider"/><div className="summary-meta"><span>Terakhir diperbarui</span><b>{records[0] ? new Date(records[0].recorded_at).toLocaleString('id-ID') : 'Belum ada data'}</b></div></div>
              <div className="data-panel"><div className="panel-heading"><div><h2>Data Terekam</h2><span>Semua alamat website yang tersimpan</span></div><div className="search-box"><Search size={16}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari data..."/></div></div>
                {loading ? <div className="empty-state"><LoaderCircle className="spin" size={25}/><span>Memuat data...</span></div> : filteredRecords.length === 0 ? <div className="empty-state"><div className="empty-icon"><HardDrive size={23}/></div><b>{search ? 'Data tidak ditemukan' : 'Belum ada data terekam'}</b><span>{search ? 'Coba kata kunci lain.' : 'Buka menu Rekam untuk mulai menyimpan alamat website.'}</span>{!search && <button className="button button-primary" onClick={() => setSection('record')}>Mulai Rekam</button>}</div> :
                <div className="record-list">{filteredRecords.map((item) => <div className="record-row" key={item.id}><div className="record-site-icon"><Globe2 size={18}/></div><div className="record-main"><b>{item.title}</b><a href={item.url} target="_blank" rel="noreferrer">{item.url}</a></div><div className="record-time"><Clock3 size={14}/>{new Date(item.recorded_at).toLocaleString('id-ID')}</div><button className="icon-button" onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')} title="Buka website"><ArrowUpRight size={17}/></button><button className="icon-button danger-hover" onClick={() => void deleteRecord(item.id)} title="Hapus data"><Trash2 size={16}/></button></div>)}</div>}
              </div>
            </>
          )}
        </div>
      </main>
      {settingsOpen && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}><section className="settings-modal"><div className="modal-head"><div><div className="eyebrow">KONFIGURASI</div><h2>Pengaturan Website</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Tutup"><X size={19}/></button></div><p className="modal-copy">Tentukan alamat website yang akan dibuka pada menu Rekam.</p><label className="field-label" htmlFor="target-url">URL Website Tujuan</label><input id="target-url" className="url-input" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="https://contoh.com" onKeyDown={(e) => { if (e.key === 'Enter') void saveSettings(); }}/><div className="field-hint"><ShieldCheck size={14}/> Gunakan alamat lengkap dengan https:// atau http://</div><div className="modal-actions"><button className="button button-secondary" onClick={() => setSettingsOpen(false)}>Batal</button><button className="button button-primary" onClick={() => void saveSettings()} disabled={saving}>{saving ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>} Simpan Pengaturan</button></div></section></div>}
      {notice && <div className="toast"><Check size={16}/>{notice}</div>}
    </div>
  );
}

function BrowserFrame({ url, onOpen }: { url: string; onOpen: () => void }) {
  const [blocked, setBlocked] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const reload = () => setReloadKey((v) => v + 1);
    window.addEventListener('game-reload-frame', reload);
    return () => window.removeEventListener('game-reload-frame', reload);
  }, [url]);
  useEffect(() => setBlocked(false), [url]);
  return <div className="browser-shell"><div className="browser-chrome"><div className="window-dots"><i/><i/><i/></div><div className="address-pill"><ShieldCheck size={13}/><span>{url}</span></div><button className="icon-button browser-open" onClick={onOpen} aria-label="Buka di tab baru"><Maximize2 size={15}/></button></div><div className="browser-viewport"><iframe key={reloadKey} title="Website tujuan" src={url} onError={() => setBlocked(true)} allow="clipboard-read; clipboard-write; fullscreen" referrerPolicy="strict-origin-when-cross-origin"/>{blocked && <div className="frame-blocked"><div className="blocked-icon"><ExternalLink size={24}/></div><h3>Website tidak dapat ditampilkan di sini</h3><p>Website tujuan mungkin melarang pemuatan melalui iframe. Buka website langsung di tab browser untuk melanjutkan.</p><button className="button button-primary" onClick={onOpen}><ExternalLink size={16}/> Buka Website</button></div>}</div></div>;
}
