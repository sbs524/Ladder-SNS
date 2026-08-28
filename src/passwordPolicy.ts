/**
 * 회원가입 비밀번호 규칙: 8자 이상 + 특수문자 1개 이상.
 * 가입 폼(AuthModal)과 온보딩 3단계(OnboardingHero)가 같은 규칙을 쓴다.
 */
export const PASSWORD_RULE_TEXT = '8자 이상, 특수문자 1개 이상 (!@#$%^&* 등)';

const SPECIAL_CHARS = '!@#$%^&*()_+-=[]{};:\'",.<>/?\\|`~';

export function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return '비밀번호는 8자 이상이어야 합니다.';
  }
  if (![...password].some((c) => SPECIAL_CHARS.includes(c))) {
    return '특수문자를 1개 이상 포함해야 합니다.';
  }
  return null;
}
