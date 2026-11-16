import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  Activity, ArrowUpRight, BookmarkPlus, Check, ChevronDown, Clock3,
  ExternalLink, Globe2, HardDrive, LoaderCircle, Maximize2, Menu,
  LogOut, MonitorPlay, Plus, RefreshCw, Search, Settings2,
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
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
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
    if (!db) { setAuthReady(true); setLoading(false); return; }
    let active = true;
    db.auth.getSession().then(({ data }) => {
      if (active) { setSession(data.session); setAuthReady(true); }
    });
    const { data: listener } = db.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session || !db) { setRecords([]); setLoading(false); return; }
    let active = true;
    async function loadUserData() {
      setLoading(true);
      const [{ data: setting, error: settingError }, { data: rows, error: rowsError }] = await Promise.all([
        db!.from('game_settings').select('target_url').eq('user_id', session!.user.id).maybeSingle(),
        db!.from('game_records').select('id,title,url,recorded_at').eq('user_id', session!.user.id).order('recorded_at', { ascending: false }).limit(250),
      ]);
      if (!active) return;
      if (settingError || rowsError) ping('Gagal memuat data akun: ' + (settingError?.message || rowsError?.message));
      if (setting?.target_url && validUrl(setting.target_url)) {
        setTargetUrl(setting.target_url); setUrlDraft(setting.target_url);
      } else {
        const initial = { user_id: session!.user.id, target_url: DEFAULT_URL };
        const { error } = await db!.from('game_settings').upsert(initial, { onConflict: 'user_id' });
        if (error) ping('Gagal membuat pengaturan akun: ' + error.message);
        setTargetUrl(DEFAULT_URL); setUrlDraft(DEFAULT_URL);
      }
      setRecords((rows || []) as SavedRecord[]);
      setLoading(false);
    }
    void loadUserData();
    return () => { active = false; };
  }, [session?.user.id]);

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
      const { error } = await db.from('game_settings').upsert({ user_id: session!.user.id, target_url: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) { setSaving(false); ping('Gagal menyimpan ke database: ' + error.message); return; }
    }
    setTargetUrl(next); setUrlDraft(next); setSaving(false); setSettingsOpen(false);
    ping('Alamat website berhasil disimpan.');
  }

  async function saveRecord() {
    const record = { user_id: session!.user.id, title: new URL(targetUrl).hostname, url: targetUrl, recorded_at: new Date().toISOString() };
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

  async function signOut() {
    if (!db) return;
    const { error } = await db.auth.signOut();
    if (error) ping('Gagal keluar: ' + error.message);
  }

  if (!authReady) return <div className="auth-loading"><LoaderCircle className="spin" size={26}/> Memeriksa sesi login...</div>;
  if (!session || !db) return <AuthScreen db={db} />;

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
          <div className="secure-card"><div className="secure-icon"><ShieldCheck size={17}/></div><div><b>Workspace browser</b><span>Konfigurasi website terpusat</span></div></div>
          <button className="settings-link" onClick={() => { setUrlDraft(targetUrl); setSettingsOpen(true); }}><Settings2 size={17}/> Pengaturan <ChevronDown size={15}/></button>
          <div className="sidebar-foot"><span className="status-dot"/>{db ? 'Supabase terhubung' : 'Mode penyimpanan lokal'}<span className="version">v1.0.0</span></div>
        </div>
      </aside>
      {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Tutup navigasi"/>}
      <main className="main-area">
        <header className="topbar">
          <div className="top-left"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Buka menu"><Menu size={20}/></button><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><b>{section === 'record' ? 'Rekam' : 'Buka Data'}</b></div></div>
          <div className="top-actions"><div className="connection"><span className="status-dot"/>{db ? 'Database aktif' : 'Lokal'}</div><button className="icon-button" onClick={() => { setUrlDraft(targetUrl); setSettingsOpen(true); }} aria-label="Pengaturan"><Settings2 size={18}/></button><button className="icon-button" onClick={() => void signOut()} title="Keluar dari aplikasi" aria-label="Keluar"><LogOut size={17}/></button><div className="avatar">{(session.user.email || "U").charAt(0).toUpperCase()}</div></div>
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


function AuthScreen({ db }: { db: SupabaseClient | null }) {
  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit() {
    setError(''); setMessage('');
    if (!db) { setError('Koneksi Supabase belum dikonfigurasi.'); return; }
    if (!email.trim()) { setError('Masukkan alamat email.'); return; }
    if (mode === 'login' && password.length < 6) { setError('Kata sandi minimal 6 karakter.'); return; }
    setBusy(true);
    if (mode === 'login') {
      const { error: authError } = await db.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) setError(authError.message);
    } else {
      const { error: authError } = await db.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (authError) setError(authError.message);
      else setMessage('Jika email terdaftar, tautan pemulihan kata sandi akan dikirim ke inbox Anda.');
    }
    setBusy(false);
  }

  const title = mode === 'login' ? 'Masuk ke akun' : 'Reset kata sandi';
  return <div className="auth-page">
    <div className="auth-card">
      <div className="auth-brand"><div className="brand-mark"><Globe2 size={23}/></div><div><b>GAME</b><span>WEB WORKSPACE</span></div></div>
      <div className="eyebrow"><ShieldCheck size={14}/> AREA AKUN</div>
      <h1>{title}</h1>
      <p className="auth-subtitle">{mode === 'login' ? 'Masuk menggunakan akun yang dibuat oleh Super Admin.' : 'Masukkan email akun untuk menerima tautan pemulihan.'}</p>
      <label className="field-label" htmlFor="auth-email">Email</label>
      <input id="auth-email" className="url-input auth-input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nama@email.com" onKeyDown={e => { if(e.key === 'Enter') void submit(); }}/>
      {mode === 'login' && <><label className="field-label" htmlFor="auth-password">Kata sandi</label><input id="auth-password" className="url-input auth-input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Masukkan kata sandi" onKeyDown={e => { if(e.key === 'Enter') void submit(); }}/></>}
      {error && <div className="auth-error">{error}</div>}
      {message && <div className="auth-message">{message}</div>}
      <button className="button button-primary auth-submit" onClick={() => void submit()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : null}{mode === 'login' ? 'Masuk' : 'Kirim Tautan Reset'}</button>
      <div className="auth-links">
        {mode === 'login' && <button onClick={() => {setMode('reset');setError('');setMessage('');}}>Lupa kata sandi?</button>}
        {mode === 'reset' && <button onClick={() => {setMode('login');setError('');setMessage('');}}>Kembali ke halaman masuk</button>}
      </div>
      <div className="auth-private"><ShieldCheck size={14}/> Akun dibuat dan dikelola oleh Super Admin. Setiap akun hanya dapat mengakses data miliknya sendiri.</div>
    </div>
  </div>;
}
