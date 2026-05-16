FROM nginx:1.27-alpine

COPY index.html /usr/share/nginx/html/
COPY core /usr/share/nginx/html/core
COPY packages /usr/share/nginx/html/packages

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1
