import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AtSign, BarChart3, ChevronDown, ChevronRight, Database, ExternalLink, Instagram, Link2, LoaderCircle, MessageSquare, RefreshCw, ShieldCheck, Twitter, Unplug, Users, Video, Youtube } from 'lucide-react';
import type { RawDataTab } from './YoutubeRawDataPage';

type PlatformId = 'youtube' | 'instagram' | 'threads' | 'x';

type ChannelMetrics = { subscriber_count: number | string | null; view_count: number | string | null; video_count: number | string | null };
type ConnectedChannel = {
  social_channel_id: string;
  external_channel_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  last_synced_at: string | null;
  /** 유튜브만 채워진다. 나머지 플랫폼은 아직 프로필 지표를 동기화하지 않는다. */
  youtube_channel_profiles?: ChannelMetrics | ChannelMetrics[] | null;
};

type PlatformCard = {
  id: PlatformId;
  name: string;
  blurb: string;
  /** 연동 패널에 적는, 실제로 요청하는 권한 설명. 과장하면 심사에서 걸린다. */
  scopeNote: string;
  icon: React.ComponentType<{ className?: string }>;
  /** 카드 아이콘 배경 + 강조색 */
  iconClass: string;
  accentText: string;
  accentButton: string;
  openUrl?: (channel: ConnectedChannel) => string;
};

const PLATFORMS: PlatformCard[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    blurb: '채널, 영상, 분석 지표와 댓글을 가져옵니다.',
    scopeNote: '채널·영상·분석 지표·댓글을 읽고, 영상 정보 수정과 댓글 답글·모더레이션을 위해 관리 권한(youtube.force-ssl)을 함께 요청합니다. 새 영상 업로드는 하지 않습니다.',
    icon: Youtube,
    iconClass: 'bg-red-500 text-white',
    accentText: 'text-red-500',
    accentButton: 'bg-red-600 hover:bg-red-700',
    openUrl: (channel) => 'https://www.youtube.com/channel/' + channel.external_channel_id,
  },
  {
    id: 'instagram',
    name: '인스타그램',
    blurb: '계정 정보와 게시물 발행 권한을 연결합니다.',
    scopeNote: 'Instagram 로그인(instagram_business_basic, instagram_business_content_publish)으로 계정 정보를 읽고 게시물을 발행합니다. 비즈니스 또는 크리에이터 계정만 연결할 수 있습니다.',
    icon: Instagram,
    iconClass: 'bg-gradient-to-br from-amber-400 via-pink-500 to-purple-600 text-white',
    accentText: 'text-pink-500',
    accentButton: 'bg-pink-600 hover:bg-pink-700',
    openUrl: (channel) => channel.handle ? 'https://www.instagram.com/' + channel.handle.replace(/^@/, '') : 'https://www.instagram.com/',
  },
  {
    id: 'threads',
    name: '쓰레드',
    blurb: '프로필과 게시물 발행 권한을 연결합니다.',
    scopeNote: 'threads_basic, threads_content_publish 권한으로 프로필을 읽고 게시물을 발행합니다.',
    icon: AtSign,
    iconClass: 'bg-slate-900 text-white',
    accentText: 'text-slate-700',
    accentButton: 'bg-slate-900 hover:bg-slate-800',
    openUrl: (channel) => channel.handle ? 'https://www.threads.net/' + channel.handle : 'https://www.threads.net/',
  },
  {
    id: 'x',
    name: 'X (트위터)',
    blurb: '계정 정보와 게시 권한을 연결합니다.',
    scopeNote: 'tweet.read, tweet.write, users.read 권한으로 계정을 읽고 게시합니다. offline.access는 토큰 자동 갱신에만 씁니다.',
    icon: Twitter,
    iconClass: 'bg-slate-900 text-white',
    accentText: 'text-slate-700',
    accentButton: 'bg-slate-900 hover:bg-slate-800',
    openUrl: (channel) => channel.handle ? 'https://x.com/' + channel.handle.replace(/^@/, '') : 'https://x.com/',
  },
];

// 유튜브 패널에서만 쓰는, 원본 데이터 화면의 탭 바로가기.
const youtubeDataTypes: Array<{ icon: typeof Users; title: string; text: string; tab: RawDataTab }> = [
  { icon: Users, title: '채널 프로필', text: '채널명·핸들·구독자 수', tab: '개요' },
  { icon: Video, title: '콘텐츠', text: '영상·쇼츠·라이브 정보', tab: '영상 관리' },
  { icon: BarChart3, title: '분석 지표', text: '최근 30일 조회·시청 지표', tab: '분석' },
  { icon: MessageSquare, title: '댓글', text: '작성자·본문·답글 데이터', tab: '댓글 관리' },
];

