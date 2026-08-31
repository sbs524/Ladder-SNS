import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, BarChart3, ChevronDown, Database, ExternalLink, Link2, LoaderCircle, MessageSquare, RefreshCw, ShieldCheck, Unplug, Users, Video, Youtube } from 'lucide-react';

type ChannelMetrics = { subscriber_count: number | string | null; view_count: number | string | null; video_count: number | string | null };
type YouTubeChannel = {
  social_channel_id: string;
  external_channel_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  last_synced_at: string | null;
  youtube_channel_profiles: ChannelMetrics | ChannelMetrics[] | null;
};

const dataTypes = [
  { icon: Users, title: '채널 프로필', text: '채널명·핸들·구독자 수' },
  { icon: Video, title: '콘텐츠', text: '영상·쇼츠·라이브 정보' },
  { icon: BarChart3, title: '분석 지표', text: '최근 30일 조회·시청 지표' },
  { icon: MessageSquare, title: '댓글', text: '작성자·본문·답글 데이터' },
];

function metricsFor(channel: YouTubeChannel) {
  return Array.isArray(channel.youtube_channel_profiles) ? channel.youtube_channel_profiles[0] : channel.youtube_channel_profiles;
}

function numberLabel(value: number | string | null | undefined) {
  const numberValue = typeof value === 'string' ? Number(value) : value;
  return typeof numberValue === 'number' && Number.isFinite(numberValue) ? new Intl.NumberFormat('ko-KR').format(numberValue) : '–';
}

async function api<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { credentials: 'include', ...init });
  const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() as T & { error?: { message?: string } } : null;
  if (!response.ok) throw new Error(body?.error?.message || '요청을 처리하지 못했습니다.');
  return body as T;
}

