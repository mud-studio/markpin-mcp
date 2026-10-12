# Glama directory checks only: starts the published server on an empty folder so it can answer MCP introspection.
# Everyone else installs with `npx -y @markpin/mcp --dir <folder>` (see mcp-server/README.md).
FROM node:22-alpine
RUN npm install -g @markpin/mcp@0.8.0 && mkdir -p /data/pages && chown -R node /data
USER node
CMD ["markpin-mcp", "--dir", "/data"]
