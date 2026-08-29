type ApiErrorPayload = { error?: { message?: string } };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = response.headers.get('content-type')?.includes('application/json')
    ? ((await response.json()) as T & ApiErrorPayload)
    : null;
  if (!response.ok) throw new Error(body?.error?.message || '요청을 처리하지 못했습니다.');
  return body as T;
}

export type ManagedVideo = { social_content_id: string; title: string | null; body_text: string | null };
export type ManagedComment = {
  social_comment_id: string;
  social_channel_id: string;
  social_content_id: string | null;
  external_comment_id: string;
  parent_social_comment_id: string | null;
  comment_kind: string;
  author_display_name: string | null;
  author_avatar_url: string | null;
  body_text: string | null;
  like_count: number | null;
  source_published_at: string | null;
  visibility_status: string;
};

export function updateVideo(channelId: string, contentId: string, changes: { title?: string; description?: string }) {
  return api<{ video: ManagedVideo }>(`/api/connections/youtube/${channelId}/videos/${contentId}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

export function deleteVideo(channelId: string, contentId: string) {
  return api<void>(`/api/connections/youtube/${channelId}/videos/${contentId}`, { method: 'DELETE' });
}

export function replyToComment(channelId: string, commentId: string, body: string) {
  return api<{ comment: ManagedComment }>(`/api/connections/youtube/${channelId}/comments/${commentId}/reply`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export function moderateComment(channelId: string, commentId: string, action: 'hide' | 'delete') {
  return api<void>(`/api/connections/youtube/${channelId}/comments/${commentId}/moderate`, {
    method: 'PATCH',
    body: JSON.stringify({ action }),
  });
}
