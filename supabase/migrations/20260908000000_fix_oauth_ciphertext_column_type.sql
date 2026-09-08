-- 라이브 DB의 platform_oauth_grants 토큰 컬럼이 bytea로 만들어져 있었다. 서버는 이 컬럼을
-- base64 문자열(text)로 쓰고 읽는다. 그래서 저장은 "base64 문자열의 ASCII 바이트"로 들어가고,
-- 읽을 때는 PostgREST가 bytea를 '\x...' 16진수 문자열로 돌려줘서 base64 디코딩이 쓰레기값을
-- 만든다 -> AES-GCM 인증 실패("Unsupported state or unable to authenticate data")로 모든
-- 동기화 잡이 실패했다.
--
-- 저장된 바이트가 곧 원래 base64 문자열의 UTF-8이므로 convert_from()으로 무손실 복구된다.
-- 기존 토큰이 그대로 살아나서 사용자가 재연동할 필요가 없다.
begin;

alter table public.platform_oauth_grants
  alter column access_token_ciphertext type text
    using case when access_token_ciphertext is null then null
               else convert_from(access_token_ciphertext, 'UTF8') end,
  alter column refresh_token_ciphertext type text
    using case when refresh_token_ciphertext is null then null
               else convert_from(refresh_token_ciphertext, 'UTF8') end;

commit;
