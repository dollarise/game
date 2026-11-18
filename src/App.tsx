import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { desktopInvoke, desktopListen, isDesktop } from './lib/desktop';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { decodeBoardSnapshot, inferGameStep, patternCertainty, type BoardCard } from './lib/solitaire-engine';
import {
  ArrowLeft, ArrowRight, BookmarkPlus, Check, ChevronDown,
  Globe2, HardDrive, LoaderCircle, Menu,
  LogOut, MonitorPlay, Plus, RefreshCw, Search, Settings2,
  ShieldCheck, Trash2, X, Users, UserPlus, Shield, Pause, Play, Square
} from 'lucide-react';

type Section = 'browser' | 'data' | 'admin';
type RecordingStartResult = { stages: string[]; browser_error: string | null };
type MouseEventData = { type: 'move' | 'click' | 'board' | 'game_step'; x: number; y: number; button?: number; elapsed_ms: number; label?: string };
type PatternAlert = { status: 'completed' | 'incomplete'; title: string; cards: BoardCard[]; steps: string[]; certainty: 'exact' | 'partial' };
type SavedRecord = { id: string; title: string; duration_ms: number; event_count: number; status: 'completed' | 'incomplete'; events?: MouseEventData[]; recorded_at: string };

const DEFAULT_URL = 'https://1xlite-6487.com/en/games/solitaire';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;
const db: SupabaseClient | null = supabaseUrl && supabaseKey
 ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
 : null;

function validUrl(value: string) {
  try { const parsed = new URL(value); return parsed.protocol === 'https:' || parsed.protocol === 'http:'; }
  catch { return false; }
}

