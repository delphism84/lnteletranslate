# 4개 봇 웹훅 Nginx 설정

백엔드 1개(포트 64000)로 4개 봇을 처리합니다. Nginx에 아래 location 블록을 추가하세요.

```nginx
# lnteletranslate 4개 봇 웹훅 (단일 백엔드 64000)
location /telegram-webhook-d {
    proxy_pass https://127.0.0.1:64000/telegram-webhook-d;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_ssl_verify off;
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}
location /telegram-webhook-2 {
    proxy_pass https://127.0.0.1:64000/telegram-webhook-2;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_ssl_verify off;
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}
location /telegram-webhook-1 {
    proxy_pass https://127.0.0.1:64000/telegram-webhook-1;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_ssl_verify off;
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}
location /telegram-webhook-m {
    proxy_pass https://127.0.0.1:64000/telegram-webhook-m;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_ssl_verify off;
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}
```

- 적용 대상: `server.lunarsystem.co.kr` 서버 블록
- 기존 `/telegram-webhook`, `/telegram-webhook-jo`, `/telegram-webhook-vietnam` 블록은 위 4개로 교체하거나 제거
