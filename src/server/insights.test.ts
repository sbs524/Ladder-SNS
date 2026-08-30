import assert from "node:assert/strict";
import test from "node:test";
import { classifyFormat, formatStats, kstSlot, median, norm, peakTimeByUploadSlot, viralityScore, weightedAverage, type VideoSample } from "./insights";

test("norm anchors at 50 for the reference and saturates at 4x", () => {
  assert.equal(norm(1, 1), 50);
  assert.equal(norm(2, 1), 75);
  assert.equal(norm(4, 1), 100);
  assert.equal(norm(8, 1), 100, "clamps above 4x");
  assert.equal(norm(0.5, 1), 25);
  assert.equal(norm(0.25, 1), 0);
  assert.equal(norm(0, 1), 0, "zero and negatives score 0, never NaN");
});

test("median resists a single breakout value", () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([1, 1, 1, 1, 100000]), 1);
  assert.equal(median([]), 0);
});

test("weightedAverage weights by views and ignores nulls", () => {
  assert.equal(weightedAverage([{ value: 10, weight: 1 }, { value: 20, weight: 3 }]), 17.5);
  assert.equal(weightedAverage([{ value: null, weight: 100 }, { value: 40, weight: 1 }]), 40);
  assert.equal(weightedAverage([{ value: 10, weight: 0 }]), null, "no usable weight means no number");
  assert.equal(weightedAverage([]), null);
});

test("kstSlot buckets by Korean local hour, not UTC", () => {
  // 2026-08-30T20:00Z is 2026-08-31 05:00 KST — dawn, not evening.
  assert.equal(kstSlot("2026-08-30T20:00:00.000Z"), "dawn");
  assert.equal(kstSlot("2026-08-30T00:00:00.000Z"), "morning"); // 09:00 KST
  assert.equal(kstSlot("2026-08-30T04:00:00.000Z"), "afternoon"); // 13:00 KST
  assert.equal(kstSlot("2026-08-30T11:00:00.000Z"), "evening"); // 20:00 KST
  assert.equal(kstSlot("not a date"), null);
});

test("classifyFormat treats live as live regardless of duration", () => {
  assert.equal(classifyFormat(45, "none"), "shorts");
  assert.equal(classifyFormat(180, null), "shorts");
  assert.equal(classifyFormat(181, "none"), "midform");
  assert.equal(classifyFormat(600, "none"), "midform");
  assert.equal(classifyFormat(601, "none"), "longform");
  assert.equal(classifyFormat(45, "live"), "live");
});

test("viralityScore renormalises weights when a component is unavailable", () => {
  const base = { views: 1000, likes: 40, comments: 8, shares: 2, subscribers: 2000, nonSubscriberViews: 500 };
  const full = viralityScore(base);
  assert.equal(full.note, null);
  assert.ok(full.score !== null && full.score >= 0 && full.score <= 100);

  const noBreakdown = viralityScore({ ...base, nonSubscriberViews: null });
  assert.match(noBreakdown.note || "", /구독 상태별/);
  assert.ok(noBreakdown.score !== null && noBreakdown.score >= 0 && noBreakdown.score <= 100);

  // A tiny channel must not produce an infinite reach multiple.
  const tinyChannel = viralityScore({ ...base, subscribers: 3 });
  assert.equal(tinyChannel.components.reachMultiple, null);
  assert.ok(tinyChannel.score !== null && Number.isFinite(tinyChannel.score));
});

test("viralityScore refuses to score a channel with no views", () => {
  const result = viralityScore({ views: 0, likes: 0, comments: 0, shares: 0, subscribers: 500, nonSubscriberViews: null });
  assert.equal(result.score, null);
  assert.match(result.note || "", /조회수/);
});

function sample(publishedAt: string, initialViews: number, format: VideoSample["format"] = "shorts"): VideoSample {
  return { publishedAt, initialViews, format, shares: null };
}

test("peakTimeByUploadSlot stays silent below the minimum sample size", () => {
  const result = peakTimeByUploadSlot([sample("2026-08-01T11:00:00Z", 100), sample("2026-08-02T11:00:00Z", 200)]);
  assert.equal(result.available, false);
  assert.equal(result.best, null);
  assert.match(result.reason || "", /12개 이상/);
});

test("peakTimeByUploadSlot ranks the slot whose median outperforms the channel", () => {
  const videos: VideoSample[] = [];
  // 6 evening uploads (20:00 KST) at ~1000 views, 6 dawn uploads (05:00 KST) at ~100.
  for (let index = 0; index < 6; index += 1) videos.push(sample(`2026-08-0${index + 1}T11:00:00Z`, 1000 + index));
  for (let index = 0; index < 6; index += 1) videos.push(sample(`2026-08-1${index}T20:00:00Z`, 100 + index));

  const result = peakTimeByUploadSlot(videos);
  assert.equal(result.available, true);
  assert.equal(result.best?.slot, "evening");
  assert.equal(result.best?.videoCount, 6);
  assert.ok((result.best?.multiple ?? 0) > 1, "winning slot beats the channel median");
});

test("formatStats needs three videos before it will call a format best", () => {
  const thin = formatStats([sample("2026-08-01T11:00:00Z", 500, "shorts"), sample("2026-08-02T11:00:00Z", 400, "longform")]);
  assert.equal(thin.best, null, "two videos across two formats is not evidence");

  const enough = formatStats([
    sample("2026-08-01T11:00:00Z", 1000, "shorts"),
    sample("2026-08-02T11:00:00Z", 1100, "shorts"),
    sample("2026-08-03T11:00:00Z", 900, "shorts"),
    sample("2026-08-04T11:00:00Z", 100, "longform"),
    sample("2026-08-05T11:00:00Z", 120, "longform"),
    sample("2026-08-06T11:00:00Z", 90, "longform"),
  ]);
  assert.equal(enough.best?.format, "shorts");
  assert.equal(enough.stats.find((stat) => stat.format === "shorts")?.videoCount, 3);
});
