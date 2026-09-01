import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, ChevronDown, Database, LoaderCircle, MessageSquare, Pencil, RefreshCw, Reply, ShieldAlert, Trash2 } from 'lucide-react';
import { deleteVideo, moderateComment, replyToComment, updateVideo, type ManagedComment } from '../lib/youtubeManageApi';

type ChannelSummary = { social_channel_id: string; display_name: string; handle: string | null; can_manage_content: boolean };
type RawRecord = Record<string, unknown>;
type RawDataResponse = {
  channel: RawRecord;
  videos: RawRecord[];
  daily_metrics: RawRecord[];
  breakdowns: Record<string, RawRecord[]>;
  comments: RawRecord[];
};
type CommentsPage = { comments: ManagedComment[]; next_cursor: string | null };

const DELETE_CONFIRM_DELAY_MS = 2000;
const TABS = ['개요', '영상 관리', '분석', '댓글 관리'] as const;
type Tab = (typeof TABS)[number];
/** 연동 정보 카드가 특정 탭으로 바로 열 수 있도록 내보낸다. */
export type RawDataTab = Tab;

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

function ScopeBanner({ channelId }: { channelId: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-[11px] text-amber-800">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span className="flex-1">이 채널은 쓰기 권한 없이 연결되어 있어 영상 수정·삭제와 댓글 답글·모더레이션을 사용할 수 없습니다.</span>
      <button
        type="button"
        onClick={() => window.location.assign('/api/connections/youtube/start')}
        className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-amber-700"
      >
        다시 연결
      </button>
    </div>
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

function VideoEditor({ channelId, video, onSaved, onDeleted }: {
  channelId: string;
  video: RawRecord;
  onSaved: (contentId: string, changes: { title: string; body_text: string }) => void;
  onDeleted: (contentId: string) => void;
}) {
  const contentId = video.social_content_id as string;
  const [title, setTitle] = useState(String(video.title ?? ''));
  const [description, setDescription] = useState(String(video.body_text ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteReady, setDeleteReady] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty = title !== String(video.title ?? '') || description !== String(video.body_text ?? '');

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateVideo(channelId, contentId, { title, description });
      onSaved(contentId, { title, body_text: description });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '영상 정보를 수정하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const openDeleteConfirm = () => {
    setConfirmDelete(true);
    setDeleteReady(false);
    window.setTimeout(() => setDeleteReady(true), DELETE_CONFIRM_DELAY_MS);
  };

  const confirmDeleteVideo = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteVideo(channelId, contentId);
      onDeleted(contentId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '영상을 삭제하지 못했습니다.');
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-slate-200/70 bg-white/70 p-3">
      <div>
        <label className="mb-1 block text-[10px] font-bold text-slate-500">제목</label>
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} className="glass-input w-full rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold text-slate-500">설명</label>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={5000} className="glass-input w-full rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-900" />
      </div>
      {error && <p role="alert" className="flex items-center gap-1.5 text-[11px] font-medium text-rose-600"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => void save()} disabled={!dirty || saving} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-800 disabled:opacity-50">
          <Pencil className="h-3 w-3" />{saving ? '저장 중...' : '저장'}
        </button>
        {!confirmDelete ? (
          <button type="button" onClick={openDeleteConfirm} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50">
            <Trash2 className="h-3 w-3" />영상 삭제
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-rose-700">YouTube에서 영구 삭제됩니다.</span>
            <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">취소</button>
            <button type="button" onClick={() => void confirmDeleteVideo()} disabled={!deleteReady || deleting} className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-rose-700 disabled:opacity-50">{deleting ? '삭제 중...' : '정말 삭제'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function CommentRow({ channelId, comment, canManage, onReplied, onModerated }: {
  channelId: string;
  comment: ManagedComment;
  canManage: boolean;
  onReplied: (reply: ManagedComment) => void;
  onModerated: (commentId: string, status: string) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [moderating, setModerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitReply = async () => {
    const body = replyText.trim();
    if (!body) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await replyToComment(channelId, comment.social_comment_id, body);
      onReplied(result.comment);
      setReplyText('');
      setReplying(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '답글을 작성하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const moderate = async (action: 'hide' | 'delete') => {
    const confirmed = window.confirm(action === 'hide' ? '이 댓글을 숨길까요?' : '이 댓글을 영구 삭제할까요? 되돌릴 수 없습니다.');
    if (!confirmed) return;
    setModerating(true);
    setError(null);
    try {
      await moderateComment(channelId, comment.social_comment_id, action);
      onModerated(comment.social_comment_id, action === 'hide' ? 'hidden' : 'deleted');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '처리하지 못했습니다.');
    } finally {
      setModerating(false);
    }
  };

  if (comment.visibility_status === 'deleted') return null;

  return (
    <div className={'rounded-xl border bg-white/70 p-3 ' + (comment.comment_kind === 'reply' ? 'ml-6 border-slate-100' : 'border-slate-200/80')}>
      <div className="flex items-start gap-2.5">
        {comment.author_avatar_url ? <img src={comment.author_avatar_url} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" /> : <div className="h-7 w-7 shrink-0 rounded-full bg-slate-200" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[11px] font-extrabold text-slate-800">{comment.author_display_name || '알 수 없음'}</p>
            {comment.comment_kind === 'reply' && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">답글</span>}
            {comment.visibility_status === 'hidden' && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">숨김</span>}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] text-slate-700">{comment.body_text}</p>
          {error && <p role="alert" className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-rose-600"><AlertCircle className="h-3 w-3 shrink-0" />{error}</p>}
          <div className="mt-1.5 flex items-center gap-1.5">
            <button type="button" onClick={() => setReplying((previous) => !previous)} disabled={!canManage} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-40">
              <Reply className="h-3 w-3" />답글 작성
            </button>
            <button type="button" onClick={() => void moderate('hide')} disabled={!canManage || moderating || comment.visibility_status === 'hidden'} className="rounded-lg px-1.5 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-40">숨기기</button>
            <button type="button" onClick={() => void moderate('delete')} disabled={!canManage || moderating} className="rounded-lg px-1.5 py-1 text-[10px] font-bold text-rose-500 hover:bg-rose-50 disabled:opacity-40">삭제</button>
          </div>
          {replying && (
            <div className="mt-2 flex items-start gap-1.5">
              <textarea value={replyText} onChange={(event) => setReplyText(event.target.value)} rows={2} maxLength={10000} placeholder="답글을 입력하세요" className="glass-input flex-1 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-900" />
              <button type="button" onClick={() => void submitReply()} disabled={!replyText.trim() || submitting} className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-slate-800 disabled:opacity-50">{submitting ? '등록 중...' : '등록'}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function YoutubeRawDataPage({ onBack, initialTab = '개요' }: { onBack: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [data, setData] = useState<RawDataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedVideoId, setExpandedVideoId] = useState<string | null>(null);

  const [comments, setComments] = useState<ManagedComment[]>([]);
  const [commentsCursor, setCommentsCursor] = useState<string | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  const selectedChannel = channels.find((channel) => channel.social_channel_id === selectedChannelId) || null;

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

  const loadComments = useCallback(async (channelId: string, cursor?: string | null) => {
    setCommentsLoading(true);
    setCommentsError(null);
    try {
      const params = new URLSearchParams({ channel_id: channelId });
      if (cursor) params.set('cursor', cursor);
      const result = await api<CommentsPage>(`/api/social/comments?${params.toString()}`);
      setComments((previous) => (cursor ? [...previous, ...result.comments] : result.comments));
      setCommentsCursor(result.next_cursor);
    } catch (requestError) {
      setCommentsError(requestError instanceof Error ? requestError.message : '댓글을 불러오지 못했습니다.');
    } finally {
      setCommentsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === '댓글 관리' && selectedChannelId) {
      setComments([]);
      setCommentsCursor(null);
      void loadComments(selectedChannelId);
    }
  }, [tab, selectedChannelId, loadComments]);

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

  const handleVideoSaved = (contentId: string, changes: { title: string; body_text: string }) => {
    setData((previous) => previous && { ...previous, videos: previous.videos.map((video) => (video.social_content_id === contentId ? { ...video, ...changes } : video)) });
  };
  const handleVideoDeleted = (contentId: string) => {
    setData((previous) => previous && { ...previous, videos: previous.videos.filter((video) => video.social_content_id !== contentId) });
    setExpandedVideoId(null);
  };
  const handleCommentReplied = (reply: ManagedComment) => {
    setComments((previous) => [reply, ...previous]);
  };
  const handleCommentModerated = (commentId: string, status: string) => {
    setComments((previous) => previous.map((comment) => (comment.social_comment_id === commentId ? { ...comment, visibility_status: status } : comment)));
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

  const canManage = selectedChannel?.can_manage_content ?? false;

  return (
    <div className="mx-auto w-full max-w-6xl px-1 py-2 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white/70 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-white">
            <ArrowLeft className="h-3.5 w-3.5" />대시보드로
          </button>
          <div className="flex items-center gap-1.5"><Database className="h-4 w-4 text-indigo-500" /><h2 className="text-base font-extrabold text-slate-900">원본 데이터</h2></div>
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

      <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200/80 bg-white/50 p-1">
        {TABS.map((label) => (
          <button key={label} type="button" onClick={() => setTab(label)} className={'rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all ' + (tab === label ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white')}>
            {label}
          </button>
        ))}
      </div>

      {error && <div role="alert" className="flex gap-2 rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2.5 text-[11px] text-rose-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}

      {!selectedChannelId && !error && <p className="text-xs text-slate-500">연결된 YouTube 채널이 없습니다. 대시보드의 "연동 정보"에서 채널을 먼저 연결하세요.</p>}

      {selectedChannelId && !canManage && (tab === '영상 관리' || tab === '댓글 관리') && <ScopeBanner channelId={selectedChannelId} />}

      {tab !== '댓글 관리' && loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />불러오는 중입니다.</div>
      ) : null}

      {data && tab === '개요' && (
        <div className="space-y-4">
          <Section title="채널 프로필" subtitle="social_channels + youtube_channel_profiles 전체 컬럼">
            <RawKeyValue data={channelFlat} />
          </Section>
          <Section title="일별 채널 지표" subtitle="youtube_channel_daily_metrics — 최근 동기화된 30일" count={data.daily_metrics.length}>
            <RawTable rows={data.daily_metrics} emptyLabel="아직 동기화된 일별 지표가 없습니다." />
          </Section>
        </div>
      )}

      {data && tab === '영상 관리' && (
        <Section title="영상" subtitle="제목·설명 수정과 삭제는 YouTube에 실제로 반영됩니다. 행을 클릭하면 펼쳐집니다." count={videoRows.length}>
          {videoRows.length === 0 ? <p className="py-3 text-[11px] italic text-slate-400">아직 동기화된 영상이 없습니다.</p> : (
            <div className="max-h-[600px] space-y-1.5 overflow-auto pr-1">
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
                    {isOpen && selectedChannelId && (
                      <div className="space-y-2.5 border-t border-slate-100 px-3 py-2.5">
                        {canManage && <VideoEditor channelId={selectedChannelId} video={video} onSaved={handleVideoSaved} onDeleted={handleVideoDeleted} />}
                        <RawKeyValue data={video} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      )}

      {data && tab === '분석' && (
        <div className="space-y-4">
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
        </div>
      )}

      {tab === '댓글 관리' && selectedChannelId && (
        <Section title="댓글" subtitle="시청자 댓글에 답글을 달거나 숨기기·삭제할 수 있습니다." count={comments.length}>
          {commentsError && <p role="alert" className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-rose-600"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{commentsError}</p>}
          {comments.length === 0 && !commentsLoading ? (
            <p className="flex items-center gap-1.5 py-3 text-[11px] italic text-slate-400"><MessageSquare className="h-3.5 w-3.5" />아직 동기화된 댓글이 없습니다.</p>
          ) : (
            <div className="space-y-1.5">
              {comments.map((comment) => (
                <CommentRow key={comment.social_comment_id} channelId={selectedChannelId} comment={comment} canManage={canManage} onReplied={handleCommentReplied} onModerated={handleCommentModerated} />
              ))}
            </div>
          )}
          {commentsLoading && <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />불러오는 중입니다.</div>}
          {commentsCursor && !commentsLoading && (
            <button type="button" onClick={() => void loadComments(selectedChannelId, commentsCursor)} className="mt-3 w-full rounded-xl border border-slate-200 bg-white/70 py-2 text-[11px] font-bold text-slate-600 hover:bg-white">
              더 보기
            </button>
          )}
        </Section>
      )}

    </div>
  );
}