function formatDuration(milliseconds: number) {
  const total = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export default function App() {
  const [section, setSection] = useState<Section>('browser');
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const [authReady, setAuthReady] = useState(false);
  const [targetUrl, setTargetUrl] = useState(DEFAULT_URL);
  const [urlDraft, setUrlDraft] = useState(DEFAULT_URL);
  const [records, setRecords] = useState<SavedRecord[]>([]);
  const [dataTab, setDataTab] = useState<'completed' | 'incomplete'>('completed');
  const [selectedRecord, setSelectedRecord] = useState<SavedRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingRecord, setSavingRecord] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [patternAlert, setPatternAlert] = useState<PatternAlert | null>(null);
  const boardMatchChecked = useRef(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState<'waiting' | 'recording' | 'paused'>('waiting');
  const [startingRecording, setStartingRecording] = useState(false);
  const [recordingEvents, setRecordingEvents] = useState<MouseEventData[]>([]);
  const [recordingDiagnostics, setRecordingDiagnostics] = useState<string[]>([]);
  const recordingEventsRef = useRef<MouseEventData[]>([]);
  const recordingSaveStatusRef = useRef<'completed' | 'incomplete'>('completed');
  const [elapsedMs, setElapsedMs] = useState(0);
  const recordingStartedAt = useRef<number | null>(null);
  const recordingSessionActive = useRef(false);
  const savingRecordRef = useRef(false);
  const accumulatedMs = useRef(0);
  const isSuperAdmin = session?.user.app_metadata?.role === 'super_admin';

  useEffect(() => {
    if (!db) { setAuthReady(true); setLoading(false); return; }
    let active = true;
    db.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setAuthReady(true); } });
    const { data: listener } = db.auth.onAuthStateChange((_event, nextSession) => { if (active) setSession(nextSession); });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session || !db) { setRecords([]); setLoading(false); return; }
    let active = true;
    async function loadUserData() {
      setLoading(true);
      const [{ data: setting, error: settingError }, { data: rows, error: rowsError }] = await Promise.all([
        db!.from('game_settings').select('target_url').eq('user_id', session!.user.id).maybeSingle(),
        db!.from('game_mouse_recordings').select('id,title,duration_ms,event_count,status,recorded_at').eq('user_id', session!.user.id).order('recorded_at', { ascending: false }).limit(250),
      ]);
      if (!active) return;
      if (settingError || rowsError) ping('Gagal memuat data akun: ' + (settingError?.message || rowsError?.message));
      if (setting?.target_url && validUrl(setting.target_url)) { setTargetUrl(setting.target_url); setUrlDraft(setting.target_url); }
      else {
        const { error } = await db!.from('game_settings').upsert({ user_id: session!.user.id, target_url: DEFAULT_URL }, { onConflict: 'user_id' });
        if (error) ping('Gagal membuat pengaturan akun: ' + error.message);
        setTargetUrl(DEFAULT_URL); setUrlDraft(DEFAULT_URL);
      }
      setRecords((rows || []) as SavedRecord[]);
      setLoading(false);
    }
    void loadUserData();
    return () => { active = false; };
  }, [session?.user.id]);

  useEffect(() => {
    if (recordingStatus !== 'recording') return;
    const timer = window.setInterval(() => {
      const current = recordingStartedAt.current;
      setElapsedMs(accumulatedMs.current + (current === null ? 0 : Date.now() - current));
    }, 250);
    return () => window.clearInterval(timer);
  }, [recordingStatus]);

  function beginRecordingSession(message: string) {
    setRecordingDiagnostics([]);
    if (recordingSessionActive.current) {
      setRecordingStatus('recording');
      return;
    }
    recordingSessionActive.current = true;
    accumulatedMs.current = 0;
    recordingStartedAt.current = Date.now();
    recordingEventsRef.current = [];
    recordingSaveStatusRef.current = 'completed';
    boardMatchChecked.current = false;
    setPatternAlert(null);
    setElapsedMs(0);
    setRecordingEvents([]);
    setRecordingStatus('recording');
    setSection('browser');
    ping(message);
  }

  useEffect(() => {
    let active = true;
    let unlistenDiagnostic: (() => void) | undefined;
    void desktopListen<{ stage: string }>('recording-diagnostic', (event) => {
      if (active) setRecordingDiagnostics((items) => [...items, event.payload.stage].slice(-8));
    }).then((stop) => { if (active) unlistenDiagnostic = stop; else stop(); });
    return () => { active = false; unlistenDiagnostic?.(); };
  }, []);

  useEffect(() => {
    let active = true;
    let unlistenInput: (() => void) | undefined;
    void desktopListen<Omit<MouseEventData, 'elapsed_ms'> & { type: 'move' | 'click' | 'board' }>('recording-input', async (event) => {
      if (!active || recordingStartedAt.current === null) return;
      const elapsed = accumulatedMs.current + Date.now() - recordingStartedAt.current;
      const payload = event.payload;
      if (payload.type === 'board') {
        const snapshot = decodeBoardSnapshot(payload.label);
        if (snapshot && snapshot.cards.length > 0 && !boardMatchChecked.current && db) {
          boardMatchChecked.current = true;
          const currentSession = sessionRef.current;
          if (!currentSession) return;
          const { data } = await db.from('game_mouse_recordings')
            .select('id,title,status,events,recorded_at')
            .eq('user_id', currentSession.user.id)
            .order('recorded_at', { ascending: false }).limit(250);
          if (!active) return;
          const candidates = (data || []).map((row: any) => {
            const savedEvents = Array.isArray(row.events) ? row.events as MouseEventData[] : [];
            const initialBoard = savedEvents.find((item) => item.type === 'board');
            const latestBoard = [...savedEvents].reverse().find((item) => item.type === 'board');
            return { row, savedEvents, savedBoard: decodeBoardSnapshot(initialBoard?.label), latestBoard: decodeBoardSnapshot(latestBoard?.label) };
          }).filter((item) => item.savedBoard?.signature === snapshot.signature);
          const match = candidates.find((item) => item.row.status === 'completed') || candidates.find((item) => item.row.status === 'incomplete');
          if (match) {
            const steps = match.savedEvents.filter((item) => item.type === 'game_step' && item.label)
              .map((item) => { try { return JSON.parse(item.label || '').description as string; } catch { return ''; } })
              .filter(Boolean);
            const certainty = patternCertainty(snapshot);
            setPatternAlert({
              status: match.row.status,
              title: match.row.title,
              cards: match.latestBoard?.cards || snapshot.cards,
              steps,
              certainty
            });
            ping(certainty === 'exact'
              ? (match.row.status === 'completed' ? 'Identitas pola cocok dengan rekaman selesai.' : 'Identitas pola cocok dengan rekaman belum selesai.')
              : 'Kandidat pola ditemukan. Identitas kartu tertutup belum dapat dipastikan.');
          } else {
            ping(patternCertainty(snapshot) === 'exact'
              ? 'Pola baru terdeteksi. Permainan akan direkam seperti biasa.'
              : 'Belum ada kandidat pola yang cocok. Identitas pola masih bersifat parsial sampai kartu terbuka.');
          }
        }
      }
      let currentEvents = recordingEventsRef.current;
      if (payload.type === 'board') {
        const previousBoardEvent = [...currentEvents].reverse().find((item) => item.type === 'board');
        const previousBoard = decodeBoardSnapshot(previousBoardEvent?.label);
        const nextBoard = decodeBoardSnapshot(payload.label);
        if (previousBoard && nextBoard) {
          const step = inferGameStep(previousBoard, nextBoard);
          if (step) {
            currentEvents = [...currentEvents, { type: 'game_step', x: 0, y: 0, elapsed_ms: Math.round(elapsed), label: JSON.stringify(step) }];
          }
        }
      }
      const nextEvents = [...currentEvents, { ...payload, x: payload.x ?? 0, y: payload.y ?? 0, elapsed_ms: Math.round(elapsed) }];
      recordingEventsRef.current = nextEvents;
      setRecordingEvents(nextEvents);
    }).then((stop) => { if (active) unlistenInput = stop; else stop(); });
    // The game page supplies mouse data only; recording controls stay in GAME.
    return () => { active = false; unlistenInput?.(); };
  }, []);

  const filteredRecords = useMemo(() => records.filter((item) =>
    item.status === dataTab && (item.title + ' ' + new Date(item.recorded_at).toLocaleString('id-ID')).toLowerCase().includes(search.toLowerCase())
  ), [records, search, dataTab]);

  function ping(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3200);
  }

  async function saveSettings() {
    if (!validUrl(urlDraft.trim())) { ping('Masukkan alamat website yang valid (http/https).'); return; }
    setSaving(true);
    const next = new URL(urlDraft.trim()).toString();
    if (db) {
      const { error } = await db.from('game_settings').upsert({ user_id: session!.user.id, target_url: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) { setSaving(false); ping('Gagal menyimpan pengaturan: ' + error.message); return; }
    }
    setTargetUrl(next); setUrlDraft(next); setSaving(false); setSettingsOpen(false);
    ping('Pengaturan website berhasil disimpan.');
  }

  async function openRecord(item: SavedRecord) {
    if (!db) return;
    setSelectedRecord({ ...item, events: [] });
    setDetailLoading(true);
    const { data, error } = await db.from('game_mouse_recordings').select('events').eq('id', item.id).single();
    setDetailLoading(false);
    if (error) { ping('Gagal membuka data rekaman: ' + error.message); return; }
    setSelectedRecord({ ...item, events: (data.events || []) as MouseEventData[] });
  }

  async function deleteRecord(id: string) {
    if (db) {
      const { error } = await db.from('game_mouse_recordings').delete().eq('id', id);
      if (error) { ping('Gagal menghapus rekaman: ' + error.message); return; }
    }
    setRecords((old) => old.filter((item) => item.id !== id));
    if (selectedRecord?.id === id) setSelectedRecord(null);
    ping('Data rekaman berhasil dihapus.');
  }

  async function navigateTarget(nextUrl: string) {
    setTargetUrl(nextUrl);
    setUrlDraft(nextUrl);
    if (db) {
      const { error } = await db.from('game_settings').upsert({ user_id: session!.user.id, target_url: nextUrl, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) ping('Alamat berubah di browser, tetapi gagal disimpan: ' + error.message);
    }
  }

  async function startManualRecording() {
    if (startingRecording) return;
    if (recordingSessionActive.current) {
      setRecordingStatus('recording');
      ping('Sesi rekaman sudah berjalan.');
      return;
    }
    if (recordingStatus !== 'waiting') return;
    setStartingRecording(true);
    // Start the clock immediately on the UI thread. Do not make the timer
    // depend on the WebView2 command/event round-trip, which can be delayed.
    beginRecordingSession('Timer rekaman berjalan. Silakan mainkan Solitaire.');
    try {
      const result = await desktopInvoke<RecordingStartResult>('browser_start_recording');
      setRecordingDiagnostics(result.stages);
      if (result.browser_error) ping('Perintah Rekam diterima aplikasi, tetapi gagal diteruskan ke browser: ' + result.browser_error);
    } catch (error) {
      // Keep the app-owned session and timer alive. A WebView bridge failure
      // must not silently cancel a session the user explicitly started.
      // Surface the capture error so it can be diagnosed without losing time.
      ping('Sesi rekaman tetap berjalan, tetapi koneksi perekam mouse gagal: ' + String(error));
    } finally {
      setStartingRecording(false);
    }
  }

  function pauseRecording() {
    if (recordingStatus !== 'recording' || recordingStartedAt.current === null) return;
    accumulatedMs.current += Date.now() - recordingStartedAt.current;
    recordingStartedAt.current = null;
    setElapsedMs(accumulatedMs.current);
    setRecordingStatus('paused');
  }

  function resumeRecording() {
    if (recordingStatus !== 'paused') return;
    recordingStartedAt.current = Date.now();
    setRecordingStatus('recording');
  }

  async function stopRecording(status?: 'completed' | 'incomplete') {
    if (status) recordingSaveStatusRef.current = status;
    if (!db || !session || !recordingSessionActive.current || savingRecordRef.current) return;
    if (recordingStartedAt.current !== null) {
      accumulatedMs.current += Date.now() - recordingStartedAt.current;
      recordingStartedAt.current = null;
    }
    const duration = accumulatedMs.current;
    const events = [...recordingEventsRef.current];
    // Never discard a session on Stop just because the event stream is empty.
    // Save it as incomplete so the user can see the session in Buka Data.
    const saveStatus = events.length === 0 ? 'incomplete' : recordingSaveStatusRef.current;
    savingRecordRef.current = true;
    setSavingRecord(true);
    const recordedAt = new Date().toISOString();
    const title = 'Solitaire - ' + new Date(recordedAt).toLocaleString('id-ID');
    const { data, error } = await db.from('game_mouse_recordings')
      .insert({ user_id: session.user.id, title, duration_ms: Math.round(duration), event_count: events.length, events, status: saveStatus })
      .select('id,title,duration_ms,event_count,status,recorded_at').single();
    savingRecordRef.current = false;
    setSavingRecord(false);
    if (error) {
      setRecordingStatus('paused');
      setElapsedMs(duration);
      ping('Gagal menyimpan rekaman. Data masih tersedia; tekan Stop lagi untuk mencoba: ' + error.message);
      return;
    }
    setRecords((old) => [data as SavedRecord, ...old]);
    recordingSessionActive.current = false;
    setRecordingStatus('waiting');
    recordingEventsRef.current = [];
    setRecordingEvents([]);
    setElapsedMs(0);
    accumulatedMs.current = 0;
    recordingStartedAt.current = null;
    recordingSaveStatusRef.current = 'completed';
    ping(events.length === 0
      ? 'Sesi disimpan ke Buka Data > Belum Selesai, tetapi tidak ada aktivitas mouse yang diterima.'
      : saveStatus === 'incomplete'
        ? 'Rekaman disimpan ke Buka Data > Belum Selesai.'
        : 'Rekaman berhasil disimpan ke Buka Data > Selesai.');
  }

  async function signOut() {
    if (!db) return;
    if (recordingStatus !== 'waiting') { ping('Selesaikan rekaman dengan Stop sebelum keluar.'); return; }
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
          <button className={section === 'browser' ? 'nav-item active' : 'nav-item'} onClick={() => { setSection('browser'); setMobileNav(false); }}><MonitorPlay size={18}/><span>Browser</span>{section === 'browser' && <span className="nav-dot"/>}</button>
          <button className={section === 'data' ? 'nav-item active' : 'nav-item'} onClick={() => { if (recordingStatus !== 'waiting') { ping('Tekan Stop untuk menyimpan rekaman sebelum membuka Buka Data.'); return; } setSection('data'); setMobileNav(false); }}><HardDrive size={18}/><span>Buka Data</span>{records.length > 0 && <small>{records.length}</small>}</button>
          {isSuperAdmin && <button className={section === 'admin' ? 'nav-item active' : 'nav-item'} onClick={() => { setSection('admin'); setMobileNav(false); }}><Users size={18}/><span>Manajemen Pengguna</span>{section === 'admin' && <span className="nav-dot"/>}</button>}
          <div className="recording-toolbar sidebar-recording-toolbar">
            <div className="recording-indicator"><span className={recordingStatus === 'recording' ? 'recording-dot active' : 'recording-dot'}/><div><b>{recordingStatus === 'waiting' ? 'Siap Merekam' : recordingStatus === 'paused' ? 'Rekam · Dijeda' : 'Rekam · ' + formatDuration(elapsedMs)}</b><span>{recordingStatus === 'waiting' ? 'Tekan Rekam di aplikasi untuk memulai sesi' : recordingEvents.length.toLocaleString('id-ID') + ' aktivitas mouse terekam'}</span></div></div>
            <div className="recording-actions">
              {recordingStatus === 'waiting' && <button className="button button-primary" onClick={() => { setSection('browser'); setMobileNav(false); void startManualRecording(); }} disabled={startingRecording}><Play size={15}/> {startingRecording ? 'Memulai...' : 'Rekam'}</button>}
              {recordingStatus === 'recording' && <button className="button button-secondary" onClick={pauseRecording}><Pause size={15}/> Jeda</button>}
              {recordingStatus === 'paused' && <button className="button button-primary" onClick={resumeRecording}><Play size={15}/> Lanjutkan</button>}
              {recordingStatus !== 'waiting' && <button className="button button-danger" onClick={() => void stopRecording()} disabled={savingRecord}>{savingRecord ? <LoaderCircle className="spin" size={15}/> : <Square size={14}/>} {savingRecord ? 'Menyimpan...' : 'Stop'}</button>}
            </div>
          </div>
        </nav>
        <div className="sidebar-bottom">
          <div className="secure-card"><div className="secure-icon"><ShieldCheck size={17}/></div><div><b>Workspace browser</b><span>Rekam langkah dan kondisi Solitaire</span></div></div>
          <button className="settings-link" onClick={() => { setUrlDraft(targetUrl); setSettingsOpen(true); }}><Settings2 size={17}/> Pengaturan <ChevronDown size={15}/></button>
          <div className="sidebar-foot"><span className="status-dot"/>{db ? 'Supabase terhubung' : 'Mode penyimpanan lokal'}<span className="version">v1.5.0</span></div>
        </div>
      </aside>
      {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Tutup navigasi"/>}
      <main className="main-area">
        <header className="topbar">
          <div className="top-left"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Buka menu"><Menu size={20}/></button><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><b>{section === 'browser' ? 'Rekam' : section === 'data' ? 'Buka Data' : 'Manajemen Pengguna'}</b></div></div>
          <div className="top-actions"><div className="connection"><span className="status-dot"/>{db ? 'Database aktif' : 'Lokal'}</div><button className="icon-button" onClick={() => { setUrlDraft(targetUrl); setSettingsOpen(true); }} aria-label="Pengaturan"><Settings2 size={18}/></button><button className="icon-button" onClick={() => void signOut()} title="Keluar dari aplikasi" aria-label="Keluar"><LogOut size={17}/></button><div className="avatar">{(session.user.email || "U").charAt(0).toUpperCase()}</div></div>
        </header>
        <div className="content">
          {section === 'browser' ? (
            <BrowserFrame url={targetUrl} onNavigate={navigateTarget} suspend={settingsOpen}
              recordingStatus={recordingStatus} diagnostics={recordingDiagnostics} />
          ) : section === 'data' ? (
            <>
              <div className="page-heading"><div><div className="eyebrow"><HardDrive size={14}/> DATA CENTER</div><h1>Buka Data</h1><p>Riwayat kondisi papan, langkah permainan, dan aktivitas mouse Solitaire.</p></div><button className="button button-primary" onClick={() => { setSection('browser'); setMobileNav(false); }}><Plus size={16}/> Kembali ke Rekam</button></div>
              <div className="data-summary"><div className="summary-icon"><BookmarkPlus size={19}/></div><div><span>Total sesi rekaman tersimpan</span><b>{records.length} <small>sesi</small></b></div><div className="summary-divider"/><div className="summary-meta"><span>Rekaman terakhir</span><b>{records[0] ? new Date(records[0].recorded_at).toLocaleString('id-ID') : 'Belum ada data'}</b></div></div>
              <div className="data-panel"><div className="panel-heading"><div><h2>Rekaman Solitaire</h2><span>Data aktivitas mouse tersimpan per sesi, terpisah untuk setiap akun</span></div><div className="search-box"><Search size={16}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari sesi rekaman..."/></div></div><div className="data-tabs"><button className={dataTab === 'completed' ? 'data-tab active' : 'data-tab'} onClick={() => setDataTab('completed')}>Selesai <span>{records.filter((item) => item.status === 'completed').length}</span></button><button className={dataTab === 'incomplete' ? 'data-tab active' : 'data-tab'} onClick={() => setDataTab('incomplete')}>Belum Selesai <span>{records.filter((item) => item.status === 'incomplete').length}</span></button></div>
                {loading ? <div className="empty-state"><LoaderCircle className="spin" size={25}/><span>Memuat data...</span></div> : filteredRecords.length === 0 ? <div className="empty-state"><div className="empty-icon"><HardDrive size={23}/></div><b>{search ? 'Data tidak ditemukan' : 'Belum ada rekaman tersimpan'}</b><span>{search ? 'Coba kata kunci lain.' : 'Buka menu Rekam, lalu klik Play / Start Game di dalam Solitaire.'}</span>{!search && <button className="button button-primary" onClick={() => { setSection('browser'); setMobileNav(false); }}>Buka Rekam</button>}</div> :
                <div className="record-list">{filteredRecords.map((item) => <div className="record-row" key={item.id}><div className="record-site-icon"><MonitorPlay size={18}/></div><div className="record-main"><b>{item.title}</b>{item.status === 'incomplete' && <small className="record-status-incomplete">Belum Selesai · Give up</small>}<span>{formatDuration(item.duration_ms)} · {item.event_count.toLocaleString('id-ID')} peristiwa terekam</span><small>{new Date(item.recorded_at).toLocaleString('id-ID')}</small></div><button className="button button-secondary" onClick={() => void openRecord(item)} title="Buka data rekaman">Buka Data</button><button className="icon-button danger-hover" onClick={() => void deleteRecord(item.id)} title="Hapus rekaman"><Trash2 size={16}/></button></div>)}</div>}
              </div>
            </>
          ) : isSuperAdmin ? <AdminPanel db={db} session={session} ping={ping} /> : <div className="empty-state"><Shield size={24}/><b>Akses ditolak</b><span>Menu ini hanya tersedia untuk Super Admin.</span></div>}
        </div>
      </main>
      {selectedRecord && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedRecord(null); }}><section className="settings-modal recording-detail"><div className="modal-head"><div><div className="eyebrow">DETAIL REKAMAN</div><h2>{selectedRecord.title}</h2></div><button className="icon-button" onClick={() => setSelectedRecord(null)} aria-label="Tutup"><X size={19}/></button></div><div className="record-detail-summary"><div><span>Durasi aktif</span><b>{formatDuration(selectedRecord.duration_ms)}</b></div><div><span>Total aktivitas</span><b>{selectedRecord.event_count.toLocaleString('id-ID')}</b></div></div><div className="record-event-list">{detailLoading ? <div className="empty-state"><LoaderCircle className="spin" size={22}/>Memuat detail rekaman...</div> : <><div className="record-event-head"><b>Langkah permainan</b><span>{(selectedRecord.events || []).filter((event) => event.type === 'game_step').length} langkah teramati dari perubahan papan</span></div>{(selectedRecord.events || []).filter((event) => event.type === 'game_step').map((event, index) => <div className="record-event-row" key={'step-' + index}><span>{index + 1}</span><b>Langkah {index + 1}</b><span>{formatDuration(event.elapsed_ms)}</span><span>{(() => { try { return JSON.parse(event.label || '').description || 'Langkah teramati'; } catch { return 'Langkah teramati'; } })()}</span><small>Berdasarkan perubahan kondisi papan, bukan tebakan dari koordinat mouse.</small></div>)}{(selectedRecord.events || []).filter((event) => event.type === 'game_step').length === 0 && <div className="empty-state"><span>Belum ada langkah permainan terstruktur pada rekaman ini.</span></div>}<div className="record-event-head"><b>Aktivitas mouse dan kondisi papan</b><span>Menampilkan maksimal 200 peristiwa pendukung</span></div>{(selectedRecord.events || []).filter((event) => event.type !== 'game_step').slice(0, 200).map((event, index) => <div className="record-event-row" key={'event-' + index}><span>{index + 1}</span><b>{event.type === 'move' ? 'Gerak mouse' : event.type === 'board' ? 'Kondisi papan' : 'Klik'}</b><span>{formatDuration(event.elapsed_ms)}</span>{event.type === 'board' ? <span>{decodeBoardSnapshot(event.label)?.cards.length || 0} elemen kartu terdeteksi</span> : <span>X: {Math.round(event.x)} · Y: {Math.round(event.y)}</span>}{event.type === 'click' && <small>{event.label || (event.button === 2 ? 'Klik kanan' : 'Klik kiri')}</small>}</div>)}</>}</div><div className="modal-actions"><button className="button button-secondary" onClick={() => setSelectedRecord(null)}>Tutup</button></div></section></div>}
      {settingsOpen && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}><section className="settings-modal"><div className="modal-head"><div><div className="eyebrow">KONFIGURASI</div><h2>Pengaturan Website</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Tutup"><X size={19}/></button></div><p className="modal-copy">Tentukan alamat website yang akan dibuka pada browser internal GAME.</p><label className="field-label" htmlFor="target-url">URL Website Tujuan</label><input id="target-url" className="url-input" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="https://contoh.com" onKeyDown={(e) => { if (e.key === 'Enter') void saveSettings(); }}/><div className="field-hint"><ShieldCheck size={14}/> Gunakan alamat lengkap dengan https:// atau http://</div><div className="modal-actions"><button className="button button-secondary" onClick={() => setSettingsOpen(false)}>Batal</button><button className="button button-primary" onClick={() => void saveSettings()} disabled={saving}>{saving ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>} Simpan Pengaturan</button></div></section></div>}
      {patternAlert && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setPatternAlert(null); }}><section className="settings-modal recording-detail"><div className="modal-head"><div><div className="eyebrow">{patternAlert.certainty === "exact" ? "IDENTITAS POLA COCOK" : "KANDIDAT POLA DITEMUKAN"}</div><h2>{patternAlert.status === 'completed' ? 'Pola pernah diselesaikan' : 'Pola pernah dimainkan'}</h2></div><button className="icon-button" onClick={() => setPatternAlert(null)} aria-label="Tutup"><X size={19}/></button></div><p className="modal-copy">{patternAlert.certainty === 'exact' ? 'Identitas seluruh 52 kartu cocok' : 'Susunan kartu yang terlihat cocok sebagai kandidat, tetapi belum merupakan kecocokan pasti karena ada identitas kartu tertutup yang belum diketahui'} dengan rekaman <b>{patternAlert.title}</b> pada menu Buka Data → {patternAlert.status === 'completed' ? 'Selesai' : 'Belum Selesai'}.</p>{patternAlert.status === 'completed' ? <><h3>Langkah permainan yang berhasil diamati</h3>{patternAlert.steps.length ? <ol>{patternAlert.steps.map((step, index) => <li key={index}>{step}</li>)}</ol> : <p>Belum ada langkah terstruktur pada rekaman ini. Klik mouse lama tidak dianggap sebagai bukti pemindahan kartu.</p>}</> : <><h3>Langkah terakhir yang teramati</h3>{patternAlert.steps.length ? <ol>{patternAlert.steps.slice(-5).map((step, index) => <li key={index}>{step}</li>)}</ol> : <p>Belum ada langkah kartu yang dapat dipastikan dari rekaman ini.</p>}<h3>Informasi kartu pada pola</h3><p>{patternAlert.cards.filter((card) => !card.faceUp).length} kartu masih tertutup/tidak terbaca dari pola ini.</p><ul>{patternAlert.cards.filter((card) => !card.faceUp).slice(0, 20).map((card, index) => <li key={index}>Posisi {card.slot}: kartu belum terbuka</li>)}</ul><p>Kartu tertutup hanya akan diberi identitas jika pernah terbuka dan terekam pada pola yang sama.</p></>}<div className="modal-actions"><button className="button button-primary" onClick={() => setPatternAlert(null)}>Mengerti</button></div></section></div>}
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

