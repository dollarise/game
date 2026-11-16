import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, BookmarkPlus, Check, ChevronDown, Clock3,
  Globe2, HardDrive, LoaderCircle, Menu,
  LogOut, MonitorPlay, Plus, RefreshCw, Search, Settings2,
  ShieldCheck, Trash2, X, Users, UserPlus, Shield
} from 'lucide-react';

type Section = 'browser' | 'data' | 'admin';
type SavedRecord = { id: string; title: string; url: string; recorded_at: string };

const DEFAULT_URL = 'https://1xlite-6487.com/';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
// Supabase Auth is the source of truth for accounts and sessions.
// Keep the SDK's default storage key stable so existing signed-in users
// remain signed in after an application upgrade.
const db: SupabaseClient | null = supabaseUrl && supabaseKey
 ? createClient(supabaseUrl, supabaseKey, {
     auth: {
       persistSession: true,
       autoRefreshToken: true,
       detectSessionInUrl: true,
     },
   })
 : null;

function validUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch { return false; }
}

export default function App() {
  const [section, setSection] = useState<Section>('browser');
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
  const isSuperAdmin = session?.user.app_metadata?.role === 'super_admin';

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

  function ping(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2800);
  }

  async function saveSettings() {
    if (!validUrl(urlDraft.trim())) { ping('Masukkan alamat website yang valid (http/https).'); return; }
    setSaving(true);
    const next = new URL(urlDraft.trim()).toString();
    if (db) {
      const { error } = await db.from('game_settings').upsert({ user_id: session!.user.id, target_url: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) { setSaving(false); ping('Gagal menyimpan ke database: ' + error.message); return; }
    }
    setTargetUrl(next); setUrlDraft(next); setSaving(false); setSettingsOpen(false);
    ping('Alamat website berhasil disimpan.');
  }

  async function deleteRecord(id: string) {
    if (db) {
      const { error } = await db.from('game_records').delete().eq('id', id);
      if (error) { ping('Gagal menghapus: ' + error.message); return; }
    }
    const next = records.filter((item) => item.id !== id);
    setRecords(next);
  }



  async function navigateTarget(nextUrl: string) {
    setTargetUrl(nextUrl);
    setUrlDraft(nextUrl);
    if (db) {
      const { error } = await db.from('game_settings').upsert({ user_id: session!.user.id, target_url: nextUrl, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) ping('Alamat berubah di browser, tetapi gagal disimpan: ' + error.message);
    }
  }

  async function saveRecordForUrl(url: string, showNotice = true) {
    if (!validUrl(url)) return;
    const normalizedUrl = new URL(url).toString();
    const record = { user_id: session!.user.id, title: new URL(normalizedUrl).hostname, url: normalizedUrl, recorded_at: new Date().toISOString() };
    if (!db) return;
    const { data, error } = await db.from('game_records').insert(record).select('id,title,url,recorded_at').single();
    if (error) { if (showNotice) ping('Gagal menyimpan data: ' + error.message); return; }
    setRecords((old) => [data as SavedRecord, ...old]);
    if (showNotice) ping('Alamat berhasil disimpan ke Buka Data.');
  }

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
          <button className={section === 'browser' ? 'nav-item active' : 'nav-item'} onClick={() => { setSection('browser'); setMobileNav(false); }}><MonitorPlay size={18}/><span>Rekam</span>{section === 'browser' && <span className="nav-dot"/>}</button>
          <button className={section === 'data' ? 'nav-item active' : 'nav-item'} onClick={() => { setSection('data'); setMobileNav(false); }}><HardDrive size={18}/><span>Buka Data</span>{records.length > 0 && <small>{records.length}</small>}</button>
          {isSuperAdmin && <button className={section === 'admin' ? 'nav-item active' : 'nav-item'} onClick={() => { setSection('admin'); setMobileNav(false); }}><Users size={18}/><span>Manajemen Pengguna</span>{section === 'admin' && <span className="nav-dot"/>}</button>}
        </nav>
        <div className="sidebar-bottom">
          <div className="secure-card"><div className="secure-icon"><ShieldCheck size={17}/></div><div><b>Workspace browser</b><span>Konfigurasi website terpusat</span></div></div>
          <button className="settings-link" onClick={() => { setUrlDraft(targetUrl); setSettingsOpen(true); }}><Settings2 size={17}/> Pengaturan <ChevronDown size={15}/></button>
          <div className="sidebar-foot"><span className="status-dot"/>{db ? 'Supabase terhubung' : 'Mode penyimpanan lokal'}<span className="version">v1.1.5</span></div>
        </div>
      </aside>
      {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Tutup navigasi"/>}
      <main className="main-area">
        <header className="topbar">
          <div className="top-left"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Buka menu"><Menu size={20}/></button><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><b>{section === 'browser' ? 'Browser' : section === 'data' ? 'Buka Data' : 'Manajemen Pengguna'}</b></div></div>
          <div className="top-actions"><div className="connection"><span className="status-dot"/>{db ? 'Database aktif' : 'Lokal'}</div><button className="icon-button" onClick={() => { setUrlDraft(targetUrl); setSettingsOpen(true); }} aria-label="Pengaturan"><Settings2 size={18}/></button><button className="icon-button" onClick={() => void signOut()} title="Keluar dari aplikasi" aria-label="Keluar"><LogOut size={17}/></button><div className="avatar">{(session.user.email || "U").charAt(0).toUpperCase()}</div></div>
        </header>
        <div className="content">
          {section === 'browser' ? (
            <BrowserFrame url={targetUrl} onNavigate={navigateTarget} onSave={saveRecordForUrl} onAutoRecord={(url) => saveRecordForUrl(url, false)} suspend={settingsOpen}/>
          ) : section === 'data' ? (
            <>
              <div className="page-heading"><div><div className="eyebrow"><HardDrive size={14}/> DATA CENTER</div><h1>Buka Data</h1><p>Daftar alamat website yang pernah Anda rekam.</p></div><button className="button button-primary" onClick={() => { setSection('browser'); setMobileNav(false); }}><Plus size={16}/> Buka Website</button></div>
              <div className="data-summary"><div className="summary-icon"><BookmarkPlus size={19}/></div><div><span>Total data tersimpan</span><b>{records.length} <small>alamat</small></b></div><div className="summary-divider"/><div className="summary-meta"><span>Terakhir diperbarui</span><b>{records[0] ? new Date(records[0].recorded_at).toLocaleString('id-ID') : 'Belum ada data'}</b></div></div>
              <div className="data-panel"><div className="panel-heading"><div><h2>Data Terekam</h2><span>Semua alamat website yang tersimpan</span></div><div className="search-box"><Search size={16}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari data..."/></div></div>
                {loading ? <div className="empty-state"><LoaderCircle className="spin" size={25}/><span>Memuat data...</span></div> : filteredRecords.length === 0 ? <div className="empty-state"><div className="empty-icon"><HardDrive size={23}/></div><b>{search ? 'Data tidak ditemukan' : 'Belum ada data terekam'}</b><span>{search ? 'Coba kata kunci lain.' : 'Klik menu Rekam untuk membuka website tujuan.'}</span>{!search && <button className="button button-primary" onClick={() => { setSection('browser'); setMobileNav(false); }}>Buka Website</button>}</div> :
                <div className="record-list">{filteredRecords.map((item) => <div className="record-row" key={item.id}><div className="record-site-icon"><Globe2 size={18}/></div><div className="record-main"><b>{item.title}</b><a href={item.url} onClick={(event) => { event.preventDefault(); setSection('browser'); void navigateTarget(item.url); }}>{item.url}</a></div><div className="record-time"><Clock3 size={14}/>{new Date(item.recorded_at).toLocaleString('id-ID')}</div><button className="icon-button" onClick={() => { setSection('browser'); void navigateTarget(item.url); }} title="Buka website di GAME"><ArrowUpRight size={17}/></button><button className="icon-button danger-hover" onClick={() => void deleteRecord(item.id)} title="Hapus data"><Trash2 size={16}/></button></div>)}</div>}
              </div>
            </>
          ) : isSuperAdmin ? <AdminPanel db={db} session={session} ping={ping} /> : <div className="empty-state"><Shield size={24}/><b>Akses ditolak</b><span>Menu ini hanya tersedia untuk Super Admin.</span></div>}
        </div>
      </main>
      {settingsOpen && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}><section className="settings-modal"><div className="modal-head"><div><div className="eyebrow">KONFIGURASI</div><h2>Pengaturan Website</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Tutup"><X size={19}/></button></div><p className="modal-copy">Tentukan alamat website yang akan dibuka pada menu Rekam.</p><label className="field-label" htmlFor="target-url">URL Website Tujuan</label><input id="target-url" className="url-input" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="https://contoh.com" onKeyDown={(e) => { if (e.key === 'Enter') void saveSettings(); }}/><div className="field-hint"><ShieldCheck size={14}/> Gunakan alamat lengkap dengan https:// atau http://</div><div className="modal-actions"><button className="button button-secondary" onClick={() => setSettingsOpen(false)}>Batal</button><button className="button button-primary" onClick={() => void saveSettings()} disabled={saving}>{saving ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>} Simpan Pengaturan</button></div></section></div>}
      {notice && <div className="toast"><Check size={16}/>{notice}</div>}
    </div>
  );
}


type ManagedUser = {
  id: string; email?: string; role: 'user' | 'super_admin';
  created_at: string; email_confirmed_at?: string | null;
  banned_until?: string | null; last_sign_in_at?: string | null;
};

function AdminPanel({ db, session, ping }: { db: SupabaseClient; session: Session; ping: (message: string) => void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'super_admin'>('user');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');

  async function adminAction(payload: Record<string, unknown>) {
    const { data, error: invokeError } = await db.functions.invoke('game-user-admin', { body: payload });
    if (invokeError) throw new Error(invokeError.message);
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function loadUsers() {
    setBusy(true); setError('');
    try {
      const data = await adminAction({ action: 'list' });
      setUsers((data.users || []) as ManagedUser[]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal memuat pengguna.'); }
    finally { setBusy(false); }
  }

  useEffect(() => { void loadUsers(); }, []);

  async function createUser() {
    setError('');
    if (!email.trim() || password.length < 8) { setError('Isi email dan kata sandi minimal 8 karakter.'); return; }
    setBusy(true);
    try {
      await adminAction({ action: 'create', email: email.trim(), password, role });
      setEmail(''); setPassword(''); setRole('user'); setShowCreate(false);
      await loadUsers(); ping('Akun pengguna berhasil dibuat dan email otomatis dikonfirmasi.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Gagal membuat akun.'); }
    finally { setBusy(false); }
  }

  async function changeRole(user: ManagedUser, nextRole: 'user' | 'super_admin') {
    if (user.role === nextRole) return;
    if (!window.confirm(`Ubah peran ${user.email} menjadi ${nextRole === 'super_admin' ? 'Super Admin' : 'Pengguna'}?`)) return;
    setBusy(true);
    try { await adminAction({ action: 'set_role', userId: user.id, role: nextRole }); await loadUsers(); ping('Peran pengguna berhasil diperbarui.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Gagal mengubah peran.'); }
    finally { setBusy(false); }
  }

  async function changeStatus(user: ManagedUser, active: boolean) {
    if (!window.confirm(`${active ? 'Aktifkan' : 'Nonaktifkan'} akun ${user.email}?`)) return;
    setBusy(true);
    try { await adminAction({ action: 'set_active', userId: user.id, active }); await loadUsers(); ping(`Akun berhasil ${active ? 'diaktifkan' : 'dinonaktifkan'}.`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Gagal mengubah status akun.'); }
    finally { setBusy(false); }
  }

  const visibleUsers = users.filter(u => (u.email || '').toLowerCase().includes(filter.toLowerCase()));
  return <section className="admin-users">
    <div className="page-heading"><div><div className="eyebrow"><Shield size={14}/> ADMINISTRATOR</div><h1>Manajemen Pengguna</h1><p>Buat akun, atur peran, dan aktifkan atau nonaktifkan akses pengguna.</p></div><button className="button button-primary" onClick={() => { setShowCreate(v => !v); setError(''); }}><UserPlus size={16}/>{showCreate ? 'Tutup Form' : 'Tambah Pengguna'}</button></div>
    {showCreate && <div className="data-panel admin-create"><div className="panel-heading"><div><h2>Buat Akun Baru</h2><span>Email akan langsung dikonfirmasi. Pengguna tidak perlu mendaftar sendiri.</span></div></div><div className="admin-form-grid"><div><label className="field-label">Email</label><input className="url-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="pengguna@email.com"/></div><div><label className="field-label">Kata sandi sementara</label><input className="url-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimal 8 karakter"/></div><div><label className="field-label">Peran</label><select className="url-input" value={role} onChange={e => setRole(e.target.value as 'user' | 'super_admin')}><option value="user">Pengguna</option><option value="super_admin">Super Admin</option></select></div><div className="admin-form-action"><button className="button button-primary" onClick={() => void createUser()} disabled={busy}><UserPlus size={15}/> Buat Akun</button></div></div></div>}
    {error && <div className="auth-error admin-error">{error}</div>}
    <div className="data-panel"><div className="panel-heading"><div><h2>Daftar Akun</h2><span>{users.length} akun terdaftar</span></div><div className="admin-tools"><div className="search-box"><Search size={16}/><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Cari email..."/></div><button className="icon-button" onClick={() => void loadUsers()} title="Muat ulang" disabled={busy}><RefreshCw size={17}/></button></div></div>
    {busy && users.length === 0 ? <div className="empty-state"><LoaderCircle className="spin" size={24}/><span>Memuat akun...</span></div> : visibleUsers.length === 0 ? <div className="empty-state"><Users size={24}/><b>Tidak ada akun</b><span>Belum ada pengguna yang cocok dengan pencarian.</span></div> :
      <div className="admin-user-list">{visibleUsers.map(user => {
        const active = !user.banned_until || new Date(user.banned_until).getTime() < Date.now();
        return <div className="admin-user-row" key={user.id}><div className="admin-user-avatar">{(user.email || 'U').charAt(0).toUpperCase()}</div><div className="admin-user-main"><b>{user.email || 'Tanpa email'} {user.id === session.user.id && <small>(Anda)</small>}</b><span>Dibuat {new Date(user.created_at).toLocaleDateString('id-ID')} · {user.email_confirmed_at ? 'Email terverifikasi' : 'Email belum terverifikasi'}</span></div><span className={active ? 'admin-status active' : 'admin-status inactive'}>{active ? 'Aktif' : 'Nonaktif'}</span><select className="admin-role-select" value={user.role} onChange={e => void changeRole(user, e.target.value as 'user' | 'super_admin')} disabled={busy || user.id === session.user.id}><option value="user">Pengguna</option><option value="super_admin">Super Admin</option></select><button className={active ? 'button button-secondary admin-toggle' : 'button button-primary admin-toggle'} onClick={() => void changeStatus(user, !active)} disabled={busy || user.id === session.user.id}>{active ? 'Nonaktifkan' : 'Aktifkan'}</button></div>;
      })}</div>}
    </div>
    <p className="admin-footnote"><ShieldCheck size={14}/> Pengelolaan akun dilindungi pemeriksaan peran di server. Setiap akun tetap hanya dapat mengakses data miliknya sendiri.</p>
  </section>;
}

function BrowserFrame({ url, onNavigate, onSave, onAutoRecord, suspend }: { url: string; onNavigate: (url: string) => void; onSave: (url: string) => void; onAutoRecord: (url: string) => void; suspend: boolean }) {
  const desktop = isTauri();
  const [address, setAddress] = useState(url);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [reloadKey, setReloadKey] = useState(0);
  const [history, setHistory] = useState<string[]>([url]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [nativeReady, setNativeReady] = useState(false);
  const [nativeError, setNativeError] = useState('');
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastPropUrl = useRef(url);
  const lastAutoRecordedUrl = useRef('');

  useEffect(() => {
    if (url !== lastPropUrl.current) {
      lastPropUrl.current = url;
      setAddress(url);
      setCurrentUrl(url);
      setHistory([url]);
      setHistoryIndex(0);
      if (desktop) {
        void invoke('browser_navigate', { url }).catch((error) => setNativeError(String(error)));
      }
    }
  }, [url, desktop]);

  useEffect(() => {
    if (!desktop) return;
    if (suspend) {
      void invoke('browser_set_visible', { visible: false }).catch((error) => setNativeError(String(error)));
    } else {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect && rect.width > 1 && rect.height > 1) {
        void invoke('browser_set_bounds', {
          x: Math.max(0, rect.left), y: Math.max(0, rect.top),
          width: rect.width, height: rect.height,
        }).catch((error) => setNativeError(String(error)));
      }
    }
  }, [desktop, suspend]);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<string>('browser-url-changed', (event) => {
      if (!validUrl(event.payload)) return;
      const nextUrl = new URL(event.payload).toString();
      setAddress(nextUrl);
      setCurrentUrl(nextUrl);
      lastPropUrl.current = nextUrl;
      onNavigate(nextUrl);
      if (lastAutoRecordedUrl.current !== nextUrl) {
        lastAutoRecordedUrl.current = nextUrl;
        onAutoRecord(nextUrl);
      }
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;

    const syncBounds = async () => {
      const element = viewportRef.current;
      if (!element || disposed) return;
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        await invoke('browser_set_visible', { visible: false });
        return;
      }
      await invoke('browser_set_bounds', {
        x: Math.max(0, rect.left), y: Math.max(0, rect.top),
        width: rect.width, height: rect.height,
      });
      if (!disposed) setNativeReady(true);
    };

    const onLayout = () => { void syncBounds().catch((error) => setNativeError(String(error))); };

    void syncBounds().catch((error) => setNativeError(String(error)));
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    if (viewportRef.current && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(onLayout);
      observer.observe(viewportRef.current);
    }

    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
      void invoke('browser_set_visible', { visible: false }).catch(() => undefined);
    };
  }, [desktop]);

  async function navigate(value: string, addHistory = true) {
    let next = value.trim();
    if (!/^https?:\/\//i.test(next)) next = 'https://' + next;
    if (!validUrl(next)) return;
    next = new URL(next).toString();
    lastPropUrl.current = next;
    setCurrentUrl(next);
    setAddress(next);

    if (addHistory) {
      const nextHistory = [...history.slice(0, historyIndex + 1), next];
      setHistory(nextHistory);
      setHistoryIndex(nextHistory.length - 1);
    }

    if (desktop) {
      try {
        await invoke('browser_navigate', { url: next });
      } catch (error) {
        setNativeError(String(error));
      }
    } else {
      setReloadKey((value) => value + 1);
    }
    onNavigate(next);
  }

  function goBack() {
    if (desktop) {
      void invoke('browser_back').catch((error) => setNativeError(String(error)));
      return;
    }
    if (historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    void navigate(history[nextIndex], false);
  }

  function goForward() {
    if (desktop) {
      void invoke('browser_forward').catch((error) => setNativeError(String(error)));
      return;
    }
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    void navigate(history[nextIndex], false);
  }

  function reload() {
    if (desktop) {
      void invoke('browser_reload').catch((error) => setNativeError(String(error)));
    } else {
      setReloadKey((value) => value + 1);
    }
  }

  return (
    <section className="browser-workspace">
      <div className="browser-shell">
        <div className="browser-chrome">
          <div className="browser-controls">
            <button className="icon-button" onClick={goBack} disabled={!desktop && historyIndex <= 0} title="Kembali"><ArrowLeft size={16}/></button>
            <button className="icon-button" onClick={goForward} disabled={!desktop && historyIndex >= history.length - 1} title="Maju"><ArrowRight size={16}/></button>
            <button className="icon-button" onClick={reload} title="Muat ulang"><RefreshCw size={15}/></button>
          </div>
          <form className="browser-address-form" onSubmit={(event) => { event.preventDefault(); void navigate(address); }}>
            <Globe2 size={14}/><input aria-label="Alamat website" value={address} onChange={(event) => setAddress(event.target.value)} spellCheck={false}/>
            <button type="submit">Buka</button>
          </form>
          <button className="icon-button browser-save" onClick={() => onSave(currentUrl)} title="Simpan alamat ke Buka Data"><BookmarkPlus size={16}/></button>
        </div>
        <div className="browser-viewport" ref={viewportRef}>
          {desktop ? (
            <div className="native-browser-placeholder">
              {nativeError ? <span>Browser desktop gagal dijalankan: {nativeError}</span> : !nativeReady ? <span>Menyiapkan browser internal...</span> : null}
            </div>
          ) : (
            <iframe key={reloadKey} title="Browser GAME" src={currentUrl} allow="clipboard-read; clipboard-write; fullscreen; autoplay" referrerPolicy="strict-origin-when-cross-origin"/>
          )}
        </div>
      </div>
    </section>
  );
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
