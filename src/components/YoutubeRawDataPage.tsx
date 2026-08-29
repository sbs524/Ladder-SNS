import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, ChevronDown, Database, LoaderCircle, RefreshCw } from 'lucide-react';

type ChannelSummary = { social_channel_id: string; display_name: string; handle: string | null };
type RawRecord = Record<string, unknown>;
type RawDataResponse = {
  channel: RawRecord;
  videos: RawRecord[];
  daily_metrics: RawRecord[];
  breakdowns: Record<string, RawRecord[]>;
  comments: RawRecord[];
};

async function api<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { credentials: 'include', ...init });
  const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() as T & { error?: { message?: string } } : null;
  if (!response.ok) throw new Error(body?.error?.message || '요청을 처리하지 못했습니다.');
  return body as T;
}

function flatten(value: unknown): string {
  if (value === null || value === undefined || value === '') return '–';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function mergeRelation(value: unknown): RawRecord {
  if (Array.isArray(value)) return (value[0] as RawRecord) || {};
  return (value as RawRecord) || {};
}

function RawTable({ rows, emptyLabel }: { rows: RawRecord[]; emptyLabel: string }) {
  const columns = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((row) => Object.keys(row).forEach((key) => set.add(key)));
    return Array.from(set);
  }, [rows]);

  if (rows.length === 0) return <p className="py-3 text-[11px] italic text-slate-400">{emptyLabel}</p>;

  return (
    <div className="max-h-[420px] overflow-auto rounded-xl border border-slate-200/70">
      <table className="min-w-full text-[11px]">
        <thead className="sticky top-0 bg-slate-50/95 backdrop-blur">
          <tr>{columns.map((column) => <th key={column} className="whitespace-nowrap px-2 py-1.5 text-left font-bold text-slate-600">{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-slate-100 hover:bg-slate-50/60">
              {columns.map((column) => <td key={column} title={flatten(row[column])} className="max-w-[220px] truncate whitespace-nowrap px-2 py-1.5 text-slate-700">{flatten(row[column])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RawKeyValue({ data }: { data: RawRecord }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <p className="py-2 text-[11px] italic text-slate-400">데이터 없음</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2 border-b border-slate-100 py-1 text-[11px]">
          <dt className="w-40 shrink-0 font-bold text-slate-500">{key}</dt>
          <dd className="break-all text-slate-800">{flatten(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, subtitle, count, children }: { title: string; subtitle?: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="glass-panel rounded-2xl border border-white/70 p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-extrabold text-slate-900">{title}{typeof count === 'number' && <span className="ml-1.5 font-medium text-slate-400">({count})</span>}</h3>
      </div>
      {subtitle && <p className="-mt-2 mb-3 text-[11px] text-slate-500">{subtitle}</p>}
      {children}
    </section>
  );
}

const BREAKDOWN_LABELS: Record<string, string> = {
  country: '국가별',
  traffic_source: '유입 경로',
  device: '기기',
  audience: '연령·성별',
  playback_location: '재생 위치',
  subscribed_status: '구독 여부',
  search_terms: '검색어 (YouTube 검색)',
  external_traffic: '외부 유입 (외부 링크)',
  sharing_service: '공유 채널',
  retention_curve: '시청 지속률 (영상별)',
};

export function YoutubeRawDataPage({ onBack }: { onBack: () => void }) {
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [data, setData] = useState<RawDataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedVideoId, setExpandedVideoId] = useState<string | null>(null);

  useEffect(() => {
    void api<{ channels: ChannelSummary[] }>('/api/connections/youtube')
      .then((result) => {
        setChannels(result.channels);
        setSelectedChannelId((previous) => previous || result.channels[0]?.social_channel_id || null);
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : '연결된 채널을 불러오지 못했습니다.'));
  }, []);

  const loadRawData = useCallback(async (channelId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<RawDataResponse>(`/api/connections/youtube/${channelId}/raw-data`);
      setData(result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedChannelId) void loadRawData(selectedChannelId);
  }, [selectedChannelId, loadRawData]);

  const triggerSync = async () => {
    if (!selectedChannelId) return;
    setSyncing(true);
    try {
      await api(`/api/connections/youtube/${selectedChannelId}/sync`, { method: 'POST' });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '동기화 작업을 시작하지 못했습니다.');
    } finally {
      setSyncing(false);
    }
  };

  const videoRows = useMemo(() => (data?.videos || []).map((video) => {
    const youtubeVideo = mergeRelation(video.youtube_videos);
    const { youtube_videos: _omit, ...contentFields } = video;
    return { ...contentFields, ...youtubeVideo };
  }), [data]);

  const channelFlat = useMemo(() => {
    if (!data?.channel) return {};
    const { profile, ...channelFields } = data.channel;
    return { ...channelFields, ...(profile as RawRecord | null || {}) };
  }, [data]);

  return (
    <div className="mx-auto w-full max-w-6xl px-1 py-2 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white/70 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-white">
            <ArrowLeft className="h-3.5 w-3.5" />대시보드로
          </button>
          <div className="flex items-center gap-1.5"><Database className="h-4 w-4 text-indigo-500" /><h2 className="text-base font-extrabold text-slate-900">YouTube 원본 데이터</h2></div>
        </div>
        <div className="flex items-center gap-1.5">
          {channels.length > 1 && (
            <select value={selectedChannelId || ''} onChange={(event) => setSelectedChannelId(event.target.value)} className="rounded-xl border border-slate-200 bg-white/80 px-2.5 py-1.5 text-[11px] font-bold text-slate-700">
              {channels.map((channel) => <option key={channel.social_channel_id} value={channel.social_channel_id}>{channel.display_name}</option>)}
            </select>
          )}
          <button type="button" onClick={() => void triggerSync()} disabled={syncing || !selectedChannelId} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/70 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-white disabled:opacity-50">
            <RefreshCw className={'h-3.5 w-3.5 ' + (syncing ? 'animate-spin' : '')} />동기화 요청
          </button>
          <button type="button" onClick={() => selectedChannelId && void loadRawData(selectedChannelId)} disabled={loading || !selectedChannelId} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-slate-800 disabled:opacity-50">
            새로고침
          </button>
        </div>
      </div>

      <p className="text-[11px] leading-4 text-slate-500">
        지금 YouTube에서 수집·저장 중인 데이터를 가공 없이 전부 보여줍니다. 동기화는 비동기 작업이라 "동기화 요청" 후 완료까지 몇 분 걸릴 수 있고, 그 사이엔 새로고침해도 이전 데이터가 보일 수 있습니다.
      </p>

      {error && <div role="alert" className="flex gap-2 rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2.5 text-[11px] text-rose-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}

      {!selectedChannelId && !error && <p className="text-xs text-slate-500">연결된 YouTube 채널이 없습니다. 대시보드의 "연동 정보"에서 채널을 먼저 연결하세요.</p>}

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />불러오는 중입니다.</div>
      ) : data && (
        <div className="space-y-4">
          <Section title="채널 프로필" subtitle="social_channels + youtube_channel_profiles 전체 컬럼">
            <RawKeyValue data={channelFlat} />
          </Section>

          <Section title="일별 채널 지표" subtitle="youtube_channel_daily_metrics — 최근 동기화된 30일" count={data.daily_metrics.length}>
            <RawTable rows={data.daily_metrics} emptyLabel="아직 동기화된 일별 지표가 없습니다." />
          </Section>

          <Section title="영상" subtitle="social_contents + youtube_videos, 최신순 (최대 200개). 행을 클릭하면 전체 필드를 펼쳐 봅니다." count={videoRows.length}>
            {videoRows.length === 0 ? <p className="py-3 text-[11px] italic text-slate-400">아직 동기화된 영상이 없습니다.</p> : (
              <div className="max-h-[520px] space-y-1.5 overflow-auto pr-1">
                {videoRows.map((video) => {
                  const id = video.social_content_id as string;
                  const isOpen = expandedVideoId === id;
                  return (
                    <div key={id} className="rounded-xl border border-slate-200/70 bg-white/60">
                      <button type="button" onClick={() => setExpandedVideoId(isOpen ? null : id)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
                        <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-800">{flatten(video.title)}</span>
                        <span className="shrink-0 text-[10px] text-slate-400">{flatten(video.content_type)} · {flatten(video.source_published_at)}</span>
                        <ChevronDown className={'h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ' + (isOpen ? 'rotate-180' : '')} />
                      </button>
                      {isOpen && <div className="border-t border-slate-100 px-3 py-2"><RawKeyValue data={video} /></div>}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {Object.entries(data.breakdowns).map(([reportType, rows]) => {
            const flattenedRows = rows.map((row) => ({
              metric_date: row.metric_date,
              ...(row.youtube_video_id ? { youtube_video_id: row.youtube_video_id } : {}),
              ...((row.dimension_values as RawRecord) || {}),
              ...((row.metric_values as RawRecord) || {}),
            }));
            return (
              <Section key={reportType} title={`분석 — ${BREAKDOWN_LABELS[reportType] || reportType}`} subtitle={`youtube_analytics_breakdowns (report_type = ${reportType})`} count={flattenedRows.length}>
                <RawTable rows={flattenedRows} emptyLabel="데이터가 없습니다." />
              </Section>
            );
          })}

          <Section title="댓글" subtitle="social_comments — 최신순 (최대 100개)" count={data.comments.length}>
            <RawTable rows={data.comments} emptyLabel="아직 동기화된 댓글이 없습니다." />
          </Section>
        </div>
      )}
    </div>
  );
}