function BrowserFrame({ url, onNavigate, suspend, recordingStatus, diagnostics }: {
  url: string; onNavigate: (url: string) => void; suspend: boolean;
  recordingStatus: 'waiting' | 'recording' | 'paused'; diagnostics: string[];
}) {
  const desktop = isDesktop();
  const [address, setAddress] = useState(url);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [reloadKey, setReloadKey] = useState(0);
  const [history, setHistory] = useState<string[]>([url]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [nativeReady, setNativeReady] = useState(false);
  const [nativeError, setNativeError] = useState('');
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastPropUrl = useRef(url);

  useEffect(() => {
    if (url !== lastPropUrl.current) {
      lastPropUrl.current = url; setAddress(url); setCurrentUrl(url); setHistory([url]); setHistoryIndex(0);
      if (desktop) void desktopInvoke('browser_navigate', { url }).catch((error) => setNativeError(String(error)));
    }
  }, [url, desktop]);

  useEffect(() => {
    if (!desktop) return;
    if (suspend) void desktopInvoke('browser_set_visible', { visible: false }).catch((error) => setNativeError(String(error)));
    else {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect && rect.width > 1 && rect.height > 1) void desktopInvoke('browser_set_bounds', { x: Math.max(0, rect.left), y: Math.max(0, rect.top), width: rect.width, height: rect.height }).catch((error) => setNativeError(String(error)));
    }
  }, [desktop, suspend]);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void desktopListen<string>('browser-url-changed', (event) => {
      if (!active || !validUrl(event.payload)) return;
      const nextUrl = new URL(event.payload).toString();
      setAddress(nextUrl);
      setCurrentUrl(nextUrl);
      lastPropUrl.current = nextUrl;
      onNavigate(nextUrl);
    }).then((stop) => { if (active) unlisten = stop; else stop(); });
    return () => { active = false; unlisten?.(); };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    const syncBounds = async () => {
      const element = viewportRef.current;
      if (!element || disposed) return;
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) { await desktopInvoke('browser_set_visible', { visible: false }); return; }
      await desktopInvoke('browser_set_bounds', { x: Math.max(0, rect.left), y: Math.max(0, rect.top), width: rect.width, height: rect.height });
      if (!disposed) setNativeReady(true);
    };
    const onLayout = () => { void syncBounds().catch((error) => setNativeError(String(error))); };
    void syncBounds().catch((error) => setNativeError(String(error)));
    window.addEventListener('resize', onLayout); window.addEventListener('scroll', onLayout, true);
    if (viewportRef.current && typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(onLayout); observer.observe(viewportRef.current); }
    return () => { disposed = true; observer?.disconnect(); window.removeEventListener('resize', onLayout); window.removeEventListener('scroll', onLayout, true); void desktopInvoke('browser_set_visible', { visible: false }).catch(() => undefined); };
  }, [desktop]);

  async function navigate(value: string, addHistory = true) {
    let next = value.trim();
    if (!/^https?:\/\//i.test(next)) next = 'https://' + next;
    if (!validUrl(next)) return;
    next = new URL(next).toString(); lastPropUrl.current = next; setCurrentUrl(next); setAddress(next);
    if (addHistory) { const nextHistory = [...history.slice(0, historyIndex + 1), next]; setHistory(nextHistory); setHistoryIndex(nextHistory.length - 1); }
    if (desktop) { try { await desktopInvoke('browser_navigate', { url: next }); } catch (error) { setNativeError(String(error)); } }
    else setReloadKey((value) => value + 1);
    onNavigate(next);
  }
  function goBack() {
    if (desktop) { void desktopInvoke('browser_back').catch((error) => setNativeError(String(error))); return; }
    if (historyIndex <= 0) return; const nextIndex = historyIndex - 1; setHistoryIndex(nextIndex); void navigate(history[nextIndex], false);
  }
  function goForward() {
    if (desktop) { void desktopInvoke('browser_forward').catch((error) => setNativeError(String(error))); return; }
    if (historyIndex >= history.length - 1) return; const nextIndex = historyIndex + 1; setHistoryIndex(nextIndex); void navigate(history[nextIndex], false);
  }
  function reload() {
    if (desktop) void desktopInvoke('browser_reload').catch((error) => setNativeError(String(error)));
    else setReloadKey((value) => value + 1);
  }
  return (
    <section className="browser-workspace">
      {recordingStatus !== 'waiting' && <div className="recording-diagnostics" aria-live="polite"><b>Diagnosis Rekaman</b><span>{diagnostics.length > 0 ? diagnostics.map((stage, index) => <small key={index}>{({ 'native-start-command': 'Perintah Rekam diterima aplikasi desktop', 'start-message-sent': 'Perintah Rekam dikirim ke browser internal', 'start-received': 'Skrip browser menerima perintah Rekam', 'iframe-start-sent': 'Sinyal diteruskan ke iframe', 'mouse-captured': 'Gerakan mouse tertangkap', 'iframe-event-relayed': 'Data iframe diterima browser utama' } as Record<string, string>)[stage] || stage}</small>) : <small>Menunggu sinyal diagnosis dari browser dan game...</small>}</span></div>}
 
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
        </div>
        <div className="browser-viewport" ref={viewportRef}>
          {desktop ? <div className="native-browser-placeholder">{nativeError ? <span>Browser desktop gagal dijalankan: {nativeError}</span> : !nativeReady ? <span>Menyiapkan browser internal...</span> : null}</div> :
            <iframe key={reloadKey} title="Browser GAME" src={currentUrl} allow="clipboard-read; clipboard-write; fullscreen; autoplay" referrerPolicy="strict-origin-when-cross-origin"/>}
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