// Future platforms only need their own card metadata and API adapter in this component.
export function PlatformConnectionsSection({ isAuthenticated, onOpenRawData }: { isAuthenticated: boolean; onOpenRawData?: () => void }) {
  const [opened, setOpened] = useState(false);
  const [channels, setChannels] = useState<YouTubeChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [workingChannelId, setWorkingChannelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setChannels([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ channels: YouTubeChannel[] }>('/api/connections/youtube');
      setChannels(result.channels);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '연동 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sync = async (channelId: string) => {
    setWorkingChannelId(channelId);
    try {
      await api('/api/connections/youtube/' + channelId + '/sync', { method: 'POST' });
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '동기화 작업을 시작하지 못했습니다.');
    } finally {
      setWorkingChannelId(null);
    }
  };

  const disconnect = async (channel: YouTubeChannel) => {
    if (!window.confirm(channel.display_name + ' 채널 연결을 해제할까요? 저장된 채널 데이터도 함께 삭제됩니다.')) return;
    setWorkingChannelId(channel.social_channel_id);
    try {
      await api('/api/connections/youtube/' + channel.social_channel_id, { method: 'DELETE' });
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '채널 연결을 해제하지 못했습니다.');
    } finally {
      setWorkingChannelId(null);
    }
  };

  const connected = channels.length > 0;

  return (
    <section className="glass-panel rounded-2xl p-4 sm:p-5 border border-white/70" aria-labelledby="platform-connections-title">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div><p className="text-[10px] font-extrabold tracking-[0.16em] text-slate-400 uppercase">Platform connections</p><h2 id="platform-connections-title" className="mt-0.5 text-base font-extrabold text-slate-900">연동 정보</h2><p className="text-[11px] text-slate-500 mt-0.5">플랫폼 카드를 눌러 연결 상태와 가져오는 데이터를 확인하세요.</p></div>
        {opened && isAuthenticated && <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/70 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-white disabled:opacity-50"><RefreshCw className={'w-3.5 h-3.5 ' + (loading ? 'animate-spin' : '')} />새로고침</button>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
        <button type="button" aria-expanded={opened} onClick={() => setOpened((previous) => !previous)} className={'group text-left rounded-2xl border p-3.5 transition-all ' + (opened ? 'border-red-200 bg-red-50/70 ring-2 ring-red-500/10' : 'border-white/80 bg-white/40 hover:bg-white/70 hover:-translate-y-0.5')}>
          <div className="flex items-start justify-between gap-3"><div className="w-9 h-9 rounded-xl bg-red-500 text-white flex items-center justify-center shadow-sm"><Youtube className="w-5 h-5" /></div><ChevronDown className={'w-4 h-4 text-slate-400 transition-transform ' + (opened ? 'rotate-180' : '')} /></div>
          <p className="mt-3 text-sm font-extrabold text-slate-900">YouTube</p><p className="mt-0.5 text-[11px] leading-4 text-slate-500">채널, 영상, 분석 지표와 댓글을 가져옵니다.</p>
          <div className="mt-3 flex items-center gap-1.5 text-[10px] font-bold"><span className={'w-1.5 h-1.5 rounded-full ' + (connected ? 'bg-emerald-500' : 'bg-slate-300')} /><span className={connected ? 'text-emerald-700' : 'text-slate-500'}>{loading ? '상태 확인 중' : connected ? channels.length + '개 채널 연결됨' : '연결되지 않음'}</span></div>
        </button>
      </div>

      {opened && <div className="mt-3 rounded-2xl border border-slate-200/80 bg-white/55 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5"><Link2 className="w-4 h-4 text-red-500" />YouTube 연동 정보</h3><p className="mt-1 text-[11px] leading-4 text-slate-500">채널·영상·분석 지표·댓글을 읽고, 영상 정보 수정과 댓글 답글·모더레이션을 위해 관리 권한(youtube.force-ssl)을 함께 요청합니다. 새 영상 업로드는 하지 않습니다.</p></div>{isAuthenticated && !connected && !loading && <button type="button" onClick={() => window.location.assign('/api/connections/youtube/start')} className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-2 text-[11px] font-extrabold text-white hover:bg-red-700"><Youtube className="w-3.5 h-3.5" />YouTube 채널 연결</button>}
        {isAuthenticated && connected && !loading && onOpenRawData && <button type="button" onClick={onOpenRawData} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-extrabold text-white hover:bg-slate-800"><Database className="w-3.5 h-3.5" />원본 데이터</button>}</div>
        {!isAuthenticated ? <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2.5 text-[11px] text-indigo-800 flex gap-2"><ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" /><span>연동 상태 확인과 채널 연결은 로그인 후 사용할 수 있습니다.</span></div> : <>
          {error && <div role="alert" className="mt-3 rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2.5 text-[11px] text-rose-700 flex gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}
          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2">{dataTypes.map(({ icon: Icon, title, text }) => <div key={title} className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5"><Icon className="w-3.5 h-3.5 text-red-500 mb-1.5" /><p className="text-[11px] font-extrabold text-slate-800">{title}</p><p className="mt-0.5 text-[10px] leading-3.5 text-slate-500">{text}</p></div>)}</div>
          {loading ? <div className="mt-4 flex items-center justify-center gap-2 py-5 text-xs text-slate-500"><LoaderCircle className="w-4 h-4 animate-spin" />연동 채널을 불러오는 중입니다.</div> : connected && <div className="mt-4 space-y-2.5"><p className="text-[11px] font-extrabold text-slate-700">연결된 채널</p>{channels.map((channel) => {
            const metrics = metricsFor(channel);
            const working = workingChannelId === channel.social_channel_id;
            return <div key={channel.social_channel_id} className="rounded-xl border border-slate-200/80 bg-white/70 p-3 flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="flex min-w-0 items-center gap-2.5 flex-1">{channel.avatar_url ? <img src={channel.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover bg-slate-100" /> : <div className="w-9 h-9 rounded-full bg-red-50 text-red-600 flex items-center justify-center"><Youtube className="w-4 h-4" /></div>}<div className="min-w-0"><p className="truncate text-xs font-extrabold text-slate-900">{channel.display_name}</p><p className="truncate text-[10px] text-slate-500">{channel.handle || channel.external_channel_id}</p></div></div>
              <div className="grid grid-cols-3 gap-3 text-[10px] text-slate-500"><span><strong className="block text-xs text-slate-800">{numberLabel(metrics?.subscriber_count)}</strong>구독자</span><span><strong className="block text-xs text-slate-800">{numberLabel(metrics?.view_count)}</strong>누적 조회</span><span><strong className="block text-xs text-slate-800">{numberLabel(metrics?.video_count)}</strong>영상</span></div>
              <div className="flex items-center gap-1.5 lg:ml-auto"><button type="button" onClick={() => void sync(channel.social_channel_id)} disabled={working} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={'w-3 h-3 ' + (working ? 'animate-spin' : '')} />동기화</button><a href={'https://www.youtube.com/channel/' + channel.external_channel_id} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" title="YouTube에서 열기"><ExternalLink className="w-3.5 h-3.5" /></a><button type="button" onClick={() => void disconnect(channel)} disabled={working} className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50" title="연결 해제"><Unplug className="w-3.5 h-3.5" /></button></div>
            </div>;
          })}</div>}
        </>}
      </div>}
    </section>
  );
}
