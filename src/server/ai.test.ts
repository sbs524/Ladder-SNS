import assert from "node:assert/strict";
import test from "node:test";
import { validateDraft, validateReport } from "./ai";

// validateReport는 모델이 만든 JSON과 화면 사이의 유일한 방어선이다. 여기가 느슨해지면
// 반쯤 비어 있는 리포트가 그대로 렌더링돼 목업 시절보다 나쁜 화면이 나온다.

const validReport = {
  overallScore: 72,
  scoreLabel: "성장 중인 채널",
  summary: "최근 30일 조회수 33,430회, 참여율 4.1%.",
  keyStrengths: ["댓글 비율이 높다"],
  bottlenecks: ["업로드 주기가 불규칙하다"],
  channelAdvice: [{ platform: "youtube", strategy: "쇼츠 비중 확대", tactics: ["주 2회 쇼츠"] }],
  contentRoadmap: [],
};

test("validateReport accepts a well-formed report", () => {
  assert.equal(validateReport(validReport), null);
});

test("validateReport rejects a score outside 0~100", () => {
  assert.notEqual(validateReport({ ...validReport, overallScore: 140 }), null);
  assert.notEqual(validateReport({ ...validReport, overallScore: -1 }), null);
});

test("validateReport rejects a non-numeric score", () => {
  assert.notEqual(validateReport({ ...validReport, overallScore: "94점" }), null);
});

test("validateReport rejects empty strength and bottleneck lists", () => {
  assert.notEqual(validateReport({ ...validReport, keyStrengths: [] }), null);
  assert.notEqual(validateReport({ ...validReport, bottlenecks: [{ text: "객체다" }] }), null);
});

test("validateReport rejects advice without a platform or tactics", () => {
  assert.notEqual(validateReport({ ...validReport, channelAdvice: [{ strategy: "플랫폼 없음", tactics: ["a"] }] }), null);
  assert.notEqual(validateReport({ ...validReport, channelAdvice: [{ platform: "youtube", tactics: [] }] }), null);
});

test("validateReport rejects non-objects, including an array", () => {
  assert.notEqual(validateReport(null), null);
  assert.notEqual(validateReport("{}"), null);
  assert.notEqual(validateReport([validReport]), null);
});

// 초안은 YouTube videos.update의 길이 제약을 그대로 받는다. 여기서 안 걸러내면
// 사용자가 저장을 눌렀을 때 Google이 거부한다.
const validDraft = { title: "타루의 니케 공략 3분 요약", description: "핵심만 정리했습니다.\n\n#니케" };

test("validateDraft accepts a well-formed draft", () => {
  assert.equal(validateDraft(validDraft), null);
});

test("validateDraft rejects an empty title", () => {
  assert.notEqual(validateDraft({ ...validDraft, title: "   " }), null);
});

test("validateDraft rejects a title over the YouTube 100 character limit", () => {
  assert.notEqual(validateDraft({ ...validDraft, title: "가".repeat(101) }), null);
  assert.equal(validateDraft({ ...validDraft, title: "가".repeat(100) }), null);
});

test("validateDraft rejects a description over 5000 characters", () => {
  assert.notEqual(validateDraft({ ...validDraft, description: "가".repeat(5001) }), null);
});

test("validateDraft allows an empty description so the existing one is kept", () => {
  assert.equal(validateDraft({ ...validDraft, description: "" }), null);
});
