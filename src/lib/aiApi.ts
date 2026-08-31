import type { AIAnalysisReport } from '../types';

// AI 종합 진단 / 1:1 컨설턴트. 둘 다 Plus 전용이라 403 PLUS_REQUIRED가 정상 응답 경로에 있다.
// 화면이 잠금 상태와 진짜 오류를 구분해야 하므로 code를 버리지 않고 그대로 올린다.

export class AiApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }

  get isPlusRequired() {
    return this.code === 'PLUS_REQUIRED';
  }

  get isNoChannel() {
    return this.code === 'NO_CONNECTED_CHANNEL';
  }

  /** 할당량과 크레딧이 모두 없을 때. 충전 경로를 보여줘야 한다. */
  get needsCredits() {
    return this.code === 'INSUFFICIENT_CREDITS';
  }
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const payload = response.headers.get('content-type')?.includes('application/json')
    ? ((await response.json()) as T & { error?: { code?: string; message?: string } })
    : null;
  if (!response.ok) {
    throw new AiApiError(payload?.error?.code || 'UNKNOWN', payload?.error?.message || 'AI 요청에 실패했습니다.');
  }
  return payload as T;
}

export type AiReportResponse = {
  model: string;
  generatedAt: string;
  rangeDays: number;
  /** generatedAt은 서버가 채우므로 리포트 본문에는 없다. */
  report: Omit<AIAnalysisReport, 'generatedAt'>;
  usage: UsageStatus;
};

export function requestAiReport(signal?: AbortSignal) {
  return postJson<AiReportResponse>('/api/gemini/analyze', {}, signal);
}

export type UsageStatus = {
  used: number;
  limit: number;
  /** 이번 달 남은 할당량. 크레딧과 합산하지 않는다 — 이월 여부가 다른 별도 잔액이다. */
  remaining: number;
  credits: number;
  /** 할당량을 다 썼을 때 1회당 차감될 크레딧 수. */
  creditCost: number;
};

export type VideoDraft = { title: string; description: string };

/** 이미 올라간 영상의 제목·설명 초안. 저장은 youtubeManageApi.updateVideo가 한다. */
export function requestVideoDraft(socialContentId: string, tone: string, signal?: AbortSignal) {
  return postJson<{ model: string; draft: VideoDraft; usage: UsageStatus }>(
    '/api/gemini/draft',
    { socialContentId, tone },
    signal,
  );
}

export type AdvisorTurn = { role: 'user' | 'model'; text: string };

export function askAdvisor(query: string, history: AdvisorTurn[], signal?: AbortSignal) {
  return postJson<{ model: string; reply: string; usage: UsageStatus }>('/api/gemini/advisor', { query, history }, signal);
}