function metricsFor(channel: ConnectedChannel) {
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

/**
 * 연동 진입점. 플랫폼마다 OAuth 흐름은 서버가 같은 모양으로 노출하므로
 * (/api/connections/:platform/start · GET · DELETE) 이 컴포넌트는 카드 목록만 안다.
 */
export function PlatformConnectionsSection({ isAuthenticated, onOpenRawData }: { isAuthenticated: boolean; onOpenRawData?: (tab?: RawDataTab) => void }) {
  const [openedPlatform, setOpenedPlatform] = useState<PlatformId | null>(null);
  const [channelsByPlatform, setChannelsByPlatform] = useState<Record<PlatformId, ConnectedChannel[]>>({ youtube: [], instagram: [], threads: [], x: [] });
  const [loading, setLoading] = useState(false);
  const [workingChannelId, setWorkingChannelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setChannelsByPlatform({ youtube: [], instagram: [], threads: [], x: [] });
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 한 플랫폼이 실패해도 나머지 카드는 상태를 보여줘야 하므로 allSettled로 받는다.
      const results = await Promise.allSettled(
        PLATFORMS.map((platform) => api<{ channels: ConnectedChannel[] }>('/api/connections/' + platform.id)),
      );
      const next: Record<PlatformId, ConnectedChannel[]> = { youtube: [], instagram: [], threads: [], x: [] };
      const failures: string[] = [];
      results.forEach((result, index) => {
        const platform = PLATFORMS[index];
        // 라우트가 아직 없으면 SPA fallback이 HTML을 돌려주고 api()는 null을 반환한다.
        // 옵셔널 체이닝이 없으면 여기서 터져 섹션 전체가 "상태 확인 중"에 굳는다.
        if (result.status === 'fulfilled') next[platform.id] = result.value?.channels ?? [];
        else failures.push(platform.name);
      });
      setChannelsByPlatform(next);
      setError(failures.length > 0 ? failures.join(', ') + ' 연동 정보를 불러오지 못했습니다.' : null);
    } finally {
      // 어떤 실패든 스피너는 반드시 멈춘다.
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

  const disconnect = async (platform: PlatformId, channel: ConnectedChannel) => {
    if (!window.confirm(channel.display_name + ' 연결을 해제할까요? 저장된 데이터도 함께 삭제됩니다.')) return;
    setWorkingChannelId(channel.social_channel_id);
    try {
      await api('/api/connections/' + platform + '/' + channel.social_channel_id, { method: 'DELETE' });
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '연결을 해제하지 못했습니다.');
    } finally {
      setWorkingChannelId(null);
    }
  };

  const opened = PLATFORMS.find((platform) => platform.id === openedPlatform) || null;
  const openedChannels = opened ? channelsByPlatform[opened.id] : [];
  const openedConnected = openedChannels.length > 0;

  return (
    <section className="glass-panel rounded-2xl p-4 sm:p-5 border border-white/70" aria-labelledby="platform-connections-title">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div><p className="text-[10px] font-extrabold tracking-[0.16em] text-slate-400 uppercase">Platform connections</p><h2 id="platform-connections-title" className="mt-0.5 text-base font-extrabold text-slate-900">연동 정보</h2><p className="text-[11px] text-slate-500 mt-0.5">플랫폼 카드를 눌러 연결 상태와 가져오는 데이터를 확인하세요.</p></div>
        {isAuthenticated && <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/70 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-white disabled:opacity-50"><RefreshCw className={'w-3.5 h-3.5 ' + (loading ? 'animate-spin' : '')} />새로고침</button>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
        {PLATFORMS.map((platform) => {
          const count = channelsByPlatform[platform.id].length;
          const isOpen = openedPlatform === platform.id;
          const Icon = platform.icon;
          return (
            <button
              key={platform.id}
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenedPlatform(isOpen ? null : platform.id)}
              className={'group text-left rounded-2xl border p-3.5 transition-all ' + (isOpen ? 'border-slate-300 bg-white/80 ring-2 ring-slate-900/5' : 'border-white/80 bg-white/40 hover:bg-white/70 hover:-translate-y-0.5')}
            >
              <div className="flex items-start justify-between gap-3">
                <div className={'w-9 h-9 rounded-xl flex items-center justify-center shadow-sm ' + platform.iconClass}><Icon className="w-5 h-5" /></div>
                <ChevronDown className={'w-4 h-4 text-slate-400 transition-transform ' + (isOpen ? 'rotate-180' : '')} />
              </div>
              <p className="mt-3 text-sm font-extrabold text-slate-900">{platform.name}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{platform.blurb}</p>
              <div className="mt-3 flex items-center gap-1.5 text-[10px] font-bold">
                <span className={'w-1.5 h-1.5 rounded-full ' + (count > 0 ? 'bg-emerald-500' : 'bg-slate-300')} />
                <span className={count > 0 ? 'text-emerald-700' : 'text-slate-500'}>{loading ? '상태 확인 중' : count > 0 ? count + '개 계정 연결됨' : '연결되지 않음'}</span>
              </div>
            </button>
          );
        })}
      </div>

      {opened && <div className="mt-3 rounded-2xl border border-slate-200/80 bg-white/55 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5"><Link2 className={'w-4 h-4 ' + opened.accentText} />{opened.name} 연동 정보</h3>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">{opened.scopeNote}</p>
          </div>
          {isAuthenticated && !openedConnected && !loading && <button type="button" onClick={() => window.location.assign('/api/connections/' + opened.id + '/start')} className={'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-extrabold text-white ' + opened.accentButton}><opened.icon className="w-3.5 h-3.5" />{opened.name} 계정 연결</button>}
          {isAuthenticated && opened.id === 'youtube' && openedConnected && !loading && onOpenRawData && <button type="button" onClick={() => onOpenRawData()} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-extrabold text-white hover:bg-slate-800"><Database className="w-3.5 h-3.5" />원본 데이터</button>}
        </div>

        {!isAuthenticated ? <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2.5 text-[11px] text-indigo-800 flex gap-2"><ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" /><span>연동 상태 확인과 계정 연결은 로그인 후 사용할 수 있습니다.</span></div> : <>
          {error && <div role="alert" className="mt-3 rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2.5 text-[11px] text-rose-700 flex gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}

          {opened.id === 'youtube' && <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2">{youtubeDataTypes.map(({ icon: Icon, title, text, tab }) => {
            const body = <><Icon className="w-3.5 h-3.5 text-red-500 mb-1.5" /><p className="text-[11px] font-extrabold text-slate-800">{title}</p><p className="mt-0.5 text-[10px] leading-3.5 text-slate-500">{text}</p></>;
            const openable = openedConnected && !loading && onOpenRawData;
            if (!openable) return <div key={title} className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5">{body}</div>;
            return <button key={title} type="button" onClick={() => onOpenRawData(tab)} className="group text-left rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 transition-all hover:border-slate-300 hover:bg-white hover:-translate-y-0.5">
              {body}
              <span className="mt-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-400 group-hover:text-red-600">원본 보기<ChevronRight className="w-3 h-3" /></span>
            </button>;
          })}</div>}

          {loading ? <div className="mt-4 flex items-center justify-center gap-2 py-5 text-xs text-slate-500"><LoaderCircle className="w-4 h-4 animate-spin" />연동 계정을 불러오는 중입니다.</div> : openedConnected && <div className="mt-4 space-y-2.5">
            <p className="text-[11px] font-extrabold text-slate-700">연결된 계정</p>
            {openedChannels.map((channel) => {
              const metrics = metricsFor(channel);
              const working = workingChannelId === channel.social_channel_id;
              const Icon = opened.icon;
              return <div key={channel.social_channel_id} className="rounded-xl border border-slate-200/80 bg-white/70 p-3 flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="flex min-w-0 items-center gap-2.5 flex-1">
                  {channel.avatar_url ? <img src={channel.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover bg-slate-100" /> : <div className={'w-9 h-9 rounded-full flex items-center justify-center ' + opened.iconClass}><Icon className="w-4 h-4" /></div>}
                  <div className="min-w-0"><p className="truncate text-xs font-extrabold text-slate-900">{channel.display_name}</p><p className="truncate text-[10px] text-slate-500">{channel.handle || channel.external_channel_id}</p></div>
                </div>
                {opened.id === 'youtube' && <div className="grid grid-cols-3 gap-3 text-[10px] text-slate-500"><span><strong className="block text-xs text-slate-800">{numberLabel(metrics?.subscriber_count)}</strong>구독자</span><span><strong className="block text-xs text-slate-800">{numberLabel(metrics?.view_count)}</strong>누적 조회</span><span><strong className="block text-xs text-slate-800">{numberLabel(metrics?.video_count)}</strong>영상</span></div>}
                <div className="flex items-center gap-1.5 lg:ml-auto">
                  {opened.id === 'youtube' && <button type="button" onClick={() => void sync(channel.social_channel_id)} disabled={working} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={'w-3 h-3 ' + (working ? 'animate-spin' : '')} />동기화</button>}
                  {opened.openUrl && <a href={opened.openUrl(channel)} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" title={opened.name + '에서 열기'}><ExternalLink className="w-3.5 h-3.5" /></a>}
                  <button type="button" onClick={() => void disconnect(opened.id, channel)} disabled={working} className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50" title="연결 해제"><Unplug className="w-3.5 h-3.5" /></button>
                </div>
              </div>;
            })}
          </div>}
        </>}
      </div>}
    </section>
  );
}
