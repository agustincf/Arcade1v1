# Imagen mínima del servidor MCP de Arcade1v1, para los chequeos automáticos
# de los directorios (Glama y equivalentes): solo necesitan que el server
# arranque por stdio y responda a la introspección. Instala el paquete
# publicado en npm — el mismo que usa cualquier usuario con npx.
FROM node:22-alpine

RUN npm install -g @arcade1v1/mcp

# ARBITER_URL es opcional: por defecto apunta al árbitro publicado.
ENTRYPOINT ["arcade1v1-mcp"]
