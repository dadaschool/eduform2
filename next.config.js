/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * 교내 서버(윈도우) 설치에서 데이터 API 를 PostgREST 로 넘긴다.
   *
   * 클라이언트 라이브러리는 <주소>/rest/v1/... 로 요청한다. 그 주소를 이 앱으로
   * 두고, 여기서 같은 컴퓨터의 PostgREST 로 전달한다. Kong 같은 게이트웨이를
   * 따로 두지 않아도 되고, 바깥에 열리는 포트가 3000 하나로 끝난다.
   * PostgREST 와 Postgres 는 127.0.0.1 에만 붙여 두면 밖에서 보이지 않는다.
   *
   * POSTGREST_URL 이 없으면 아무것도 하지 않는다. 클라우드 Supabase 로 쓰는
   * 배포에는 이 규칙이 필요 없기 때문이다.
   */
  async rewrites() {
    const target = process.env.POSTGREST_URL
    if (!target) return []
    const base = target.replace(/\/+$/, '')
    return [{ source: '/rest/v1/:path*', destination: `${base}/:path*` }]
  },
}

module.exports = nextConfig
