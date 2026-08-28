import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePassword } from './passwordPolicy';

test('8자 미만은 거부', () => {
  assert.match(validatePassword('a!1') ?? '', /8자 이상/);
  assert.match(validatePassword('abcdef!') ?? '', /8자 이상/);
});

test('특수문자가 없으면 거부', () => {
  assert.match(validatePassword('abcdefgh') ?? '', /특수문자/);
  assert.match(validatePassword('Password123') ?? '', /특수문자/);
});

test('8자 이상 + 특수문자면 통과', () => {
  assert.equal(validatePassword('abcdefg!'), null);
  assert.equal(validatePassword('Ladder@2026'), null);
  assert.equal(validatePassword('12345678~'), null);
});

test('한글은 특수문자로 치지 않는다', () => {
  assert.match(validatePassword('비밀번호입니다요') ?? '', /특수문자/);
});
