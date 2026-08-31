import { PlatformConfig } from '../types';

// 플랫폼 메타(색·아이콘·한글명)만 남았다. 지표 목업은 전부 실 API로 대체됨.
export const PLATFORM_CONFIGS: Record<string, PlatformConfig> = {
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    koreanName: '유튜브',
    color: '#FF0000',
    bgColor: 'bg-red-500',
    lightBg: 'bg-red-500/10',
    borderColor: 'border-red-200',
    textColor: 'text-red-600',
    icon: 'Youtube',
    description: '동영상, 쇼츠 및 커뮤니티 시청자 지표 분석',
  },
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    koreanName: '인스타그램',
    color: '#E1306C',
    bgColor: 'bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600',
    lightBg: 'bg-rose-500/10',
    borderColor: 'border-rose-200',
    textColor: 'text-rose-600',
    icon: 'Instagram',
    description: '릴스 도달, 피드 인터랙션 및 스토리 분석',
  },
  threads: {
    id: 'threads',
    name: 'Threads',
    koreanName: '쓰레드',
    color: '#000000',
    bgColor: 'bg-black',
    lightBg: 'bg-slate-900/10',
    borderColor: 'border-slate-300',
    textColor: 'text-slate-900',
    icon: 'AtSign',
    description: '텍스트 스레드 반응, 답글 및 리포스트 추적',
  },
  x: {
    id: 'x',
    name: 'X (Twitter)',
    koreanName: 'X (트위터)',
    color: '#0F1419',
    bgColor: 'bg-slate-900',
    lightBg: 'bg-sky-500/10',
    borderColor: 'border-slate-300',
    textColor: 'text-slate-900',
    icon: 'Twitter',
    description: '실시간 트윗 임프레션, 리트윗 및 북마크 분석',
  },
};

