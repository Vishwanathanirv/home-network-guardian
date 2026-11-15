# The scanner on its own. Run it on the network you want to scan:
#   docker run --rm --network host -v "$PWD:/out" -w /out lamplight scan
FROM node:22-alpine
WORKDIR /app
COPY scanner/lamplight.cjs ./lamplight.cjs
USER node
ENTRYPOINT ["node", "/app/lamplight.cjs"]
CMD ["--help"]
